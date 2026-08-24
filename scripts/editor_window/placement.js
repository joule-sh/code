const vscode = require("vscode");
const { ACTIVITY_BAR, SECONDARY_SIDEBAR, placementFor } = require("../../editor/src/placement.js");

const BARS = [
  { ids: ACTIVITY_BAR, name: "activity bar", closes: "workbench.action.closeSidebar" },
  { ids: SECONDARY_SIDEBAR, name: "secondary side bar", closes: "workbench.action.closeAuxiliaryBar" },
  { ids: null, name: "bottom panel", closes: "workbench.action.closePanel" },
];

function expected() {
  const ids = placementFor(vscode.version);
  const bar = BARS.find((b) => b.ids === ids);
  return {
    bar: bar.name,
    closes: bar.closes,
    view: ids.view,
    container: "workbench.view.extension." + ids.container,
    others: BARS.filter((b) => b !== bar),
  };
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function open(panel, where, timeoutMs) {
  await vscode.commands.executeCommand(where.container);
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (panel.view !== null && panel.view.visible === true) { return true; }
    await sleep(100);
  }
  return false;
}

async function runAndSettle(command) {
  await vscode.commands.executeCommand(command);
  await sleep(500);
}

async function assertPlacement(panel, ok, say) {
  const where = expected();
  say("  this editor is " + vscode.version + ", so the view belongs in the " + where.bar);

  const commands = await vscode.commands.getCommands(true);
  ok(commands.includes(where.container),
    "the editor built the joule view container this editor version is meant to use");

  ok(await open(panel, where, 30000),
    "opening that container shows the joule view, so the view is in it rather than spilled into another one");

  for (const other of where.others) {
    await runAndSettle(other.closes);
    ok(panel.view.visible === true,
      "closing the " + other.name + " leaves the joule view showing, so it did not open there");
  }

  await runAndSettle(where.closes);
  for (let i = 0; i < 40 && panel.view.visible === true; i++) { await sleep(250); }
  ok(panel.view.visible === false,
    "closing the " + where.bar + " takes the joule view with it, so that is where this editor opens it");

  ok(await open(panel, where, 30000), "the view comes back when its container is asked for again");
}

module.exports = { assertPlacement, expected };
