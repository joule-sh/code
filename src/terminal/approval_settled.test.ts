import { approvalAskText, approvalSettledLine, settledPhraseFor, settleApprovalBlock, noteApprovalBlock, SETTLED_ALLOWED, SETTLED_ALWAYS, SETTLED_DENIED, SETTLED_BY_MODE } from "./approval_settled.ts";
import { DECISION_ALLOW, DECISION_ALWAYS, DECISION_DENY, DECIDED_BY_MODE, DECIDED_BY_PERSON } from "../protocol/frames.ts";
import { PendingApproval, APPROVAL_OPTION_COUNT } from "./input_state.ts";
import { Scrollback } from "./scrollback.ts";

const WIDE_ASK: string = "run [{\"command\": \"npm run build --silent && npm test -- --reporter=verbose --runInBand tests/health.spec.js\"}]";

test("yes, yes-and-don't-ask-again, and a standing mode are three different facts", () => {
  let allow = settledPhraseFor(DECISION_ALLOW, DECIDED_BY_PERSON);
  let always = settledPhraseFor(DECISION_ALWAYS, DECIDED_BY_PERSON);
  let mode = settledPhraseFor(DECISION_ALLOW, DECIDED_BY_MODE);
  expect(allow == SETTLED_ALLOWED);
  expect(always == SETTLED_ALWAYS);
  expect(mode == SETTLED_BY_MODE);
  expect(allow != always);
  expect(allow != mode);
  expect(always != mode);
  expect(settledPhraseFor(DECISION_DENY, DECIDED_BY_PERSON) == SETTLED_DENIED);
});

test("a denial settles as a denial rather than disappearing", () => {
  let line = approvalSettledLine("run [{}]", settledPhraseFor(DECISION_DENY, DECIDED_BY_PERSON), 80);
  expect(line.indexOf(SETTLED_DENIED) > 0);
  expect(line.indexOf("run [{}]") > 0);
});

test("the settled line fits 80 columns whatever was asked, and keeps the decision", () => {
  for (const phrase of [SETTLED_ALLOWED, SETTLED_ALWAYS, SETTLED_DENIED, SETTLED_BY_MODE]) {
    let line = approvalSettledLine(WIDE_ASK, phrase, 80);
    expect(line.length <= 80);
    expect(line.slice(line.length - phrase.length, line.length) == phrase);
  }
});

test("a settled line too long for its width loses the end of the ask, not the decision", () => {
  let line = approvalSettledLine(WIDE_ASK, SETTLED_ALWAYS, 80);
  expect(line.indexOf("...") > 0);
  expect(line.indexOf("run [{") > 0);
  expect(line.indexOf("tests/health.spec.js") < 0);
});

test("an unknown width still lands inside the 80 columns scrollback is clipped at", () => {
  expect(approvalSettledLine(WIDE_ASK, SETTLED_BY_MODE, 0).length <= 80);
});

test("what was asked reads the same settled as it did open", () => {
  expect(approvalAskText("run", "{\"command\": \"ls\"}") == "run [{\"command\": \"ls\"}]");
});

function blockScrollback(): Scrollback {
  let sb = new Scrollback();
  sb.append("\nbefore");
  sb.markApprovalBlock();
  sb.append("\n  ? run [{\"command\": \"ls\"}]");
  sb.appendFixed("\n  1. Yes\n  2. Always\n  3. No");
  return sb;
}

test("settling an approval leaves one line where the whole block was", () => {
  let sb = blockScrollback();
  let pending = new PendingApproval();
  pending.begin("c1", "run");
  noteApprovalBlock(sb, pending, "run", "{\"command\": \"ls\"}");
  let rows = sb.lineCount();

  settleApprovalBlock(sb, pending, DECISION_ALLOW);

  expect(sb.lineCount() == rows);
  expect(sb.visibleCount() == rows - APPROVAL_OPTION_COUNT);
  let view = sb.tail(rows);
  expect(view[view.length - 1].indexOf(SETTLED_ALLOWED) > 0);
  for (const row of view) {
    expect(row.indexOf("3. No") < 0);
    expect(row.indexOf("2. Always") < 0);
  }
});

test("no row above or below a settled approval moves, so nothing repainted by row number corrupts", () => {
  let sb = blockScrollback();
  let pending = new PendingApproval();
  pending.begin("c1", "run");
  noteApprovalBlock(sb, pending, "run", "{\"command\": \"ls\"}");
  let firstOption = pending.firstOptionRow;
  sb.append("\nafter");
  let tailRow = sb.lineCount() - 1;

  settleApprovalBlock(sb, pending, DECISION_DENY);

  expect(sb.lines[tailRow] == "after");
  expect(sb.lines[firstOption].indexOf("1. Yes") >= 0);
  expect(sb.isHidden(firstOption));
  expect(!sb.isHidden(tailRow));
});

test("ctrl-o does not bring a dead menu back", () => {
  let sb = blockScrollback();
  let pending = new PendingApproval();
  pending.begin("c1", "run");
  noteApprovalBlock(sb, pending, "run", "{\"command\": \"ls\"}");
  settleApprovalBlock(sb, pending, DECISION_ALLOW);

  expect(!sb.toggleLastGroup());
  expect(sb.collapsedCount() == 0);
  for (const row of sb.tail(sb.lineCount())) {
    expect(row.indexOf("3. No") < 0);
  }
});
