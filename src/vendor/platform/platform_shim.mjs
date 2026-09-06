import fs from 'node:fs';
export function plat_env(name) {
  return process.env[name] ?? '';
}

export function plat_env_present(name) {
  return Object.prototype.hasOwnProperty.call(process.env, name) ? 1 : 0;
}

export function plat_append(path, text) {
  try {
    const fd = fs.openSync(path, fs.constants.O_WRONLY | fs.constants.O_CREAT | fs.constants.O_APPEND, 0o644);
    try {
      const buf = Buffer.from(text, 'latin1');
      let written = 0;
      while (written < buf.length) written += fs.writeSync(fd, buf, written, buf.length - written);
    } finally {
      fs.closeSync(fd);
    }
    return 0;
  } catch {
    return -1;
  }
}

export function plat_chmod(path, mode) {
  if (process.platform === 'win32') return 1;
  try {
    fs.chmodSync(path, mode);
    return 0;
  } catch {
    return -1;
  }
}

// Lumen's Boehm-collector-specific interior-pointer question does not apply
// under Node -- V8's GC does not lose a pointer into the middle of an object
// the way Boehm can without the flag this reports on. Always "on".
export function plat_gc_interior_pointers() {
  return 1;
}

// The native shim's POSIX branch is unconditionally -1 ("unknown; the caller
// falls back to trying the real connect") -- plat_port_open.c's #else, read
// directly, does nothing else. Its Windows branch does a real blocking
// connect()/closesocket(), which Node's net module has no synchronous
// equivalent for (net.connect is inherently async; a true synchronous probe
// needs the same worker + Atomics.wait bridge spec 508 is building for
// sockets generally). Rather than fake synchrony or block the event loop,
// this reports "unknown" on every platform -- exactly the POSIX behaviour,
// and a correct, honest degradation on Windows: worthConnectingTo() already
// treats "unknown" as "try it", so the fallback path is unchanged.
export function plat_port_open(host, port) {
  return -1;
}
