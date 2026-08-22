import { jail } from "../tools/jail.ts";

export type CommandVerdict = { autoRun: bool, reason: string };
export type TokenizeResult = { ok: bool, tokens: string[] };

const DANGEROUS_CHARS: string[] = [";", "&", "|", "`", "$", "<", ">", "~", "\\", "(", ")", "{", "}", "\n", "\r"];

const DENY_SUBSTRINGS: string[] = [
  "rm -rf", "rm -fr", "rm -r -f", "rm -f -r",
  "sudo ", "sudo\t",
  "git push", "push -f", "push --force",
  "reset --hard", "clean -f", "clean -fd", "filter-branch", "rebase",
  ".ssh", ".aws", ".config", "id_rsa", "id_ed25519", "id_dsa", "credentials",
  "npm publish", "yarn publish", "pnpm publish", "cargo publish", "twine upload", "docker push", "npm login",
];

function isSpaceChar(c: string): bool {
  return c == " " || c == "\t";
}

function containsMetacharacters(command: string): bool {
  for (const ch of DANGEROUS_CHARS) {
    if (command.indexOf(ch) >= 0) { return true; }
  }
  return false;
}

function denyListMatches(command: string): bool {
  let lower = command.toLowerCase();
  for (const s of DENY_SUBSTRINGS) {
    if (lower.indexOf(s) >= 0) { return true; }
  }
  return false;
}

function badTokenize(): TokenizeResult {
  return { ok: false, tokens: [] };
}

export function tokenizeSimpleCommand(command: string): TokenizeResult {
  let tokens: string[] = [];
  let i = 0;
  let n = command.length;
  while (i < n) {
    while (i < n && isSpaceChar(command.charAt(i))) { i = i + 1; }
    if (i >= n) { break; }
    let tok = "";
    let sawAny = false;
    while (i < n && !isSpaceChar(command.charAt(i))) {
      let c = command.charAt(i);
      if (c == "'") {
        let j = i + 1;
        while (j < n && command.charAt(j) != "'") { j = j + 1; }
        if (j >= n) { return badTokenize(); }
        tok = tok + command.slice(i + 1, j);
        i = j + 1;
        sawAny = true;
        continue;
      }
      if (c == "\"") {
        let j = i + 1;
        while (j < n && command.charAt(j) != "\"") { j = j + 1; }
        if (j >= n) { return badTokenize(); }
        tok = tok + command.slice(i + 1, j);
        i = j + 1;
        sawAny = true;
        continue;
      }
      tok = tok + c;
      i = i + 1;
      sawAny = true;
    }
    if (sawAny) { tokens.push(tok); }
  }
  return { ok: true, tokens: tokens };
}

function nonFlagArgsSafe(args: string[], root: string): bool {
  for (const a of args) {
    if (a.startsWith("-")) { continue; }
    if (a.startsWith("/")) { return false; }
    let j = jail(root, a);
    if (!j.ok) { return false; }
  }
  return true;
}

function flagsOnly(args: string[]): bool {
  for (const a of args) {
    if (!a.startsWith("-")) { return false; }
  }
  return true;
}

function gitBranchSafe(args: string[]): bool {
  for (const a of args) {
    if (a == "-d" || a == "-D" || a == "-m" || a == "-M" || a == "--delete" || a == "--move" || a == "-c" || a == "-C" || a == "--copy") {
      return false;
    }
  }
  return true;
}

function gitRemoteSafe(args: string[]): bool {
  if (args.length == 0) { return true; }
  if (args.length == 1 && args[0] == "-v") { return true; }
  return false;
}

function gitSubcommandSafe(args: string[], root: string): bool {
  if (args.length == 0) { return false; }
  let sub = args[0];
  let rest = args.slice(1);
  if (sub == "status" || sub == "rev-parse") { return true; }
  if (sub == "diff" || sub == "log" || sub == "show") { return nonFlagArgsSafe(rest, root); }
  if (sub == "branch") { return gitBranchSafe(rest); }
  if (sub == "remote") { return gitRemoteSafe(rest); }
  return false;
}

function isRecognizedTestInvocation(tokens: string[]): bool {
  let head = tokens[0];
  let rest = tokens.slice(1);
  if (head == "npm" && rest.length >= 1 && rest[0] == "test") { return flagsOnly(rest.slice(1)); }
  if (head == "npm" && rest.length >= 2 && rest[0] == "run" && rest[1] == "test") { return flagsOnly(rest.slice(2)); }
  if ((head == "yarn" || head == "pnpm") && rest.length >= 1 && rest[0] == "test") { return flagsOnly(rest.slice(1)); }
  if (head == "make" && rest.length >= 1 && rest[0] == "test") { return flagsOnly(rest.slice(1)); }
  if (head == "go" && rest.length >= 1 && rest[0] == "test") { return true; }
  if (head == "cargo" && rest.length >= 1 && rest[0] == "test") { return true; }
  if (head == "pytest") { return flagsOnly(rest); }
  if ((head == "python" || head == "python3") && rest.length >= 2 && rest[0] == "-m" && rest[1] == "pytest") { return true; }
  return false;
}

function classifyByAllowList(tokens: string[], root: string): bool {
  let head = tokens[0];
  let rest = tokens.slice(1);
  if (head == "ls") { return nonFlagArgsSafe(rest, root); }
  if (head == "pwd") { return rest.length == 0; }
  if (head == "cat") { return rest.length >= 1 && nonFlagArgsSafe(rest, root); }
  if (head == "echo") { return true; }
  if (head == "git") { return gitSubcommandSafe(rest, root); }
  if (isRecognizedTestInvocation(tokens)) { return true; }
  return false;
}

function verdict(autoRun: bool, reason: string): CommandVerdict {
  return { autoRun: autoRun, reason: reason };
}

function judgeCommand(command: string, workspaceRoot: string, allowFn: (tokens: string[], root: string) => bool): CommandVerdict {
  let trimmed = command.trim();
  if (trimmed == "") {
    return verdict(false, "empty command");
  }
  if (denyListMatches(trimmed)) {
    return verdict(false, "matches the hard deny list");
  }
  if (containsMetacharacters(trimmed)) {
    return verdict(false, "compound command or shell metacharacters");
  }
  let tok = tokenizeSimpleCommand(trimmed);
  if (!tok.ok || tok.tokens.length == 0) {
    return verdict(false, "could not be tokenized safely");
  }
  let head = tok.tokens[0];
  if (head.indexOf("/") >= 0) {
    return verdict(false, "path-qualified command");
  }
  if (allowFn(tok.tokens, workspaceRoot)) {
    return verdict(true, "matches the auto-run allow list");
  }
  return verdict(false, "not on the auto-run allow list");
}

export function classifyCommand(command: string, workspaceRoot: string): CommandVerdict {
  return judgeCommand(command, workspaceRoot, classifyByAllowList);
}

function classifyByPlanAllowList(tokens: string[], root: string): bool {
  let head = tokens[0];
  let rest = tokens.slice(1);
  if (head == "ls") { return nonFlagArgsSafe(rest, root); }
  if (head == "pwd") { return rest.length == 0; }
  if (head == "cat") { return rest.length >= 1 && nonFlagArgsSafe(rest, root); }
  if (head == "git") { return gitSubcommandSafe(rest, root); }
  return false;
}

export function classifyPlanCommand(command: string, workspaceRoot: string): CommandVerdict {
  return judgeCommand(command, workspaceRoot, classifyByPlanAllowList);
}
