import { jail } from "./jail.ts";

function freshRoot(name: string): string {
  let root = "/tmp/jail-test-" + name;
  if (fs.existsSync(root)) {
    fs.rmSync(root, true);
  }
  fs.mkdirSync(root, true);
  return root;
}

test("a normal path inside the root is allowed", () => {
  let root = freshRoot("normal");
  fs.mkdirSync(root + "/src");
  fs.writeFileSync(root + "/src/a.ts", "hi");
  let r = jail(root, "src/a.ts");
  expect(r.ok);
  expect(r.path == fs.realpathSync(root) + "/src/a.ts");
});

test("a traversal path out of the root is refused", () => {
  let root = freshRoot("traverse");
  let r = jail(root, "../../etc/passwd");
  expect(!r.ok);
});

test("an absolute-looking path stays nested under the root, not escaped", () => {
  let root = freshRoot("absolute");
  let r = jail(root, "/etc/passwd");
  expect(r.ok);
  expect(r.path.startsWith(fs.realpathSync(root)));
  expect(!r.ok || r.path != "/etc/passwd");
});

test("a symlink inside the root pointing out of it is refused", () => {
  let root = freshRoot("symlink");
  let outside = "/tmp/jail-test-outside";
  if (fs.existsSync(outside)) {
    fs.rmSync(outside, true);
  }
  fs.mkdirSync(outside, true);
  fs.writeFileSync(outside + "/secret.txt", "leaked");
  fs.symlinkSync(outside, root + "/escape");

  let r = jail(root, "escape/secret.txt");
  expect(!r.ok);
});

test("a not-yet-existing file under the root is still allowed", () => {
  let root = freshRoot("notyet");
  let r = jail(root, "new/dir/file.ts");
  expect(r.ok);
  expect(r.path == fs.realpathSync(root) + "/new/dir/file.ts");
});

test("a not-yet-existing file escaping via traversal is still refused", () => {
  let root = freshRoot("notyet-escape");
  let r = jail(root, "../outside/file.ts");
  expect(!r.ok);
});
