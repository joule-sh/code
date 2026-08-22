export const PROJECT_INSTRUCTIONS_FILENAME: string = "JOULE.md";
export const PROJECT_INSTRUCTIONS_MAX_BYTES: int = 8000;

const PROJECT_INSTRUCTIONS_LABEL: string = "Project instructions (from JOULE.md at the workspace root, committed to the repo and shared by everyone working in it):\n\n";
const TRUNCATION_NOTE: string = "\n\n[JOULE.md truncated at 8000 bytes for context, trim it so the whole file fits]";

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
