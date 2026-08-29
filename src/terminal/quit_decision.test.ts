import { PendingQuitDecision, quitDecisionOptionForChar, QUIT_DECISION_KEEP, QUIT_DECISION_QUIT, QUIT_DECISION_STAY, QUIT_DECISION_OPTION_COUNT } from "./input_state.ts";
import { quitDecisionOptionLabel, quitDecisionOptionRow } from "./renderer.ts";
import { backgroundKeptNotes } from "./quit_decision.ts";

test("the quit prompt offers exactly three answers", () => {
  expect(QUIT_DECISION_OPTION_COUNT == 3);
  expect(QUIT_DECISION_KEEP == 0);
  expect(QUIT_DECISION_QUIT == 1);
  expect(QUIT_DECISION_STAY == 2);
});

test("a number or the initial letter picks an answer, anything else is not a choice", () => {
  expect(quitDecisionOptionForChar("1") == QUIT_DECISION_KEEP);
  expect(quitDecisionOptionForChar("k") == QUIT_DECISION_KEEP);
  expect(quitDecisionOptionForChar("2") == QUIT_DECISION_QUIT);
  expect(quitDecisionOptionForChar("q") == QUIT_DECISION_QUIT);
  expect(quitDecisionOptionForChar("3") == QUIT_DECISION_STAY);
  expect(quitDecisionOptionForChar("s") == QUIT_DECISION_STAY);
  expect(quitDecisionOptionForChar("x") == -1);
  expect(quitDecisionOptionForChar("") == -1);
});

test("keep is the first answer and names the background, so Enter on a fresh prompt keeps the session", () => {
  let p = new PendingQuitDecision();
  p.open();
  expect(p.isPending());
  expect(p.selected == QUIT_DECISION_KEEP);
  expect(quitDecisionOptionLabel(QUIT_DECISION_KEEP).indexOf("background") >= 0);
  expect(quitDecisionOptionLabel(QUIT_DECISION_QUIT).indexOf("Quit") >= 0);
});

test("the selection moves between the three answers and clamps at both ends", () => {
  let p = new PendingQuitDecision();
  p.open();
  expect(!p.moveSelection(-1));
  expect(p.selected == 0);
  expect(p.moveSelection(1));
  expect(p.selected == 1);
  expect(p.moveSelection(1));
  expect(p.selected == 2);
  expect(!p.moveSelection(1));
  expect(p.selected == 2);
});

test("closing the prompt clears its pending state and its option rows", () => {
  let p = new PendingQuitDecision();
  p.open();
  p.setOptionRows(7);
  expect(p.hasOptionRows());
  p.close();
  expect(!p.isPending());
  expect(!p.hasOptionRows());
});

test("keeping a session says where it went and how to end it", () => {
  let notes = backgroundKeptNotes(41234, "");
  expect(notes.length == 2);
  expect(notes[0].indexOf("127.0.0.1:41234") >= 0);
  expect(notes[1].indexOf("joule --stop") >= 0);
});

test("keeping a named session says how to reattach and end that exact session", () => {
  let notes = backgroundKeptNotes(41234, "review");
  expect(notes[0].indexOf("review") >= 0);
  expect(notes[1].indexOf("joule --session review") >= 0);
  expect(notes[1].indexOf("joule --stop --session review") >= 0);
});

test("only the highlighted answer row carries the cursor marker", () => {
  let selected = quitDecisionOptionRow(QUIT_DECISION_KEEP, QUIT_DECISION_KEEP);
  let other = quitDecisionOptionRow(QUIT_DECISION_QUIT, QUIT_DECISION_KEEP);
  expect(selected.indexOf("> ") >= 0);
  expect(other.indexOf("> ") < 0);
  expect(other.indexOf(quitDecisionOptionLabel(QUIT_DECISION_QUIT)) >= 0);
});
