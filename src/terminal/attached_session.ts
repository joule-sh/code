import { PendingApproval, PendingPlanDecision, InputLine } from "./input_state.ts";
import { TurnStatusTracker } from "./screen.ts";
import { ApprovalLog } from "./attach_approval.ts";
import { ClientState } from "./attach_state.ts";
import { TaggedTurns } from "./tasks_bridge.ts";
import { PlanOfferTracker } from "./attach_plan.ts";
import { TurnWatchdog } from "./attach_watchdog.ts";
import { LocalPrompts } from "./attach_echo.ts";
import { DaemonClient } from "../daemon/attach_client.ts";
import { AttachResult, ensureAttached, attachedMode, attachedModel } from "../daemon/attach_lifecycle.ts";
import { Drafts } from "./drafts.ts";
import { sessionDisplayName } from "./session_switch.ts";

export class AttachedSession {
  name: string;
  client: DaemonClient;
  port: int;
  notes: string[];
  approvalLog: ApprovalLog;
  state: ClientState;
  watchdog: TurnWatchdog;
  echoes: LocalPrompts;
  pendingApproval: PendingApproval;
  planPending: PendingPlanDecision;
  planTracker: PlanOfferTracker;
  tagged: TaggedTurns;
  rk: TurnStatusTracker;

  constructor(name: string, result: AttachResult, fallbackMode: string, fallbackModel: string) {
    this.name = name;
    this.client = result.client;
    this.port = result.port;
    this.notes = result.notes;
    this.approvalLog = new ApprovalLog(attachedMode(result.pending, fallbackMode));
    this.state = new ClientState(attachedModel(result.pending, fallbackModel));
    this.watchdog = new TurnWatchdog(result.port);
    this.echoes = new LocalPrompts();
    this.pendingApproval = new PendingApproval();
    this.planPending = new PendingPlanDecision();
    this.planTracker = new PlanOfferTracker();
    this.tagged = new TaggedTurns();
    this.rk = new TurnStatusTracker();
  }

  adopt(name: string, result: AttachResult, fallbackMode: string, fallbackModel: string): void {
    this.name = name;
    this.client = result.client;
    this.port = result.port;
    this.notes = result.notes;
    this.approvalLog = new ApprovalLog(attachedMode(result.pending, fallbackMode));
    this.state = new ClientState(attachedModel(result.pending, fallbackModel));
    this.watchdog = new TurnWatchdog(result.port);
    this.echoes = new LocalPrompts();
    this.pendingApproval = new PendingApproval();
    this.planPending = new PendingPlanDecision();
    this.planTracker = new PlanOfferTracker();
    this.tagged = new TaggedTurns();
    this.rk = new TurnStatusTracker();
  }

  mode(): string {
    return this.approvalLog.mode;
  }

  displayName(): string {
    return sessionDisplayName(this.name);
  }
}

export class SwitchResult {
  ok: bool;
  replay: string[];
  notes: string[];

  constructor(ok: bool, replay: string[], notes: string[]) {
    this.ok = ok;
    this.replay = replay;
    this.notes = notes;
  }
}

export function switchFailureNote(target: string, notes: string[]): string[] {
  let lines: string[] = [];
  for (const n of notes) { lines.push(n); }
  lines.push("could not enter the " + sessionDisplayName(target) + " session - staying in this one");
  return lines;
}

export function switchSession(sess: AttachedSession, workspaceRoot: string, target: string, drafts: Drafts, input: InputLine): SwitchResult {
  let result = ensureAttached(workspaceRoot, target, true);
  if (!result.client.socketReady) {
    result.client.detach();
    return new SwitchResult(false, [], switchFailureNote(target, result.notes));
  }

  drafts.save(sess.name, input.buf);
  let leaving = sess.client;
  let fallbackMode = sess.approvalLog.mode;
  let fallbackModel = sess.state.model;
  sess.adopt(target, result, fallbackMode, fallbackModel);
  leaving.detach();
  input.setBuf(drafts.load(target));

  return new SwitchResult(true, result.pending, result.notes);
}

test("a failed switch says which session could not be entered and that we stayed", () => {
  let lines = switchFailureNote("review", ["port 8300 answers for another workspace"]);
  expect(lines.length == 2);
  expect(lines[0] == "port 8300 answers for another workspace");
  expect(lines[1].includes("review"));
  expect(lines[1].includes("staying in this one"));
});

test("the default session reads as default in a failure note, never as blank", () => {
  let lines = switchFailureNote("", []);
  expect(lines[0].includes("default"));
});

test("a switch result carries its replay only when it succeeded", () => {
  let good = new SwitchResult(true, ["{}"], []);
  let bad = new SwitchResult(false, [], ["why not"]);
  expect(good.ok);
  expect(good.replay.length == 1);
  expect(!bad.ok);
  expect(bad.replay.length == 0);
});
