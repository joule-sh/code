import { classifyCommand, classifyPlanCommand, tokenizeSimpleCommand } from "./command_safety.ts";

function freshRoot(name: string): string {
  let root = "/tmp/command-safety-test-" + name;
  if (fs.existsSync(root)) {
    fs.rmSync(root, true);
  }
  fs.mkdirSync(root, true);
  return root;
}

test("a plain ls with no arguments auto-runs", () => {
  let root = freshRoot("ls-plain");
  let v = classifyCommand("ls", root);
  expect(v.autoRun);
});

test("git status, diff, log and rev-parse all auto-run", () => {
  let root = freshRoot("git-readonly");
  expect(classifyCommand("git status", root).autoRun);
  expect(classifyCommand("git diff", root).autoRun);
  expect(classifyCommand("git log", root).autoRun);
  expect(classifyCommand("git rev-parse HEAD", root).autoRun);
});

test("npm test and make test auto-run", () => {
  let root = freshRoot("test-cmd");
  expect(classifyCommand("npm test", root).autoRun);
  expect(classifyCommand("make test", root).autoRun);
});

test("a command not on the allow list prompts, even a harmless-looking one", () => {
  let root = freshRoot("unknown-cmd");
  expect(!classifyCommand("npm install", root).autoRun);
  expect(!classifyCommand("mkdir foo", root).autoRun);
  expect(!classifyCommand("find / -name *.log", root).autoRun);
});

test("a semicolon-joined compound command is rejected outright, not partially matched", () => {
  let root = freshRoot("compound-semi");
  let v = classifyCommand("ls; rm -rf x", root);
  expect(!v.autoRun);
});

test("an && chained compound command is rejected outright", () => {
  let root = freshRoot("compound-and");
  let v = classifyCommand("ls && rm -rf x", root);
  expect(!v.autoRun);
});

test("an || chained compound command is rejected outright", () => {
  let root = freshRoot("compound-or");
  let v = classifyCommand("ls || rm -rf x", root);
  expect(!v.autoRun);
});

test("a pipe into another command is rejected outright", () => {
  let root = freshRoot("compound-pipe");
  let v = classifyCommand("git status | rm -rf x", root);
  expect(!v.autoRun);
});

test("backtick command substitution is rejected outright", () => {
  let root = freshRoot("backtick");
  let v = classifyCommand("echo `rm -rf x`", root);
  expect(!v.autoRun);
});

test("dollar-paren command substitution is rejected outright", () => {
  let root = freshRoot("dollar-paren");
  let v = classifyCommand("echo $(rm -rf x)", root);
  expect(!v.autoRun);
});

test("a background-and shell operator is rejected outright", () => {
  let root = freshRoot("background-amp");
  let v = classifyCommand("ls & rm -rf x", root);
  expect(!v.autoRun);
});

test("quoting a metacharacter does not launder it past the checker", () => {
  let root = freshRoot("quoting-trick");
  let v = classifyCommand("git status 'foo; rm -rf x'", root);
  expect(!v.autoRun);
});

test("a redirect masquerading as a safe command is rejected outright", () => {
  let root = freshRoot("redirect");
  let v = classifyCommand("ls > /etc/cron.d/evil", root);
  expect(!v.autoRun);
});

test("a safe-looking command with a dangerous argument still prompts: git branch -D", () => {
  let root = freshRoot("git-branch-delete");
  let v = classifyCommand("git branch -D main", root);
  expect(!v.autoRun);
});

test("a safe-looking command with a dangerous argument still prompts: git remote add", () => {
  let root = freshRoot("git-remote-add");
  let v = classifyCommand("git remote add evil https://example.com/x.git", root);
  expect(!v.autoRun);
});

test("a relative path that escapes the workspace via .. still prompts", () => {
  let root = freshRoot("dotdot-escape");
  let v = classifyCommand("cat ../../etc/passwd", root);
  expect(!v.autoRun);
});

test("an absolute path argument still prompts, even though it looks like a plain ls", () => {
  let root = freshRoot("absolute-path");
  let v = classifyCommand("cat /etc/passwd", root);
  expect(!v.autoRun);
  let v2 = classifyCommand("ls /etc", root);
  expect(!v2.autoRun);
});

test("a symlink inside the workspace pointing outside it still prompts", () => {
  let root = freshRoot("symlink-escape");
  let outside = "/tmp/command-safety-test-outside";
  if (fs.existsSync(outside)) {
    fs.rmSync(outside, true);
  }
  fs.mkdirSync(outside, true);
  fs.writeFileSync(outside + "/secret.txt", "leaked");
  fs.symlinkSync(outside, root + "/escape");

  let v = classifyCommand("cat escape/secret.txt", root);
  expect(!v.autoRun);
});

test("a tilde home-directory reference is rejected outright as a metacharacter", () => {
  let root = freshRoot("tilde");
  let v = classifyCommand("cat ~/.bashrc", root);
  expect(!v.autoRun);
});

test("a deny-list entry a naive per-command classifier would call safe still prompts: cat of an ssh key", () => {
  let root = freshRoot("deny-wins-cat");
  fs.mkdirSync(root + "/build", true);
  fs.writeFileSync(root + "/build/id_rsa", "not a real key");
  let v = classifyCommand("cat build/id_rsa", root);
  expect(!v.autoRun);
  expect(v.reason == "matches the hard deny list");
});

test("git push --force matches the deny list even though git status alone is allowed", () => {
  let root = freshRoot("deny-git-push");
  let v = classifyCommand("git push --force", root);
  expect(!v.autoRun);
  expect(v.reason == "matches the hard deny list");
});

test("rm -rf matches the deny list", () => {
  let root = freshRoot("deny-rm-rf");
  let v = classifyCommand("rm -rf build", root);
  expect(!v.autoRun);
  expect(v.reason == "matches the hard deny list");
});

test("sudo matches the deny list", () => {
  let root = freshRoot("deny-sudo");
  let v = classifyCommand("sudo cat /etc/shadow", root);
  expect(!v.autoRun);
});

test("git reset --hard and git rebase both match the deny list", () => {
  let root = freshRoot("deny-history-rewrite");
  expect(!classifyCommand("git reset --hard HEAD~1", root).autoRun);
  expect(!classifyCommand("git rebase main", root).autoRun);
});

test("a package publish command matches the deny list", () => {
  let root = freshRoot("deny-publish");
  expect(!classifyCommand("npm publish", root).autoRun);
});

test("an empty or whitespace-only command prompts rather than crashing", () => {
  let root = freshRoot("empty-cmd");
  expect(!classifyCommand("", root).autoRun);
  expect(!classifyCommand("   ", root).autoRun);
});

test("a path-qualified binary bypasses name matching and prompts", () => {
  let root = freshRoot("path-qualified");
  let v = classifyCommand("/bin/ls", root);
  expect(!v.autoRun);
  expect(v.reason == "path-qualified command");
});

test("an unterminated quote fails tokenization and prompts rather than guessing", () => {
  let root = freshRoot("unterminated-quote");
  let badCommand = "cat " + "\"" + "unterminated";
  let v = classifyCommand(badCommand, root);
  expect(!v.autoRun);
});

test("the tokenizer keeps a quoted argument with a space together as one token", () => {
  let r = tokenizeSimpleCommand("cat 'my file.txt'");
  expect(r.ok);
  expect(r.tokens.length == 2);
  expect(r.tokens[1] == "my file.txt");
});

test("cat with no file argument prompts instead of auto-running against stdin", () => {
  let root = freshRoot("cat-no-args");
  let v = classifyCommand("cat", root);
  expect(!v.autoRun);
});

test("plan: ls, pwd, cat, and read-only git commands all auto-run", () => {
  let root = freshRoot("plan-readonly");
  fs.writeFileSync(root + "/note.txt", "hi");
  expect(classifyPlanCommand("ls", root).autoRun);
  expect(classifyPlanCommand("pwd", root).autoRun);
  expect(classifyPlanCommand("cat note.txt", root).autoRun);
  expect(classifyPlanCommand("git status", root).autoRun);
  expect(classifyPlanCommand("git diff", root).autoRun);
  expect(classifyPlanCommand("git log", root).autoRun);
  expect(classifyPlanCommand("git rev-parse HEAD", root).autoRun);
  expect(classifyPlanCommand("git remote -v", root).autoRun);
});

test("plan: npm test and make test do not auto-run, unlike safe-auto - plan is stricter, derived from the same allow list", () => {
  let root = freshRoot("plan-stricter-tests");
  expect(!classifyPlanCommand("npm test", root).autoRun);
  expect(!classifyPlanCommand("make test", root).autoRun);
  expect(classifyCommand("npm test", root).autoRun);
  expect(classifyCommand("make test", root).autoRun);
});

test("plan: echo does not auto-run - it is not a read, search, or listing command", () => {
  let root = freshRoot("plan-no-echo");
  expect(!classifyPlanCommand("echo hi", root).autoRun);
});

test("plan: a command absent from the plan allow list prompts, even a harmless-looking one", () => {
  let root = freshRoot("plan-unknown-cmd");
  expect(!classifyPlanCommand("npm install", root).autoRun);
  expect(!classifyPlanCommand("mkdir foo", root).autoRun);
});

test("plan: a semicolon-joined compound command is rejected outright, not partially matched", () => {
  let root = freshRoot("plan-compound-semi");
  let v = classifyPlanCommand("ls; rm -rf x", root);
  expect(!v.autoRun);
});

test("plan: an && chained compound command is rejected outright", () => {
  let root = freshRoot("plan-compound-and");
  let v = classifyPlanCommand("git status && rm -rf x", root);
  expect(!v.autoRun);
});

test("plan: a pipe into another command is rejected outright", () => {
  let root = freshRoot("plan-compound-pipe");
  let v = classifyPlanCommand("git status | rm -rf x", root);
  expect(!v.autoRun);
});

test("plan: backtick command substitution is rejected outright", () => {
  let root = freshRoot("plan-backtick");
  let v = classifyPlanCommand("cat `rm -rf x`", root);
  expect(!v.autoRun);
});

test("plan: a path-qualified binary bypasses name matching and prompts", () => {
  let root = freshRoot("plan-path-qualified");
  let v = classifyPlanCommand("/bin/ls", root);
  expect(!v.autoRun);
  expect(v.reason == "path-qualified command");
});

test("plan: an absolute path argument still prompts, even though it looks like a plain cat", () => {
  let root = freshRoot("plan-absolute-path");
  expect(!classifyPlanCommand("cat /etc/passwd", root).autoRun);
  expect(!classifyPlanCommand("ls /etc", root).autoRun);
});

test("plan: a relative path that escapes the workspace via .. still prompts", () => {
  let root = freshRoot("plan-dotdot-escape");
  let v = classifyPlanCommand("cat ../../etc/passwd", root);
  expect(!v.autoRun);
});

test("plan: a deny-list entry still prompts even though the command name is otherwise allow-listed: cat of an ssh key", () => {
  let root = freshRoot("plan-deny-wins-cat");
  fs.mkdirSync(root + "/build", true);
  fs.writeFileSync(root + "/build/id_rsa", "not a real key");
  let v = classifyPlanCommand("cat build/id_rsa", root);
  expect(!v.autoRun);
  expect(v.reason == "matches the hard deny list");
});

test("plan: git push --force matches the deny list even though git status alone is allowed", () => {
  let root = freshRoot("plan-deny-git-push");
  let v = classifyPlanCommand("git push --force", root);
  expect(!v.autoRun);
  expect(v.reason == "matches the hard deny list");
});

test("plan: rm -rf matches the deny list", () => {
  let root = freshRoot("plan-deny-rm-rf");
  let v = classifyPlanCommand("rm -rf build", root);
  expect(!v.autoRun);
  expect(v.reason == "matches the hard deny list");
});

test("plan: a safe-looking command with a dangerous argument still prompts: git branch -D", () => {
  let root = freshRoot("plan-git-branch-delete");
  let v = classifyPlanCommand("git branch -D main", root);
  expect(!v.autoRun);
});

test("plan: a safe-looking command with a dangerous argument still prompts: git remote add", () => {
  let root = freshRoot("plan-git-remote-add");
  let v = classifyPlanCommand("git remote add evil https://example.com/x.git", root);
  expect(!v.autoRun);
});

test("plan: an empty or whitespace-only command prompts rather than crashing", () => {
  let root = freshRoot("plan-empty-cmd");
  expect(!classifyPlanCommand("", root).autoRun);
  expect(!classifyPlanCommand("   ", root).autoRun);
});
