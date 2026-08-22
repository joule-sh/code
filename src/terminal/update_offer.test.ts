import { PendingUpdateInstall, installedMessage, updateInstallDecision, tryHandleUpdateOfferArrow } from "./update_offer.ts";
import { PendingUpdateOffer } from "./input_state.ts";
import { appendMailbox, MailboxReader } from "../tasks/mailbox.ts";
import { TAG_INSTALLED, TAG_UP_TO_DATE, TAG_ERR } from "../update/install_worker.ts";
import { Scrollback } from "./scrollback.ts";

function freshMailbox(name: string): string {
  let p = "/tmp/update-offer-test-" + name + ".log";
  fs.writeFileSync(p, "");
  return p;
}

test("installedMessage formats the from/to versions and tells the user to restart", () => {
  let msg = installedMessage("0.6.1|0.6.2");
  expect(msg.indexOf("0.6.1") >= 0);
  expect(msg.indexOf("0.6.2") >= 0);
  expect(msg.indexOf("restart") >= 0);
});

test("installedMessage degrades gracefully on a malformed payload", () => {
  expect(installedMessage("garbage") == "joule: update installed");
});

test("PendingUpdateInstall.poll returns nothing until the worker's mailbox entry arrives", () => {
  let install = new PendingUpdateInstall();
  let mailbox = freshMailbox("pending");
  install.mailboxPath = mailbox;
  install.reader = new MailboxReader(mailbox);
  install.running = true;
  expect(install.poll() == "");
  expect(install.running);
});

test("PendingUpdateInstall.poll surfaces a successful install, then goes idle", () => {
  let install = new PendingUpdateInstall();
  let mailbox = freshMailbox("installed");
  install.mailboxPath = mailbox;
  install.reader = new MailboxReader(mailbox);
  install.running = true;
  appendMailbox(mailbox, TAG_INSTALLED, "0.6.1|0.6.2");
  let msg = install.poll();
  expect(msg.indexOf("0.6.1") >= 0);
  expect(msg.indexOf("0.6.2") >= 0);
  expect(!install.running);
});

test("PendingUpdateInstall.poll surfaces an up-to-date result", () => {
  let install = new PendingUpdateInstall();
  let mailbox = freshMailbox("uptodate");
  install.mailboxPath = mailbox;
  install.reader = new MailboxReader(mailbox);
  install.running = true;
  appendMailbox(mailbox, TAG_UP_TO_DATE, "0.6.1");
  expect(install.poll().indexOf("already on the latest release") >= 0);
  expect(!install.running);
});

test("PendingUpdateInstall.poll surfaces the installer's own error message", () => {
  let install = new PendingUpdateInstall();
  let mailbox = freshMailbox("errored");
  install.mailboxPath = mailbox;
  install.reader = new MailboxReader(mailbox);
  install.running = true;
  appendMailbox(mailbox, TAG_ERR, "the downloaded archive is corrupt");
  let msg = install.poll();
  expect(msg.indexOf("update failed") >= 0);
  expect(msg.indexOf("corrupt") >= 0);
  expect(!install.running);
});

test("an idle PendingUpdateInstall never polls a mailbox at all", () => {
  let install = new PendingUpdateInstall();
  expect(install.poll() == "");
});

test("updateInstallDecision refuses a second update while one is already running", () => {
  let msg = updateInstallDecision(true, "0.5.0", "/opt/.joule-code/0.5.0/joule", "/opt/.joule-code");
  expect(msg.indexOf("already in progress") >= 0);
});

test("updateInstallDecision declines a dev (source) build", () => {
  let msg = updateInstallDecision(false, "dev", "/opt/.joule-code/0.5.0/joule", "/opt/.joule-code");
  expect(msg.indexOf("source build") >= 0);
});

test("updateInstallDecision declines a binary that install.sh did not manage", () => {
  let root = "/tmp/update-offer-test-unmanaged-root";
  if (fs.existsSync(root)) { fs.rmSync(root, true); }
  fs.mkdirSync(root + "/0.5.0", true);
  let msg = updateInstallDecision(false, "0.5.0", "/usr/local/bin/joule", root);
  expect(msg.indexOf("install.sh") >= 0);
});

test("updateInstallDecision clears the way when nothing rules the update out", () => {
  let root = "/tmp/update-offer-test-managed-root";
  if (fs.existsSync(root)) { fs.rmSync(root, true); }
  fs.mkdirSync(root + "/0.5.0", true);
  fs.writeFileSync(root + "/0.5.0/joule", "binary");
  let msg = updateInstallDecision(false, "0.5.0", root + "/0.5.0/joule", root);
  expect(msg == "");
});

test("update offer arrow handling is inert when no offer is pending", () => {
  let offer = new PendingUpdateOffer();
  let sb = new Scrollback();
  expect(!tryHandleUpdateOfferArrow(offer, sb, true, 1));
});

test("update offer arrow navigation only moves the highlight while the input line is empty", () => {
  let offer = new PendingUpdateOffer();
  offer.open("0.6.2");
  offer.setOptionRows(0);
  let sb = new Scrollback();
  expect(!tryHandleUpdateOfferArrow(offer, sb, false, 1));
  expect(offer.selected == 0);
  expect(tryHandleUpdateOfferArrow(offer, sb, true, 1));
  expect(offer.selected == 1);
});
