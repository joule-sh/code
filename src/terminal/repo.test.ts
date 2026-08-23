import { parseHeadRef, parseRemoteSlug, slugFromUrl, baseName, describeRepo, repoSummary } from "./repo.ts";

test("a HEAD pointing at a branch names the branch, not the ref path it is written as", () => {
  expect(parseHeadRef("ref: refs/heads/main\n") == "main");
  expect(parseHeadRef("ref: refs/heads/154-terminal-design\n") == "154-terminal-design");
});

test("a detached HEAD reads as a short sha rather than as an empty branch", () => {
  expect(parseHeadRef("7265931f2a4c8d0e1b6a5f4c3d2e1a0b9c8d7e6f\n") == "7265931");
});

test("a HEAD file that says nothing useful yields nothing rather than a stray fragment", () => {
  expect(parseHeadRef("") == "");
  expect(parseHeadRef("  \n") == "");
});

test("an https remote reads as owner and repository, with the git suffix dropped", () => {
  expect(slugFromUrl("https://github.com/joule-sh/code.git") == "joule-sh/code");
  expect(slugFromUrl("https://github.com/joule-sh/code") == "joule-sh/code");
});

test("an ssh remote reads the same way, though it separates the owner with a colon", () => {
  expect(slugFromUrl("git@github.com:joule-sh/code.git") == "joule-sh/code");
});

test("a remote with nothing to split on falls back to what it does have", () => {
  expect(slugFromUrl("code") == "code");
  expect(slugFromUrl("") == "");
});

test("the first url in a git config is the one taken, since that is origin", () => {
  let config = "[core]\n\trepositoryformatversion = 0\n[remote \"origin\"]\n\turl = https://github.com/joule-sh/code.git\n\tfetch = +refs\n[remote \"fork\"]\n\turl = https://github.com/someone/code.git\n";
  expect(parseRemoteSlug(config) == "joule-sh/code");
});

test("a git config with no remote at all yields nothing", () => {
  expect(parseRemoteSlug("[core]\n\tbare = false\n") == "");
});

test("a directory name is read off a path with or without a trailing slash", () => {
  expect(baseName("/home/aymen/project") == "project");
  expect(baseName("/home/aymen/project/") == "project");
  expect(baseName("project") == "project");
});

test("the repo line reads as a sentence fragment, and drops the branch half when there is none", () => {
  expect(describeRepo("joule-sh/code", "main") == "joule-sh/code on main");
  expect(describeRepo("joule-sh/code", "") == "joule-sh/code");
  expect(describeRepo("", "main") == "");
});

test("a workspace that is not a git checkout reports nothing, so the row can be left out", () => {
  expect(repoSummary("/nonexistent/path/that/is/not/a/checkout") == "");
});
