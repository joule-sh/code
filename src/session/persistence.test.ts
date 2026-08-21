import { Message, ROLE_USER, ROLE_ASSISTANT, ROLE_SYSTEM } from "./types.ts";
import { SessionFile, sessionKeyFor, parseSessionFile, saveSessionFile, loadSessionFile } from "./persistence.ts";

function freshRoot(name: string): string {
  let root = "/tmp/persistence-test-" + name;
  if (fs.existsSync(root)) {
    fs.rmSync(root, true);
  }
  fs.mkdirSync(root, true);
  return root;
}

function sampleHistory(): Message[] {
  let msgs: Message[] = [
    { role: ROLE_SYSTEM, text: "sys prompt", toolCallId: "", toolCalls: [] },
    { role: ROLE_USER, text: "hello", toolCallId: "", toolCalls: [] },
    { role: ROLE_ASSISTANT, text: "hi there", toolCallId: "", toolCalls: [] },
  ];
  return msgs;
}

test("sessionKeyFor is stable for the same workspace path", () => {
  let a = sessionKeyFor("/home/user/projects/code");
  let b = sessionKeyFor("/home/user/projects/code");
  expect(a == b);
});

test("sessionKeyFor differs for different workspace paths", () => {
  let a = sessionKeyFor("/home/user/projects/code");
  let b = sessionKeyFor("/home/user/projects/other");
  expect(a != b);
});

test("sessionKeyFor does not collide when sanitized slugs would otherwise match", () => {
  let a = sessionKeyFor("/a/b");
  let b = sessionKeyFor("/a-b");
  expect(a != b);
});

test("sessionKeyFor only uses filename-safe characters", () => {
  let key = sessionKeyFor("/home/user/weird path/with spaces+stuff!");
  let i = 0;
  let allSafe = true;
  while (i < key.length) {
    let c = key.charAt(i);
    let isSafe = (c >= "a" && c <= "z") || (c >= "A" && c <= "Z") || (c >= "0" && c <= "9") || c == "." || c == "_" || c == "-";
    if (!isSafe) { allSafe = false; }
    i = i + 1;
  }
  expect(allSafe);
});

test("parseSessionFile reads a well-formed file with nested history", () => {
  let f = parseSessionFile("{\"workspace\":\"/repo\",\"savedAt\":\"123\",\"history\":[{\"role\":\"user\",\"text\":\"hi\",\"toolCallId\":\"\",\"toolCalls\":[]}]}");
  expect(f != null);
  if (f != null) {
    expect(f.workspace == "/repo");
    expect(f.history.length == 1);
    expect(f.history[0].role == "user");
  }
});

test("parseSessionFile on empty or malformed text returns null, not a crash", () => {
  let f1 = parseSessionFile("");
  expect(f1 == null);
  let f2 = parseSessionFile("not json at all");
  expect(f2 == null);
});

test("saveSessionFile writes a session that loadSessionFile reads back exactly, including nested tool calls", () => {
  let root = freshRoot("roundtrip");
  let target = root + "/nested/session.json";
  let history: Message[] = [
    { role: ROLE_USER, text: "read a.ts", toolCallId: "", toolCalls: [] },
    { role: ROLE_ASSISTANT, text: "", toolCallId: "", toolCalls: [{ callId: "c1", tool: "read", args: "a.ts" }] },
  ];
  let file: SessionFile = { workspace: "/repo", savedAt: "1000", history: history };

  saveSessionFile(target, file);
  let loaded = loadSessionFile(target);

  expect(loaded != null);
  if (loaded != null) {
    expect(loaded.workspace == "/repo");
    expect(loaded.savedAt == "1000");
    expect(loaded.history.length == 2);
    expect(loaded.history[1].toolCalls.length == 1);
    expect(loaded.history[1].toolCalls[0].tool == "read");
    expect(loaded.history[1].toolCalls[0].args == "a.ts");
  }
});

test("saveSessionFile overwrites a previously written session for the same path", () => {
  let root = freshRoot("overwrite");
  let target = root + "/session.json";
  let first: SessionFile = { workspace: "/repo", savedAt: "1", history: [{ role: ROLE_USER, text: "first", toolCallId: "", toolCalls: [] }] };
  let second: SessionFile = { workspace: "/repo", savedAt: "2", history: sampleHistory() };

  saveSessionFile(target, first);
  saveSessionFile(target, second);
  let loaded = loadSessionFile(target);

  expect(loaded != null);
  if (loaded != null) {
    expect(loaded.savedAt == "2");
    expect(loaded.history.length == 3);
  }
});

test("saveSessionFile leaves no leftover temp file next to the target", () => {
  let root = freshRoot("no-leftover-tmp");
  let target = root + "/session.json";
  saveSessionFile(target, { workspace: "/repo", savedAt: "1", history: sampleHistory() });

  let entries = fs.readdirSync(root);
  expect(entries.length == 1);
  expect(entries[0] == "session.json");
});

test("loadSessionFile returns null for a path that does not exist", () => {
  let root = freshRoot("missing");
  let loaded = loadSessionFile(root + "/does-not-exist.json");
  expect(loaded == null);
});
