import { projectInstructionsPath, truncateInstructions, loadProjectInstructionsFrom, loadProjectInstructions, PROJECT_INSTRUCTIONS_MAX_BYTES } from "./project_instructions.ts";

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
