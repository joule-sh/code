import { run } from "./run.ts";

function freshRoot(name: string): string {
  let root = "/tmp/run-test-" + name;
  if (fs.existsSync(root)) {
    fs.rmSync(root, true);
  }
  fs.mkdirSync(root, true);
  return root;
}

test("exit 0 with output captured", () => {
  let root = freshRoot("exit0");
  let r = run(root, "echo hello", 5000);
  expect(r.ok);
  expect(r.status == 0);
  expect(r.stdout.indexOf("hello") >= 0);
  expect(!r.killed);
});

test("a non-zero exit is reported with its code, not thrown", () => {
  let root = freshRoot("nonzero");
  let r = run(root, "exit 7", 5000);
  expect(r.ok);
  expect(r.status == 7);
});

test("stderr is captured separately from stdout", () => {
  let root = freshRoot("stderr");
  let r = run(root, "echo out; echo err 1>&2", 5000);
  expect(r.stdout.indexOf("out") >= 0);
  expect(r.stderr.indexOf("err") >= 0);
});

test("cwd is the workspace root", () => {
  let root = freshRoot("cwd");
  fs.writeFileSync(root + "/marker.txt", "here");
  let r = run(root, "cat marker.txt", 5000);
  expect(r.stdout.indexOf("here") >= 0);
});

test("output over the cap is truncated with the flag set", () => {
  let root = freshRoot("cap");
  let r = run(root, "yes x | head -c 200000", 10000);
  expect(r.truncated);
  expect(r.stdout.length <= 100000);
});

test("a command reading stdin does not hang the test", () => {
  let root = freshRoot("stdin");
  let r = run(root, "cat", 5000);
  expect(r.ok);
});

test("running past the timeout budget is reported as killed", () => {
  let root = freshRoot("timeout");
  let r = run(root, "sleep 1", 200);
  expect(r.killed);
  expect(r.error.indexOf("exceeded") >= 0);
});

test("running within the timeout budget is not reported as killed", () => {
  let root = freshRoot("no-timeout");
  let r = run(root, "echo quick", 5000);
  expect(!r.killed);
});
