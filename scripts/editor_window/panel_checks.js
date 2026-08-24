const vscode = require("vscode");
const fs = require("node:fs");
const path = require("node:path");
const modes = require("../../editor/src/modes.js");

function panelChecks(kit) {
  const { ok, probe, shown, waitForShown, waitFor, real, capture, workspace, home } = kit;

  function configFile() {
    return path.join(home, ".config", "joule-code", "config.json");
  }

  function namesTheWorkspace(text) {
    return text.includes(workspace) || text.includes(real(workspace));
  }

  function sessionMode(panel) {
    const session = panel.session.conversation.session;
    return session === null ? "" : session.mode;
  }

  async function offeredRoutes(panel) {
    const titles = await probe(panel, { op: "read", selector: ".route-title" });
    ok(titles.found === 3, "the first-run screen makes the choice explicit, one button per route");
    ok(titles.texts.includes("a joule account"), "the account route is offered by name");
    ok(titles.texts.includes("your own provider key"), "the provider-key route is offered by name");
    ok(titles.texts.includes("a self-hosted joule server"), "the self-hosted route is offered by name");

    const whys = await probe(panel, { op: "read", selector: ".route-why" });
    ok(whys.found === 3, "each route carries its own description beneath it, not a default plus a hint");
    const said = whys.texts.join(" ");
    ok(said.includes("JOULE_CODE_SERVER"), "the self-hosted route names the setting that is otherwise undiscoverable");
    ok(said.includes("never asks you to type a key"), "the provider-key route says the panel never takes the key itself");
  }

  async function keyRouteOpensTheConfigFile(panel) {
    const fields = await probe(panel, { op: "read", selector: "input, textarea" });
    ok(fields.found === 0, "the first-run screen has no field a key could be typed into");

    const clicked = await probe(panel, { op: "click", selector: ".route-key" });
    ok(clicked.ok === true, "the provider-key route took a real click in the webview");
    await waitFor(() => vscode.window.activeTextEditor !== undefined
      && real(vscode.window.activeTextEditor.document.uri.fsPath) === real(configFile()),
      30000, "the config file to open in this editor window");
    ok(fs.readFileSync(configFile(), "utf8").includes("\"apiKey\": \"\""),
      "the file the panel opened holds an empty key, so nothing secret was written for it");
    await waitForShown(panel, ".first-run-note", "never asks you to type a key", 15000,
      "the panel saying where the key goes and that it does not hold one");
  }

  async function firstRunScreen(panel) {
    await waitForShown(panel, ".first-run-lead", "coding agent", 60000,
      "the first-run screen introducing joule in a sentence, with nothing configured");
    await capture(panel, "first-run");
    const problems = await probe(panel, { op: "read", selector: ".first-run-problem, .badge-failed, .gate" });
    ok(problems.found === 0, "an unconfigured window gets the introduction rather than a failure or a session view");

    await offeredRoutes(panel);
    await keyRouteOpensTheConfigFile(panel);

    fs.writeFileSync(configFile(), JSON.stringify({
      baseUrl: "http://127.0.0.1:1", model: "stub-model", apiKey: "test-key",
    }, null, 2) + "\n");
    await probe(panel, { op: "click", selector: ".first-run-again" });
    await waitForShown(panel, ".gate-text", "no joule daemon is running", 30000,
      "the same screen moving on to the session gate once configuration exists");
    const gone = await probe(panel, { op: "read", selector: ".first-run" });
    ok(gone.found === 0, "a configured window is not shown the first-run screen again");
    await waitForShown(panel, ".fact-value", "the provider key in", 15000,
      "the gate saying how this window reaches a model, without printing the key");
    await capture(panel, "gate");
  }

  async function composerControls(panel) {
    const composer = await probe(panel, { op: "read", selector: ".composer-box .composer-input" });
    ok(composer.found === 1, "the composer is a bordered box with the input inside it");
    const placeholder = await probe(panel, { op: "read", selector: ".composer-input[placeholder]" });
    ok(placeholder.found === 1, "the input says what to type rather than sitting empty");

    const where = await shown(panel, ".composer-status .status-where");
    ok(namesTheWorkspace(where) && where.includes("this machine") && where.includes("never in the editor"),
      "the status line says where the tools will run, naming the folder and the machine");

    const mode = sessionMode(panel);
    const permits = modes.permissionText(mode);
    ok(permits !== "", "the session is in a mode the panel knows how to describe: " + mode);
    const said = await shown(panel, ".composer-status .status-mode");
    ok(said.includes(mode) && said.includes(permits),
      "the status line says what may run without being asked: " + JSON.stringify(mode + " - " + permits));

    const chips = await probe(panel, { op: "read", selector: ".composer-controls .chip" });
    ok(chips.found === 3, "the controls sit on one row inside the box: mode, model and send");
    const select = await probe(panel, { op: "read", selector: ".composer-controls .mode-chip" });
    ok(select.values[0] === mode, "the mode control shows the mode the daemon is actually in");
    ok(select.texts[0].includes(modes.MODE_PLAN),
      "the mode control offers the modes the daemon accepts, plan among them");
    const model = await shown(panel, ".composer-controls .model-chip");
    ok(model === "stub-model", "the model control names the model this session drives");
    const send = await shown(panel, ".composer-controls .composer-send");
    ok(send === "send", "send sits at the end of that row rather than as a button below the box");
    const below = await probe(panel, { op: "read", selector: ".composer-actions" });
    ok(below.found === 0, "the old row of buttons under the box is gone");
    await capture(panel, "composer");
  }

  async function driveModeFromComposer(panel) {
    const was = sessionMode(panel);
    const wanted = was === modes.MODE_READ_ONLY ? modes.MODE_AUTO_EDIT : modes.MODE_READ_ONLY;

    const chosen = await probe(panel, { op: "choose", selector: ".mode-chip", value: wanted });
    ok(chosen.ok === true, "the mode control in the webview took a real change");
    await waitFor(() => sessionMode(panel) === wanted, 30000,
      "the daemon to take the mode the panel set and tell every client on the session");
    ok(sessionMode(panel) === wanted,
      "choosing a mode in the composer drives the gate /mode drives, not a second notion of it");
    await waitForShown(panel, ".status-mode", modes.permissionText(wanted), 15000,
      "the status line following the daemon's answer rather than the click");

    await probe(panel, { op: "choose", selector: ".mode-chip", value: was });
    await waitFor(() => sessionMode(panel) === was, 30000, "the mode to go back to where it started");
  }

  async function approvalDesign(panel) {
    const where = await shown(panel, ".approval-where");
    ok(namesTheWorkspace(where) && where.includes("not in the editor"),
      "the approval card says where the command will run before it is approved");
    const note = await shown(panel, ".approval-note");
    ok(note.includes("whoever answers first"),
      "the approval card says the first answer wins, here or in a terminal on the same session");
    const running = await shown(panel, ".composer-controls .composer-send");
    ok(running === "stop", "while a turn is running, the send control is what stops it");
    await capture(panel, "approval");
  }

  return { firstRunScreen, composerControls, driveModeFromComposer, approvalDesign };
}

module.exports = { panelChecks };
