import { readFile, writeFile, editFile, listDir, grep } from "./files.ts";

function freshRoot(name: string): string {
  let root = "/tmp/files-test-" + name;
  if (fs.existsSync(root)) {
    fs.rmSync(root, true);
  }
  fs.mkdirSync(root, true);
  return root;
}

test("read: happy path returns the file content", () => {
  let root = freshRoot("read-happy");
  fs.writeFileSync(root + "/a.ts", "line1\nline2\nline3");
  let r = readFile(root, "a.ts", 0, 0);
  expect(r.ok);
  expect(r.content == "line1\nline2\nline3");
  expect(!r.truncated);
});

test("read: a binary file is refused rather than returned as bytes", () => {
  let root = freshRoot("read-binary");
  fs.writeFileSync(root + "/pic.jpg", "JFIF" + String.fromCharCode(0) + "bytes");
  let r = readFile(root, "pic.jpg", 0, 0);
  expect(!r.ok);
  expect(r.content == "");
  expect(r.error.indexOf("binary") > 0);
});

test("read: past EOF is empty, not an error", () => {
  let root = freshRoot("read-eof");
  fs.writeFileSync(root + "/a.ts", "line1\nline2");
  let r = readFile(root, "a.ts", 50, 0);
  expect(r.ok);
  expect(r.content == "");
});

test("read: truncation sets the flag", () => {
  let root = freshRoot("read-trunc");
  fs.writeFileSync(root + "/a.ts", "1\n2\n3\n4\n5");
  let r = readFile(root, "a.ts", 0, 2);
  expect(r.ok);
  expect(r.truncated);
  expect(r.content == "1\n2");
});

test("read: a nonexistent path is an error", () => {
  let root = freshRoot("read-missing");
  let r = readFile(root, "nope.ts", 0, 0);
  expect(!r.ok);
});

test("write: happy path creates the file", () => {
  let root = freshRoot("write-happy");
  let r = writeFile(root, "a.ts", "hello");
  expect(r.ok);
  expect(fs.readFileSync(root + "/a.ts") == "hello");
});

test("write: creates parent directories", () => {
  let root = freshRoot("write-parents");
  let r = writeFile(root, "src/routes/health.ts", "export {};");
  expect(r.ok);
  expect(fs.existsSync(root + "/src/routes/health.ts"));
});

test("edit: happy path replaces the single match", () => {
  let root = freshRoot("edit-happy");
  fs.writeFileSync(root + "/a.ts", "const x = 1;\nconst y = 2;");
  let r = editFile(root, "a.ts", "const x = 1;", "const x = 100;");
  expect(r.ok);
  expect(fs.readFileSync(root + "/a.ts") == "const x = 100;\nconst y = 2;");
});

test("edit: zero matches is an error", () => {
  let root = freshRoot("edit-zero");
  fs.writeFileSync(root + "/a.ts", "const x = 1;");
  let r = editFile(root, "a.ts", "const z = 9;", "const z = 10;");
  expect(!r.ok);
});

test("edit: two matches is an error", () => {
  let root = freshRoot("edit-two");
  fs.writeFileSync(root + "/a.ts", "foo();\nfoo();");
  let r = editFile(root, "a.ts", "foo();", "bar();");
  expect(!r.ok);
});

test("list: happy path returns directory entries", () => {
  let root = freshRoot("list-happy");
  fs.writeFileSync(root + "/a.ts", "");
  fs.writeFileSync(root + "/b.ts", "");
  let r = listDir(root, ".");
  expect(r.ok);
  expect(r.entries.length == 2);
});

test("list: a nonexistent directory is an error", () => {
  let root = freshRoot("list-missing");
  let r = listDir(root, "nope");
  expect(!r.ok);
});

test("grep: happy path finds matching lines with file and line number", () => {
  let root = freshRoot("grep-happy");
  fs.mkdirSync(root + "/src", true);
  fs.writeFileSync(root + "/src/a.ts", "first\nfindme\nthird");
  let r = grep(root, "findme", "");
  expect(r.ok);
  expect(r.matches.length == 1);
  expect(r.matches[0].line == 2);
  expect(r.matches[0].file == "src/a.ts");
});

test("grep: a glob filters which files are searched", () => {
  let root = freshRoot("grep-glob");
  fs.writeFileSync(root + "/a.ts", "target");
  fs.writeFileSync(root + "/b.md", "target");
  let r = grep(root, "target", "*.ts");
  expect(r.matches.length == 1);
  expect(r.matches[0].file == "a.ts");
});
