import { DIM, RESET } from "./style.ts";

export const COLLAPSE_HEAD_LINES: int = 6;
export const COLLAPSE_MIN_LINES: int = 10;

export type CollapsePlan = { head: string, body: string, hidden: int };

function plainPlan(rendered: string): CollapsePlan {
  return { head: rendered, body: "", hidden: 0 };
}

export function planToolOutputCollapse(rendered: string): CollapsePlan {
  if (rendered == "") {
    return plainPlan(rendered);
  }
  if (rendered.charAt(0) != "\n") {
    return plainPlan(rendered);
  }
  let parts = rendered.split("\n");
  let total = parts.length - 1;
  if (total <= COLLAPSE_MIN_LINES) {
    return plainPlan(rendered);
  }
  let head = "";
  let i = 1;
  while (i <= COLLAPSE_HEAD_LINES) {
    head = head + "\n" + parts[i];
    i = i + 1;
  }
  let body = "";
  let first = true;
  while (i < parts.length) {
    if (!first) {
      body = body + "\n";
    }
    body = body + parts[i];
    first = false;
    i = i + 1;
  }
  return { head: head, body: body, hidden: total - COLLAPSE_HEAD_LINES };
}

export function collapsedMarker(hidden: int): string {
  return DIM + "     ... +" + `${hidden}` + " lines (ctrl-o to expand)" + RESET;
}

export function expandedMarker(hidden: int): string {
  return DIM + "     ... " + `${hidden}` + " more lines (ctrl-o to collapse)" + RESET;
}
