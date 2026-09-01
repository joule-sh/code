import { Session } from "../session/session.ts";
import { ProviderConfig } from "../providers/openai.ts";
import { PROTOCOL_VERSION, TEXT_DELTA, TURN_END, REASON_DONE, TextDeltaFrame, TurnEndFrame, encodeTextDelta, encodeTurnEnd } from "../protocol/frames.ts";
import { BackgroundRunTask, SubagentTask } from "./state.ts";
import { TaskBoard, backgroundTurnId, agentTurnId, pipelineTurnId, isTaskTurnId } from "./task_board.ts";
import { configureBackgroundRun, spawnBackgroundRun } from "./background_run.ts";
import { configureSubagent, spawnSubagent } from "./subagent_worker.ts";
import { Pipeline, parsePipelineSpec, reportOf } from "./pipeline.ts";

export { backgroundTurnId, agentTurnId, isTaskTurnId };

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

  startPipeline(args: string): string {
    if (this.pipelines.length > 0 && !this.pipelines[this.pipelines.length - 1].done) {
      return "a pipeline is already running (" + this.pipelines[this.pipelines.length - 1].statusText() + ") - one at a time; wait for it or cancel its agents via /tasks";
    }
    let parsed = parsePipelineSpec(args);
    if (!parsed.ok) { return "run_pipeline refused: " + parsed.fault; }
    let id = this.board.freshId("pipe-");
    let p = new Pipeline(id, parsed.spec);
    this.pipelines.push(p);
    return "pipeline " + id + " started with " + `${parsed.spec.stages.length}` + " stage(s) - stages advance on their own as agents finish, and the final reports land in this conversation; /tasks shows progress";
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

  poll(session: Session): void {
    this.board.poll(session);
    for (const p of this.pipelines) {
      if (p.done) { continue; }
      let before = p.stageAt;
      let finished = p.poll(
        (id: string) => this.board.agentDone(id),
        (id: string) => reportOf(this.board.agentAccumulated(id)),
        (task: string, steps: int, report: string) => this.spawnOne(task, steps, report));
      // Stage transitions render in every client - the terminal tags the
      // lines, the console builds its pipeline card from them - so they go
      // out as frames on the pipeline's own turn, not into model history.
      if (!finished && p.stageAt != before) {
        let f: TextDeltaFrame = { v: PROTOCOL_VERSION, seq: session.takeSeq(), type: TEXT_DELTA, turnId: pipelineTurnId(p.id), text: p.stageStartedText() + "\n" };
        session.emit(encodeTextDelta(f));
      }
      if (finished) {
        let ef: TurnEndFrame = { v: PROTOCOL_VERSION, seq: session.takeSeq(), type: TURN_END, turnId: pipelineTurnId(p.id), reason: REASON_DONE };
        session.emit(encodeTurnEnd(ef));
        session.note("[pipeline " + p.id + " finished]\n" + p.summary);
      }
    }
  }
}
