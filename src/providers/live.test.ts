import { CancelWatch, TurnTracker } from "./live.ts";

test("a fresh CancelWatch has not tripped", () => {
  let w = new CancelWatch();
  expect(!w.tripped());
});

test("polling a fd with nothing pending does not trip the watch", () => {
  let w = new CancelWatch();
  w.poll(0);
  expect(!w.tripped());
});

test("reset clears a tripped watch back to untripped", () => {
  let w = new CancelWatch();
  w.seen = true;
  expect(w.tripped());
  w.reset();
  expect(!w.tripped());
});

test("a fresh TurnTracker starts with an empty current turn", () => {
  let t = new TurnTracker();
  expect(t.current == "");
});

test("setCurrent updates the tracked turn id", () => {
  let t = new TurnTracker();
  t.setCurrent("t1");
  expect(t.current == "t1");
  t.setCurrent("t2");
  expect(t.current == "t2");
});
