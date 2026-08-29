import { PendingSessionPick } from "./input_state.ts";
import { sessionDisplayName, sessionEntryRow, currentSessionLine, stayingNote, joulePlusSession } from "./session_switch.ts";

test("sessionDisplayName shows \"default\" for the unnamed session and the name itself otherwise", () => {
  expect(sessionDisplayName("") == "default");
  expect(sessionDisplayName("review") == "review");
});

test("sessionEntryRow marks the current session and highlights the selected row, independently", () => {
  let current = sessionEntryRow("review", true, false);
  let notCurrent = sessionEntryRow("release", false, false);
  let selected = sessionEntryRow("release", false, true);
  expect(current.indexOf("(current)") >= 0);
  expect(notCurrent.indexOf("(current)") < 0);
  expect(selected.indexOf("> ") >= 0);
  expect(notCurrent.indexOf("> ") < 0);
});

test("currentSessionLine names the default session plainly, matching /model and /mode with no argument", () => {
  expect(currentSessionLine("") == "\nsession: default");
  expect(currentSessionLine("review") == "\nsession: review");
});

test("stayingNote names the session that was stayed in", () => {
  expect(stayingNote("").indexOf("default session") >= 0);
  expect(stayingNote("review").indexOf("review session") >= 0);
});

test("joulePlusSession names the exact command for a session, and the bare one for the default", () => {
  expect(joulePlusSession("joule", "") == "joule");
  expect(joulePlusSession("joule", "review") == "joule --session review");
  expect(joulePlusSession("joule --stop", "review") == "joule --stop --session review");
});

test("PendingSessionPick opens on the current session's index, so Enter on a fresh prompt stays", () => {
  let p = new PendingSessionPick();
  p.open(["", "review", "release"], 1);
  expect(p.isPending());
  expect(p.selected == 1);
  expect(p.selectedEntry() == "review");
});

test("PendingSessionPick clamps out-of-range indices back to the first entry", () => {
  let p = new PendingSessionPick();
  p.open(["", "review"], 99);
  expect(p.selected == 0);
});

test("PendingSessionPick.moveSelection clamps at both ends, unlike the model picker it has no headers to skip", () => {
  let p = new PendingSessionPick();
  p.open(["", "review", "release"], 0);
  expect(!p.moveSelection(-1));
  expect(p.selected == 0);
  expect(p.moveSelection(1));
  expect(p.selected == 1);
  expect(p.moveSelection(1));
  expect(p.selected == 2);
  expect(!p.moveSelection(1));
  expect(p.selected == 2);
});

test("PendingSessionPick.close clears pending state and its entries", () => {
  let p = new PendingSessionPick();
  p.open(["", "review"], 0);
  p.setOptionRows(4);
  expect(p.hasOptionRows());
  p.close();
  expect(!p.isPending());
  expect(!p.hasOptionRows());
});
