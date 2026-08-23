import { attachMailboxPath, openAttachMailbox, appendAttachMailbox, reapAttachMailbox, drainAttachMailbox, ATTACH_MAILBOX_PREFIX, ATTACH_MAILBOX_SUFFIX } from "./attach_mailbox.ts";
import { TAG_FRAME, TAG_CONNECTED, TAG_DISCONNECTED, encodeMailboxFrame, encodeMailboxControl } from "../relay/client_logic.ts";

function freshTmp(name: string): string {
  let dir = "/tmp/joule-attach-mailbox-test-" + name;
  if (fs.existsSync(dir)) { fs.rmSync(dir, true); }
  fs.mkdirSync(dir, true);
  return dir;
}

function mailboxCount(dir: string): int {
  let names: string[] = [];
  try { names = fs.readdirSync(dir); } catch { return 0; }
  let n = 0;
  for (const name of names) {
    if (name.startsWith(ATTACH_MAILBOX_PREFIX) && name.endsWith(ATTACH_MAILBOX_SUFFIX)) { n = n + 1; }
  }
  return n;
}

function frame(seq: int): string {
  return "{\"v\":1,\"seq\":" + `${seq}` + ",\"type\":\"turn.delta\"}";
}

test("attachMailboxPath names the file the client owns", () => {
  expect(attachMailboxPath("/tmp", "abc-123") == "/tmp/joule-attach-abc-123.mailbox");
});

test("an opened mailbox is empty and present", () => {
  let dir = freshTmp("open");
  let path = attachMailboxPath(dir, "conn-a");
  openAttachMailbox(path);
  expect(fs.existsSync(path));
  expect(fs.readFileSync(path) == "");
  expect(mailboxCount(dir) == 1);
});

test("the worker appends to a mailbox its client is holding open", () => {
  let dir = freshTmp("append");
  let path = attachMailboxPath(dir, "conn-a");
  openAttachMailbox(path);
  appendAttachMailbox(path, encodeMailboxFrame(frame(1)));
  expect(fs.readFileSync(path) == TAG_FRAME + "|" + frame(1) + "\n");
});

test("the worker leaves a reaped mailbox reaped rather than recreating it", () => {
  let dir = freshTmp("reaped");
  let path = attachMailboxPath(dir, "conn-a");
  appendAttachMailbox(path, encodeMailboxControl(TAG_DISCONNECTED, "socket closed"));
  expect(!fs.existsSync(path));
  expect(mailboxCount(dir) == 0);
});

test("the worker writes nowhere when it has never been configured", () => {
  let dir = freshTmp("unset");
  appendAttachMailbox("", encodeMailboxControl(TAG_CONNECTED, ""));
  expect(mailboxCount(dir) == 0);
});

test("reaping removes the mailbox and says so", () => {
  let dir = freshTmp("reap");
  let path = attachMailboxPath(dir, "conn-a");
  openAttachMailbox(path);
  appendAttachMailbox(path, encodeMailboxFrame(frame(1)));
  expect(reapAttachMailbox(path));
  expect(!fs.existsSync(path));
  expect(mailboxCount(dir) == 0);
});

test("reaping twice is not an error and removes nothing the second time", () => {
  let dir = freshTmp("twice");
  let path = attachMailboxPath(dir, "conn-a");
  openAttachMailbox(path);
  expect(reapAttachMailbox(path));
  expect(!reapAttachMailbox(path));
  expect(!reapAttachMailbox(""));
  expect(mailboxCount(dir) == 0);
});

test("a mailbox reaped at detach is not resurrected by the worker winding down", () => {
  let dir = freshTmp("wind-down");
  let path = attachMailboxPath(dir, "conn-a");
  openAttachMailbox(path);
  appendAttachMailbox(path, encodeMailboxControl(TAG_CONNECTED, ""));
  reapAttachMailbox(path);
  appendAttachMailbox(path, encodeMailboxControl(TAG_DISCONNECTED, "socket closed"));
  appendAttachMailbox(path, encodeMailboxControl(TAG_DISCONNECTED, "socket closed"));
  expect(!fs.existsSync(path));
  expect(mailboxCount(dir) == 0);
});

test("attach churn leaves no mailbox behind", () => {
  let dir = freshTmp("churn");
  let i = 0;
  while (i < 40) {
    let path = attachMailboxPath(dir, "conn-" + `${i}`);
    openAttachMailbox(path);
    appendAttachMailbox(path, encodeMailboxControl(TAG_CONNECTED, ""));
    appendAttachMailbox(path, encodeMailboxFrame(frame(1)));
    expect(drainAttachMailbox(path, 0).lines.length == 2);
    reapAttachMailbox(path);
    appendAttachMailbox(path, encodeMailboxControl(TAG_DISCONNECTED, "gone"));
    i = i + 1;
  }
  expect(mailboxCount(dir) == 0);
});

test("a drain reads only what it has not read before", () => {
  let dir = freshTmp("cursor");
  let path = attachMailboxPath(dir, "conn-a");
  openAttachMailbox(path);
  appendAttachMailbox(path, encodeMailboxFrame(frame(1)));
  let first = drainAttachMailbox(path, 0);
  expect(first.lines.length == 1);
  expect(first.seen == 1);
  let idle = drainAttachMailbox(path, first.seen);
  expect(idle.lines.length == 0);
  expect(idle.seen == 1);
});

test("a reconnect under the same id replays every frame that follows the disconnect", () => {
  let dir = freshTmp("replay");
  let path = attachMailboxPath(dir, "conn-a");
  openAttachMailbox(path);

  appendAttachMailbox(path, encodeMailboxControl(TAG_CONNECTED, ""));
  appendAttachMailbox(path, encodeMailboxFrame(frame(1)));
  let live = drainAttachMailbox(path, 0);
  expect(live.lines.length == 2);
  expect(live.lines[1].payload == frame(1));

  appendAttachMailbox(path, encodeMailboxControl(TAG_DISCONNECTED, "reset by peer"));
  let dropped = drainAttachMailbox(path, live.seen);
  expect(dropped.lines.length == 1);
  expect(dropped.lines[0].tag == TAG_DISCONNECTED);
  expect(fs.existsSync(path));

  appendAttachMailbox(path, encodeMailboxControl(TAG_CONNECTED, ""));
  let i = 2;
  while (i < 27) {
    appendAttachMailbox(path, encodeMailboxFrame(frame(i)));
    i = i + 1;
  }
  let backlog = drainAttachMailbox(path, dropped.seen);
  expect(backlog.lines.length == 26);
  expect(backlog.lines[0].tag == TAG_CONNECTED);
  expect(backlog.lines[1].payload == frame(2));
  expect(backlog.lines[25].payload == frame(26));
  expect(backlog.seen == 29);
});

test("a drain of a mailbox that is not there keeps the cursor it was given", () => {
  let dir = freshTmp("absent");
  let path = attachMailboxPath(dir, "conn-a");
  let read = drainAttachMailbox(path, 7);
  expect(read.lines.length == 0);
  expect(read.seen == 7);
});
