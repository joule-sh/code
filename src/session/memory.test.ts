import { MemoryEntry, memoryDirPath, memoryStorePath, saveMemoryEntry, loadMemoryDir, addMemoryEntryText, removeMemoryEntryAt, clearMemoryDir, listMemoryText, looksLikeSecret, buildMemoryContext, loadUserMemoryText, parseMemoryEntry, MAX_ENTRY_BYTES, MAX_MEMORY_CONTEXT_BYTES, MEMORY_SECRET_REFUSAL, MEMORY_SECRET_SKIPPED } from "./memory.ts";

const CREDENTIAL: string = "sk-live-4f9ab27c1de83094bb75";

function freshDir(name: string): string {
  let dir = "/tmp/memory-test-" + name;
  if (fs.existsSync(dir)) { fs.rmSync(dir, true); }
  fs.mkdirSync(dir, true);
  return dir;
}

function handWrite(dir: string, name: string, body: string): string {
  let full = dir + "/" + name;
  fs.writeFileSync(full, body);
  return full;
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

test("the store is a directory of markdown files beside the rest of the config", () => {
  expect(memoryStorePath() == memoryDirPath() + "/memory");
  expect(memoryStorePath().endsWith("/memory"));
});

test("an added memory is one markdown file, readable back with its text intact", () => {
  let dir = freshDir("round-trip");
  addMemoryEntryText(dir, "prefers pnpm over npm");
  let entries = loadMemoryDir(dir);
  expect(entries.length == 1);
  expect(entries[0].text == "prefers pnpm over npm");
  expect(entries[0].path.endsWith(".md"));
});

test("the file a memory lands in is named so a person can find it, and carries frontmatter", () => {
  let dir = freshDir("named");
  addMemoryEntryText(dir, "Prefers Tabs Over Spaces");
  let entries = loadMemoryDir(dir);
  let raw = fs.readFileSync(entries[0].path);
  expect(raw.startsWith("---"));
  expect(raw.indexOf("savedAt:") >= 0);
  expect(raw.indexOf("Prefers Tabs Over Spaces") >= 0);
  expect(entries[0].path.indexOf("prefers-tabs-over-spaces") >= 0);
});

test("adding a second memory writes a second file and leaves the first alone", () => {
  let dir = freshDir("one-file-each");
  addMemoryEntryText(dir, "first thing");
  let firstPath = loadMemoryDir(dir)[0].path;
  addMemoryEntryText(dir, "second thing");
  let entries = loadMemoryDir(dir);
  expect(entries.length == 2);
  expect(fs.existsSync(firstPath));
  expect(entries[0].path != entries[1].path);
});

test("two memories saved in the same millisecond do not overwrite each other", () => {
  let dir = freshDir("same-millisecond");
  saveMemoryEntry(dir, "one", "1700000000000");
  saveMemoryEntry(dir, "one", "1700000000000");
  expect(loadMemoryDir(dir).length == 2);
});

test("entries come back oldest first, ordered by savedAt rather than by how the directory lists them", () => {
  let dir = freshDir("ordering");
  handWrite(dir, "zzz.md", "---\nsavedAt: 1700000000001\n---\nsecond");
  handWrite(dir, "aaa.md", "---\nsavedAt: 1700000000000\n---\nfirst");
  let entries = loadMemoryDir(dir);
  expect(entries.length == 2);
  expect(entries[0].text == "first");
  expect(entries[1].text == "second");
});

test("a hand-written file with no frontmatter at all is still read as a memory", () => {
  let dir = freshDir("no-frontmatter");
  handWrite(dir, "note.md", "just a plain note someone wrote");
  let entries = loadMemoryDir(dir);
  expect(entries.length == 1);
  expect(entries[0].text == "just a plain note someone wrote");
});

test("an empty file and a non-markdown file are both ignored", () => {
  let dir = freshDir("ignored");
  handWrite(dir, "blank.md", "   \n\t\n");
  handWrite(dir, "notes.txt", "not a memory");
  expect(loadMemoryDir(dir).length == 0);
});

test("a missing store is an empty store, not an error", () => {
  expect(loadMemoryDir("/tmp/memory-test-does-not-exist-at-all").length == 0);
});

test("the write path still refuses a credential, and writes nothing", () => {
  let dir = freshDir("write-refusal");
  let r = addMemoryEntryText(dir, "the api key is " + CREDENTIAL);
  expect(!r.ok);
  expect(r.message == MEMORY_SECRET_REFUSAL);
  expect(loadMemoryDir(dir).length == 0);
});

test("a memory file written BY HAND with a credential in it never reaches the model's context", () => {
  let dir = freshDir("handwritten-credential");
  handWrite(dir, "1700000000000-key.md", "---\nsavedAt: 1700000000000\n---\nthe deploy key is " + CREDENTIAL);
  handWrite(dir, "1700000000001-ok.md", "---\nsavedAt: 1700000000001\n---\nprefers tabs");
  let context = loadUserMemoryText(dir);
  expect(context.indexOf(CREDENTIAL) < 0);
  expect(context.indexOf("deploy key") < 0);
  expect(context.indexOf("prefers tabs") >= 0);
});

test("the read path marks such a file refused rather than pretending it is not there", () => {
  let dir = freshDir("handwritten-marked");
  handWrite(dir, "1700000000000-key.md", "---\nsavedAt: 1700000000000\n---\n" + CREDENTIAL);
  let entries = loadMemoryDir(dir);
  expect(entries.length == 1);
  expect(entries[0].refused);
});

test("listing a refused file names the file to fix without printing the credential back out", () => {
  let dir = freshDir("listing-refused");
  handWrite(dir, "1700000000000-key.md", "---\nsavedAt: 1700000000000\n---\n" + CREDENTIAL);
  let listing = listMemoryText(dir);
  expect(listing.indexOf(CREDENTIAL) < 0);
  expect(listing.indexOf(MEMORY_SECRET_SKIPPED) >= 0);
  expect(listing.indexOf("1700000000000-key.md") >= 0);
});

test("a credential smuggled in by hand is refused on the read path even with no frontmatter to hide behind", () => {
  let dir = freshDir("handwritten-bare");
  handWrite(dir, "bare.md", "bearer abcdefghijklmnop0123456789");
  expect(loadUserMemoryText(dir) == "");
});

test("a long random-looking token is refused on the read path, not just the known prefixes", () => {
  let dir = freshDir("handwritten-token");
  handWrite(dir, "tok.md", "---\nsavedAt: 1\n---\nremember AKIA7FJ39DKSLW02MXQ4ZP1B");
  expect(loadUserMemoryText(dir) == "");
});

test("buildMemoryContext drops a refused entry even if one is handed to it directly", () => {
  let entries: MemoryEntry[] = [
    { text: "safe thing", savedAt: "1", path: "/tmp/a.md", refused: false },
    { text: CREDENTIAL, savedAt: "2", path: "/tmp/b.md", refused: true },
  ];
  let context = buildMemoryContext(entries);
  expect(context.indexOf("safe thing") >= 0);
  expect(context.indexOf(CREDENTIAL) < 0);
});

test("parseMemoryEntry flags a credential regardless of how the file was framed", () => {
  expect(parseMemoryEntry("---\nsavedAt: 1\n---\n" + CREDENTIAL, "/tmp/x.md")[0].refused);
  expect(parseMemoryEntry(CREDENTIAL, "/tmp/x.md")[0].refused);
  expect(!parseMemoryEntry("---\nsavedAt: 1\n---\nplain preference", "/tmp/x.md")[0].refused);
});

test("forget removes exactly the file at that position and leaves the others", () => {
  let dir = freshDir("forget");
  saveMemoryEntry(dir, "first", "1700000000000");
  saveMemoryEntry(dir, "second", "1700000000001");
  saveMemoryEntry(dir, "third", "1700000000002");
  expect(removeMemoryEntryAt(dir, 2));
  let entries = loadMemoryDir(dir);
  expect(entries.length == 2);
  expect(entries[0].text == "first");
  expect(entries[1].text == "third");
});

test("forget on a position that is not there changes nothing", () => {
  let dir = freshDir("forget-missing");
  saveMemoryEntry(dir, "only", "1700000000000");
  expect(!removeMemoryEntryAt(dir, 7));
  expect(!removeMemoryEntryAt(dir, 0));
  expect(loadMemoryDir(dir).length == 1);
});

test("clear removes every memory file", () => {
  let dir = freshDir("clear");
  saveMemoryEntry(dir, "one", "1700000000000");
  saveMemoryEntry(dir, "two", "1700000000001");
  clearMemoryDir(dir);
  expect(loadMemoryDir(dir).length == 0);
});

test("clear on a store that was never written is not an error", () => {
  clearMemoryDir("/tmp/memory-test-clear-absent");
  expect(true);
});

test("listing an empty store points at the directory to write into by hand", () => {
  let dir = freshDir("listing-empty");
  let listing = listMemoryText(dir);
  expect(listing.indexOf("nothing remembered yet") >= 0);
  expect(listing.indexOf(dir) >= 0);
});

test("listing numbers the entries so forget takes the number that was shown", () => {
  let dir = freshDir("listing-numbers");
  saveMemoryEntry(dir, "first", "1700000000000");
  saveMemoryEntry(dir, "second", "1700000000001");
  let listing = listMemoryText(dir);
  expect(listing.indexOf("1. first") >= 0);
  expect(listing.indexOf("2. second") >= 0);
});

test("an over-long memory is refused with the size in the message", () => {
  let dir = freshDir("too-long");
  let r = addMemoryEntryText(dir, repeatChar("x", MAX_ENTRY_BYTES + 1));
  expect(!r.ok);
  expect(r.message.indexOf("shorten it") >= 0);
  expect(loadMemoryDir(dir).length == 0);
});

test("an empty add is a usage message, not an empty file", () => {
  let dir = freshDir("empty-add");
  let r = addMemoryEntryText(dir, "   ");
  expect(!r.ok);
  expect(r.message.indexOf("usage") >= 0);
  expect(loadMemoryDir(dir).length == 0);
});

test("the context is capped in bytes so a large store cannot swamp the window", () => {
  let dir = freshDir("context-cap");
  let i = 0;
  while (i < 40) {
    saveMemoryEntry(dir, repeatChar("y", 200), "17000000000" + `${i + 10}`);
    i = i + 1;
  }
  expect(loadUserMemoryText(dir).length <= MAX_MEMORY_CONTEXT_BYTES + 500);
});

test("an empty store injects nothing at all", () => {
  let dir = freshDir("context-empty");
  expect(loadUserMemoryText(dir) == "");
});

test("looksLikeSecret still recognises what it recognised before", () => {
  expect(looksLikeSecret("ghp_abcdefghijklmnop"));
  expect(looksLikeSecret("my API key is here"));
  expect(looksLikeSecret("-----BEGIN RSA PRIVATE KEY-----"));
  expect(!looksLikeSecret("prefers tabs over spaces"));
  expect(!looksLikeSecret("uses the staging box for builds"));
});
