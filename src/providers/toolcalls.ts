import { jsonFirstChoice, jsonMemberStart, jsonStringMemberAt, jsonIntMemberAt } from "https://lumen-lang.org/package/std-contrib/ai/core/jsonscan.ts";
import { ToolCallReq } from "../session/types.ts";

export type ToolCallFragment = { index: int, id: string, name: string, argsChunk: string };

export function jsonSkipSpace(s: string, i: int): int {
  let j = i;
  while (j < s.length) {
    let c = s.charAt(j);
    if (c != " " && c != "\n" && c != "\t" && c != "\r") { break; }
    j = j + 1;
  }
  return j;
}

export function jsonSkipValue(s: string, i: int): int {
  let j = jsonSkipSpace(s, i);
  if (j >= s.length) { return j; }
  let c = s.charAt(j);
  if (c == "{" || c == "[") {
    let depth = 0;
    let inStr = false;
    while (j < s.length) {
      let ch = s.charAt(j);
      if (inStr) {
        if (ch == "\\") { j = j + 2; continue; }
        if (ch == "\"") { inStr = false; }
        j = j + 1;
        continue;
      }
      if (ch == "\"") { inStr = true; j = j + 1; continue; }
      if (ch == "{" || ch == "[") { depth = depth + 1; }
      if (ch == "}" || ch == "]") {
        depth = depth - 1;
        if (depth == 0) { return j + 1; }
      }
      j = j + 1;
    }
    return j;
  }
  if (c == "\"") {
    let j2 = j + 1;
    while (j2 < s.length) {
      let ch = s.charAt(j2);
      if (ch == "\\") { j2 = j2 + 2; continue; }
      if (ch == "\"") { return j2 + 1; }
      j2 = j2 + 1;
    }
    return j2;
  }
  while (j < s.length) {
    let ch = s.charAt(j);
    if (ch == "," || ch == "}" || ch == "]") { break; }
    j = j + 1;
  }
  return j;
}

export function jsonQuotedAt(s: string, at: int): string {
  let j = jsonSkipSpace(s, at);
  if (j >= s.length || s.charAt(j) != "\"") { return ""; }
  j = j + 1;
  let out = "";
  while (j < s.length) {
    let ch = s.charAt(j);
    if (ch == "\"") { return out; }
    if (ch == "\\") {
      let esc = s.charAt(j + 1);
      if (esc == "n") { out = out + "\n"; }
      else if (esc == "t") { out = out + "\t"; }
      else if (esc == "r") { out = out + "\r"; }
      else if (esc == "u") { out = out + "?"; j = j + 4; }
      else { out = out + esc; }
      j = j + 2;
      continue;
    }
    out = out + ch;
    j = j + 1;
  }
  return out;
}

export function toolCallFragments(doc: string): ToolCallFragment[] {
  let out: ToolCallFragment[] = [];
  let choice = jsonFirstChoice(doc);
  if (choice < 0) { return out; }
  let deltaAt = jsonMemberStart(doc, choice, "delta");
  if (deltaAt < 0) { return out; }
  let arrAt = jsonMemberStart(doc, deltaAt, "tool_calls");
  if (arrAt < 0) { return out; }
  let j = jsonSkipSpace(doc, arrAt);
  if (j >= doc.length || doc.charAt(j) != "[") { return out; }
  j = j + 1;
  while (j < doc.length) {
    j = jsonSkipSpace(doc, j);
    if (j >= doc.length || doc.charAt(j) == "]") { break; }
    let elemStart = j;
    let idx = jsonIntMemberAt(doc, elemStart, "index");
    let id = jsonStringMemberAt(doc, elemStart, "id");
    let name = "";
    let args = "";
    let fnAt = jsonMemberStart(doc, elemStart, "function");
    if (fnAt >= 0) {
      name = jsonStringMemberAt(doc, fnAt, "name");
      args = jsonStringMemberAt(doc, fnAt, "arguments");
    }
    out.push({ index: idx, id: id, name: name, argsChunk: args });
    j = jsonSkipValue(doc, elemStart);
    j = jsonSkipSpace(doc, j);
    if (j < doc.length && doc.charAt(j) == ",") { j = j + 1; }
  }
  return out;
}

function ensureLenStr(arr: string[], n: int): string[] {
  let out = arr;
  while (out.length <= n) {
    out = [...out, ""];
  }
  return out;
}

function ensureLenBool(arr: bool[], n: int): bool[] {
  let out = arr;
  while (out.length <= n) {
    out = [...out, false];
  }
  return out;
}

function setAtStr(arr: string[], i: int, v: string): string[] {
  return [...arr.slice(0, i), v, ...arr.slice(i + 1)];
}

function setAtBool(arr: bool[], i: int, v: bool): bool[] {
  return [...arr.slice(0, i), v, ...arr.slice(i + 1)];
}

export class ToolCallAssembler {
  ids: string[];
  names: string[];
  args: string[];
  seenFlags: bool[];

  constructor() {
    this.ids = [];
    this.names = [];
    this.args = [];
    this.seenFlags = [];
  }

  add(frag: ToolCallFragment): void {
    this.ids = ensureLenStr(this.ids, frag.index);
    this.names = ensureLenStr(this.names, frag.index);
    this.args = ensureLenStr(this.args, frag.index);
    this.seenFlags = ensureLenBool(this.seenFlags, frag.index);

    this.seenFlags = setAtBool(this.seenFlags, frag.index, true);
    if (frag.id != "") { this.ids = setAtStr(this.ids, frag.index, "" + frag.id); }
    if (frag.name != "") { this.names = setAtStr(this.names, frag.index, "" + frag.name); }
    let combined = this.args[frag.index] + frag.argsChunk;
    this.args = setAtStr(this.args, frag.index, combined);
  }

  build(): ToolCallReq[] {
    let out: ToolCallReq[] = [];
    let i = 0;
    while (i < this.ids.length) {
      if (this.seenFlags[i]) {
        out.push({ callId: this.ids[i], tool: this.names[i], args: this.args[i] });
      }
      i = i + 1;
    }
    return out;
  }
}
