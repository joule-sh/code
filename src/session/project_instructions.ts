export const PROJECT_INSTRUCTIONS_FILENAME: string = "JOULE.md";
export const CLAUDE_INSTRUCTIONS_FILENAME: string = "CLAUDE.md";
export const PROJECT_INSTRUCTIONS_MAX_BYTES: int = 8000;

const PROJECT_INSTRUCTIONS_LABEL: string = "Project instructions (from JOULE.md at the workspace root, committed to the repo and shared by everyone working in it):\n\n";
const WORKSPACE_INSTRUCTIONS_LABEL: string = "Project instructions from the workspace root, committed to the repo and shared by everyone working in it. Every file below is in force at once; where they disagree JOULE.md is the one written for joule and wins:\n\n";
const TRUNCATION_NOTE: string = "\n\n[project instructions truncated at 8000 bytes for context, trim them so they fit]";

export function projectInstructionsPath(workspaceRoot: string): string {
  return workspaceRoot + "/" + PROJECT_INSTRUCTIONS_FILENAME;
}

export function truncateInstructions(text: string, maxBytes: int): string {
  if (text.length <= maxBytes) { return text; }
  return text.slice(0, maxBytes) + TRUNCATION_NOTE;
}

export function loadProjectInstructionsFrom(filePath: string): string {
  if (!fs.existsSync(filePath)) { return ""; }
  let raw = fs.readFileSync(filePath).trim();
  if (raw == "") { return ""; }
  return PROJECT_INSTRUCTIONS_LABEL + truncateInstructions(raw, PROJECT_INSTRUCTIONS_MAX_BYTES);
}

export function loadProjectInstructions(workspaceRoot: string): string {
  return loadProjectInstructionsFrom(projectInstructionsPath(workspaceRoot));
}

export function claudeInstructionsPath(workspaceRoot: string): string {
  return workspaceRoot + "/" + CLAUDE_INSTRUCTIONS_FILENAME;
}

function instructionSection(filePath: string, filename: string): string {
  if (!fs.existsSync(filePath)) { return ""; }
  let raw = fs.readFileSync(filePath).trim();
  if (raw == "") { return ""; }
  return "--- " + filename + " ---\n" + raw;
}

export function loadWorkspaceInstructions(workspaceRoot: string): string {
  let sections: string[] = [];
  let joule = instructionSection(projectInstructionsPath(workspaceRoot), PROJECT_INSTRUCTIONS_FILENAME);
  if (joule != "") { sections.push(joule); }
  let claude = instructionSection(claudeInstructionsPath(workspaceRoot), CLAUDE_INSTRUCTIONS_FILENAME);
  if (claude != "") { sections.push(claude); }
  if (sections.length == 0) { return ""; }
  return WORKSPACE_INSTRUCTIONS_LABEL + truncateInstructions(sections.join("\n\n"), PROJECT_INSTRUCTIONS_MAX_BYTES);
}
