import { Session } from "../session/session.ts";
import { ProviderConfig } from "../providers/openai.ts";
import { BackgroundRunTask, SubagentTask } from "./state.ts";
import { TaskBoard, backgroundTurnId, agentTurnId, isTaskTurnId } from "./task_board.ts";
import { configureBackgroundRun, spawnBackgroundRun } from "./background_run.ts";
import { configureSubagent, spawnSubagent } from "./subagent_worker.ts";

export { backgroundTurnId, agentTurnId, isTaskTurnId };

export class TaskManager {
  root: string;
  providerCfg: ProviderConfig;
  modeProvider: () => string;
  nonce: string;
  board: TaskBoard;

  constructor(root: string, providerCfg: ProviderConfig, modeProvider: () => string) {
    this.root = root;
    this.providerCfg = providerCfg;
    this.modeProvider = modeProvider;
    this.nonce = `${Date.now()}`;
    this.board = new TaskBoard();
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

  startSubagent(taskText: string): string {
    let id = this.board.freshId("agent-");
    let outPath = "/tmp/joule-" + this.nonce + "-" + id + "-out.log";
    let inPath = "/tmp/joule-" + this.nonce + "-" + id + "-in.log";
    let cancelPath = "/tmp/joule-" + this.nonce + "-" + id + "-cancel.flag";
    fs.writeFileSync(outPath, "");
    fs.writeFileSync(inPath, "");
    let mode = this.modeProvider();
    configureSubagent(this.providerCfg.baseUrl, this.providerCfg.model, this.providerCfg.apiKey, taskText, this.root, mode, outPath, inPath, cancelPath);
    spawnSubagent();
    this.board.registerAgentTask(new SubagentTask(id, taskText, outPath, inPath, cancelPath, mode));
    return "spawned subagent " + id + " (mode: " + mode + ") for: " + taskText + " - it runs on its own turn loop and reports back into this conversation when it finishes; check /tasks for progress, /tasks cancel " + id + " to ask it to stop between steps";
  }

  cancel(id: string): string {
    return this.board.cancel(id);
  }

  taskStatus(id: string): string {
    if (id == "") { return this.board.listText(); }
    return this.board.taskStatusText(id);
  }

  listText(): string {
    return this.board.listText();
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
  }
}
