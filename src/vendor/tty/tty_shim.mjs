import fs from 'node:fs';
import net from 'node:net';
import tty from 'node:tty';
import { execFileSync } from 'node:child_process';
import os from 'node:os';

const g_primed = new Map();

function ensureNonBlocking(fd) {
  if (g_primed.has(fd)) return;
  let s = null;
  try {
    s = tty.isatty(fd) ? new tty.ReadStream(fd) : new net.Socket({ fd, readable: true, writable: false });
    s.pause();
  } catch {
    s = false; // a regular file: readSync already returns immediately, nothing to prime
  }
  g_primed.set(fd, s);
}

const SLEEP_SAB = new Int32Array(new SharedArrayBuffer(4));
function sleepMs(ms) { if (ms > 0) Atomics.wait(SLEEP_SAB, 0, 0, ms); }

export function tty_isatty(fd) {
  return tty.isatty(fd) ? 1 : 0;
}

export function tty_raw_enable(fd) {
  if (fd !== 0 || !process.stdin.isTTY) return -1;
  try { process.stdin.setRawMode(true); } catch { return -1; }
  return 0;
}

export function tty_raw_disable(fd) {
  if (fd !== 0 || !process.stdin.isTTY) return -1;
  try { process.stdin.setRawMode(false); } catch { return -1; }
  return 0;
}

export function tty_read_byte(fd) {
  ensureNonBlocking(fd);
  const buf = Buffer.alloc(1);
  while (true) {
    try {
      const n = fs.readSync(fd, buf, 0, 1, null);
      return n === 0 ? -1 : buf[0];
    } catch (e) {
      if (e.code === 'EAGAIN') { sleepMs(5); continue; }
      return -2;
    }
  }
}

export function tty_read_byte_timeout(fd, timeoutMs) {
  ensureNonBlocking(fd);
  const buf = Buffer.alloc(1);
  const deadline = Date.now() + timeoutMs;
  while (true) {
    try {
      const n = fs.readSync(fd, buf, 0, 1, null);
      return n === 0 ? -1 : buf[0];
    } catch (e) {
      if (e.code !== 'EAGAIN') return -2;
      const left = deadline - Date.now();
      if (left <= 0) return -3;
      sleepMs(Math.min(5, left));
    }
  }
}

export function tty_cols(fd) {
  if (!tty.isatty(fd)) return -1;
  try {
    const ws = fd === 1 ? process.stdout : fd === 2 ? process.stderr : new tty.WriteStream(fd);
    return ws.columns ?? -1;
  } catch { return -1; }
}

export function tty_rows(fd) {
  if (!tty.isatty(fd)) return -1;
  try {
    const ws = fd === 1 ? process.stdout : fd === 2 ? process.stderr : new tty.WriteStream(fd);
    return ws.rows ?? -1;
  } catch { return -1; }
}

export function tty_open_devnull_for_test() {
  return fs.openSync(os.devNull, 'r');
}

// Test-only pipe: a FIFO stands in for a real pipe() syscall, which Node's
// public API does not expose. The read end is returned non-blocking-primed;
// the write end is opened here and kept for tty_write_byte_to_test_pipe.
let g_test_pipe_write_fd = -1;
export function tty_open_test_pipe() {
  const path = fs.mkdtempSync(os.tmpdir() + '/lumen-tty-') + '/p';
  execFileSync('mkfifo', [path]);
  const readFd = fs.openSync(path, fs.constants.O_RDONLY | fs.constants.O_NONBLOCK);
  const writeFd = fs.openSync(path, fs.constants.O_WRONLY);
  g_test_pipe_write_fd = writeFd;
  g_primed.set(readFd, false); // already O_NONBLOCK from open(); nothing more to prime
  return readFd;
}

export function tty_write_byte_to_test_pipe(byte) {
  if (g_test_pipe_write_fd < 0) return -1;
  const buf = Buffer.from([byte & 0xff]);
  try {
    return fs.writeSync(g_test_pipe_write_fd, buf, 0, 1) === 1 ? 1 : -1;
  } catch { return -1; }
}
