import { updateCheckDisabled, UPDATE_CHECK_ENV } from "./settings.ts";

test("the env var name matches the JOULE_CODE_ convention", () => {
  expect(UPDATE_CHECK_ENV == "JOULE_CODE_UPDATE_CHECK");
});

test("unset env and file leaves the check enabled", () => {
  expect(!updateCheckDisabled("", ""));
});

test("off, 0, false and no all disable it via env, case-insensitively", () => {
  expect(updateCheckDisabled("off", ""));
  expect(updateCheckDisabled("OFF", ""));
  expect(updateCheckDisabled("0", ""));
  expect(updateCheckDisabled("false", ""));
  expect(updateCheckDisabled("no", ""));
  expect(updateCheckDisabled(" off ", ""));
});

test("the config file value is honored when env is unset", () => {
  expect(updateCheckDisabled("", "off"));
  expect(!updateCheckDisabled("", "on"));
});

test("env wins over the file when both are set", () => {
  expect(!updateCheckDisabled("on", "off"));
  expect(updateCheckDisabled("off", "on"));
});

test("an unrecognized value leaves the check enabled rather than guessing", () => {
  expect(!updateCheckDisabled("banana", ""));
  expect(!updateCheckDisabled("", "banana"));
});
