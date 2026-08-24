const vscode = require("vscode");
const setup = require("./setup.js");

const ROUTE_ACCOUNT = "account";
const ROUTE_KEY = "key";
const ROUTE_SERVER = "server";

const TERMINAL_NAME = "joule sign-in";

function signInNote() {
  return "a terminal opened with joule in it. sign in there with /login: it opens your browser, "
    + "and the code goes back into the terminal. come back here and check again when it is done.";
}

function keyNote(file) {
  return "opened " + file + ". put your baseUrl and apiKey there and save it. "
    + "this panel never asks you to type a key, so it never holds one.";
}

function serverNote(url) {
  return "joule will use " + url + ". it is remembered in the config file, and "
    + setup.SERVER_ENV + " overrides it for one shell.";
}

function openTerminal(jouleBin, cwd) {
  const terminal = vscode.window.createTerminal({ name: TERMINAL_NAME, cwd });
  terminal.show(true);
  terminal.sendText(jouleBin, true);
  return terminal;
}

async function openConfigFile(env) {
  const file = setup.ensureConfigFile(env);
  const doc = await vscode.workspace.openTextDocument(vscode.Uri.file(file));
  await vscode.window.showTextDocument(doc, { preview: false });
  return file;
}

async function askForServer(env, current) {
  const typed = await vscode.window.showInputBox({
    title: "A self-hosted joule server",
    prompt: "The address of the joule server this machine should use. It is kept in the config file, not a secret.",
    value: current,
    placeHolder: "https://joule.example.com",
    validateInput: (text) => {
      const trimmed = String(text || "").trim();
      if (trimmed === "") { return "an address is needed, for example https://joule.example.com"; }
      if (!/^https?:\/\/[^\s/]+/.test(trimmed)) { return "that is not an http or https address"; }
      return null;
    },
  });
  if (typed === undefined) { return ""; }
  return setup.rememberServer(env, typed);
}

async function runRoute(route, options) {
  const opts = options || {};
  const env = opts.env || process.env;
  if (route === ROUTE_ACCOUNT) {
    openTerminal(opts.jouleBin || "joule", opts.cwd);
    return signInNote();
  }
  if (route === ROUTE_KEY) {
    return keyNote(await openConfigFile(env));
  }
  if (route === ROUTE_SERVER) {
    const chosen = await askForServer(env, opts.server || "");
    return chosen === "" ? "" : serverNote(chosen);
  }
  return "";
}

module.exports = {
  ROUTE_ACCOUNT,
  ROUTE_KEY,
  ROUTE_SERVER,
  TERMINAL_NAME,
  signInNote,
  keyNote,
  serverNote,
  runRoute,
};
