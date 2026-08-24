const fs = require("node:fs");
const path = require("node:path");

const PROMPT = "start the dev server and show me what it prints";
const SERVER_FILE = "server.js";
const SERVER_LINES = 42;
const NOISY_FILE = "noisy.sh";
const NOISY_LINES = 29;
const HEAD_LINES = 6;
const DEEP_MARK = "/step-30";
const HEAD_MARK = "const http = require";
const WATCHER_LINE = "[nodemon] 3.1.14";
const LAST_OUTPUT_LINE = "Server running at http://127.0.0.1:3000/";
const ESC = String.fromCharCode(27);

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function inView(kit, selector, block, index) {
  await kit.probe(kit.panel, { op: "scroll", selector, block, index: index || 0 });
  await sleep(900);
}

function serverSource() {
  const lines = [
    "const http = require(\"node:http\");",
    "",
    "const PORT = 3000;",
    "const ROUTES = {};",
    "",
  ];
  while (lines.length < SERVER_LINES - 1) {
    const n = lines.length;
    lines.push("ROUTES[\"/step-" + n + "\"] = function () { return \"step " + n + "\"; };");
  }
  lines.push("http.createServer().listen(PORT);");
  return lines.join("\n") + "\n";
}

function noisyScript() {
  const rows = [
    "\\033[33m[nodemon]\\033[39m 3.1.14",
    "\\033[33m[nodemon]\\033[39m to restart at any time, enter `rs`",
    "\\033[33m[nodemon]\\033[39m watching path(s): *.*",
    "\\033[32m[nodemon]\\033[39m starting `node server.js`",
  ];
  for (let i = 1; i <= NOISY_LINES - 5; i++) {
    const at = i < 10 ? "0" + i : String(i);
    rows.push("\\033[90m12:00:" + at + "\\033[39m \\033[36mGET\\033[39m /health \\033[32m200\\033[39m 1.2 ms");
  }
  rows.push(LAST_OUTPUT_LINE);
  return "printf '" + rows.join("\\n") + "\\n'\n";
}

function writeFixtures(workspace) {
  fs.writeFileSync(path.join(workspace, SERVER_FILE), serverSource());
  fs.writeFileSync(path.join(workspace, NOISY_FILE), noisyScript());
}

async function readIsAFactWithTheFileUnderIt(kit) {
  const { ok, panel, probe, shown, waitForShown, shot, capture } = kit;
  await waitForShown(panel, ".tool-name", "read", 60000,
    "the auto-approved read painting as a row in the transcript");
  await waitForShown(panel, ".tool-meta", SERVER_LINES + " lines", 60000,
    "the row saying how much came back once the read returned, without printing it");

  const head = await shown(panel, ".tool-head");
  ok(head.includes(SERVER_FILE), "the row names the file that was read: " + JSON.stringify(head));
  ok(!head.includes("{\"path\"") && !head.includes("\"path\":"),
    "the row is the fact, not the json the model called with (#236)");

  const collapsed = await shown(panel, ".tool-output");
  ok(collapsed.includes(HEAD_MARK), "the first lines of the file are there to read");
  ok(!collapsed.includes(DEEP_MARK),
    "a " + SERVER_LINES + "-line file does not paint " + SERVER_LINES + " lines into the transcript (#236)");
  const numbered = await probe(panel, { op: "read", selector: ".code-num" });
  ok(numbered.found === HEAD_LINES,
    "file content is numbered like code rather than pasted at the same weight as prose");
  const more = await shown(panel, ".tool-more");
  ok(more === "+" + (SERVER_LINES - HEAD_LINES) + " lines",
    "the rest is offered rather than printed: " + JSON.stringify(more));
  await capture(panel, "read-collapsed");
  await inView(kit, ".tool", "start");
  shot("read");

  const clicked = await probe(panel, { op: "click", selector: ".tool-more" });
  ok(clicked.ok === true, "the expand control took a real click");
  const opened = await shown(panel, ".tool-output");
  ok(opened.includes(DEEP_MARK), "expanding paints the whole file the tool returned");
  ok((await shown(panel, ".tool-more")) === "show less", "and offers to put it away again");
  await inView(kit, ".tool", "start");
  shot("read-expanded");
  await capture(panel, "read-expanded");
  await probe(panel, { op: "click", selector: ".tool-more" });
  ok(!(await shown(panel, ".tool-output")).includes(DEEP_MARK), "and it does go away again");
}

async function theApprovalKeepsItsWordsAndLosesItsWeight(kit) {
  const { ok, panel, probe, shown, waitForShown, shot, capture, workspace } = kit;
  await waitForShown(panel, ".approval-tool", "run", 60000, "the approval card for the run tool");

  const detail = await shown(panel, ".approval-detail");
  ok(detail.includes("sh " + NOISY_FILE), "the card still shows the exact command, not a summary of it");
  const where = await shown(panel, ".approval-where");
  ok(where.includes(workspace) && where.includes("not in the editor"),
    "the card still says where the command runs");
  const note = await shown(panel, ".approval-note");
  ok(note.includes("whoever answers first") && note.includes("clears everywhere"),
    "the card still says the first answer anywhere is the one that decides");
  const buttons = await probe(panel, { op: "read", selector: ".approval-button" });
  ok(buttons.found === 3 && buttons.texts.includes("allow") && buttons.texts.includes("deny")
    && buttons.texts.some((t) => t.startsWith("always allow")),
    "all three choices are still offered, by the same names");
  await capture(panel, "approval");
  await inView(kit, ".approval", "center");
  shot("approval");

  const clicked = await probe(panel, { op: "click", selector: ".approval-button.approval-allow" });
  ok(clicked.ok === true, "the allow button took a real click");
}

async function outputCarriesColourRatherThanEscapes(kit) {
  const { ok, panel, probe, shown, waitForShown, shot, capture } = kit;
  await waitForShown(panel, ".tool-meta", "exit 0", 60000, "the run row saying how the command ended");

  const meta = await shown(panel, ".tool-meta");
  ok(meta.includes("exit 0, " + NOISY_LINES + " lines"),
    "the run row is its outcome and its size: " + JSON.stringify(meta));

  const painted = await shown(panel, ".tool-output");
  ok(painted.includes(WATCHER_LINE), "the watcher's own first line is readable");
  ok(painted.indexOf(ESC) < 0 && !painted.includes("[33m") && !painted.includes("[39m"),
    "no escape sequence is painted as literal text (#226)");
  ok(!painted.includes(LAST_OUTPUT_LINE),
    "and " + NOISY_LINES + " lines of it did not flood the transcript either (#236)");

  const markup = (await probe(panel, { op: "html", selector: ".tool-output" })).texts.join("\n");
  ok(markup.includes("ansi-fg-3"),
    "the yellow the watcher asked for is a class the editor's theme colours, not a code in the text (#226)");
  await capture(panel, "run-collapsed");
  await inView(kit, ".tool", "start", 1);
  shot("run");

  const more = await probe(panel, { op: "read", selector: ".tool-more" });
  ok(more.found === 2, "each of the two rows offers its own rest");
  await probe(panel, { op: "click", selector: ".tool-more", index: 1 });
  const opened = await shown(panel, ".tool-output");
  ok(opened.includes(LAST_OUTPUT_LINE), "expanding the run paints the rest of what it printed");
  const colours = await probe(panel, { op: "read", selector: ".ansi-fg-6, .ansi-fg-2, .ansi-fg-8" });
  ok(colours.found > 0, "the lines it wrote in colour are coloured here too");
  await capture(panel, "run-expanded");
  await inView(kit, ".tool", "start", 1);
  shot("run-expanded");
}

async function theSessionStillAnswers(kit) {
  const { ok, panel, probe, waitFor, waitForShown } = kit;
  const was = panel.session.conversation.session.mode;
  const wanted = was === "read-only" ? "auto-edit" : "read-only";
  await probe(panel, { op: "choose", selector: ".mode-chip", value: wanted });
  await waitFor(() => panel.session.conversation.session.mode === wanted, 30000,
    "the daemon to answer a mode set after a turn that printed a lot");
  ok(panel.session.conversation.session.mode === wanted,
    "the session still takes an instruction from this window after all that output");
  await probe(panel, { op: "choose", selector: ".mode-chip", value: was });
  await waitForShown(panel, ".status-mode", was, 30000, "the mode going back to where the turn ran");
}

async function letGoOfTheSession(kit) {
  const { ok, say, panel } = kit;
  const port = panel.session.port;
  panel.dispose();
  ok(panel.session.link === null, "closing the panel tears down this window's connection to the daemon");
  say("  the window let go of the daemon on 127.0.0.1:" + port + ", which the runner stops on its way out");
}

async function assertTranscript(kit) {
  const { panel, probe, waitFor, workspace, startStub, attachFromWebview } = kit;
  writeFixtures(workspace);
  await startStub();
  await attachFromWebview(panel);
  await probe(panel, { op: "fill", selector: ".composer-input", text: PROMPT, key: "Enter" });
  await readIsAFactWithTheFileUnderIt(kit);
  await theApprovalKeepsItsWordsAndLosesItsWeight(kit);
  await outputCarriesColourRatherThanEscapes(kit);
  await waitFor(() => panel.session.conversation.turnActive === false, 60000, "the turn to end");
  await theSessionStillAnswers(kit);
  await letGoOfTheSession(kit);
}

module.exports = { assertTranscript, PROMPT, SERVER_LINES, NOISY_LINES };
