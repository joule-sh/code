import { appendMailbox, MailboxReader } from "../tasks/mailbox.ts";
import { shouldCheck, noticeText, updateCommandFor, UpdateNotifier } from "./notifier.ts";
import { INSTALL_METHOD_SCRIPT, INSTALL_METHOD_NPM, INSTALL_METHOD_UNKNOWN } from "./install_detect.ts";
import { UpdateCache } from "./cache.ts";
import { TAG_OK } from "./worker.ts";

function freshMailbox(name: string): string {
  let p = "/tmp/notifier-test-" + name + ".log";
  fs.writeFileSync(p, "");
  return p;
}

test("shouldCheck skips a dev build even with everything else eligible", () => {
  let cache: UpdateCache = { checkedAt: 0, latestSeen: "" };
  expect(!shouldCheck("dev", false, INSTALL_METHOD_SCRIPT, cache, 1000));
});

test("shouldCheck skips when the config disabled it", () => {
  let cache: UpdateCache = { checkedAt: 0, latestSeen: "" };
  expect(!shouldCheck("0.5.0", true, INSTALL_METHOD_SCRIPT, cache, 1000));
});

test("shouldCheck skips an install neither installer owns", () => {
  let cache: UpdateCache = { checkedAt: 0, latestSeen: "" };
  expect(!shouldCheck("0.5.0", false, INSTALL_METHOD_UNKNOWN, cache, 1000));
});

test("shouldCheck skips when the cache is fresh, and proceeds once it is stale", () => {
  let fresh: UpdateCache = { checkedAt: 1000, latestSeen: "" };
  expect(!shouldCheck("0.5.0", false, INSTALL_METHOD_SCRIPT, fresh, 1000 + 3600000));

  let stale: UpdateCache = { checkedAt: 1000, latestSeen: "" };
  expect(shouldCheck("0.5.0", false, INSTALL_METHOD_SCRIPT, stale, 1000 + 90000000));
});

test("shouldCheck proceeds when nothing rules it out", () => {
  let never: UpdateCache = { checkedAt: 0, latestSeen: "" };
  expect(shouldCheck("0.5.0", false, INSTALL_METHOD_SCRIPT, never, 1000));
});

test("noticeText names the version and the documented install command", () => {
  let text = noticeText("0.5.0", "v0.6.0", INSTALL_METHOD_SCRIPT);
  expect(text.indexOf("0.6.0") >= 0);
  expect(text.indexOf("0.5.0") >= 0);
  expect(text.indexOf("install.sh") >= 0);
});

test("poll returns nothing until the worker's mailbox entry arrives", () => {
  let n = new UpdateNotifier();
  let mailbox = freshMailbox("pending");
  n.mailboxPath = mailbox;
  n.reader = new MailboxReader(mailbox);
  n.active = true;
  n.currentVersion = "0.5.0";
  n.method = INSTALL_METHOD_SCRIPT;

  expect(n.poll() == "");
});

test("poll surfaces the notice once a newer release arrives, then goes inactive", () => {
  let n = new UpdateNotifier();
  let mailbox = freshMailbox("newer");
  n.mailboxPath = mailbox;
  n.reader = new MailboxReader(mailbox);
  n.active = true;
  n.currentVersion = "0.5.0";
  n.method = INSTALL_METHOD_SCRIPT;

  appendMailbox(mailbox, TAG_OK, "{\"tag_name\":\"v0.6.0\"}");

  let notice = n.poll();
  expect(notice.indexOf("0.6.0") >= 0);
  expect(!n.active);
  expect(n.latestVersion == "0.6.0");

  expect(n.poll() == "");
});

test("poll stays silent when the release found is not actually newer", () => {
  let n = new UpdateNotifier();
  let mailbox = freshMailbox("not-newer");
  n.mailboxPath = mailbox;
  n.reader = new MailboxReader(mailbox);
  n.active = true;
  n.currentVersion = "0.6.0";
  n.method = INSTALL_METHOD_SCRIPT;

  appendMailbox(mailbox, TAG_OK, "{\"tag_name\":\"v0.6.0\"}");

  expect(n.poll() == "");
});

test("poll stays silent, but goes inactive, when the worker reports an error", () => {
  let n = new UpdateNotifier();
  let mailbox = freshMailbox("errored");
  n.mailboxPath = mailbox;
  n.reader = new MailboxReader(mailbox);
  n.active = true;
  n.currentVersion = "0.5.0";
  n.method = INSTALL_METHOD_SCRIPT;

  appendMailbox(mailbox, "ERR", "-1");

  expect(n.poll() == "");
  expect(!n.active);
});

test("an inactive notifier never polls again", () => {
  let n = new UpdateNotifier();
  expect(n.poll() == "");
});

test("an npm install is checked just like a script install", () => {
  let never: UpdateCache = { checkedAt: 0, latestSeen: "" };
  expect(shouldCheck("0.5.0", false, INSTALL_METHOD_NPM, never, 1000));
});

test("updateCheck off still silences an npm install", () => {
  let never: UpdateCache = { checkedAt: 0, latestSeen: "" };
  expect(!shouldCheck("0.5.0", true, INSTALL_METHOD_NPM, never, 1000));
});

test("the notice names the command that actually updates this install", () => {
  let npmText = noticeText("0.5.0", "v0.6.0", INSTALL_METHOD_NPM);
  expect(npmText.indexOf("npm install -g @joule-sh/code@latest") >= 0);
  expect(npmText.indexOf("install.sh") < 0);
  let scriptText = noticeText("0.5.0", "v0.6.0", INSTALL_METHOD_SCRIPT);
  expect(scriptText.indexOf("install.sh") >= 0);
  expect(updateCommandFor(INSTALL_METHOD_NPM).startsWith("npm install -g"));
});
