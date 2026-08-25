import { PendingUpdateInstall, installedMessage, updateInstallDecision, unknownInstallDecline, tryHandleUpdateOfferArrow } from "./update_offer.ts";
import { INSTALL_METHOD_SCRIPT, INSTALL_METHOD_NPM, INSTALL_METHOD_UNKNOWN } from "../update/install_detect.ts";
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
  let msg = updateInstallDecision(true, "0.5.0", INSTALL_METHOD_SCRIPT);
  expect(msg.indexOf("already in progress") >= 0);
});

test("updateInstallDecision declines a dev (source) build", () => {
  let msg = updateInstallDecision(false, "dev", INSTALL_METHOD_SCRIPT);
  expect(msg.indexOf("source build") >= 0);
});

test("updateInstallDecision declines a binary neither installer owns, and says so honestly", () => {
  let msg = updateInstallDecision(false, "0.5.0", INSTALL_METHOD_UNKNOWN);
  expect(msg.indexOf("neither install.sh nor npm") >= 0);
  expect(msg.indexOf("npm install -g @joule-sh/code@latest") >= 0);
  expect(msg.indexOf("install.sh") >= 0);
  expect(unknownInstallDecline() == msg);
});

test("updateInstallDecision clears the way for a script install", () => {
  expect(updateInstallDecision(false, "0.5.0", INSTALL_METHOD_SCRIPT) == "");
});

test("updateInstallDecision clears the way for an npm install, which used to be declined", () => {
  expect(updateInstallDecision(false, "0.5.0", INSTALL_METHOD_NPM) == "");
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

test("poll records which outcome it saw, so the caller knows when to reap the daemon", () => {
  let install = new PendingUpdateInstall();
  let mailbox = freshMailbox("lastkind");
  install.mailboxPath = mailbox;
  install.reader = new MailboxReader(mailbox);
  install.running = true;
  appendMailbox(mailbox, TAG_INSTALLED, "0.6.1|0.6.2");
  install.poll();
  expect(install.lastKind == TAG_INSTALLED);

  let idle = new PendingUpdateInstall();
  expect(idle.lastKind == "");
});
