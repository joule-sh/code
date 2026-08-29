// A per-session scratch directory (#336): somewhere sanctioned to put
// throwaway working files - intermediate script output, a draft before it
// becomes a real repo file, debug dumps - without littering the workspace or
// colliding with another session's leftovers in a shared system temp dir
// (which has bitten real work before: a stray script from an unrelated
// session shadowed a stdlib module for anything run from it later).
//
// Lives inside the workspace root, not under the daemon's home-config
// runtime dir, so every existing jailed tool (read/write/edit/list/grep) can
// already reach it with no change to jail.ts, and every `run` shell command
// can already reach it as a plain relative path with no env var plumbing,
// because both already start from the workspace root.
import { sessionKeyFor } from "./persistence.ts";

export const SCRATCH_ROOT_REL: string = ".joule/scratch";

export function scratchDirRel(workspaceRoot: string, sessionName: string): string {
  return SCRATCH_ROOT_REL + "/" + sessionKeyFor(workspaceRoot, sessionName);
}

function ensureGitExcludesScratch(workspaceRoot: string): void {
  let gitDir = workspaceRoot + "/.git";
  if (!fs.existsSync(gitDir)) { return; }
  if (!fs.statSync(gitDir).isDirectory) { return; }
  let infoDir = gitDir + "/info";
  if (!fs.existsSync(infoDir)) { fs.mkdirSync(infoDir, true); }
  let excludePath = infoDir + "/exclude";
  let existing = "";
  if (fs.existsSync(excludePath)) { existing = fs.readFileSync(excludePath); }
  let line = "/" + SCRATCH_ROOT_REL + "/";
  if (existing.indexOf(line) >= 0) { return; }
  let sep = existing == "" || existing.endsWith("\n") ? "" : "\n";
  fs.writeFileSync(excludePath, existing + sep + line + "\n");
}

// Creates the directory if needed, makes sure git will never see it, and
// hands back the workspace-relative path - the form every tool and every
// shell command already addresses paths in, so there is nothing further to
// tell the agent beyond this one string.
export function ensureScratchDir(workspaceRoot: string, sessionName: string): string {
  let rel = scratchDirRel(workspaceRoot, sessionName);
  let abs = workspaceRoot + "/" + rel;
  if (!fs.existsSync(abs)) { fs.mkdirSync(abs, true); }
  ensureGitExcludesScratch(workspaceRoot);
  return rel;
}

export function scratchContextNote(rel: string): string {
  return "You have a scratch directory at " + rel + ", inside this workspace but excluded from git - use it for throwaway working files (intermediate script output, drafts, debug dumps) instead of littering the repo itself or a shared system temp directory. It is reachable like any other workspace-relative path, by every tool and by shell commands run with the run tool.";
}

// The workspace's scratch root, covering every session that has ever used
// one on it - the bulk-clean escape hatch for `joule --clean-scratch`, since
// nothing else prunes these by itself.
export function cleanScratch(workspaceRoot: string): bool {
  let abs = workspaceRoot + "/" + SCRATCH_ROOT_REL;
  if (!fs.existsSync(abs)) { return false; }
  fs.rmSync(abs, true);
  return true;
}

test("scratchDirRel nests under the fixed root, keyed the same way daemon runtime dirs are", () => {
  let rel = scratchDirRel("/repo", "review");
  expect(rel.startsWith(SCRATCH_ROOT_REL + "/"));
  expect(rel == SCRATCH_ROOT_REL + "/" + sessionKeyFor("/repo", "review"));
});

test("scratchDirRel differs for different sessions on the same workspace, so they never collide", () => {
  let a = scratchDirRel("/repo", "review");
  let b = scratchDirRel("/repo", "release");
  let c = scratchDirRel("/repo", "");
  expect(a != b);
  expect(a != c);
  expect(b != c);
});

test("scratchContextNote names the exact relative path so the agent has one thing to remember", () => {
  let note = scratchContextNote(".joule/scratch/abc123");
  expect(note.indexOf(".joule/scratch/abc123") >= 0);
});

function freshRoot(name: string): string {
  let root = "/tmp/scratch-test-" + name;
  if (fs.existsSync(root)) { fs.rmSync(root, true); }
  fs.mkdirSync(root, true);
  return root;
}

test("ensureScratchDir creates the directory and returns its workspace-relative path", () => {
  let root = freshRoot("create");
  let rel = ensureScratchDir(root, "review");
  expect(fs.existsSync(root + "/" + rel));
  expect(rel == scratchDirRel(root, "review"));
});

test("ensureScratchDir is idempotent - calling it again does not fail or lose the directory", () => {
  let root = freshRoot("idempotent");
  ensureScratchDir(root, "");
  let rel = ensureScratchDir(root, "");
  expect(fs.existsSync(root + "/" + rel));
});

test("ensureScratchDir adds a git-exclude line for a repo, and does nothing for a non-repo", () => {
  let repo = freshRoot("git-repo");
  fs.mkdirSync(repo + "/.git", true);
  ensureScratchDir(repo, "");
  let excludeText = fs.readFileSync(repo + "/.git/info/exclude");
  expect(excludeText.indexOf("/" + SCRATCH_ROOT_REL + "/") >= 0);

  let bare = freshRoot("no-git");
  ensureScratchDir(bare, "");
  expect(!fs.existsSync(bare + "/.git"));
});

test("ensureScratchDir does not duplicate the git-exclude line on repeated calls", () => {
  let repo = freshRoot("git-repo-repeat");
  fs.mkdirSync(repo + "/.git", true);
  ensureScratchDir(repo, "");
  ensureScratchDir(repo, "other");
  let excludeText = fs.readFileSync(repo + "/.git/info/exclude");
  let line = "/" + SCRATCH_ROOT_REL + "/";
  let firstAt = excludeText.indexOf(line);
  let secondAt = excludeText.indexOf(line, firstAt + line.length);
  expect(firstAt >= 0);
  expect(secondAt < 0);
});

test("cleanScratch removes the whole scratch root for a workspace and reports whether there was one", () => {
  let root = freshRoot("clean");
  expect(!cleanScratch(root));
  ensureScratchDir(root, "review");
  ensureScratchDir(root, "release");
  expect(cleanScratch(root));
  expect(!fs.existsSync(root + "/" + SCRATCH_ROOT_REL));
  expect(!cleanScratch(root));
});
