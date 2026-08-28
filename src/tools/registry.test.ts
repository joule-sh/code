import { ToolsRegistry } from "./registry.ts";
import { Credential } from "../auth/credentials.ts";

function freshRoot(name: string): string {
  let root = "/tmp/registry-test-" + name;
  if (fs.existsSync(root)) {
    fs.rmSync(root, true);
  }
  fs.mkdirSync(root, true);
  return root;
}

test("read: dispatches and returns file content", () => {
  let root = freshRoot("read");
  fs.writeFileSync(root + "/a.ts", "line1\nline2");
  let reg = new ToolsRegistry(root);
  let r = reg.dispatch("read", "{\"path\":\"a.ts\"}");
  expect(r.ok);
  expect(r.output == "line1\nline2");
});

test("read: missing offset and limit use sane defaults", () => {
  let root = freshRoot("read-defaults");
  fs.writeFileSync(root + "/a.ts", "1\n2\n3");
  let reg = new ToolsRegistry(root);
  let r = reg.dispatch("read", "{\"path\":\"a.ts\"}");
  expect(r.ok);
  expect(r.output == "1\n2\n3");
  expect(!r.truncated);
});

test("write: dispatches and creates the file", () => {
  let root = freshRoot("write");
  let reg = new ToolsRegistry(root);
  let r = reg.dispatch("write", "{\"path\":\"out.ts\",\"content\":\"hello\"}");
  expect(r.ok);
  expect(fs.readFileSync(root + "/out.ts") == "hello");
});

test("edit: dispatches and replaces the single match", () => {
  let root = freshRoot("edit");
  fs.writeFileSync(root + "/a.ts", "const x = 1;");
  let reg = new ToolsRegistry(root);
  let r = reg.dispatch("edit", "{\"path\":\"a.ts\",\"old_text\":\"const x = 1;\",\"new_text\":\"const x = 2;\"}");
  expect(r.ok);
  expect(fs.readFileSync(root + "/a.ts") == "const x = 2;");
});

test("edit: no match surfaces the error in output, ok is false", () => {
  let root = freshRoot("edit-fail");
  fs.writeFileSync(root + "/a.ts", "const x = 1;");
  let reg = new ToolsRegistry(root);
  let r = reg.dispatch("edit", "{\"path\":\"a.ts\",\"old_text\":\"nope\",\"new_text\":\"x\"}");
  expect(!r.ok);
});

test("list: dispatches and joins entries", () => {
  let root = freshRoot("list");
  fs.writeFileSync(root + "/a.ts", "x");
  fs.writeFileSync(root + "/b.ts", "y");
  let reg = new ToolsRegistry(root);
  let r = reg.dispatch("list", "{\"path\":\".\"}");
  expect(r.ok);
  expect(r.output.indexOf("a.ts") >= 0);
  expect(r.output.indexOf("b.ts") >= 0);
});

test("grep: dispatches and formats file:line: text", () => {
  let root = freshRoot("grep");
  fs.writeFileSync(root + "/a.ts", "hello world\nsomething else");
  let reg = new ToolsRegistry(root);
  let r = reg.dispatch("grep", "{\"pattern\":\"hello\"}");
  expect(r.ok);
  expect(r.output == "a.ts:1: hello world");
});

test("grep: missing glob does not crash, defaults to matching everything", () => {
  let root = freshRoot("grep-noglob");
  fs.writeFileSync(root + "/a.ts", "needle here");
  let reg = new ToolsRegistry(root);
  let r = reg.dispatch("grep", "{\"pattern\":\"needle\"}");
  expect(r.ok);
  expect(r.output.indexOf("needle here") >= 0);
});

test("grep: no matches reports it rather than an empty string", () => {
  let root = freshRoot("grep-empty");
  fs.writeFileSync(root + "/a.ts", "nothing to see");
  let reg = new ToolsRegistry(root);
  let r = reg.dispatch("grep", "{\"pattern\":\"zzz\"}");
  expect(r.ok);
  expect(r.output == "no matches");
});

test("run: dispatches and reports the exit status", () => {
  let root = freshRoot("run");
  let reg = new ToolsRegistry(root);
  let r = reg.dispatch("run", "{\"command\":\"echo hi\"}");
  expect(r.ok);
  expect(r.output.indexOf("exit 0") >= 0);
  expect(r.output.indexOf("hi") >= 0);
});

test("run: missing timeout_ms defaults rather than running unbounded", () => {
  let root = freshRoot("run-timeout-default");
  let reg = new ToolsRegistry(root);
  let r = reg.dispatch("run", "{\"command\":\"echo ok\"}");
  expect(r.ok);
  expect(r.output.indexOf("over budget") < 0);
});

test("web_search without a platform credential set fails clean rather than reaching the network", () => {
  let root = freshRoot("web-search-signed-out");
  let reg = new ToolsRegistry(root);
  let r = reg.dispatch("web_search", "{\"q\":\"x\"}");
  expect(!r.ok);
  expect(r.output.indexOf("/login") >= 0);
});

test("web_retrieve without a platform credential set fails clean too", () => {
  let root = freshRoot("web-retrieve-signed-out");
  let reg = new ToolsRegistry(root);
  let r = reg.dispatch("web_retrieve", "{\"q\":\"x\"}");
  expect(!r.ok);
  expect(r.output.indexOf("/login") >= 0);
});

test("setPlatformAccess holds the server and credential the dispatch will use, rather than refusing web_search up front", () => {
  let root = freshRoot("web-search-signed-in");
  let reg = new ToolsRegistry(root);
  let c: Credential = {
    server: "", secret: "jl_test_secret", accountId: "", accountEmail: "",
    keyId: "", keyPrefix: "", scopes: "", savedAt: "",
    relayUrl: "", relayWsUrl: "", webUrl: "",
  };
  reg.setPlatformAccess("https://joule.sh", c);
  expect(reg.platformSlot.length == 1);
  expect(reg.platformSlot[0].server == "https://joule.sh");
  expect(reg.platformSlot[0].credential.secret == "jl_test_secret");
});

test("an unknown tool name returns a clean failure, not a crash", () => {
  let root = freshRoot("unknown");
  let reg = new ToolsRegistry(root);
  let r = reg.dispatch("frobnicate", "{}");
  expect(!r.ok);
  expect(r.output == "unknown tool: frobnicate");
});
