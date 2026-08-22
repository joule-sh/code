import { nextMode, isValidMode } from "./slots.ts";
import { MODE_READ_ONLY, MODE_AUTO_EDIT, MODE_SAFE_AUTO, MODE_FULL_AUTO, MODE_PLAN } from "../approval/gate.ts";

test("the mode cycle steps read-only to auto-edit to safe-auto to full-auto and round again", () => {
  expect(nextMode(MODE_READ_ONLY) == MODE_AUTO_EDIT);
  expect(nextMode(MODE_AUTO_EDIT) == MODE_SAFE_AUTO);
  expect(nextMode(MODE_SAFE_AUTO) == MODE_FULL_AUTO);
  expect(nextMode(MODE_FULL_AUTO) == MODE_READ_ONLY);
});

test("four steps from any mode arrive back where they started", () => {
  expect(nextMode(nextMode(nextMode(nextMode(MODE_READ_ONLY)))) == MODE_READ_ONLY);
  expect(nextMode(nextMode(nextMode(nextMode(MODE_AUTO_EDIT)))) == MODE_AUTO_EDIT);
  expect(nextMode(nextMode(nextMode(nextMode(MODE_SAFE_AUTO)))) == MODE_SAFE_AUTO);
  expect(nextMode(nextMode(nextMode(nextMode(MODE_FULL_AUTO)))) == MODE_FULL_AUTO);
});

test("every mode the cycle produces is one the /mode command would also accept", () => {
  let m = MODE_READ_ONLY;
  let i = 0;
  while (i < 9) {
    m = nextMode(m);
    expect(isValidMode(m));
    i = i + 1;
  }
});

test("a mode string the cycle does not recognise lands on read-only rather than sticking", () => {
  expect(nextMode("nonsense") == MODE_READ_ONLY);
  expect(nextMode("") == MODE_READ_ONLY);
});

test("safe-auto is a valid mode on its own", () => {
  expect(isValidMode(MODE_SAFE_AUTO));
});

test("plan is a valid mode on its own, reachable through /mode, not the shift+tab cycle", () => {
  expect(isValidMode(MODE_PLAN));
});

test("the shift+tab cycle never lands on plan - a fifth stop would cost every mode extra keypresses", () => {
  expect(nextMode(MODE_READ_ONLY) != MODE_PLAN);
  expect(nextMode(MODE_AUTO_EDIT) != MODE_PLAN);
  expect(nextMode(MODE_SAFE_AUTO) != MODE_PLAN);
  expect(nextMode(MODE_FULL_AUTO) != MODE_PLAN);
});

test("cycling out of plan with shift+tab lands on read-only, the same fallback an unrecognized mode gets", () => {
  expect(nextMode(MODE_PLAN) == MODE_READ_ONLY);
});
