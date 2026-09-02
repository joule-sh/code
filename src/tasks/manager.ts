import { Session } from "../session/session.ts";
import { ProviderConfig } from "../providers/openai.ts";
import { PROTOCOL_VERSION, TEXT_DELTA, TURN_END, REASON_DONE, TextDeltaFrame, TurnEndFrame, encodeTextDelta, encodeTurnEnd } from "../protocol/frames.ts";
import { BackgroundRunTask, SubagentTask } from "./state.ts";
import { TaskBoard, backgroundTurnId, agentTurnId, pipelineTurnId, isTaskTurnId } from "./task_board.ts";
import { configureBackgroundRun, spawnBackgroundRun } from "./background_run.ts";
import { configureSubagent, spawnSubagent } from "./subagent_worker.ts";
import { Pipeline, parsePipelineSpec, reportOf } from "./pipeline.ts";

export { backgroundTurnId, agentTurnId, isTaskTurnId };

const PIPELINE_POLL_MS: int = 400;
const PIPELINE_MAX_WAIT_MS: int = 900000;

export class TaskManager {
  root: string;
  providerCfg: ProviderConfig;
  modeProvider: () => string;
  nonce: string;
  board: TaskBoard;
  pipelines: Pipeline[];

  constructor(root: string, providerCfg: ProviderConfig, modeProvider: () => string) {
    this.root = root;
    this.providerCfg = providerCfg;
    this.modeProvider = modeProvider;
    this.nonce = `${Date.now()}`;
    this.board = new TaskBoard();
    this.pipelines = [];
  }

  startBackgroundRun(command: string): string {
    let id = this.board.freshId("bgrun-");
    let mailboxPath = "/tmp/joule-" + this.nonce + "-" + id + ".log";
    fs.writeFileSync(mailboxPath, "");
    configureBackgroundRun(command, this.root, mailboxPath);
    spawnBackgroundRun();
    this.board.registerRunTask(new BackgroundRunTask(id, command, mailboxPath));
    return "started in the background as task " + id + " - its output streams into the scrollback and /tasks as it happens; it cannot be forcibly stopped once started, only finish or /tasks cancel " + id + " to detach";
  }

  spawnOne(taskText: string, steps: int, report: string): string {
    let id = this.board.freshId("agent-");
    let outPath = "/tmp/joule-" + this.nonce + "-" + id + "-out.log";
    let inPath = "/tmp/joule-" + this.nonce + "-" + id + "-in.log";
    let cancelPath = "/tmp/joule-" + this.nonce + "-" + id + "-cancel.flag";
    fs.writeFileSync(outPath, "");
    fs.writeFileSync(inPath, "");
    let mode = this.modeProvider();
    configureSubagent(this.providerCfg.baseUrl, this.providerCfg.model, this.providerCfg.apiKey, taskText, this.root, mode, outPath, inPath, cancelPath, steps, report);
    spawnSubagent();
    this.board.registerAgentTask(new SubagentTask(id, taskText, outPath, inPath, cancelPath, mode));
    return id;
  }

  startSubagent(taskText: string, steps: int, report: string): string {
    let id = this.spawnOne(taskText, steps, report);
    let mode = this.modeProvider();
    return "spawned subagent " + id + " (mode: " + mode + ") for: " + taskText + " - it runs on its own turn loop and reports back into this conversation when it finishes; check /tasks for progress, /tasks cancel " + id + " to ask it to stop between steps";
  }

  // A stage's answer, or - when the agent said nothing - why it said nothing.
  // An agent that died on a provider error accumulated no text, and passing
  // that empty string on as the report hands the next stage nothing and tells
  // the caller nothing went wrong.
  reportFor(id: string): string {
    let said = reportOf(this.board.agentAccumulated(id));
    if (said != "") { return said; }
    let note = this.board.agentNote(id);
    if (note != "") { return "(no report) " + note; }
    return "(no report)";
  }

  // One stage transition, drawn for every client. Returns true when this
  // advance finished the pipeline.
  advancePipeline(p: Pipeline, session: Session): bool {
    let before = p.stageAt;
    let finished = p.poll(
      (id: string) => this.board.agentDone(id),
      (id: string) => this.reportFor(id),
      (task: string, steps: int, report: string) => this.spawnOne(task, steps, report));
    if (!finished && p.stageAt != before) {
      let f: TextDeltaFrame = { v: PROTOCOL_VERSION, seq: session.takeSeq(), type: TEXT_DELTA, turnId: pipelineTurnId(p.id), text: p.stageStartedText() + "\n" };
      session.emit(encodeTextDelta(f));
    }
    if (finished) {
      let ef: TurnEndFrame = { v: PROTOCOL_VERSION, seq: session.takeSeq(), type: TURN_END, turnId: pipelineTurnId(p.id), reason: REASON_DONE };
      session.emit(encodeTurnEnd(ef));
    }
    return finished;
  }

  // The pipeline runs to its end inside the call that asked for it, and its
  // consolidated report is what the call answers with. Anything else ends the
  // turn the moment the plan is accepted: the caller has nothing to say yet,
  // stops calling tools, and the stages then advance into a turn that is over
  // - which is exactly what a delegated session cannot see.
  runPipeline(args: string, session: Session): string {
    if (this.pipelines.length > 0 && !this.pipelines[this.pipelines.length - 1].done) {
      return "a pipeline is already running (" + this.pipelines[this.pipelines.length - 1].statusText() + ") - one at a time; wait for it or cancel its agents via /tasks";
    }
    let parsed = parsePipelineSpec(args);
    if (!parsed.ok) { return "run_pipeline refused: " + parsed.fault; }
    let id = this.board.freshId("pipe-");
    let p = new Pipeline(id, parsed.spec);
    this.pipelines.push(p);
    this.advancePipeline(p, session);

    let waited: int = 0;
    while (!p.done && waited < PIPELINE_MAX_WAIT_MS) {
      process.sleep(PIPELINE_POLL_MS);
      waited = waited + PIPELINE_POLL_MS;
      this.board.poll(session);
      this.advancePipeline(p, session);
    }
    if (!p.done) {
      return "pipeline " + id + " is still running after " + `${PIPELINE_MAX_WAIT_MS / 1000}`
        + "s and is no longer being waited on: " + p.statusText() + " - /tasks shows the rest";
    }
    return "pipeline " + id + " finished " + `${parsed.spec.stages.length}` + " stage(s).\n" + p.summary;
  }

  cancel(id: string): string {
    return this.board.cancel(id);
  }

  taskStatus(id: string): string {
    if (id == "") { return this.board.listText(); }
    return this.board.taskStatusText(id);
  }

  listText(): string {
    let out = this.board.listText();
    for (const p of this.pipelines) {
      out = out + "\n" + p.statusBlock();
    }
    return out;
  }

  runningTaskCount(): int {
    return this.board.runningCount();
  }

  hasPendingApproval(): bool {
    return this.board.hasPendingApproval();
  }

  activeApprovalText(): string {
    return this.board.activeApprovalText();
  }

  answerActiveApproval(decision: string): void {
    this.board.answerActiveApproval(decision);
  }

  activeApprovalTool(): string {
    return this.board.activeApprovalTool();
  }

  activeApprovalCallId(): string {
    return this.board.activeApprovalCallId();
  }

  activeApprovalSelected(): int {
    return this.board.activeApprovalSelected();
  }

  activeApprovalHasOptionRows(): bool {
    return this.board.activeApprovalHasOptionRows();
  }

  activeApprovalOptionRows(): int {
    return this.board.activeApprovalOptionRows();
  }

  moveActiveApprovalSelection(delta: int, count: int): bool {
    return this.board.moveActiveApprovalSelection(delta, count);
  }

  setLatestApprovalOptionRows(first: int): void {
    this.board.setLatestApprovalOptionRows(first);
  }

  // A pipeline normally finishes inside runPipeline. This keeps advancing one
  // that outlived its call, so a pipeline abandoned at the wait cap still
  // reaches its end and still reports.
  poll(session: Session): void {
    this.board.poll(session);
    for (const p of this.pipelines) {
      if (p.done) { continue; }
      if (this.advancePipeline(p, session)) {
        session.note("[pipeline " + p.id + " finished]\n" + p.summary);
      }
    }
  }
}
