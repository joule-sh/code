import { appendMailbox, MailboxReader, findMailboxEntry } from "./mailbox.ts";

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
