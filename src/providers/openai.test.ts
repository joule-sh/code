import { consumeStream, errorReplyFromBody, requestBody, ToolSchema } from "./openai.ts";
import { Message } from "../session/types.ts";

class LineQueue {
  lines: string[];
  idx: int;
  constructor(lines: string[]) {
    this.lines = lines;
    this.idx = 0;
  }
  next(): string {
    let l = this.lines[this.idx];
    this.idx = this.idx + 1;
    return l;
  }
  finished(): bool {
    return this.idx >= this.lines.length;
  }
}

class Collector {
  seen: string[];
  constructor() { this.seen = []; }
  add(s: string): void { this.seen.push(s); }
}

test("a plain completion assembles text and streams deltas", () => {
  let q = new LineQueue([
    "data: {\"choices\":[{\"index\":0,\"delta\":{\"content\":\"Hello\"},\"finish_reason\":null}]}",
    "",
    "data: {\"choices\":[{\"index\":0,\"delta\":{\"content\":\" world\"},\"finish_reason\":null}]}",
    "",
    "data: {\"choices\":[{\"index\":0,\"delta\":{},\"finish_reason\":\"stop\"}]}",
    "",
    "data: [DONE]",
  ]);
  let collector = new Collector();
  let reply = consumeStream(() => q.next(), () => q.finished(), (t: string) => { collector.add(t); });

  expect(!reply.failed);
  expect(reply.text == "Hello world");
  expect(collector.seen.length == 2);
  expect(collector.seen[0] == "Hello");
  expect(reply.calls.length == 0);
});

test("fragmented tool-call arguments assemble by index across chunks", () => {
  let q = new LineQueue([
    "data: {\"choices\":[{\"index\":0,\"delta\":{\"tool_calls\":[{\"index\":0,\"id\":\"call_1\",\"type\":\"function\",\"function\":{\"name\":\"read_file\",\"arguments\":\"\"}}]},\"finish_reason\":null}]}",
    "",
    "data: {\"choices\":[{\"index\":0,\"delta\":{\"tool_calls\":[{\"index\":0,\"function\":{\"arguments\":\"{\\\"path\\\":\"}}]},\"finish_reason\":null}]}",
    "",
    "data: {\"choices\":[{\"index\":0,\"delta\":{\"tool_calls\":[{\"index\":0,\"function\":{\"arguments\":\"\\\"a.ts\\\"}\"}}]},\"finish_reason\":null}]}",
    "",
    "data: {\"choices\":[{\"index\":0,\"delta\":{},\"finish_reason\":\"tool_calls\"}]}",
    "",
    "data: [DONE]",
  ]);
  let collector = new Collector();
  let reply = consumeStream(() => q.next(), () => q.finished(), (t: string) => { collector.add(t); });

  expect(!reply.failed);
  expect(reply.calls.length == 1);
  expect(reply.calls[0].callId == "call_1");
  expect(reply.calls[0].tool == "read_file");
  expect(reply.calls[0].args == "{\"path\":\"a.ts\"}");
});

test("two interleaved tool calls assemble into separate entries", () => {
  let q = new LineQueue([
    "data: {\"choices\":[{\"index\":0,\"delta\":{\"tool_calls\":[{\"index\":0,\"id\":\"c0\",\"function\":{\"name\":\"a\",\"arguments\":\"1\"}},{\"index\":1,\"id\":\"c1\",\"function\":{\"name\":\"b\",\"arguments\":\"2\"}}]},\"finish_reason\":null}]}",
    "",
    "data: {\"choices\":[{\"index\":0,\"delta\":{\"tool_calls\":[{\"index\":0,\"function\":{\"arguments\":\"x\"}}]},\"finish_reason\":null}]}",
    "",
    "data: {\"choices\":[{\"index\":0,\"delta\":{},\"finish_reason\":\"tool_calls\"}]}",
    "",
    "data: [DONE]",
  ]);
  let reply = consumeStream(() => q.next(), () => q.finished(), (t: string) => {});

  expect(reply.calls.length == 2);
  expect(reply.calls[0].tool == "a");
  expect(reply.calls[0].args == "1x");
  expect(reply.calls[1].tool == "b");
  expect(reply.calls[1].args == "2");
});

test("a mid-stream disconnect returns whatever was assembled, does not throw", () => {
  let q = new LineQueue([
    "data: {\"choices\":[{\"index\":0,\"delta\":{\"content\":\"partial\"},\"finish_reason\":null}]}",
    "",
  ]);
  let reply = consumeStream(() => q.next(), () => q.finished(), (t: string) => {});

  expect(reply.text == "partial");
  expect(!reply.failed);
});

test("an empty answer with a finish_reason is surfaced as an error, not a blank success", () => {
  let q = new LineQueue([
    "data: {\"choices\":[{\"index\":0,\"delta\":{},\"finish_reason\":\"stop\"}]}",
    "",
    "data: [DONE]",
  ]);
  let reply = consumeStream(() => q.next(), () => q.finished(), (t: string) => {});

  expect(reply.failed);
  expect(reply.errorCode == "E_EMPTY_ANSWER");
});

test("a stream-level error frame ends the reply as failed", () => {
  let q = new LineQueue([
    "data: {\"error\":{\"message\":\"context length exceeded\"}}",
    "",
  ]);
  let reply = consumeStream(() => q.next(), () => q.finished(), (t: string) => {});

  expect(reply.failed);
  expect(reply.errorMessage == "context length exceeded");
});

test("a 401 body reaches the caller as the error message", () => {
  let raw = "{\"error\":{\"message\":\"Invalid API key\",\"type\":\"invalid_request_error\"}}";
  let reply = errorReplyFromBody(401, raw);

  expect(reply.failed);
  expect(reply.errorCode == "E_HTTP_401");
  expect(reply.errorMessage == "Invalid API key");
});

test("a non-JSON error body falls back to the raw text", () => {
  let reply = errorReplyFromBody(503, "upstream connect error");
  expect(reply.failed);
  expect(reply.errorMessage == "upstream connect error");
});

test("requestBody serializes messages and marks stream true", () => {
  let messages: Message[] = [{ role: "user", text: "hi \"there\"" }];
  let body = requestBody("gpt-4o", messages, []);

  expect(body.indexOf("\"model\":\"gpt-4o\"") >= 0);
  expect(body.indexOf("\"stream\":true") >= 0);
  expect(body.indexOf("\"role\":\"user\"") >= 0);
  expect(body.indexOf("\\\"there\\\"") >= 0);
  expect(body.indexOf("\"tools\"") < 0);
});

test("requestBody includes tools when given, parameters embedded raw", () => {
  let messages: Message[] = [{ role: "user", text: "hi" }];
  let tools: ToolSchema[] = [{ name: "read_file", description: "reads a file", parametersJson: "{\"type\":\"object\",\"properties\":{\"path\":{\"type\":\"string\"}}}" }];
  let body = requestBody("gpt-4o", messages, tools);

  expect(body.indexOf("\"tools\"") >= 0);
  expect(body.indexOf("\"name\":\"read_file\"") >= 0);
  expect(body.indexOf("\"properties\":{\"path\"") >= 0);
});
