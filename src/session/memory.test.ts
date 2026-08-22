import { MemoryEntry, MemoryFile, parseMemoryFile, loadMemoryFile, saveMemoryFile, addMemoryEntryText, removeMemoryEntryAt, clearMemoryFile, listMemoryText, looksLikeSecret, buildMemoryContext, loadUserMemoryText, MAX_MEMORY_ENTRIES, MAX_ENTRY_BYTES, MAX_MEMORY_CONTEXT_BYTES } from "./memory.ts";

function freshRoot(name: string): string {
  let root = "/tmp/memory-test-" + name;
  if (fs.existsSync(root)) {
    fs.rmSync(root, true);
  }
  fs.mkdirSync(root, true);
  return root;
}

function repeatChar(ch: string, n: int): string {
  let out = "";
  let i = 0;
  while (i < n) {
    out = out + ch;
    i = i + 1;
  }
  return out;
}

test("parseMemoryFile on empty or malformed text returns null, not a crash", () => {
  expect(parseMemoryFile("") == null);
  expect(parseMemoryFile("not json") == null);
  expect(parseMemoryFile("   ") == null);
});

test("parseMemoryFile reads a well-formed file back", () => {
  let f = parseMemoryFile("{\"entries\":[{\"text\":\"likes tabs\",\"savedAt\":\"1\"}]}");
  expect(f != null);
  if (f != null) {
    expect(f.entries.length == 1);
    expect(f.entries[0].text == "likes tabs");
  }
});

test("loadMemoryFile on a missing file returns an empty store, not an error", () => {
  let root = freshRoot("missing");
  let f = loadMemoryFile(root + "/memory.json");
  expect(f.entries.length == 0);
});

test("saveMemoryFile then loadMemoryFile round trips, creating nested directories", () => {
  let root = freshRoot("roundtrip");
  let target = root + "/nested/memory.json";
  let file: MemoryFile = { entries: [{ text: "prefers pnpm", savedAt: "10" }] };
  saveMemoryFile(target, file);
  let loaded = loadMemoryFile(target);
  expect(loaded.entries.length == 1);
  expect(loaded.entries[0].text == "prefers pnpm");
});

test("addMemoryEntryText rejects an empty entry with the usage message", () => {
  let root = freshRoot("empty-add");
  let file = root + "/memory.json";
  let r = addMemoryEntryText(file, "   ");
  expect(!r.ok);
  expect(r.message.indexOf("usage") >= 0);
});

test("addMemoryEntryText saves a plain preference and it shows up in listMemoryText", () => {
  let root = freshRoot("plain-add");
  let file = root + "/memory.json";
  let r = addMemoryEntryText(file, "prefers tabs over spaces");
  expect(r.ok);
  let out = listMemoryText(file);
  expect(out.indexOf("prefers tabs over spaces") >= 0);
});

test("addMemoryEntryText rejects an entry over the per-entry byte cap", () => {
  let root = freshRoot("too-long");
  let file = root + "/memory.json";
  let long = repeatChar("a", MAX_ENTRY_BYTES + 1);
  let r = addMemoryEntryText(file, long);
  expect(!r.ok);
  expect(loadMemoryFile(file).entries.length == 0);
});

test("addMemoryEntryText caps stored entries at MAX_MEMORY_ENTRIES, dropping the oldest first", () => {
  let root = freshRoot("cap");
  let file = root + "/memory.json";
  let i = 0;
  while (i < MAX_MEMORY_ENTRIES + 5) {
    addMemoryEntryText(file, "fact number " + `${i}`);
    i = i + 1;
  }
  let entries = loadMemoryFile(file).entries;
  expect(entries.length == MAX_MEMORY_ENTRIES);
  expect(entries[0].text == "fact number 5");
  expect(entries[entries.length - 1].text == "fact number " + `${MAX_MEMORY_ENTRIES + 4}`);
});

test("removeMemoryEntryAt drops the numbered entry and leaves the rest, in order", () => {
  let root = freshRoot("remove");
  let file = root + "/memory.json";
  addMemoryEntryText(file, "first");
  addMemoryEntryText(file, "second");
  addMemoryEntryText(file, "third");
  let ok = removeMemoryEntryAt(file, 2);
  expect(ok);
  let entries = loadMemoryFile(file).entries;
  expect(entries.length == 2);
  expect(entries[0].text == "first");
  expect(entries[1].text == "third");
});

test("removeMemoryEntryAt on an out-of-range index changes nothing and returns false", () => {
  let root = freshRoot("remove-oob");
  let file = root + "/memory.json";
  addMemoryEntryText(file, "only one");
  expect(!removeMemoryEntryAt(file, 5));
  expect(!removeMemoryEntryAt(file, 0));
  expect(loadMemoryFile(file).entries.length == 1);
});

test("clearMemoryFile empties the store", () => {
  let root = freshRoot("clear");
  let file = root + "/memory.json";
  addMemoryEntryText(file, "will be cleared");
  clearMemoryFile(file);
  expect(loadMemoryFile(file).entries.length == 0);
});

test("listMemoryText says nothing is remembered yet when the store is empty", () => {
  let root = freshRoot("list-empty");
  let file = root + "/memory.json";
  expect(listMemoryText(file).indexOf("nothing remembered") >= 0);
});

test("looksLikeSecret catches a DeepSeek/OpenAI-shaped sk- key", () => {
  expect(looksLikeSecret("the key is sk-test1234567890abcdef1234567890ab"));
});

test("looksLikeSecret catches a bearer token and an api_key assignment", () => {
  expect(looksLikeSecret("Authorization: Bearer abc123def456ghi789jkl012"));
  expect(looksLikeSecret("api_key=abc123def456ghi789jkl012mno345"));
});

test("looksLikeSecret catches a long mixed-case, mixed-digit run even without a known prefix", () => {
  expect(looksLikeSecret("token is aZ9kQ2mN7pR4sT6vW8xY1bC3dE5fG0hJ"));
});

test("looksLikeSecret leaves ordinary sentences and hyphenated notes alone", () => {
  expect(!looksLikeSecret("prefers tabs over spaces in yaml files"));
  expect(!looksLikeSecret("the staging box is reachable-over-tailscale-only"));
  expect(!looksLikeSecret("build with make build, test with make test"));
});

test("addMemoryEntryText refuses text shaped like an API key, and it never reaches the memory file on disk", () => {
  let root = freshRoot("secret-guard-key");
  let file = root + "/memory.json";
  let secretText = "remember that the key is sk-test1234567890abcdef1234567890ab";
  let r = addMemoryEntryText(file, secretText);
  expect(!r.ok);
  expect(r.message.indexOf("credential") >= 0);
  expect(loadMemoryFile(file).entries.length == 0);
  let raw = fs.existsSync(file) ? fs.readFileSync(file) : "";
  expect(raw.indexOf("sk-test1234567890abcdef1234567890ab") < 0);
});

test("addMemoryEntryText refuses a pasted bearer token, and it never reaches the memory file on disk", () => {
  let root = freshRoot("secret-guard-bearer");
  let file = root + "/memory.json";
  let secretText = "use Authorization: Bearer zzq8mN2kP5rT9wY3bV6hJ1cX4dF7gA0e when calling the api";
  let r = addMemoryEntryText(file, secretText);
  expect(!r.ok);
  let raw = fs.existsSync(file) ? fs.readFileSync(file) : "";
  expect(raw.indexOf("zzq8mN2kP5rT9wY3bV6hJ1cX4dF7gA0e") < 0);
});

test("addMemoryEntryText refuses an env-style credential assignment, and it never reaches the memory file on disk", () => {
  let root = freshRoot("secret-guard-env");
  let file = root + "/memory.json";
  let secretText = "JOULE_CODE_API_KEY=sk-abcdef0123456789abcdef0123456789 is the one to use";
  let r = addMemoryEntryText(file, secretText);
  expect(!r.ok);
  let raw = fs.existsSync(file) ? fs.readFileSync(file) : "";
  expect(raw.indexOf("sk-abcdef0123456789abcdef0123456789") < 0);
});

test("addMemoryEntryText still saves a legitimate note that merely mentions a key by name, without a value", () => {
  let root = freshRoot("secret-guard-false-positive");
  let file = root + "/memory.json";
  let r = addMemoryEntryText(file, "always set the provider key through the config file, never inline");
  expect(r.ok);
  expect(loadMemoryFile(file).entries.length == 1);
});

test("buildMemoryContext renders kept entries oldest to newest, most recent last", () => {
  let entries: MemoryEntry[] = [
    { text: "first fact", savedAt: "1" },
    { text: "second fact", savedAt: "2" },
  ];
  let out = buildMemoryContext(entries);
  expect(out.indexOf("first fact") < out.indexOf("second fact"));
});

test("buildMemoryContext on no entries returns empty, so injectSystemContext has nothing to add", () => {
  let entries: MemoryEntry[] = [];
  expect(buildMemoryContext(entries) == "");
});

test("buildMemoryContext keeps the store within its context byte budget by dropping the oldest entries first", () => {
  let entries: MemoryEntry[] = [];
  let i = 0;
  while (i < 400) {
    entries.push({ text: "fact number " + `${i}` + " is a mid-length sentence about preferences", savedAt: `${i}` });
    i = i + 1;
  }
  let out = buildMemoryContext(entries);
  expect(out.length <= MAX_MEMORY_CONTEXT_BYTES + 400);
  expect(out.indexOf("fact number 0 ") < 0);
  expect(out.indexOf("fact number 399 ") >= 0);
});

test("buildMemoryContext excludes a credential-shaped entry even if it reached the file by another path, like a hand edit", () => {
  let entries: MemoryEntry[] = [
    { text: "prefers dark mode", savedAt: "1" },
    { text: "backup key is sk-handedited1234567890abcdef123456", savedAt: "2" },
    { text: "prefers 2-space indent", savedAt: "3" },
  ];
  let out = buildMemoryContext(entries);
  expect(out.indexOf("sk-handedited1234567890abcdef123456") < 0);
  expect(out.indexOf("prefers dark mode") >= 0);
  expect(out.indexOf("prefers 2-space indent") >= 0);
});

test("loadUserMemoryText is empty for a workspace with no memory file yet, staying silent like the project instructions", () => {
  let root = freshRoot("load-empty");
  expect(loadUserMemoryText(root + "/memory.json") == "");
});

test("loadUserMemoryText end to end reflects what was added through addMemoryEntryText", () => {
  let root = freshRoot("load-e2e");
  let file = root + "/memory.json";
  addMemoryEntryText(file, "runs the terminal harness before every PR");
  let out = loadUserMemoryText(file);
  expect(out.indexOf("runs the terminal harness before every PR") >= 0);
});
