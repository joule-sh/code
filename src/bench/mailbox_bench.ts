import { appendMailbox, MailboxReader } from "../tasks/mailbox.ts";
import { appendFile, envOr } from "../vendor/platform/platform.ts";

function envInt(name: string, fallback: int): int {
  let raw = envOr(name, "");
  return Number.parseInt(raw, 10) ?? fallback;
}

const MODE: string = envOr("BENCH_MODE", "mailbox");
const MAILBOX_PATH: string = envOr("BENCH_PATH", "/tmp/joule-mailbox-bench.log");
const ENTRIES: int = envInt("BENCH_ENTRIES", 2000);
const PAYLOAD: int = envInt("BENCH_PAYLOAD", 100);
const POLL_EVERY: int = envInt("BENCH_POLL_EVERY", 10);

let g_reader_ms: i64 = 0;
let g_drained: int = 0;

function ioCounter(field: string): i64 {
  let fd = fs.openSync("/proc/self/io", "r");
  if (fd < 0) { return 0; }
  let content = fs.readSync(fd, 4096);
  fs.closeSync(fd);
  let prefix = field + ": ";
  for (const raw of content.split("\n")) {
    if (raw.length <= prefix.length) { continue; }
    if (raw.slice(0, prefix.length) != prefix) { continue; }
    let digits = raw.slice(prefix.length, raw.length);
    let out: i64 = 0;
    let i: int = 0;
    while (i < digits.length) {
      let d = digits.charAt(i).charCodeAt(0) - "0".charCodeAt(0);
      if (d < 0 || d > 9) { return out; }
      out = out * 10 + d;
      i = i + 1;
    }
    return out;
  }
  return 0;
}

function bodyText(): string {
  let s = "";
  while (s.length < PAYLOAD) { s = s + "x"; }
  return s;
}

function rewriteAppend(text: string): void {
  appendFile(MAILBOX_PATH, `${Date.now()}` + "|DELTA|" + text + "\n");
}

function runRewrite(text: string): void {
  let i: int = 0;
  while (i < ENTRIES) {
    rewriteAppend(text);
    i = i + 1;
  }
}

function runOpenClose(text: string): void {
  let i: int = 0;
  while (i < ENTRIES) {
    let fd = fs.openSync(MAILBOX_PATH, "a");
    fs.writeSync(fd, `${Date.now()}` + "|DELTA|" + text + "\n");
    fs.closeSync(fd);
    i = i + 1;
  }
}

function runHandle(text: string): void {
  let fd = fs.openSync(MAILBOX_PATH, "a");
  let i: int = 0;
  while (i < ENTRIES) {
    fs.writeSync(fd, `${Date.now()}` + "|DELTA|" + text + "\n");
    i = i + 1;
  }
  fs.closeSync(fd);
}

function runMailbox(text: string): void {
  let i: int = 0;
  while (i < ENTRIES) {
    appendMailbox(MAILBOX_PATH, "DELTA", text);
    i = i + 1;
  }
}

function runPoll(text: string, viaRewrite: bool): void {
  let reader = new MailboxReader(MAILBOX_PATH);
  let i: int = 0;
  while (i < ENTRIES) {
    if (viaRewrite) { rewriteAppend(text); } else { appendMailbox(MAILBOX_PATH, "DELTA", text); }
    i = i + 1;
    if (i % POLL_EVERY == 0) {
      let t0: i64 = Date.now();
      let got = reader.drainNew();
      g_reader_ms = g_reader_ms + (Date.now() - t0);
      g_drained = g_drained + got.length;
    }
  }
  let t1: i64 = Date.now();
  let last = reader.drainNew();
  g_reader_ms = g_reader_ms + (Date.now() - t1);
  g_drained = g_drained + last.length;
}

function runConcurrent(): void {
  let loop = "i=0; while [ $i -lt " + `${ENTRIES}` + " ]; do";
  loop = loop + " printf '%s' \"1700000000000|DELTA|seq-$i\" >> " + MAILBOX_PATH + ";";
  loop = loop + " printf '\n' >> " + MAILBOX_PATH + ";";
  loop = loop + " i=$((i+1)); done";
  let args: string[] = ["-c", loop + " &"];
  let reader = new MailboxReader(MAILBOX_PATH);
  let started: i64 = Date.now();
  child_process.spawnSync("/bin/sh", args);
  let next: int = 0;
  let polls: int = 0;
  let partials: int = 0;
  let outOfOrder: int = 0;
  let shrinks: int = 0;
  let smallest: int = 0;
  while (next < ENTRIES && Date.now() - started < 60000) {
    let size = fs.statSync(MAILBOX_PATH).size;
    if (size < smallest) { shrinks = shrinks + 1; }
    smallest = size;
    let raw = "";
    try { raw = fs.readFileSync(MAILBOX_PATH); } catch { raw = ""; }
    if (raw.length > 0 && raw.slice(raw.length - 1, raw.length) != "\n") { partials = partials + 1; }
    polls = polls + 1;
    for (const e of reader.drainNew()) {
      if (e.payload != "seq-" + `${next}`) { outOfOrder = outOfOrder + 1; }
      next = next + 1;
    }
  }
  g_drained = next;
  console.log("concurrent polls=" + `${polls}` + " partial_tail_seen=" + `${partials}` + " out_of_order=" + `${outOfOrder}` + " shrinks=" + `${shrinks}` + " delivered=" + `${next}` + " expected=" + `${ENTRIES}`);
}

function runMode(text: string): void {
  if (MODE == "rewrite") { runRewrite(text); return; }
  if (MODE == "openclose") { runOpenClose(text); return; }
  if (MODE == "handle") { runHandle(text); return; }
  if (MODE == "mailbox") { runMailbox(text); return; }
  if (MODE == "poll-rewrite") { runPoll(text, true); return; }
  if (MODE == "poll-mailbox") { runPoll(text, false); return; }
  if (MODE == "concurrent") { runConcurrent(); return; }
  console.log("unknown BENCH_MODE " + MODE);
}

function main(): void {
  let text = bodyText();
  fs.writeFileSync(MAILBOX_PATH, "");
  let rchar0: i64 = ioCounter("rchar");
  let wchar0: i64 = ioCounter("wchar");
  let start: i64 = Date.now();
  runMode(text);
  let total: i64 = Date.now() - start;
  let read: i64 = ioCounter("rchar") - rchar0;
  let written: i64 = ioCounter("wchar") - wchar0;
  let st = fs.statSync(MAILBOX_PATH);
  console.log("mode=" + MODE + " entries=" + `${ENTRIES}` + " payload=" + `${PAYLOAD}` + " total_ms=" + `${total}` + " writer_ms=" + `${total - g_reader_ms}` + " reader_ms=" + `${g_reader_ms}` + " drained=" + `${g_drained}` + " final_bytes=" + `${st.size}` + " bytes_read=" + `${read}` + " bytes_written=" + `${written}`);
}

main();
