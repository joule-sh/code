import { InputLine, InputHistory, PendingApproval, clip, approvalOptionForChar, decisionForApprovalOption, APPROVAL_OPTION_ALLOW, APPROVAL_OPTION_ALWAYS, APPROVAL_OPTION_DENY, APPROVAL_OPTION_COUNT } from "./input_state.ts";

test("InputLine push and backspace edit the buffer", () => {
  let line = new InputLine();
  line.push("a");
  line.push("b");
  line.push("c");
  expect(line.buf == "abc");
  line.backspace();
  expect(line.buf == "ab");
});

test("InputLine backspace on empty buffer is a no-op", () => {
  let line = new InputLine();
  line.backspace();
  expect(line.buf == "");
});

test("InputLine takeAndClear returns the text and empties the buffer", () => {
  let line = new InputLine();
  line.push("hi");
  let taken = line.takeAndClear();
  expect(taken == "hi");
  expect(line.buf == "");
});

test("InputLine setBuf replaces the buffer directly", () => {
  let line = new InputLine();
  line.push("abc");
  line.setBuf("recalled");
  expect(line.buf == "recalled");
});

test("PendingApproval tracks and clears a call id", () => {
  let p = new PendingApproval();
  expect(!p.isPending());
  p.set("c1");
  expect(p.isPending());
  expect(p.callId == "c1");
  p.clearIfMatches("c2");
  expect(p.isPending());
  p.clearIfMatches("c1");
  expect(!p.isPending());
});

test("a fresh PendingApproval starts on the first option with no option rows on screen", () => {
  let p = new PendingApproval();
  expect(p.selected == APPROVAL_OPTION_ALLOW);
  expect(!p.hasOptionRows());
  p.set("c1");
  p.setOptionRows(7);
  expect(p.hasOptionRows());
  expect(p.firstOptionRow == 7);
});

test("moveSelection walks the option list and reports whether the highlight actually moved", () => {
  let p = new PendingApproval();
  expect(p.moveSelection(1, APPROVAL_OPTION_COUNT));
  expect(p.selected == APPROVAL_OPTION_ALWAYS);
  expect(p.moveSelection(1, APPROVAL_OPTION_COUNT));
  expect(p.selected == APPROVAL_OPTION_DENY);
  expect(p.moveSelection(-1, APPROVAL_OPTION_COUNT));
  expect(p.selected == APPROVAL_OPTION_ALWAYS);
});

test("moveSelection clamps at both ends rather than wrapping, and reports no move there", () => {
  let p = new PendingApproval();
  expect(!p.moveSelection(-1, APPROVAL_OPTION_COUNT));
  expect(p.selected == APPROVAL_OPTION_ALLOW);
  p.select(APPROVAL_OPTION_DENY, APPROVAL_OPTION_COUNT);
  expect(!p.moveSelection(1, APPROVAL_OPTION_COUNT));
  expect(p.selected == APPROVAL_OPTION_DENY);
});

test("select ignores an index outside the option list", () => {
  let p = new PendingApproval();
  p.select(APPROVAL_OPTION_DENY, APPROVAL_OPTION_COUNT);
  p.select(APPROVAL_OPTION_COUNT, APPROVAL_OPTION_COUNT);
  p.select(-1, APPROVAL_OPTION_COUNT);
  expect(p.selected == APPROVAL_OPTION_DENY);
});

test("a new approval resets the highlight back to the first option", () => {
  let p = new PendingApproval();
  p.set("c1");
  p.moveSelection(2, APPROVAL_OPTION_COUNT);
  expect(p.selected == APPROVAL_OPTION_DENY);
  p.set("c2");
  expect(p.selected == APPROVAL_OPTION_ALLOW);
  expect(!p.hasOptionRows());
});

test("clearing an answered approval forgets its option rows so later keys cannot repaint them", () => {
  let p = new PendingApproval();
  p.set("c1");
  p.setTool("run");
  p.setOptionRows(3);
  p.clearIfMatches("c1");
  expect(!p.hasOptionRows());
  expect(p.tool == "");
});

test("approvalOptionForChar keeps y/n/a working and adds the list positions", () => {
  expect(approvalOptionForChar("y") == APPROVAL_OPTION_ALLOW);
  expect(approvalOptionForChar("1") == APPROVAL_OPTION_ALLOW);
  expect(approvalOptionForChar("a") == APPROVAL_OPTION_ALWAYS);
  expect(approvalOptionForChar("2") == APPROVAL_OPTION_ALWAYS);
  expect(approvalOptionForChar("n") == APPROVAL_OPTION_DENY);
  expect(approvalOptionForChar("3") == APPROVAL_OPTION_DENY);
});

test("approvalOptionForChar returns -1 for anything that is not a shortcut", () => {
  expect(approvalOptionForChar("x") == -1);
  expect(approvalOptionForChar("0") == -1);
  expect(approvalOptionForChar("4") == -1);
  expect(approvalOptionForChar("") == -1);
  expect(approvalOptionForChar("Y") == -1);
});

test("each option maps onto the existing allow/always/deny reply vocabulary", () => {
  expect(decisionForApprovalOption(APPROVAL_OPTION_ALLOW) == "allow");
  expect(decisionForApprovalOption(APPROVAL_OPTION_ALWAYS) == "always");
  expect(decisionForApprovalOption(APPROVAL_OPTION_DENY) == "deny");
});

test("clip truncates a line to the given width", () => {
  expect(clip("hello world", 5) == "hello");
  expect(clip("hi", 5) == "hi");
  expect(clip("hello", 0) == "hello");
});

test("clip does not count an ANSI color code toward the visible width", () => {
  let esc = String.fromCharCode(27);
  let colored = esc + "[38;2;139;92;246m" + "hi" + esc + "[0m";
  let out = clip(colored, 5);
  expect(out.indexOf("hi") >= 0);
  expect(out.indexOf(esc + "[38;2;139;92;246m") >= 0);
});

test("clip appends a reset when it truncates a colored line mid-content", () => {
  let esc = String.fromCharCode(27);
  let colored = esc + "[38;2;139;92;246m" + "hello world" + esc + "[0m";
  let out = clip(colored, 5);
  expect(out.indexOf("hello") >= 0);
  expect(out.indexOf("world") < 0);
  expect(out.slice(out.length - 4, out.length) == esc + "[0m");
});

test("clip leaves a plain uncolored line under width untouched", () => {
  expect(clip("plain text", 40) == "plain text");
});

test("clip counts a multi-byte UTF-8 character as a single visible column", () => {
  let line = "┌─┐";
  let out = clip(line, 2);
  expect(out == "┌─");
});

test("clip never cuts a multi-byte UTF-8 character in half", () => {
  let line = "a┌b";
  let out = clip(line, 2);
  expect(out == "a┌");
  expect(out.length == 4);
});

test("clip fits a whole row of box-drawing characters within its true visible width", () => {
  let border = "┌────┐";
  let out = clip(border, 6);
  expect(out == border);
});

test("InputHistory records submitted entries in order", () => {
  let h = new InputHistory();
  h.record("first");
  h.record("second");
  h.record("third");
  expect(h.entries.length == 3);
  expect(h.entries[0] == "first");
  expect(h.entries[1] == "second");
  expect(h.entries[2] == "third");
});

test("InputHistory back steps from the most recent entry backward", () => {
  let h = new InputHistory();
  h.record("first");
  h.record("second");
  h.record("third");
  expect(h.back("") == "third");
  expect(h.back("") == "second");
  expect(h.back("") == "first");
});

test("InputHistory forward steps back toward the most recent entry", () => {
  let h = new InputHistory();
  h.record("first");
  h.record("second");
  h.record("third");
  h.back("");
  h.back("");
  h.back("");
  expect(h.forward() == "second");
  expect(h.forward() == "third");
});

test("InputHistory stashes an in-progress line and restores it after navigating back through history", () => {
  let h = new InputHistory();
  h.record("first");
  h.record("second");
  let inProgress = "not yet sent";
  expect(h.back(inProgress) == "second");
  expect(h.back("") == "first");
  expect(h.forward() == "second");
  expect(h.forward() == inProgress);
});

test("InputHistory back on empty history is a safe no-op that returns the current buffer", () => {
  let h = new InputHistory();
  expect(h.back("still typing") == "still typing");
  expect(h.entries.length == 0);
});

test("InputHistory forward past the newest entry lands on an empty stash when nothing was in progress", () => {
  let h = new InputHistory();
  h.record("only");
  h.back("");
  expect(h.forward() == "");
});

test("InputHistory back does not walk past the oldest entry", () => {
  let h = new InputHistory();
  h.record("only");
  h.record("newest");
  h.back("");
  h.back("");
  expect(h.back("") == "only");
  expect(h.back("") == "only");
});

test("InputHistory forward without any backward navigation returns the stash unchanged", () => {
  let h = new InputHistory();
  h.record("first");
  expect(h.forward() == "");
});

test("InputHistory record clears any stashed navigation state", () => {
  let h = new InputHistory();
  h.record("first");
  h.back("in progress");
  h.record("second");
  expect(h.back("") == "second");
  expect(h.back("") == "first");
});
