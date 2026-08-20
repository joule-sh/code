import { jsonChoiceText, jsonChoiceString, jsonErrorText, jsonHasError } from "https://lumen-lang.org/package/std-contrib/ai/core/jsonscan.ts";
import { jsonObjectOf, jsonArrayOf, JsonField } from "https://lumen-lang.org/package/std-contrib/jsonrpc/rpc.ts";
import { toolCallFragments, ToolCallAssembler } from "./toolcalls.ts";
import { Message, ProviderReply } from "../session/types.ts";

export type ProviderConfig = { baseUrl: string, model: string, apiKey: string };

export type ToolSchema = { name: string, description: string, parametersJson: string };

export function authHeaders(apiKey: string): Map<string, string> {
  let h = new Map<string, string>();
  h.set("Content-Type", "application/json");
  if (apiKey != "") {
    h.set("Authorization", "Bearer " + apiKey);
  }
  return h;
}

function messageJson(m: Message): string {
  let fields: JsonField[] = [
    { key: "role", json: JSON.stringify(m.role) },
    { key: "content", json: JSON.stringify(m.text) },
  ];
  return jsonObjectOf(fields);
}

function toolJson(t: ToolSchema): string {
  let fnFields: JsonField[] = [
    { key: "name", json: JSON.stringify(t.name) },
    { key: "description", json: JSON.stringify(t.description) },
    { key: "parameters", json: t.parametersJson },
  ];
  let outer: JsonField[] = [
    { key: "type", json: JSON.stringify("function") },
    { key: "function", json: jsonObjectOf(fnFields) },
  ];
  return jsonObjectOf(outer);
}

export function requestBody(model: string, messages: Message[], tools: ToolSchema[]): string {
  let msgParts: string[] = [];
  for (const m of messages) {
    msgParts.push(messageJson(m));
  }
  let toolParts: string[] = [];
  for (const t of tools) {
    toolParts.push(toolJson(t));
  }

  let fields: JsonField[] = [
    { key: "model", json: JSON.stringify(model) },
    { key: "messages", json: jsonArrayOf(msgParts) },
    { key: "stream", json: "true" },
  ];
  if (toolParts.length > 0) {
    fields.push({ key: "tools", json: jsonArrayOf(toolParts) });
  }
  return jsonObjectOf(fields);
}

export function errorReplyFromBody(status: int, raw: string): ProviderReply {
  let msg = jsonErrorText(raw);
  if (msg == "") { msg = raw; }
  let code = "E_HTTP_" + `${status}`;
  return { text: "", calls: [], failed: true, errorCode: code, errorMessage: msg };
}

export function consumeStream(readLine: () => string, isDone: () => bool, shouldStop: () => bool, onDelta: (text: string) => void): ProviderReply {
  let assembler = new ToolCallAssembler();
  let text = "";
  let sawFinish = false;

  while (!isDone() && !shouldStop()) {
    let line = readLine();
    if (line == "") { continue; }
    if (line.length < 6 || line.slice(0, 6) != "data: ") { continue; }
    let payload = line.slice(6);
    if (payload == "[DONE]") { break; }

    if (jsonHasError(payload)) {
      let msg = jsonErrorText(payload);
      return { text: "", calls: [], failed: true, errorCode: "E_STREAM", errorMessage: msg };
    }

    let delta = jsonChoiceText(payload, "delta");
    if (delta != "") {
      text = text + delta;
      onDelta(delta);
    }

    let frags = toolCallFragments(payload);
    for (const f of frags) {
      assembler.add(f);
    }

    let finish = jsonChoiceString(payload, "finish_reason");
    if (finish != "") {
      sawFinish = true;
    }
  }

  let calls = assembler.build();

  if (text == "" && calls.length == 0 && sawFinish) {
    let msg = "the model returned an empty answer (finish_reason set, no text, no tool calls) - likely a thinking-mode response with the answer consumed silently";
    return { text: "", calls: [], failed: true, errorCode: "E_EMPTY_ANSWER", errorMessage: msg };
  }

  return { text: text, calls: calls, failed: false, errorCode: "", errorMessage: "" };
}

export function streamChat(cfg: ProviderConfig, messages: Message[], tools: ToolSchema[], onDelta: (text: string) => void, shouldStop: () => bool): ProviderReply {
  let body = requestBody(cfg.model, messages, tools);
  let url = cfg.baseUrl + "/v1/chat/completions";
  let s = http.stream(url, "POST", body, authHeaders(cfg.apiKey));

  let status = s.status();
  if (status != 200) {
    let raw = "";
    while (!s.done()) {
      raw = raw + s.readLine() + "\n";
    }
    s.close();
    return errorReplyFromBody(status, raw);
  }

  let readLineFn = () => s.readLine();
  let isDoneFn = () => s.done();
  let reply = consumeStream(readLineFn, isDoneFn, shouldStop, onDelta);
  s.close();
  return reply;
}
