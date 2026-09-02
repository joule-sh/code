import { Pipeline, parsePipelineSpec, fillPrior, joinReports, reportOf, MAX_PIPELINE_STAGES, MAX_STAGE_TASKS, MAX_PIPELINE_TASKS } from "./pipeline.ts";
import { clampSteps, withReportDirective, looksLikeLoneJson, needsAskingLite, withScratchNote } from "./subagent_worker.ts";

test("a subagent is told where its scratch directory is, and only when there is one", () => {
  let noted = withScratchNote("base", ".joule/scratch/abc123");
  expect(noted.indexOf(".joule/scratch/abc123") > 0);
  expect(noted.indexOf("base") == 0);
  expect(withScratchNote("base", "") == "base");
});
import { MODE_READ_ONLY, MODE_AUTO_EDIT, MODE_SAFE_AUTO, MODE_FULL_AUTO, MODE_PLAN } from "../approval/gate.ts";

test("a subagent reads the mode the way the session's own gate reads it", () => {
  expect(!needsAskingLite(MODE_FULL_AUTO, "write"));
  expect(!needsAskingLite(MODE_FULL_AUTO, "run"));
  // safe-auto is the default, and it is the one this used to get wrong: every
  // write from a subagent stopped for an approval the session would not ask.
  expect(!needsAskingLite(MODE_SAFE_AUTO, "write"));
  expect(!needsAskingLite(MODE_SAFE_AUTO, "edit"));
  expect(needsAskingLite(MODE_SAFE_AUTO, "run"));
  expect(!needsAskingLite(MODE_AUTO_EDIT, "write"));
  expect(needsAskingLite(MODE_AUTO_EDIT, "run"));
  expect(needsAskingLite(MODE_READ_ONLY, "write"));
  expect(needsAskingLite(MODE_PLAN, "write"));
});

test("a well-formed spec parses with its stages in order", () => {
  let p = parsePipelineSpec("{\"stages\":[{\"name\":\"survey\",\"tasks\":[\"look around\"],\"report\":\"\",\"steps\":0},{\"name\":\"verify\",\"tasks\":[\"check {{prior}}\"],\"report\":\"{\\\"verdict\\\":\\\"pass\\\"}\",\"steps\":5}]}");
  expect(p.ok);
  expect(p.spec.stages.length == 2);
  expect(p.spec.stages[0].name == "survey");
  expect(p.spec.stages[1].steps == 5);
});

test("a bare spec - name and tasks only - parses, and extra members are ignored", () => {
  let bare = parsePipelineSpec("{\"stages\":[{\"name\":\"a\",\"tasks\":[\"x\"]}]}");
  expect(bare.ok);
  expect(bare.spec.stages[0].report == "");
  expect(bare.spec.stages[0].steps == 0);
  let extra = parsePipelineSpec("{\"stages\":[{\"name\":\"a\",\"tasks\":[\"x\"],\"mood\":\"upbeat\",\"steps\":7}]}");
  expect(extra.ok);
  expect(extra.spec.stages[0].steps == 7);
  let braces = parsePipelineSpec("{\"stages\":[{\"name\":\"a\",\"tasks\":[\"say {\\\"hi\\\"} and ] too\"]}]}");
  expect(braces.ok);
  expect(braces.spec.stages[0].tasks[0] == "say {\"hi\"} and ] too");
});

test("what does not parse is refused with the shape it should have had", () => {
  let p = parsePipelineSpec("not json");
  expect(!p.ok);
  expect(p.fault.indexOf("stages") > 0);
});

test("an empty pipeline, a nameless stage and an empty task are each refused", () => {
  expect(!parsePipelineSpec("{\"stages\":[]}").ok);
  expect(!parsePipelineSpec("{\"stages\":[{\"name\":\" \",\"tasks\":[\"x\"],\"report\":\"\",\"steps\":0}]}").ok);
  expect(!parsePipelineSpec("{\"stages\":[{\"name\":\"a\",\"tasks\":[\" \"],\"report\":\"\",\"steps\":0}]}").ok);
  expect(!parsePipelineSpec("{\"stages\":[{\"name\":\"a\",\"tasks\":[],\"report\":\"\",\"steps\":0}]}").ok);
});

function stageJson(name: string, tasks: int): string {
  let list = "";
  let i: int = 0;
  while (i < tasks) {
    if (i > 0) { list = list + ","; }
    list = list + "\"t" + `${i}` + "\"";
    i = i + 1;
  }
  return "{\"name\":\"" + name + "\",\"tasks\":[" + list + "],\"report\":\"\",\"steps\":0}";
}

test("the caps hold: stages, tasks per stage, tasks in all", () => {
  let many = "";
  let i: int = 0;
  while (i <= MAX_PIPELINE_STAGES) {
    if (i > 0) { many = many + ","; }
    many = many + stageJson("s" + `${i}`, 1);
    i = i + 1;
  }
  expect(!parsePipelineSpec("{\"stages\":[" + many + "]}").ok);
  expect(!parsePipelineSpec("{\"stages\":[" + stageJson("wide", MAX_STAGE_TASKS + 1) + "]}").ok);
  expect(!parsePipelineSpec("{\"stages\":[" + stageJson("a", 5) + "," + stageJson("b", 5) + "," + stageJson("c", 1) + "]}").ok);
  expect(MAX_PIPELINE_TASKS == 10);
});

test("prior lands where the task asked for it, and nowhere else", () => {
  expect(fillPrior("check {{prior}} twice {{prior}}", "X") == "check X twice X");
  expect(fillPrior("no marker here", "X") == "no marker here");
});

test("joined reports name the agent each one came from", () => {
  let joined = joinReports(["agent-1", "agent-2"], ["saw A", "saw B"]);
  expect(joined.indexOf("[agent-1]\nsaw A") == 0);
  expect(joined.indexOf("[agent-2]\nsaw B") > 0);
});

test("the report is the JSON at the tail, prose before it and all", () => {
  expect(reportOf("thinking out loud... {\"verdict\":\"pass\"}") == "{\"verdict\":\"pass\"}");
  expect(reportOf("{\"a\":{\"b\":1}}") == "{\"a\":{\"b\":1}}");
  expect(reportOf("no json here") == "no json here");
});

// Closures cannot mutate what they capture, so the fake fleet is a class and
// the closures just call its methods.
class FakeFleet {
  spawned: string[];
  nextId: int;
  doneIds: string[];

  constructor() {
    this.spawned = [];
    this.nextId = 0;
    this.doneIds = [];
  }

  spawn(task: string): string {
    this.spawned.push(task);
    this.nextId = this.nextId + 1;
    return "agent-" + `${this.nextId}`;
  }

  finish(id: string): void {
    this.doneIds.push(id);
  }

  isDone(id: string): bool {
    for (const d of this.doneIds) { if (d == id) { return true; } }
    return false;
  }
}

test("a pipeline runs its stages in order and hands prior forward", () => {
  let p = parsePipelineSpec("{\"stages\":[{\"name\":\"one\",\"tasks\":[\"first\"],\"report\":\"\",\"steps\":0},{\"name\":\"two\",\"tasks\":[\"use {{prior}}\"],\"report\":\"\",\"steps\":0}]}");
  expect(p.ok);
  let pipe = new Pipeline("pipe-1", p.spec);
  let fleet = new FakeFleet();

  let spawn = (task: string, steps: int, report: string) => fleet.spawn(task);
  let agentDone = (id: string) => fleet.isDone(id);
  let agentReport = (id: string) => "report of " + id;

  expect(!pipe.poll(agentDone, agentReport, spawn));
  expect(fleet.spawned.length == 1);
  expect(fleet.spawned[0] == "first");

  expect(!pipe.poll(agentDone, agentReport, spawn));
  expect(fleet.spawned.length == 1);

  fleet.finish("agent-1");
  expect(!pipe.poll(agentDone, agentReport, spawn));
  expect(fleet.spawned.length == 2);
  expect(fleet.spawned[1] == "use [agent-1]\nreport of agent-1");

  fleet.finish("agent-2");
  expect(pipe.poll(agentDone, agentReport, spawn));
  expect(pipe.done);
  expect(pipe.summary.indexOf("report of agent-2") > 0);
});

test("a fan-out stage waits for every agent before moving on", () => {
  let p = parsePipelineSpec("{\"stages\":[{\"name\":\"fan\",\"tasks\":[\"a\",\"b\"],\"report\":\"\",\"steps\":0}]}");
  expect(p.ok);
  let pipe = new Pipeline("pipe-2", p.spec);
  let fleet = new FakeFleet();
  let spawn = (task: string, steps: int, report: string) => fleet.spawn(task);
  let agentDone = (id: string) => fleet.isDone(id);
  let agentReport = (id: string) => id + " said";

  expect(!pipe.poll(agentDone, agentReport, spawn));
  fleet.finish("agent-1");
  expect(!pipe.poll(agentDone, agentReport, spawn));
  fleet.finish("agent-2");
  expect(pipe.poll(agentDone, agentReport, spawn));
  expect(pipe.summary.indexOf("[agent-1]") == 0);
  expect(pipe.summary.indexOf("[agent-2]") > 0);
});

test("the status block marks stages done, active with agents, and pending", () => {
  let p = parsePipelineSpec("{\"stages\":[{\"name\":\"survey\",\"tasks\":[\"a\"]},{\"name\":\"verify\",\"tasks\":[\"b\"]}]}");
  expect(p.ok);
  let pipe = new Pipeline("pipe-9", p.spec);
  let fleet = new FakeFleet();
  let spawn = (task: string, steps: int, report: string) => fleet.spawn(task);
  let agentDone = (id: string) => fleet.isDone(id);
  let agentReport = (id: string) => "r";

  expect(pipe.statusBlock().indexOf("[ ] survey") > 0);

  pipe.poll(agentDone, agentReport, spawn);
  expect(pipe.stageStartedText() == "stage 1/2 (survey) started: agent-1");
  expect(pipe.statusBlock().indexOf("[>] survey agent-1") > 0);
  expect(pipe.statusBlock().indexOf("[ ] verify") > 0);

  fleet.finish("agent-1");
  pipe.poll(agentDone, agentReport, spawn);
  expect(pipe.statusBlock().indexOf("[x] survey") > 0);
  expect(pipe.statusBlock().indexOf("[>] verify agent-2") > 0);

  fleet.finish("agent-2");
  pipe.poll(agentDone, agentReport, spawn);
  expect(pipe.statusBlock().indexOf("done") > 0);
  expect(pipe.statusBlock().indexOf("[x] verify") > 0);
});

test("the step budget clamps at both ends and the directive only appears when asked", () => {
  expect(clampSteps(0) == 10);
  expect(clampSteps(-3) == 10);
  expect(clampSteps(25) == 25);
  expect(clampSteps(400) == 40);
  expect(withReportDirective("base", "") == "base");
  expect(withReportDirective("base", "{\"x\":1}").indexOf("exactly one") > 0);
  expect(looksLikeLoneJson("  {\"a\":1}  "));
  expect(!looksLikeLoneJson("prose then {\"a\":1}"));
  expect(!looksLikeLoneJson(""));
});
