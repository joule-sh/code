import { attachWorkersLive, stopAttachWorker, currentAttachSocket } from "./attach_worker.ts";

test("a client that never opened a socket has no receive loop to stop", () => {
  expect(attachWorkersLive() == 0);
  expect(currentAttachSocket().length == 0);
});

test("stopping a receive loop that was never started reports nothing left holding a socket", () => {
  expect(stopAttachWorker());
  expect(currentAttachSocket().length == 0);
});

test("stopping twice is not an error and still reports nothing parked", () => {
  expect(stopAttachWorker());
  expect(stopAttachWorker());
  expect(attachWorkersLive() == 0);
});
