import { catText } from "./cat.ts";

function freshRoot(name: string): string {
  let root = "/tmp/cat-test-" + name;
  if (fs.existsSync(root)) {
    fs.rmSync(root, true);
  }
  fs.mkdirSync(root, true);
  return root;
}

test("no argument prints usage rather than trying to read anything", () => {
  let root = freshRoot("usage");
  let out = catText(root, "");
  expect(out.indexOf("usage: /cat") >= 0);
});

test("an existing file's content is shown", () => {
  let root = freshRoot("happy");
  fs.writeFileSync(root + "/notes.txt", "line1\nline2\nline3");
  let out = catText(root, "notes.txt");
  expect(out.indexOf("line1\nline2\nline3") >= 0);
});

test("a missing file reports cat's own error rather than crashing", () => {
  let root = freshRoot("missing");
  let out = catText(root, "nope.txt");
  expect(out.indexOf("cat: nope.txt:") >= 0);
  expect(out.indexOf("no such file") >= 0);
});

test("a path that escapes the workspace is refused the same way", () => {
  let root = freshRoot("escape");
  let out = catText(root, "../../etc/passwd");
  expect(out.indexOf("cat: ../../etc/passwd:") >= 0);
  expect(out.indexOf("escapes the workspace") >= 0);
});

test("a file over the read limit is shown truncated, with the marker appended", () => {
  let root = freshRoot("truncated");
  let lines: string[] = [];
  let i = 0;
  while (i < 2500) {
    lines.push("line " + `${i}`);
    i = i + 1;
  }
  fs.writeFileSync(root + "/big.txt", lines.join("\n"));
  let out = catText(root, "big.txt");
  expect(out.indexOf("(truncated)") >= 0);
  expect(out.indexOf("line 0") >= 0);
  expect(out.indexOf("line 1999") >= 0);
  expect(out.indexOf("line 2499") < 0);
});
