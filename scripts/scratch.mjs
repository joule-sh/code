import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const STALE_MS = 4 * 60 * 60 * 1000;

export function scratchBase() {
  const named = (process.env.JOULE_SCRATCH_DIR || process.env.RUNNER_TEMP || "").trim();
  if (named === "") { return os.tmpdir(); }
  fs.mkdirSync(named, { recursive: true });
  return named;
}

export function sweepStale(prefix, base) {
  const dir = base || scratchBase();
  const cutoff = Date.now() - STALE_MS;
  let names = [];
  try {
    names = fs.readdirSync(dir);
  } catch (e) {
    void e;
    return;
  }
  for (const name of names) {
    if (!name.startsWith(prefix)) { continue; }
    const full = path.join(dir, name);
    try {
      if (fs.lstatSync(full).mtimeMs > cutoff) { continue; }
      fs.rmSync(full, { recursive: true, force: true });
    } catch (e) {
      void e;
    }
  }
}

export function scratchDir(prefix) {
  const base = scratchBase();
  sweepStale(prefix, base);
  return fs.mkdtempSync(path.join(base, prefix));
}
