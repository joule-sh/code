"use strict";

const { spawn } = require("node:child_process");
const platform = require("./platform.js");
const resolve = require("./resolve.js");

const IGNORED = ["SIGINT", "SIGQUIT"];
const FORWARDED = ["SIGTERM", "SIGHUP"];

function listen(signal, handler) {
  try {
    process.on(signal, handler);
    return true;
  } catch (e) {
    return false;
  }
}

function run(name) {
  let target = "";
  try {
    target = resolve.binaryPath(name, platform.current());
  } catch (e) {
    console.error(e.message);
    process.exit(1);
  }
  const child = spawn(target, process.argv.slice(2), { stdio: "inherit" });
  const attached = [];
  for (const signal of IGNORED) {
    const handler = () => {};
    if (listen(signal, handler)) { attached.push([signal, handler]); }
  }
  for (const signal of FORWARDED) {
    const handler = () => { try { child.kill(signal); } catch (e) { return; } };
    if (listen(signal, handler)) { attached.push([signal, handler]); }
  }
  function release() {
    for (const pair of attached) { process.removeListener(pair[0], pair[1]); }
  }
  child.on("error", (e) => {
    release();
    console.error("joule: could not run " + target + ": " + e.message);
    process.exit(1);
  });
  child.on("exit", (code, signal) => {
    release();
    if (signal !== null) {
      process.kill(process.pid, signal);
      return;
    }
    process.exit(code === null ? 1 : code);
  });
}

function source(command) {
  return [
    "#!/usr/bin/env node",
    "\"use strict\";",
    "require(\"../lib/shim.js\").run(\"" + command + "\");",
    "",
  ].join("\n");
}

module.exports = { run, source, IGNORED, FORWARDED };
