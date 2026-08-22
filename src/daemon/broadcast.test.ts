import { appendBroadcast, newBroadcastReader } from "./broadcast.ts";

function freshRuntimeDir(name: string): string {
  let dir = "/tmp/daemon-broadcast-test-" + name;
  if (fs.existsSync(dir)) { fs.rmSync(dir, true); }
  fs.mkdirSync(dir, true);
  return dir;
}

test("a fresh reader on an empty log drains nothing", () => {
  let dir = freshRuntimeDir("empty");
  let reader = newBroadcastReader(dir);
  expect(reader.drainNew().length == 0);
});

test("a reader started after frames were appended still sees all of them", () => {
  let dir = freshRuntimeDir("late-join");
  appendBroadcast(dir, "{\"seq\":1}");
  appendBroadcast(dir, "{\"seq\":2}");
  let reader = newBroadcastReader(dir);
  let entries = reader.drainNew();
  expect(entries.length == 2);
  expect(entries[0].payload == "{\"seq\":1}");
  expect(entries[1].payload == "{\"seq\":2}");
});

test("two independent readers on the same log each see every frame", () => {
  let dir = freshRuntimeDir("two-readers");
  appendBroadcast(dir, "{\"seq\":1}");
  let a = newBroadcastReader(dir);
  let b = newBroadcastReader(dir);
  expect(a.drainNew().length == 1);
  appendBroadcast(dir, "{\"seq\":2}");
  expect(a.drainNew().length == 1);
  expect(b.drainNew().length == 2);
});
