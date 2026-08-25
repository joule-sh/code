const fs = require("node:fs");
const path = require("node:path");
const { execFile } = require("node:child_process");

const WINDOWS_EXTENSIONS = [".exe", ".com", ".cmd", ".bat"];
const SCRIPT_EXTENSIONS = [".cmd", ".bat"];

function onWindows(platform) {
  return (platform || process.platform) === "win32";
}

function searchPath(env) {
  const e = env || process.env;
  let raw = e.PATH;
  if (raw === undefined) {
    for (const name of Object.keys(e)) {
      if (name.toUpperCase() === "PATH") { raw = e[name]; break; }
    }
  }
  return String(raw || "").split(";").map((dir) => dir.trim().replace(/^"|"$/g, "")).filter((dir) => dir !== "");
}

function comspec(env) {
  const e = env || process.env;
  return e.ComSpec || e.COMSPEC || "cmd.exe";
}

function isFile(file) {
  try {
    return fs.statSync(file).isFile();
  } catch (e) {
    void e;
    return false;
  }
}

function hasKnownExtension(name) {
  const lower = name.toLowerCase();
  return WINDOWS_EXTENSIONS.some((ext) => lower.endsWith(ext));
}

function isScript(name) {
  const lower = name.toLowerCase();
  return SCRIPT_EXTENSIONS.some((ext) => lower.endsWith(ext));
}

function spellings(bin) {
  if (hasKnownExtension(bin)) { return [bin]; }
  return WINDOWS_EXTENSIONS.map((ext) => bin + ext).concat([bin]);
}

function resolveWindows(bin, env) {
  const wanted = spellings(bin);
  if (path.basename(bin) !== bin) {
    for (const name of wanted) {
      const file = path.resolve(name);
      if (isFile(file)) { return file; }
    }
    return "";
  }
  for (const dir of searchPath(env)) {
    for (const name of wanted) {
      const file = path.join(dir, name);
      if (isFile(file)) { return file; }
    }
  }
  return "";
}

function quote(arg) {
  return "\"" + String(arg).replace(/"/g, "\\\"") + "\"";
}

function scriptArgv(file, args) {
  const line = [quote(file)].concat(args.map(quote)).join(" ");
  return ["/d", "/s", "/c", "\"" + line + "\""];
}

function commandFor(bin, args, options) {
  const opts = options || {};
  const argv = args || [];
  if (!onWindows(opts.platform)) {
    return { file: bin, argv, spawnOptions: {}, resolved: bin };
  }
  const found = resolveWindows(bin, opts.env);
  if (found === "") { return null; }
  if (!isScript(found)) {
    return { file: found, argv, spawnOptions: {}, resolved: found };
  }
  return {
    file: comspec(opts.env),
    argv: scriptArgv(found, argv),
    spawnOptions: { windowsVerbatimArguments: true },
    resolved: found,
  };
}

function notFound(bin) {
  const err = new Error("spawn " + bin + " ENOENT");
  err.code = "ENOENT";
  return err;
}

function execJoule(bin, args, options) {
  const opts = options || {};
  const command = commandFor(bin, args, opts);
  return new Promise((resolve) => {
    if (command === null) {
      resolve({ err: notFound(bin), stdout: "", stderr: "" });
      return;
    }
    const spawnOptions = Object.assign({
      cwd: opts.cwd,
      env: opts.env || process.env,
      timeout: opts.timeoutMs,
      maxBuffer: opts.maxBuffer,
    }, command.spawnOptions);
    execFile(command.file, command.argv, spawnOptions, (err, stdout, stderr) => {
      resolve({ err, stdout: String(stdout || ""), stderr: String(stderr || "") });
    });
  });
}

module.exports = {
  commandFor,
  execJoule,
  resolveWindows,
  searchPath,
  scriptArgv,
  WINDOWS_EXTENSIONS,
  SCRIPT_EXTENSIONS,
};
