import { rows } from "../vendor/tty/tty.ts";

const STDIN: int = 0;

export const MODE_READ_ONLY: string = "read-only";
export const MODE_AUTO_EDIT: string = "auto-edit";
export const MODE_SAFE_AUTO: string = "safe-auto";
export const MODE_FULL_AUTO: string = "full-auto";
export const MODE_PLAN: string = "plan";

export function screenRows(): int {
  let r = rows(STDIN);
  if (r <= 1) { r = 24; }
  return r;
}

export function nextMode(mode: string): string {
  if (mode == MODE_READ_ONLY) { return MODE_AUTO_EDIT; }
  if (mode == MODE_AUTO_EDIT) { return MODE_SAFE_AUTO; }
  if (mode == MODE_SAFE_AUTO) { return MODE_FULL_AUTO; }
  return MODE_READ_ONLY;
}

test("nextMode cycles read-only -> auto-edit -> safe-auto -> full-auto -> read-only", () => {
  expect(nextMode(MODE_READ_ONLY) == MODE_AUTO_EDIT);
  expect(nextMode(MODE_AUTO_EDIT) == MODE_SAFE_AUTO);
  expect(nextMode(MODE_SAFE_AUTO) == MODE_FULL_AUTO);
  expect(nextMode(MODE_FULL_AUTO) == MODE_READ_ONLY);
});

test("nextMode treats plan as an off-cycle mode, same as an unrecognised one", () => {
  expect(nextMode(MODE_PLAN) == MODE_READ_ONLY);
});
