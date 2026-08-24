import { appendMailbox, MailboxReader, findMailboxEntry, readAllMailboxEntries } from "./mailbox.ts";
import { appendFile } from "../vendor/platform/platform.ts";

function freshPath(name: string): string {
  let p = "/tmp/mailbox-test-" + name + ".log";
  fs.writeFileSync(p, "");
  return p;
}

test("drainNew returns nothing on an empty mailbox", () => {
  let p = freshPath("empty");
  let r = new MailboxReader(p);
  let entries = r.drainNew();
  expect(entries.length == 0);
});

test("drainNew returns entries in order with tag and payload split correctly", () => {
  let p = freshPath("basic");
  appendMailbox(p, "LINE", "first line");
  appendMailbox(p, "LINE", "second line");
  appendMailbox(p, "DONE", "lines=2");
  let r = new MailboxReader(p);
  let entries = r.drainNew();
  expect(entries.length == 3);
  expect(entries[0].tag == "LINE");
  expect(entries[0].payload == "first line");
  expect(entries[1].payload == "second line");
  expect(entries[2].tag == "DONE");
  expect(entries[2].payload == "lines=2");
});

test("readAllMailboxEntries returns every entry on every call, independent of any reader cursor", () => {
  let p = freshPath("read-all");
  appendMailbox(p, "LINE", "one");
  appendMailbox(p, "LINE", "two");
  let first = readAllMailboxEntries(p);
  expect(first.length == 2);
  let second = readAllMailboxEntries(p);
  expect(second.length == 2);
  expect(second[0].payload == "one");
  expect(second[1].payload == "two");
});

test("readAllMailboxEntries returns nothing on an empty mailbox", () => {
  let p = freshPath("read-all-empty");
  let entries = readAllMailboxEntries(p);
  expect(entries.length == 0);
});

test("drainNew only returns entries not already seen, across repeated calls", () => {
  let p = freshPath("incremental");
  appendMailbox(p, "LINE", "one");
  let r = new MailboxReader(p);
  let first = r.drainNew();
  expect(first.length == 1);

  appendMailbox(p, "LINE", "two");
  appendMailbox(p, "LINE", "three");
  let second = r.drainNew();
  expect(second.length == 2);
  expect(second[0].payload == "two");
  expect(second[1].payload == "three");

  let third = r.drainNew();
  expect(third.length == 0);
});

test("a payload containing extra pipe characters is preserved whole", () => {
  let p = freshPath("pipes");
  appendMailbox(p, "TOOLCALL", "{\"args\":\"a|b|c\"}");
  let r = new MailboxReader(p);
  let entries = r.drainNew();
  expect(entries.length == 1);
  expect(entries[0].payload == "{\"args\":\"a|b|c\"}");
});

test("drainNew on a mailbox file that does not exist yet returns nothing rather than throwing", () => {
  let r = new MailboxReader("/tmp/mailbox-test-does-not-exist.log");
  let entries = r.drainNew();
  expect(entries.length == 0);
});

test("recvAt is a positive timestamp", () => {
  let p = freshPath("timestamp");
  appendMailbox(p, "LINE", "x");
  let r = new MailboxReader(p);
  let entries = r.drainNew();
  expect(entries[0].recvAt > 0);
});

test("findMailboxEntry returns the payload for the first matching tag", () => {
  let p = freshPath("find-entry");
  appendMailbox(p, "call-1", "allow");
  appendMailbox(p, "call-2", "deny");
  let r1 = findMailboxEntry(p, "call-1");
  let r2 = findMailboxEntry(p, "call-2");
  expect(r1 == "allow");
  expect(r2 == "deny");
});

test("findMailboxEntry returns empty string for a tag never written", () => {
  let p = freshPath("find-entry-missing");
  appendMailbox(p, "call-1", "allow");
  let r = findMailboxEntry(p, "call-99");
  expect(r == "");
});

test("findMailboxEntry on a nonexistent file returns empty string rather than throwing", () => {
  let r = findMailboxEntry("/tmp/mailbox-test-does-not-exist-2.log", "anything");
  expect(r == "");
});

test("drainNew holds its position when a read comes back short, instead of replaying the mailbox", () => {
  let p = freshPath("short-read");
  appendMailbox(p, "DELTA", "one");
  appendMailbox(p, "DELTA", "two");
  let r = new MailboxReader(p);
  expect(r.drainNew().length == 2);
  fs.writeFileSync(p, "");
  expect(r.drainNew().length == 0);
  appendMailbox(p, "DELTA", "one");
  appendMailbox(p, "DELTA", "two");
  appendMailbox(p, "DELTA", "three");
  let again = r.drainNew();
  expect(again.length == 1);
  expect(again[0].payload == "three");
});

test("an entry that is only half written is held back until its newline lands", () => {
  let p = freshPath("partial");
  appendMailbox(p, "DELTA", "whole");
  appendFile(p, "1700000000000|DELTA|half");
  let r = new MailboxReader(p);
  let first = r.drainNew();
  expect(first.length == 1);
  expect(first[0].payload == "whole");
  expect(r.drainNew().length == 0);
  appendFile(p, " an entry\n");
  let second = r.drainNew();
  expect(second.length == 1);
  expect(second[0].payload == "half an entry");
});

test("appendMailbox adds to the end of the file instead of writing over the start of it", () => {
  let p = freshPath("append-not-overwrite");
  appendMailbox(p, "DELTA", "first entry, long enough to be written over");
  let afterFirst = fs.statSync(p).size;
  appendMailbox(p, "DELTA", "second");
  appendMailbox(p, "DELTA", "third");
  expect(fs.statSync(p).size > afterFirst);
  let entries = readAllMailboxEntries(p);
  expect(entries.length == 3);
  expect(entries[0].payload == "first entry, long enough to be written over");
  expect(entries[1].payload == "second");
  expect(entries[2].payload == "third");
});

test("appending only ever grows the mailbox file", () => {
  let p = freshPath("monotonic");
  let last: int = 0;
  let i: int = 0;
  while (i < 64) {
    appendMailbox(p, "DELTA", "entry " + `${i}`);
    let size = fs.statSync(p).size;
    expect(size > last);
    last = size;
    i = i + 1;
  }
});

function readCharCounter(): i64 {
  let fd = fs.openSync("/proc/self/io", "r");
  if (fd < 0) { return -1; }
  let content = fs.readSync(fd, 4096);
  fs.closeSync(fd);
  let prefix = "rchar: ";
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
  return -1;
}

function openFdCount(): int {
  try { return fs.readdirSync("/proc/self/fd").length; } catch { return -1; }
}

function hasProcSelf(): bool {
  return process.platform() == "linux";
}

const COST_ENTRIES: int = 600;
const COST_PAYLOAD: int = 100;

test("a reader polling a growing mailbox reads each entry once, not the whole file on every poll", () => {
  if (hasProcSelf()) {
    let p = freshPath("incremental-cost");
    let body = "";
    while (body.length < COST_PAYLOAD) { body = body + "x"; }
    let r = new MailboxReader(p);
    let before = readCharCounter();
    expect(before >= 0);
    let drained: int = 0;
    let i: int = 0;
    while (i < COST_ENTRIES) {
      appendMailbox(p, "DELTA", body);
      drained = drained + r.drainNew().length;
      i = i + 1;
    }
    let read: i64 = readCharCounter() - before;
    expect(drained == COST_ENTRIES);
    let size: i64 = fs.statSync(p).size;
    expect(size > 0);
    expect(read < size * 4);
  }
});

test("closing a reader releases its descriptor, so short-lived readers do not accumulate them", () => {
  if (hasProcSelf()) {
    let p = freshPath("fd-release");
    appendMailbox(p, "DELTA", "one");
    let baseline = openFdCount();
    expect(baseline > 0);
    let i: int = 0;
    while (i < 200) {
      let r = new MailboxReader(p);
      expect(r.drainNew().length == 1);
      r.close();
      i = i + 1;
    }
    expect(openFdCount() <= baseline + 4);
  }
});

const CONCURRENT_ENTRIES: int = 500;
const CONCURRENT_PATH: string = "/tmp/mailbox-test-concurrent.log";
const CONCURRENT_TIMEOUT_MS: i64 = 60000;

function spawnConcurrentWriter(): void {
  let loop = "i=0; while [ $i -lt " + `${CONCURRENT_ENTRIES}` + " ]; do";
  loop = loop + " printf '%s' \"1700000000000|DELTA|seq-$i\" >> " + CONCURRENT_PATH + ";";
  loop = loop + " printf '\n' >> " + CONCURRENT_PATH + ";";
  loop = loop + " i=$((i+1)); done";
  let args: string[] = ["-c", loop + " &"];
  child_process.spawnSync("/bin/sh", args);
}

test("a reader polling a mailbox another process is appending to sees every entry once, in order", () => {
  fs.writeFileSync(CONCURRENT_PATH, "");
  let r = new MailboxReader(CONCURRENT_PATH);
  let started: i64 = Date.now();
  spawnConcurrentWriter();
  let next: int = 0;
  let smallest: int = 0;
  while (next < CONCURRENT_ENTRIES && Date.now() - started < CONCURRENT_TIMEOUT_MS) {
    let size = fs.statSync(CONCURRENT_PATH).size;
    expect(size >= smallest);
    smallest = size;
    for (const e of r.drainNew()) {
      expect(e.tag == "DELTA");
      expect(e.payload == "seq-" + `${next}`);
      next = next + 1;
    }
  }
  expect(next == CONCURRENT_ENTRIES);
});
