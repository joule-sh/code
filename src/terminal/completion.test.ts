import { Completion, matchCommands, isCompletionPrefix, wrapDescription, completionRows, entryRows, panelBudget, firstVisibleEntry, COMPLETION_MAX_LIST_ROWS, COMPLETION_MARKER } from "./completion.ts";
import { commandList } from "./commands.ts";
import { InputLine, clip } from "./input_state.ts";

test("a buffer that does not start with a slash never opens the panel", () => {
  expect(!isCompletionPrefix(""));
  expect(!isCompletionPrefix("hello"));
  expect(!isCompletionPrefix("say /help"));
});

test("a slash followed by a space closes the panel", () => {
  expect(isCompletionPrefix("/"));
  expect(isCompletionPrefix("/mo"));
  expect(!isCompletionPrefix("/mode full-auto"));
  expect(!isCompletionPrefix("/mode "));
});

test("a bare slash matches every command", () => {
  expect(matchCommands("/").length == commandList().length);
  expect(matchCommands("/")[0].name == "/help");
});

test("a prefix matching several commands returns all of them in registry order", () => {
  let m = matchCommands("/m");
  expect(m.length == 2);
  expect(m[0].name == "/model");
  expect(m[1].name == "/mode");
});

test("a longer prefix narrows the match set", () => {
  expect(matchCommands("/mod").length == 2);
  let one = matchCommands("/model");
  expect(one.length == 1);
  expect(one[0].name == "/model");
});

test("a command name that is itself a prefix of a longer one keeps both in the list", () => {
  let m = matchCommands("/mode");
  expect(m.length == 2);
  expect(m[0].name == "/model");
  expect(m[1].name == "/mode");
});

test("an exactly typed command takes the highlight even when a longer one also matches", () => {
  let c = new Completion();
  c.refresh("/mode");
  expect(c.matches.length == 2);
  expect(c.selectedName() == "/mode");
  c.refresh("/model");
  expect(c.selectedName() == "/model");
});

test("an exact command name still matches itself so the panel stays open", () => {
  let m = matchCommands("/help");
  expect(m.length == 1);
  expect(m[0].name == "/help");
});

test("a prefix that matches nothing yields no matches and a closed panel", () => {
  expect(matchCommands("/frobnicate").length == 0);
  let c = new Completion();
  c.refresh("/frobnicate");
  expect(!c.isOpen());
  expect(c.selectedName() == "");
});

test("every command in the registry is reachable by typing its own name", () => {
  let all = commandList();
  let i = 0;
  while (i < all.length) {
    let m = matchCommands(all[i].name);
    let found = false;
    let j = 0;
    while (j < m.length) {
      if (m[j].name == all[i].name) { found = true; }
      j = j + 1;
    }
    expect(found);
    i = i + 1;
  }
});

test("refreshing per keystroke narrows the match set live", () => {
  let c = new Completion();
  c.refresh("/");
  expect(c.matches.length == commandList().length);
  c.refresh("/m");
  expect(c.matches.length == 2);
  expect(c.matches[0].name == "/model");
  c.refresh("/model");
  expect(c.matches.length == 1);
  expect(c.matches[0].name == "/model");
  c.refresh("");
  expect(!c.isOpen());
});

test("the highlight moves down and clamps at the last match", () => {
  let c = new Completion();
  c.refresh("/m");
  expect(c.selected == 0);
  c.move(1);
  expect(c.selected == 1);
  c.move(1);
  expect(c.selected == 1);
  expect(c.selectedName() == "/mode");
});

test("the highlight moves up and clamps at the first match", () => {
  let c = new Completion();
  c.refresh("/");
  c.move(1);
  c.move(1);
  expect(c.selected == 2);
  c.move(-1);
  expect(c.selected == 1);
  c.move(-1);
  expect(c.selected == 0);
  c.move(-1);
  expect(c.selected == 0);
});

test("moving the highlight on a closed panel does nothing", () => {
  let c = new Completion();
  c.refresh("hello");
  c.move(1);
  expect(c.selected == 0);
  expect(!c.isOpen());
});

test("narrowing the match set resets the highlight to the top", () => {
  let c = new Completion();
  c.refresh("/");
  c.move(1);
  c.move(1);
  expect(c.selected == 2);
  c.refresh("/m");
  expect(c.selected == 0);
  expect(c.selectedName() == "/model");
});

test("the highlight survives a refresh that does not change the match set", () => {
  let c = new Completion();
  c.refresh("/m");
  c.move(1);
  expect(c.selected == 1);
  c.refresh("/m");
  expect(c.selected == 1);
});

test("accepting the completion writes the highlighted command into the buffer", () => {
  let input = new InputLine();
  input.push("/");
  input.push("m");
  expect(input.completion.selectedName() == "/model");
  expect(input.acceptCompletion());
  expect(input.buf == "/model");
});

test("accepting the completion after arrowing down inserts the second match", () => {
  let input = new InputLine();
  input.setBuf("/m");
  input.completion.move(1);
  expect(input.acceptCompletion());
  expect(input.buf == "/mode");
  expect(input.completion.selectedName() == "/mode");
});

test("accepting with no panel open leaves the buffer alone", () => {
  let input = new InputLine();
  input.setBuf("hello");
  expect(!input.acceptCompletion());
  expect(input.buf == "hello");
});

test("accepting a no-match slash prefix leaves the buffer alone", () => {
  let input = new InputLine();
  input.setBuf("/zzz");
  expect(!input.acceptCompletion());
  expect(input.buf == "/zzz");
});

test("backspacing reopens a wider match set", () => {
  let input = new InputLine();
  input.setBuf("/clear");
  expect(input.completion.matches.length == 1);
  input.backspace();
  input.backspace();
  input.backspace();
  input.backspace();
  expect(input.buf == "/c");
  expect(input.completion.matches.length == 2);
});

test("submitting the line closes the panel", () => {
  let input = new InputLine();
  input.setBuf("/help");
  expect(input.completion.isOpen());
  let line = input.takeAndClear();
  expect(line == "/help");
  expect(!input.completion.isOpen());
});

test("a description wraps at the column width without splitting words", () => {
  let lines = wrapDescription("show or set the approval mode", 12);
  expect(lines.length == 3);
  expect(lines[0] == "show or set");
  expect(lines[1] == "the approval");
  expect(lines[2] == "mode");
});

test("a description that fits stays on one line", () => {
  let lines = wrapDescription("quit", 20);
  expect(lines.length == 1);
  expect(lines[0] == "quit");
});

test("a wrapped description indents its continuation rows under the description column", () => {
  let rows = entryRows(commandList()[2], false, 12);
  expect(rows.length == 6);
  expect(rows[0].indexOf("/mode") >= 0);
  expect(rows[0].indexOf("show or set") >= 0);
  expect(rows[1].indexOf("/mode") < 0);
  expect(rows[1].indexOf("the approval") >= 0);
  expect(rows[5].indexOf("/mode") < 0);
});

test("the panel renders one row per match, a marker on the highlight, and a rule last", () => {
  let c = new Completion();
  c.refresh("/m");
  let rows = completionRows(c, 80, panelBudget(24, 0, 1), true);
  expect(rows.length == 3);
  expect(rows[0].indexOf(COMPLETION_MARKER) == 0);
  expect(rows[0].indexOf("/model") >= 0);
  expect(rows[0].indexOf("show or set the model") >= 0);
  expect(rows[1].indexOf(COMPLETION_MARKER) != 0);
  expect(rows[1].indexOf("/mode") >= 0);
  expect(rows[2].indexOf("─") >= 0);
});

test("the marker follows the highlight down the list", () => {
  let c = new Completion();
  c.refresh("/m");
  c.move(1);
  let rows = completionRows(c, 80, panelBudget(24, 0, 1), true);
  expect(rows[0].indexOf(COMPLETION_MARKER) != 0);
  expect(rows[1].indexOf(COMPLETION_MARKER) == 0);
});

test("a closed panel renders no rows at all", () => {
  let c = new Completion();
  c.refresh("nope");
  expect(completionRows(c, 80, panelBudget(24, 0, 1), true).length == 0);
});

test("the panel never renders more rows than its budget", () => {
  let c = new Completion();
  c.refresh("/");
  let budget = panelBudget(24, 0, 1);
  expect(completionRows(c, 80, budget, true).length <= budget);
  expect(completionRows(c, 80, budget, true).length <= COMPLETION_MAX_LIST_ROWS + 1);
});

test("the panel budget leaves the status bar, the input row and a transcript row alone", () => {
  expect(panelBudget(24, 0, 1) == COMPLETION_MAX_LIST_ROWS + 1);
  expect(panelBudget(10, 0, 1) == 7);
  expect(panelBudget(10, 2, 1) == 5);
  expect(panelBudget(12, 0, 1) == 9);
});

test("a terminal too short for a useful panel gets no panel at all", () => {
  expect(panelBudget(4, 0, 1) == 0);
  expect(panelBudget(3, 0, 1) == 0);
  expect(panelBudget(5, 2, 1) == 0);
  let c = new Completion();
  c.refresh("/");
  expect(completionRows(c, 80, panelBudget(4, 0, 1), true).length == 0);
});

test("a bordered input box (#113) costs the panel two more rows than the plain prompt did", () => {
  expect(panelBudget(12, 0, 3) == panelBudget(12, 0, 1) - 2);
  expect(panelBudget(10, 0, 3) == panelBudget(10, 0, 1) - 2);
  expect(panelBudget(24, 0, 3) == COMPLETION_MAX_LIST_ROWS + 1);
  expect(panelBudget(24, 0, 1) == COMPLETION_MAX_LIST_ROWS + 1);
});

test("a short terminal scrolls the match list to keep the highlight visible", () => {
  let c = new Completion();
  c.refresh("/");
  let budget = panelBudget(10, 0, 1);
  let top = completionRows(c, 80, budget, true);
  expect(top.length <= budget);
  expect(top[0].indexOf("/help") >= 0);

  let steps = 0;
  while (steps < c.matches.length) {
    c.move(1);
    steps = steps + 1;
  }
  expect(c.selectedName() == "/exit");

  let bottom = completionRows(c, 80, budget, true);
  expect(bottom.length <= budget);
  let sawExit = false;
  let sawHelp = false;
  let i = 0;
  while (i < bottom.length) {
    if (bottom[i].indexOf("/exit") >= 0) { sawExit = true; }
    if (bottom[i].indexOf("/help") >= 0) { sawHelp = true; }
    i = i + 1;
  }
  expect(sawExit);
  expect(!sawHelp);
});

test("the first visible entry only scrolls once the highlight runs past the budget", () => {
  let all = commandList();
  expect(firstVisibleEntry(all, 60, 0, 8) == 0);
  expect(firstVisibleEntry(all, 60, 2, 8) == 0);
  expect(firstVisibleEntry(all, 60, 7, 3) > 0);
});

test("a narrow terminal drops the description column instead of overflowing", () => {
  let c = new Completion();
  c.refresh("/mode");
  let rows = completionRows(c, 12, panelBudget(24, 0, 1), true);
  expect(rows.length == 3);
  expect(rows[0].indexOf("/model") >= 0);
  expect(rows[1].indexOf("/mode") >= 0);
  expect(rows[1].indexOf("approval") < 0);
});

test("every rendered panel row survives clipping to the terminal width", () => {
  let c = new Completion();
  c.refresh("/");
  let rows = completionRows(c, 40, panelBudget(24, 0, 1), true);
  expect(rows.length > 1);
  let rule = clip(rows[rows.length - 1], 40);
  expect(rule.indexOf("─") >= 0);
});

test("with the box in play the panel leaves its own rule out, since the box's top border is the separator", () => {
  let c = new Completion();
  c.refresh("/m");
  let rows = completionRows(c, 80, panelBudget(24, 0, 3), false);
  expect(rows.length == 2);
  expect(rows[0].indexOf("/model") >= 0);
  expect(rows[1].indexOf("/mode") >= 0);
  let i = 0;
  while (i < rows.length) {
    expect(rows[i].indexOf("─") < 0);
    i = i + 1;
  }
});

test("without the box the panel still draws its own rule as the separator", () => {
  let c = new Completion();
  c.refresh("/m");
  let rows = completionRows(c, 80, panelBudget(24, 0, 1), true);
  expect(rows[rows.length - 1].indexOf("─") >= 0);
});

function anyRowHas(rowsList: string[], needle: string): bool {
  let i = 0;
  while (i < rowsList.length) {
    if (rowsList[i].indexOf(needle) >= 0) { return true; }
    i = i + 1;
  }
  return false;
}

test("dropping the rule lets one more match row fit in the same budget", () => {
  let c = new Completion();
  c.refresh("/");
  let budget = panelBudget(13, 0, 1);
  let withRule = completionRows(c, 80, budget, true);
  let withoutRule = completionRows(c, 80, budget, false);
  expect(!anyRowHas(withRule, "/exit"));
  expect(anyRowHas(withoutRule, "/exit"));
});
