import { TURN_START, TOOL_CALL, TOOL_RESULT } from "../protocol/frames.ts";
import { VIOLET, wrap } from "./style.ts";

const GLYPH: string = "◆";

export function quantaVerb(kind: string, tool: string): string {
  if (kind == TURN_START || kind == TOOL_RESULT) {
    return "thinking";
  }
  if (kind == TOOL_CALL) {
    if (tool == "read") { return "reading"; }
    if (tool == "write" || tool == "edit") { return "writing"; }
    if (tool == "list" || tool == "grep") { return "searching"; }
    if (tool == "run") { return "running"; }
    return "working";
  }
  return "";
}

export function buildQuantaIndicator(kind: string, tool: string): string {
  let verb = quantaVerb(kind, tool);
  if (verb == "") {
    return "";
  }
  return wrap(VIOLET, GLYPH + " quanta is " + verb);
}
