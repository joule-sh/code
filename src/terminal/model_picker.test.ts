import { parseModelIds, buildModelEntries } from "./model_picker.ts";
import { PendingModelPick, ModelEntry, MODEL_KIND_HEADER, MODEL_KIND_NOTE, MODEL_KIND_MODEL } from "./input_state.ts";
import { ProviderConfig } from "../providers/openai.ts";

function cfg(model: string, baseUrl: string): ProviderConfig {
  let c: ProviderConfig = { baseUrl: baseUrl, model: model, apiKey: "sk-test" };
  return c;
}

test("parseModelIds reads every id from an OpenAI-shape list, in order", () => {
  let body = "{\"object\":\"list\",\"data\":[{\"id\":\"gpt-4o\",\"object\":\"model\"},{\"id\":\"gpt-4o-mini\",\"object\":\"model\"}]}";
  let ids = parseModelIds(body);
  expect(ids.length == 2);
  expect(ids[0] == "gpt-4o");
  expect(ids[1] == "gpt-4o-mini");
});

test("parseModelIds reads the DeepSeek list shape too", () => {
  let body = "{\"object\":\"list\",\"data\":[{\"id\":\"deepseek-chat\",\"object\":\"model\",\"owned_by\":\"deepseek\"},{\"id\":\"deepseek-reasoner\",\"object\":\"model\",\"owned_by\":\"deepseek\"}]}";
  let ids = parseModelIds(body);
  expect(ids.length == 2);
  expect(ids[0] == "deepseek-chat");
  expect(ids[1] == "deepseek-reasoner");
});

test("parseModelIds takes only each element's own id, never one nested in a permission array", () => {
  let body = "{\"data\":[{\"id\":\"gpt-4\",\"permission\":[{\"id\":\"modelperm-abc\",\"object\":\"model_permission\"}]},{\"id\":\"gpt-3.5\"}]}";
  let ids = parseModelIds(body);
  expect(ids.length == 2);
  expect(ids[0] == "gpt-4");
  expect(ids[1] == "gpt-3.5");
});

test("parseModelIds is empty for a body with no data array, and for an empty one", () => {
  expect(parseModelIds("{\"error\":{\"message\":\"nope\"}}").length == 0);
  expect(parseModelIds("not json at all").length == 0);
  expect(parseModelIds("{\"object\":\"list\",\"data\":[]}").length == 0);
});

test("buildModelEntries leads with the current model as the keep affordance, then the provider group named by platform", () => {
  let ids: string[] = ["deepseek-chat", "deepseek-reasoner"];
  let entries = buildModelEntries(cfg("deepseek-chat", "https://api.deepseek.com"), ids);
  expect(entries[0].kind == MODEL_KIND_MODEL);
  expect(entries[0].id == "deepseek-chat");
  expect(entries[0].label.indexOf("deepseek/deepseek-chat") >= 0);
  expect(entries[0].label.indexOf("(current)") >= 0);
  expect(entries[1].kind == MODEL_KIND_HEADER);
  expect(entries[1].label.indexOf("deepseek") >= 0);
});

test("buildModelEntries shows provider rows by their qualified platform/model name but keeps the wire id", () => {
  let ids: string[] = ["deepseek-chat", "deepseek-reasoner"];
  let entries = buildModelEntries(cfg("deepseek-chat", "https://api.deepseek.com"), ids);
  let reasoner: ModelEntry = { kind: "", label: "", id: "" };
  let i = 0;
  while (i < entries.length) {
    if (entries[i].id == "deepseek-reasoner") { reasoner = entries[i]; }
    i = i + 1;
  }
  expect(reasoner.kind == MODEL_KIND_MODEL);
  expect(reasoner.label == "deepseek/deepseek-reasoner");
});

test("buildModelEntries does not list the current model twice - it is dropped from the provider rows", () => {
  let ids: string[] = ["deepseek-chat", "deepseek-reasoner"];
  let entries = buildModelEntries(cfg("deepseek-chat", "https://api.deepseek.com"), ids);
  let seen = 0;
  let i = 0;
  while (i < entries.length) {
    if (entries[i].kind == MODEL_KIND_MODEL && entries[i].id == "deepseek-chat") { seen = seen + 1; }
    i = i + 1;
  }
  expect(seen == 1);
});

test("buildModelEntries always ends with the joule.sh group and its not-available note", () => {
  let none: string[] = [];
  let entries = buildModelEntries(cfg("m", "https://api.deepseek.com"), none);
  let last = entries[entries.length - 1];
  let secondLast = entries[entries.length - 2];
  expect(secondLast.kind == MODEL_KIND_HEADER);
  expect(secondLast.label == "joule.sh");
  expect(last.kind == MODEL_KIND_NOTE);
});

test("buildModelEntries notes when the provider listed nothing, and offers no provider rows", () => {
  let none: string[] = [];
  let entries = buildModelEntries(cfg("m", "https://api.deepseek.com"), none);
  let providerModels = 0;
  let i = 0;
  while (i < entries.length) {
    if (entries[i].kind == MODEL_KIND_MODEL && entries[i].id != "m") { providerModels = providerModels + 1; }
    i = i + 1;
  }
  expect(providerModels == 0);
});

test("moveSelection steps over headers and notes to land on the next model", () => {
  let entries: ModelEntry[] = [
    { kind: MODEL_KIND_MODEL, label: "current", id: "current" },
    { kind: MODEL_KIND_HEADER, label: "configured provider", id: "" },
    { kind: MODEL_KIND_MODEL, label: "other", id: "other" },
    { kind: MODEL_KIND_HEADER, label: "joule.sh", id: "" },
    { kind: MODEL_KIND_NOTE, label: "not available", id: "" },
  ];
  let p = new PendingModelPick();
  p.open(entries);
  expect(p.selected == 0);
  expect(p.moveSelection(1));
  expect(p.selected == 2);
  expect(p.selectedEntry().id == "other");
});

test("moveSelection clamps at the ends rather than wrapping, and past the last model it will not move onto a note", () => {
  let entries: ModelEntry[] = [
    { kind: MODEL_KIND_MODEL, label: "current", id: "current" },
    { kind: MODEL_KIND_MODEL, label: "other", id: "other" },
    { kind: MODEL_KIND_HEADER, label: "joule.sh", id: "" },
    { kind: MODEL_KIND_NOTE, label: "not available", id: "" },
  ];
  let p = new PendingModelPick();
  p.open(entries);
  expect(!p.moveSelection(-1));
  expect(p.selected == 0);
  expect(p.moveSelection(1));
  expect(p.selected == 1);
  expect(!p.moveSelection(1));
  expect(p.selected == 1);
});
