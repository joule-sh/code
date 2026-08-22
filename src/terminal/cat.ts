import { readFile } from "../tools/files.ts";

export function catText(workspaceRoot: string, arg: string): string {
  if (arg == "") {
    return "\nusage: /cat <path>";
  }
  let r = readFile(workspaceRoot, arg, 0, 0);
  if (!r.ok) {
    return "\ncat: " + arg + ": " + r.error;
  }
  if (r.truncated) {
    return "\n" + r.content + "\n(truncated)";
  }
  return "\n" + r.content;
}
