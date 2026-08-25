import { Scrollback } from "./scrollback.ts";
import { styleBanner } from "./style.ts";
import { discoverSkills, usableSkills, findSkill, skillCatalogueText, skillBodyText, skillsListText, foreignSkillDirsInUse, Skill } from "../session/skills.ts";
import { claudeInstructionsPath } from "../session/project_instructions.ts";

export type SkillCommand = { text: string, input: string };

export function startupSkillsText(workspaceRoot: string): string {
  return skillCatalogueText(discoverSkills(workspaceRoot));
}

function countPhrase(n: int): string {
  if (n == 1) { return "1 skill loaded"; }
  return `${n}` + " skills loaded";
}

export function skillsStartupNote(workspaceRoot: string): string {
  let skills = discoverSkills(workspaceRoot);
  let usable = usableSkills(skills);
  let foreign: string[] = [];
  for (const o of foreignSkillDirsInUse(skills)) { foreign.push(o + " skills"); }
  if (fs.existsSync(claudeInstructionsPath(workspaceRoot))) { foreign.push("CLAUDE.md"); }
  let note = "";
  if (usable.length > 0) {
    note = "\n" + styleBanner(countPhrase(usable.length) + " - /skills to see them and where each came from");
  }
  if (foreign.length > 0) {
    note = note + "\n" + styleBanner("also reading " + foreign.join(", ") + ", written for another tool");
  }
  return note;
}

export function skillCommand(workspaceRoot: string, arg: string): SkillCommand {
  let skills = discoverSkills(workspaceRoot);
  let trimmed = arg.trim();
  if (trimmed == "" || trimmed == "list") {
    let listing: SkillCommand = { text: skillsListText(skills, workspaceRoot), input: "" };
    return listing;
  }

  let name = trimmed;
  let rest = "";
  let space = trimmed.indexOf(" ");
  if (space > 0) {
    name = trimmed.slice(0, space);
    rest = trimmed.slice(space + 1, trimmed.length).trim();
  }

  let hit = findSkill(skills, name);
  if (hit.length == 0) {
    let miss: SkillCommand = { text: "\nno skill named \"" + name + "\". /skills lists what is available and where each came from.", input: "" };
    return miss;
  }

  let s = hit[0];
  let body = skillBodyText(s);
  if (rest != "") { body = body + "\n\nThe person invoked this skill with: " + rest; }
  let used: SkillCommand = { text: "\n" + styleBanner("using skill \"" + s.name + "\" from " + s.origin + ": " + s.path), input: body };
  return used;
}

export function runSkillCommand(workspaceRoot: string, arg: string, sb: Scrollback): string {
  let c = skillCommand(workspaceRoot, arg);
  sb.append(c.text);
  return c.input;
}
