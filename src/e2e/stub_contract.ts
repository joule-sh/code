import { jsonSkipSpace, jsonSkipValue, jsonQuotedAt } from "../providers/toolcalls.ts";
import { Message, ToolCallReq } from "../session/types.ts";
import { contractProblem } from "../session/history_guard.ts";

export function memberAt(doc: string, objAt: int, key: string): int {
  let j = jsonSkipSpace(doc, objAt);
  if (j >= doc.length || doc.charAt(j) != "{") { return -1; }
  j = j + 1;
  while (j < doc.length) {
    j = jsonSkipSpace(doc, j);
    if (j >= doc.length || doc.charAt(j) == "}") { return -1; }
    let nameEnd = jsonSkipValue(doc, j);
    let name = jsonQuotedAt(doc, j);
    j = jsonSkipSpace(doc, nameEnd);
    if (j < doc.length && doc.charAt(j) == ":") { j = j + 1; }
    j = jsonSkipSpace(doc, j);
    if (name == key) { return j; }
    j = jsonSkipValue(doc, j);
    j = jsonSkipSpace(doc, j);
    if (j < doc.length && doc.charAt(j) == ",") { j = j + 1; }
  }
  return -1;
}

export function stringMember(doc: string, objAt: int, key: string): string {
  let at = memberAt(doc, objAt, key);
  if (at < 0) { return ""; }
  return "" + jsonQuotedAt(doc, at);
}

function callsIn(doc: string, arrAt: int): ToolCallReq[] {
  let out: ToolCallReq[] = [];
  let j = jsonSkipSpace(doc, arrAt);
  if (j >= doc.length || doc.charAt(j) != "[") { return out; }
  j = j + 1;
  while (j < doc.length) {
    j = jsonSkipSpace(doc, j);
    if (j >= doc.length || doc.charAt(j) == "]") { break; }
    let fnAt = memberAt(doc, j, "function");
    let name = "";
    if (fnAt >= 0) { name = stringMember(doc, fnAt, "name"); }
    out.push({ callId: stringMember(doc, j, "id"), tool: name, args: "" });
    j = jsonSkipValue(doc, j);
    j = jsonSkipSpace(doc, j);
    if (j < doc.length && doc.charAt(j) == ",") { j = j + 1; }
  }
  return out;
}

export function messagesFromRequest(body: string): Message[] {
  let out: Message[] = [];
  let arrAt = memberAt(body, 0, "messages");
  if (arrAt < 0) { return out; }
  let j = jsonSkipSpace(body, arrAt);
  if (j >= body.length || body.charAt(j) != "[") { return out; }
  j = j + 1;
  while (j < body.length) {
    j = jsonSkipSpace(body, j);
    if (j >= body.length || body.charAt(j) == "]") { break; }
    let calls: ToolCallReq[] = [];
    let callsAt = memberAt(body, j, "tool_calls");
    if (callsAt >= 0) { calls = callsIn(body, callsAt); }
    out.push({ role: stringMember(body, j, "role"), text: "", toolCallId: stringMember(body, j, "tool_call_id"), toolCalls: calls });
    j = jsonSkipValue(body, j);
    j = jsonSkipSpace(body, j);
    if (j < body.length && body.charAt(j) == ",") { j = j + 1; }
  }
  return out;
}

export function requestContractProblem(body: string): string {
  let messages = messagesFromRequest(body);
  if (messages.length == 0) { return ""; }
  return contractProblem(messages);
}

const ONE_CALL: string = "{\"role\":\"assistant\",\"content\":\"about to call tool_calls\",\"tool_calls\":[{\"id\":\"c1\",\"type\":\"function\",\"function\":{\"name\":\"run\",\"arguments\":\"{}\"}}]}";
const TWO_CALLS: string = "{\"role\":\"assistant\",\"content\":\"\",\"tool_calls\":[{\"id\":\"c1\",\"type\":\"function\",\"function\":{\"name\":\"run\",\"arguments\":\"{}\"}},{\"id\":\"c2\",\"type\":\"function\",\"function\":{\"name\":\"read\",\"arguments\":\"{}\"}}]}";

function request(messagesJson: string): string {
  return "{\"model\":\"m\",\"messages\":[" + messagesJson + "],\"stream\":true}";
}

test("the member walker reads the message an element carries and not a later element's", () => {
  let msgs = messagesFromRequest(request("{\"role\":\"user\",\"content\":\"hi\"}," + ONE_CALL));
  expect(msgs.length == 2);
  expect(msgs[0].role == "user");
  expect(msgs[0].toolCalls.length == 0);
  expect(msgs[1].role == "assistant");
  expect(msgs[1].toolCalls.length == 1);
  expect(msgs[1].toolCalls[0].callId == "c1");
  expect(msgs[1].toolCalls[0].tool == "run");
});

test("a request whose assistant tool_calls are answered passes the contract", () => {
  expect(requestContractProblem(request("{\"role\":\"user\",\"content\":\"hi\"}," + ONE_CALL + ",{\"role\":\"tool\",\"content\":\"ok\",\"tool_call_id\":\"c1\"}")) == "");
});

test("a request with an unanswered tool_call is refused the way the provider refuses it", () => {
  let problem = requestContractProblem(request(ONE_CALL + ",{\"role\":\"user\",\"content\":\"anything\"}"));
  expect(problem.indexOf("insufficient tool messages") > 0);
});

test("a user message wedged between a tool_calls message and its result is refused", () => {
  let wedged = ONE_CALL + ",{\"role\":\"user\",\"content\":\"[background task bgrun-1 finished]\"},{\"role\":\"tool\",\"content\":\"ok\",\"tool_call_id\":\"c1\"}";
  expect(requestContractProblem(request(wedged)) != "");
});

test("a trailing tool_calls message with nothing after it is refused", () => {
  expect(requestContractProblem(request(ONE_CALL)) != "");
});

test("two calls both answered pass, one answered does not", () => {
  let both = TWO_CALLS + ",{\"role\":\"tool\",\"content\":\"a\",\"tool_call_id\":\"c1\"},{\"role\":\"tool\",\"content\":\"b\",\"tool_call_id\":\"c2\"}";
  expect(requestContractProblem(request(both)) == "");
  let one = TWO_CALLS + ",{\"role\":\"tool\",\"content\":\"a\",\"tool_call_id\":\"c1\"}";
  expect(requestContractProblem(request(one)) != "");
});

test("a tool message answering nothing is refused", () => {
  expect(requestContractProblem(request("{\"role\":\"tool\",\"content\":\"a\",\"tool_call_id\":\"c9\"}")) != "");
});

test("a request with no messages at all is left alone", () => {
  expect(requestContractProblem("{\"model\":\"m\"}") == "");
});
