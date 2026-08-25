import { MouseReporting, mouseReportingOn, mouseSettingWord, mouseStateText, runMouseCommand, MOUSE_ON, MOUSE_OFF } from "./mouse_reporting.ts";
import { ENTER_ALT_SCREEN, EXIT_ALT_SCREEN, HIDE_CURSOR, SHOW_CURSOR, ENABLE_MOUSE_REPORTING, DISABLE_MOUSE_REPORTING } from "../vendor/tty/tty.ts";

test("mouse reporting is off unless something turns it on, so a drag selects text", () => {
  expect(!mouseReportingOn("", ""));
});

test("the config file value turns mouse reporting on", () => {
  expect(mouseReportingOn("", "on"));
  expect(mouseReportingOn("", "ON"));
  expect(mouseReportingOn("", " yes "));
  expect(mouseReportingOn("", "1"));
  expect(mouseReportingOn("", "true"));
});

test("an off or unrecognised config value leaves reporting off", () => {
  expect(!mouseReportingOn("", "off"));
  expect(!mouseReportingOn("", "no"));
  expect(!mouseReportingOn("", "banana"));
});

test("the environment overrides the config file in both directions", () => {
  expect(mouseReportingOn("on", "off"));
  expect(!mouseReportingOn("off", "on"));
});

test("the startup sequence carries the mouse enable only when reporting is on", () => {
  let off = new MouseReporting(false);
  expect(off.enterSequence() == ENTER_ALT_SCREEN + HIDE_CURSOR);
  let on = new MouseReporting(true);
  expect(on.enterSequence() == ENTER_ALT_SCREEN + HIDE_CURSOR + ENABLE_MOUSE_REPORTING);
});

test("the teardown sequence carries the disable only when the enable was written, so the pair stays balanced", () => {
  let off = new MouseReporting(false);
  expect(off.exitSequence() == SHOW_CURSOR + EXIT_ALT_SCREEN);
  expect(off.exitSequence().indexOf(DISABLE_MOUSE_REPORTING) < 0);
  let on = new MouseReporting(true);
  expect(on.exitSequence() == DISABLE_MOUSE_REPORTING + SHOW_CURSOR + EXIT_ALT_SCREEN);
});

test("switching reporting on and back off writes each escape once", () => {
  let m = new MouseReporting(false);
  expect(m.switchSequence(true) == ENABLE_MOUSE_REPORTING);
  expect(m.on);
  expect(m.switchSequence(true) == "");
  expect(m.switchSequence(false) == DISABLE_MOUSE_REPORTING);
  expect(!m.on);
  expect(m.switchSequence(false) == "");
  expect(m.exitSequence() == SHOW_CURSOR + EXIT_ALT_SCREEN);
});

test("the setting word round-trips through the reporting state", () => {
  expect(mouseSettingWord(true) == MOUSE_ON);
  expect(mouseSettingWord(false) == MOUSE_OFF);
  expect(mouseReportingOn("", mouseSettingWord(true)));
  expect(!mouseReportingOn("", mouseSettingWord(false)));
});

test("the state text says what each state costs and what it buys", () => {
  expect(mouseStateText(true).indexOf("wheel") >= 0);
  expect(mouseStateText(true).indexOf("Shift") >= 0);
  expect(mouseStateText(false).indexOf("select") >= 0);
  expect(mouseStateText(false).indexOf("PageUp/PageDown") >= 0);
});

test("each state text fits an 80 column terminal, so neither is clipped where it matters", () => {
  expect(mouseStateText(true).trim().length <= 80);
  expect(mouseStateText(false).trim().length <= 80);
});

test("/mouse with an argument that is neither on nor off changes nothing and says so", () => {
  let m = new MouseReporting(false);
  expect(runMouseCommand(m, "sideways").indexOf("usage: /mouse") >= 0);
  expect(!m.on);
});

test("/mouse with no argument reports the state without changing it", () => {
  let m = new MouseReporting(true);
  expect(runMouseCommand(m, "") == mouseStateText(true));
  expect(m.on);
});
