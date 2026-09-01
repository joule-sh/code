import { jsonMemberStart, jsonStringMemberAt, jsonIntMemberAt, decodeJsonText } from "https://lumen-lang.org/package/std-contrib/ai/core/jsonscan.ts";

// A declared plan of subagent stages, advanced by the daemon rather than by
// a model deciding hand-offs turn by turn. Stages run in order; the tasks
// inside a stage run as parallel subagents; {{prior}} in a task text is
// replaced with the previous stage's reports. See docs/09-pipeline.md.

export const MAX_PIPELINE_STAGES: int = 5;
export const MAX_STAGE_TASKS: int = 5;
export const MAX_PIPELINE_TASKS: int = 10;
export const PRIOR_MARK: string = "{{prior}}";

export type PipelineStage = {
  name: string,
  tasks: string[],
  report: string,
  steps: int,
};

export type PipelineSpec = {
  stages: PipelineStage[],
};

export type PipelineParse = {
  ok: bool,
  spec: PipelineSpec,
  fault: string,
};

function emptySpec(): PipelineSpec {
  let none: PipelineStage[] = [];
  return { stages: none };
}

function parseFailed(why: string): PipelineParse {
  return { ok: false, spec: emptySpec(), fault: why };
}

// Where the JSON value starting at `at` ends (one past its last character),
// or -1. Strings are honoured, escapes and all, which is what keeps a brace
// inside a task text from derailing the walk.
function jsonValueEnd(s: string, at: int): int {
  let c = s.slice(at, at + 1);
  if (c == "\"") {
    let i = at + 1;
    while (i < s.length) {
      let d = s.slice(i, i + 1);
      if (d == "\\") { i = i + 2; continue; }
      if (d == "\"") { return i + 1; }
      i = i + 1;
    }
    return -1;
  }
  if (c != "{" && c != "[") { return -1; }
  let depth: int = 0;
  let i = at;
  let inString = false;
  while (i < s.length) {
    let d = s.slice(i, i + 1);
    if (inString) {
      if (d == "\\") { i = i + 2; continue; }
      if (d == "\"") { inString = false; }
      i = i + 1;
      continue;
    }
    if (d == "\"") { inString = true; }
    if (d == "{" || d == "[") { depth = depth + 1; }
    if (d == "}" || d == "]") {
      depth = depth - 1;
      if (depth == 0) { return i + 1; }
    }
    i = i + 1;
  }
  return -1;
}

// The starts of an array's top-level elements, given the offset of its `[`.
function arrayElementStarts(s: string, arrayAt: int): int[] {
  let out: int[] = [];
  let end = jsonValueEnd(s, arrayAt);
  if (end < 0) { return out; }
  let i = arrayAt + 1;
  while (i < end - 1) {
    let c = s.slice(i, i + 1);
    if (c == " " || c == "," || c == "\n" || c == "\r" || c == "\t") { i = i + 1; continue; }
    out.push(i);
    let ve = jsonValueEnd(s, i);
    if (ve < 0) {
      let none: int[] = [];
      return none;
    }
    i = ve;
  }
  return out;
}

function memberArrayAt(s: string, objStart: int, key: string): int {
  let at = jsonMemberStart(s, objStart, key);
  if (at < 0) { return -1; }
  while (at < s.length && (s.slice(at, at + 1) == " " || s.slice(at, at + 1) == "\n")) { at = at + 1; }
  if (s.slice(at, at + 1) != "[") { return -1; }
  return at;
}

type RawStage = { name: string, tasks: string[], report: string, steps: int };

// Scanned rather than JSON.parse'd: the arguments arrive as the model wrote
// them, and the strict parser refuses a missing optional member and an extra
// one alike - both of which a model produces routinely.
function scanStage(whole: string, at: int): RawStage {
  let end = jsonValueEnd(whole, at);
  if (end < 0) { end = whole.length; }
  // Member lookups run on this stage's own slice, so a member missing here
  // cannot be answered by the next stage's.
  let s = whole.slice(at, end);
  let tasks: string[] = [];
  let tasksAt = memberArrayAt(s, 0, "tasks");
  if (tasksAt >= 0) {
    for (const el of arrayElementStarts(s, tasksAt)) {
      if (s.slice(el, el + 1) != "\"") { continue; }
      let se = jsonValueEnd(s, el);
      if (se < 0) { continue; }
      tasks.push(decodeJsonText(s.slice(el + 1, se - 1)));
    }
  }
  return {
    name: jsonStringMemberAt(s, 0, "name"),
    tasks: tasks,
    report: jsonStringMemberAt(s, 0, "report"),
    steps: jsonIntMemberAt(s, 0, "steps"),
  };
}

export function parsePipelineSpec(args: string): PipelineParse {
  let stagesAt = memberArrayAt(args, 0, "stages");
  if (stagesAt < 0) {
    return parseFailed("run_pipeline takes {\"stages\":[{\"name\":...,\"tasks\":[...]}]} - this call did not parse as that shape");
  }
  let starts = arrayElementStarts(args, stagesAt);
  if (starts.length == 0) {
    return parseFailed("a pipeline needs at least one stage");
  }
  if (starts.length > MAX_PIPELINE_STAGES) {
    return parseFailed("a pipeline holds at most " + `${MAX_PIPELINE_STAGES}` + " stages; this one names " + `${starts.length}`);
  }
  let total: int = 0;
  let stages: PipelineStage[] = [];
  let i: int = 0;
  while (i < starts.length) {
    let s = scanStage(args, starts[i]);
    i = i + 1;
    if (s.name.trim() == "") {
      return parseFailed("every stage needs a name, so its report can say where it came from");
    }
    if (s.tasks.length == 0) {
      return parseFailed("stage \"" + s.name + "\" has no tasks");
    }
    if (s.tasks.length > MAX_STAGE_TASKS) {
      return parseFailed("stage \"" + s.name + "\" names " + `${s.tasks.length}` + " tasks; a stage holds at most " + `${MAX_STAGE_TASKS}`);
    }
    let j: int = 0;
    while (j < s.tasks.length) {
      if (s.tasks[j].trim() == "") {
        return parseFailed("stage \"" + s.name + "\" has an empty task");
      }
      j = j + 1;
    }
    total = total + s.tasks.length;
    let steps = s.steps;
    if (steps <= 0) { steps = 0; }
    stages.push({ name: s.name, tasks: s.tasks, report: s.report, steps: steps });
  }
  if (total > MAX_PIPELINE_TASKS) {
    return parseFailed("a pipeline holds at most " + `${MAX_PIPELINE_TASKS}` + " tasks in all; this one names " + `${total}`);
  }
  let done: PipelineParse = { ok: true, spec: { stages: stages }, fault: "" };
  return done;
}

// What a later stage sees of an earlier one: each report under the id that
// produced it, so a task that fans in can still tell the sources apart.
export function joinReports(ids: string[], reports: string[]): string {
  let out = "";
  let i: int = 0;
  while (i < ids.length) {
    if (i > 0) { out = out + "\n\n"; }
    out = out + "[" + ids[i] + "]\n" + reports[i];
    i = i + 1;
  }
  return out;
}

export function fillPrior(task: string, prior: string): string {
  if (task.indexOf(PRIOR_MARK) < 0) { return task; }
  return task.split(PRIOR_MARK).join(prior);
}

// A corrected subagent leaves its prose and then its JSON in one stream, and
// the JSON at the end is the report. Balancing braces from the tail finds it;
// text that does not end in an object comes back whole.
export function reportOf(text: string): string {
  let t = text.trim();
  if (!t.endsWith("}")) { return t; }
  let depth: int = 0;
  let i: int = t.length - 1;
  while (i >= 0) {
    let c = t.slice(i, i + 1);
    if (c == "}") { depth = depth + 1; }
    if (c == "{") {
      depth = depth - 1;
      if (depth == 0) { return t.slice(i, t.length); }
    }
    i = i - 1;
  }
  return t;
}

// The running pipeline. It owns which stage is active and which subagent ids
// belong to it; whoever advances it supplies the spawner and the answers to
// "is that agent done" and "what did it say", so this stays testable without
// a worker or a clock.
export class Pipeline {
  id: string;
  spec: PipelineSpec;
  stageAt: int;
  activeIds: string[];
  prior: string;
  done: bool;
  summary: string;

  constructor(id: string, spec: PipelineSpec) {
    this.id = id;
    this.spec = spec;
    this.stageAt = -1;
    this.activeIds = [];
    this.prior = "";
    this.done = false;
    this.summary = "";
  }

  stageName(): string {
    if (this.stageAt < 0 || this.stageAt >= this.spec.stages.length) { return ""; }
    return this.spec.stages[this.stageAt].name;
  }

  statusText(): string {
    if (this.done) { return this.id + ": done"; }
    if (this.stageAt < 0) { return this.id + ": not started"; }
    return this.id + ": stage " + `${this.stageAt + 1}` + "/" + `${this.spec.stages.length}`
      + " (" + this.stageName() + "), " + `${this.activeIds.length}` + " agent(s)";
  }

  // Starts the next stage, or finishes. spawn(task, steps, report) starts one
  // subagent and returns its id.
  advance(spawn: (task: string, steps: int, report: string) => string): void {
    this.stageAt = this.stageAt + 1;
    if (this.stageAt >= this.spec.stages.length) {
      this.done = true;
      this.summary = this.prior;
      return;
    }
    let stage = this.spec.stages[this.stageAt];
    let ids: string[] = [];
    let i: int = 0;
    while (i < stage.tasks.length) {
      let task = fillPrior(stage.tasks[i], this.prior);
      ids.push(spawn(task, stage.steps, stage.report));
      i = i + 1;
    }
    this.activeIds = ids;
  }

  // Called on every poll. agentDone / agentReport answer for one id; when the
  // whole stage has reported, its output becomes prior and the next stage
  // starts. Returns true when this poll finished the pipeline.
  poll(agentDone: (id: string) => bool, agentReport: (id: string) => string,
    spawn: (task: string, steps: int, report: string) => string): bool {
    if (this.done) { return false; }
    if (this.stageAt < 0) {
      this.advance(spawn);
      return this.done;
    }
    let i: int = 0;
    while (i < this.activeIds.length) {
      if (!agentDone(this.activeIds[i])) { return false; }
      i = i + 1;
    }
    let reports: string[] = [];
    let j: int = 0;
    while (j < this.activeIds.length) {
      reports.push(agentReport(this.activeIds[j]));
      j = j + 1;
    }
    this.prior = joinReports(this.activeIds, reports);
    this.activeIds = [];
    this.advance(spawn);
    return this.done;
  }
}
