import { projectInstructionsPath, claudeInstructionsPath, truncateInstructions, loadProjectInstructionsFrom, loadProjectInstructions, loadWorkspaceInstructions, PROJECT_INSTRUCTIONS_MAX_BYTES } from "./project_instructions.ts";

function freshRoot(name: string): string {
  let root = "/tmp/project-instructions-test-" + name;
  if (fs.existsSync(root)) {
    fs.rmSync(root, true);
  }
  fs.mkdirSync(root, true);
  return root;
}

function repeatChar(ch: string, n: int): string {
  let out = "";
  let i = 0;
  while (i < n) {
    out = out + ch;
    i = i + 1;
  }
  return out;
}

test("projectInstructionsPath joins the workspace root and the fixed filename", () => {
  expect(projectInstructionsPath("/repo") == "/repo/JOULE.md");
});

test("loadProjectInstructionsFrom on a missing file returns empty, not an error", () => {
  let root = freshRoot("missing");
  expect(loadProjectInstructionsFrom(root + "/JOULE.md") == "");
});

test("loadProjectInstructions is silent (empty string) when the workspace has no JOULE.md", () => {
  let root = freshRoot("absent-silent");
  expect(loadProjectInstructions(root) == "");
});

test("loadProjectInstructionsFrom on a whitespace-only file returns empty, same as absent", () => {
  let root = freshRoot("blank");
  let file = root + "/JOULE.md";
  fs.writeFileSync(file, "   \n\t\n  ");
  expect(loadProjectInstructionsFrom(file) == "");
});

test("loadProjectInstructions reads and labels a real JOULE.md at the workspace root", () => {
  let root = freshRoot("present");
  fs.writeFileSync(root + "/JOULE.md", "build with make build\ntest with make test");
  let out = loadProjectInstructions(root);
  expect(out.indexOf("build with make build") >= 0);
  expect(out.indexOf("JOULE.md") >= 0);
});

test("truncateInstructions leaves text under the cap untouched", () => {
  expect(truncateInstructions("short", 8000) == "short");
});

test("truncateInstructions cuts text over the cap and appends a visible note", () => {
  let long = repeatChar("a", 9000);
  let out = truncateInstructions(long, 8000);
  expect(out.length > 8000);
  expect(out.indexOf("truncated") >= 0);
  expect(out.slice(0, 8000) == long.slice(0, 8000));
});

test("loadProjectInstructionsFrom applies the same byte cap end to end", () => {
  let root = freshRoot("oversized");
  let long = repeatChar("x", PROJECT_INSTRUCTIONS_MAX_BYTES + 500);
  fs.writeFileSync(root + "/JOULE.md", long);
  let out = loadProjectInstructionsFrom(root + "/JOULE.md");
  expect(out.indexOf("truncated") >= 0);
});

test("claudeInstructionsPath joins the workspace root and CLAUDE.md", () => {
  expect(claudeInstructionsPath("/repo") == "/repo/CLAUDE.md");
});

test("a workspace with neither file loads nothing at all", () => {
  let root = freshRoot("workspace-none");
  expect(loadWorkspaceInstructions(root) == "");
});

test("a workspace with only JOULE.md loads it, named", () => {
  let root = freshRoot("workspace-joule-only");
  fs.writeFileSync(root + "/JOULE.md", "build with make build");
  let out = loadWorkspaceInstructions(root);
  expect(out.indexOf("build with make build") >= 0);
  expect(out.indexOf("JOULE.md") >= 0);
  expect(out.indexOf("CLAUDE.md") < 0);
});

test("a workspace with only CLAUDE.md loads it too, so an existing setup works on first run", () => {
  let root = freshRoot("workspace-claude-only");
  fs.writeFileSync(root + "/CLAUDE.md", "prefer small commits");
  let out = loadWorkspaceInstructions(root);
  expect(out.indexOf("prefer small commits") >= 0);
  expect(out.indexOf("CLAUDE.md") >= 0);
});

test("when both exist neither is dropped: both load, JOULE.md first and named, CLAUDE.md after", () => {
  let root = freshRoot("workspace-both");
  fs.writeFileSync(root + "/JOULE.md", "JOULE_MARKER");
  fs.writeFileSync(root + "/CLAUDE.md", "CLAUDE_MARKER");
  let out = loadWorkspaceInstructions(root);
  let joule = out.indexOf("JOULE_MARKER");
  let claude = out.indexOf("CLAUDE_MARKER");
  expect(joule >= 0);
  expect(claude >= 0);
  expect(joule < claude);
  expect(out.indexOf("--- JOULE.md ---") >= 0);
  expect(out.indexOf("--- CLAUDE.md ---") >= 0);
});

test("the stated tie-break is in the text the model reads, so the order is not a silent convention", () => {
  let root = freshRoot("workspace-tiebreak");
  fs.writeFileSync(root + "/JOULE.md", "a");
  fs.writeFileSync(root + "/CLAUDE.md", "b");
  expect(loadWorkspaceInstructions(root).indexOf("JOULE.md is the one written for joule and wins") >= 0);
});

test("an empty CLAUDE.md is treated as absent rather than adding an empty section", () => {
  let root = freshRoot("workspace-empty-claude");
  fs.writeFileSync(root + "/JOULE.md", "real content");
  fs.writeFileSync(root + "/CLAUDE.md", "   \n\t\n ");
  expect(loadWorkspaceInstructions(root).indexOf("CLAUDE.md") < 0);
});

test("the byte cap covers both files together, not each one over again", () => {
  let root = freshRoot("workspace-cap");
  let half = repeatChar("x", PROJECT_INSTRUCTIONS_MAX_BYTES - 100);
  fs.writeFileSync(root + "/JOULE.md", half);
  fs.writeFileSync(root + "/CLAUDE.md", half);
  expect(loadWorkspaceInstructions(root).indexOf("truncated") >= 0);
});
