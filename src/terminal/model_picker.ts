import { jsonMemberStart, jsonStringMemberAt } from "https://lumen-lang.org/package/std-contrib/ai/core/jsonscan.ts";
import { ProviderConfig, authHeaders } from "../providers/openai.ts";
import { platformOf, qualifiedModel, displayModel } from "../providers/platform.ts";
import { serverHost } from "../auth/server.ts";
import { LiveProvider } from "../providers/live.ts";
import { Session } from "../session/session.ts";
import { announceModel } from "./announce.ts";
import { Scrollback } from "./scrollback.ts";
import { PendingModelPick, ModelEntry, MODEL_KIND_HEADER, MODEL_KIND_NOTE, MODEL_KIND_MODEL } from "./input_state.ts";
import { REVERSE, DIM, ACCENT, BOLD, RESET, wrap } from "./style.ts";

const OPTION_INDENT: string = "    ";
const MARKER_ON: string = "> ";
const MARKER_OFF: string = "  ";
const JOULE_GROUP: string = "joule.sh";
const JOULE_NOTE: string = "hosted models not available yet";
const PROVIDER_NONE: string = "no models listed - switch by typing /model <name>";

// The index just past the JSON string that opens at `i` (the opening quote),
// skipping escapes. -1 if it never closes. A local copy of jsonscan's private
// string walker, which `elementEnd` leans on.
function stringEnd(s: string, i: int): int {
  let j = i + 1;
  while (j < s.length) {
    let c = s.charAt(j);
    if (c == "\\") { j = j + 2; continue; }
    if (c == "\"") { return j + 1; }
    j = j + 1;
  }
  return -1;
}

// The index just past the array element that opens at `i` (an object `{...}`),
// braces matched and strings skipped whole so a bracket inside a string never
// moves the depth. -1 on a malformed tail. Lets `parseModelIds` step from one
// `data` element to the next without a full JSON parser.
function elementEnd(s: string, i: int): int {
  let depth = 0;
  let k = i;
  while (k < s.length) {
    let d = s.charAt(k);
    if (d == "\"") {
      let e = stringEnd(s, k);
      if (e < 0) { return -1; }
      k = e;
      continue;
    }
    if (d == "{" || d == "[") { depth = depth + 1; }
    if (d == "}" || d == "]") {
      depth = depth - 1;
      if (depth == 0) { return k + 1; }
    }
    k = k + 1;
  }
  return -1;
}

function isSpace(c: string): bool {
  return c == " " || c == "\t" || c == "\n" || c == "\r";
}

// Every `id` in an OpenAI-shape `{"data":[{"id":"..."},...]}` model list, in
// order. Reads only each element's own `id`, so a nested `id` (an older
// response embeds `id` inside a `permission` array) is never mistaken for a
// model name. Returns [] for any body without a `data` array.
export function parseModelIds(body: string): string[] {
  let out: string[] = [];
  let at = jsonMemberStart(body, 0, "data");
  if (at < 0) { return out; }
  let i = at;
  while (i < body.length && isSpace(body.charAt(i))) { i = i + 1; }
  if (i >= body.length || body.charAt(i) != "[") { return out; }
  i = i + 1;
  while (i < body.length) {
    while (i < body.length && (isSpace(body.charAt(i)) || body.charAt(i) == ",")) { i = i + 1; }
    if (i >= body.length || body.charAt(i) == "]") { break; }
    if (body.charAt(i) != "{") { break; }
    let id = jsonStringMemberAt(body, i, "id");
    if (id != "") { out.push(id); }
    let e = elementEnd(body, i);
    if (e <= i) { break; }
    i = e;
  }
  return out;
}

// The wire model ids the configured provider advertises, or [] if it cannot be
// reached or answers with anything but a 200 list. The path mirrors the chat
// call (`baseUrl + "/v1/..."`) so whatever base works for turns works here.
export function fetchModelIds(cfg: ProviderConfig): string[] {
  let resp = http.request(cfg.baseUrl + "/v1/models", "GET", "", authHeaders(cfg.apiKey));
  if (!resp.ok || resp.status != 200) {
    let none: string[] = [];
    return none;
  }
  return parseModelIds(resp.body);
}

function makeEntry(kind: string, label: string, id: string): ModelEntry {
  let e: ModelEntry = { kind: kind, label: label, id: id };
  return e;
}

function providerLabel(baseUrl: string): string {
  let platform = platformOf(baseUrl);
  if (platform != "") { return platform; }
  let host = serverHost(baseUrl);
  if (host != "") { return host; }
  return baseUrl;
}

// The picker's rows: the current model first (selecting it is the no-op / keep
// affordance), then the configured provider's models under its platform name,
// then the joule.sh group - which today is a single "not available yet" note,
// since the platform exposes no inference to list against. Provider rows carry
// the wire id in `id` and the qualified "platform/model" name in `label`;
// `providerIds` is passed in (not fetched here) so this stays pure and testable.
export function buildModelEntries(cfg: ProviderConfig, providerIds: string[]): ModelEntry[] {
  let entries: ModelEntry[] = [];
  entries.push(makeEntry(MODEL_KIND_MODEL, displayModel(cfg) + "  (current)", cfg.model));

  entries.push(makeEntry(MODEL_KIND_HEADER, "configured provider - " + providerLabel(cfg.baseUrl), ""));
  if (providerIds.length == 0) {
    entries.push(makeEntry(MODEL_KIND_NOTE, PROVIDER_NONE, ""));
  } else {
    let i = 0;
    while (i < providerIds.length) {
      if (providerIds[i] != cfg.model) {
        entries.push(makeEntry(MODEL_KIND_MODEL, qualifiedModel(cfg.baseUrl, providerIds[i]), providerIds[i]));
      }
      i = i + 1;
    }
  }

  entries.push(makeEntry(MODEL_KIND_HEADER, JOULE_GROUP, ""));
  entries.push(makeEntry(MODEL_KIND_NOTE, JOULE_NOTE, ""));
  return entries;
}

export function modelEntryRow(e: ModelEntry, isSelected: bool): string {
  if (e.kind == MODEL_KIND_HEADER) {
    return "  " + wrap(BOLD + ACCENT, e.label);
  }
  if (e.kind == MODEL_KIND_NOTE) {
    return OPTION_INDENT + wrap(DIM, e.label);
  }
  if (isSelected) {
    return OPTION_INDENT + REVERSE + MARKER_ON + e.label + RESET;
  }
  return OPTION_INDENT + DIM + MARKER_OFF + e.label + RESET;
}

const PICKER_TITLE: string = "switch model";
const PICKER_HINT: string = "  (up/down to move, enter to choose)";

function pickerBody(pending: PendingModelPick): string {
  let out = "";
  let i = 0;
  while (i < pending.entries.length) {
    if (i > 0) { out = out + "\n"; }
    out = out + modelEntryRow(pending.entries[i], i == pending.selected);
    i = i + 1;
  }
  return out;
}

export function openModelPick(pending: PendingModelPick, sb: Scrollback, entries: ModelEntry[]): void {
  pending.open(entries);
  sb.append("\n" + wrap(BOLD, PICKER_TITLE) + wrap(DIM, PICKER_HINT) + "\n" + pickerBody(pending));
  pending.setOptionRows(sb.lineCount() - pending.entries.length);
}

export function repaintModelPick(sb: Scrollback, pending: PendingModelPick): void {
  if (!pending.hasOptionRows()) { return; }
  let i = 0;
  while (i < pending.entries.length) {
    sb.setLine(pending.firstOptionRow + i, modelEntryRow(pending.entries[i], i == pending.selected));
    i = i + 1;
  }
}

export function tryHandleModelPickArrow(pending: PendingModelPick, sb: Scrollback, inputEmpty: bool, delta: int): bool {
  if (!pending.isPending() || !inputEmpty) { return false; }
  if (pending.moveSelection(delta)) { repaintModelPick(sb, pending); }
  return true;
}

// A printable key while the picker is open is swallowed (the picker is modal, so
// typing must not leak into the input line) unless the input already holds text
// - then the caller is mid-command and the picker isn't really in focus.
export function tryHandleModelPickChar(pending: PendingModelPick, inputEmpty: bool): bool {
  if (!pending.isPending() || !inputEmpty) { return false; }
  return true;
}

export function tryHandleModelPickEnter(pending: PendingModelPick, live: LiveProvider, session: Session, sb: Scrollback, inputEmpty: bool): bool {
  if (!pending.isPending() || !inputEmpty) { return false; }
  let chosen = pending.selectedEntry();
  pending.close();
  if (chosen.kind == MODEL_KIND_MODEL && chosen.id != "" && chosen.id != live.cfg.model) {
    live.cfg = { baseUrl: live.cfg.baseUrl, model: chosen.id, apiKey: live.cfg.apiKey };
    announceModel(session, displayModel(live.cfg));
  } else {
    sb.append("\n" + wrap(DIM, "model unchanged (" + displayModel(live.cfg) + ")"));
  }
  return true;
}
