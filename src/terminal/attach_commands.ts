import { PROTOCOL_VERSION, MODE_SET, MODEL_SET, TASKS_REQUEST, SHARE_REQUEST, encodeModeSet, encodeModelSet, encodeTasksRequest, encodeShareRequest } from "../protocol/frames.ts";
import { InputLine, PendingSessionPick } from "./input_state.ts";
import { sessionDisplayName, openSessionPick, pickableSessions } from "./session_switch.ts";
import { renameTargetCheck } from "./session_rename.ts";
import { Scrollback } from "./scrollback.ts";
import { TurnStatusTracker, drawScreen } from "./screen.ts";
import { ApprovalLog } from "./attach_approval.ts";
import { ClientState, CommandOutcome } from "./attach_state.ts";
import { DaemonClient } from "../daemon/attach_client.ts";
import { runningSessionsFor } from "../daemon/attach_lifecycle.ts";
import { runSkillCommand } from "./skills_ui.ts";
import { ParsedCommand, helpText, CMD_HELP, CMD_MODEL, CMD_MODE, CMD_SESSION, CMD_RENAME, CMD_SHARE, CMD_LOGIN, CMD_LOGOUT, CMD_CAT, CMD_TASKS, CMD_MEMORY, CMD_SKILLS, CMD_MOUSE, CMD_COLOR, CMD_CLEAR, CMD_EXIT } from "./commands.ts";
import { runColorCommand } from "./color_ui.ts";
import { catText } from "./cat.ts";
import { SignIn, beginSignIn, logoutText } from "./login_ui.ts";
import { memoryCommandText } from "./memory_ui.ts";
import { ServerOrigin } from "../auth/server.ts";
import { MouseReporting, runMouseCommand } from "./mouse_reporting.ts";
import { applyMouseState } from "./mouse_select.ts";

export function attachHelpText(): string {
  return helpText()
    + "\n/stop-daemon    ask this workspace's daemon to stop (any attached client may; it takes effect once any in-flight turn finishes, see docs/03-daemon.md)";
}

export class CommandDeps {
  sb: Scrollback;
  input: InputLine;
  rk: TurnStatusTracker;
  approvalLog: ApprovalLog;
  state: ClientState;
  client: DaemonClient;
  mouse: MouseReporting;
  signin: SignIn;
  sessionPick: PendingSessionPick;
  serverBase: ServerOrigin;
  workspaceRoot: string;
  sessionName: string;

  constructor(sb: Scrollback, input: InputLine, rk: TurnStatusTracker, approvalLog: ApprovalLog, state: ClientState, client: DaemonClient, mouse: MouseReporting, signin: SignIn, sessionPick: PendingSessionPick, serverBase: ServerOrigin, workspaceRoot: string, sessionName: string) {
    this.sb = sb;
    this.input = input;
    this.rk = rk;
    this.approvalLog = approvalLog;
    this.state = state;
    this.client = client;
    this.mouse = mouse;
    this.signin = signin;
    this.sessionPick = sessionPick;
    this.serverBase = serverBase;
    this.workspaceRoot = workspaceRoot;
    this.sessionName = sessionName;
  }

  paint(): void {
    drawScreen(this.sb, this.input, this.approvalLog.mode, this.rk);
  }
}

function handleModel(d: CommandDeps, arg: string): void {
  if (arg == "") {
    d.sb.append("\nmodel: " + d.state.model);
  } else {
    d.client.publish(encodeModelSet({ v: PROTOCOL_VERSION, seq: 0, type: MODEL_SET, model: arg }));
  }
}

function handleSession(d: CommandDeps, arg: string, out: CommandOutcome): void {
  if (arg == "") {
    let names = pickableSessions(d.workspaceRoot, d.sessionName);
    if (names.length <= 1) {
      d.sb.append("\nsession: " + sessionDisplayName(d.sessionName));
    } else {
      openSessionPick(d.sessionPick, d.sb, names, d.sessionName);
    }
    return;
  }
  if (arg == d.sessionName) {
    d.sb.append("\nalready in the " + sessionDisplayName(d.sessionName) + " session");
    return;
  }
  out.leaveFor(arg);
}

function handleRename(d: CommandDeps, arg: string, out: CommandOutcome): void {
  let check = renameTargetCheck(d.workspaceRoot, arg, d.sessionName, runningSessionsFor(d.workspaceRoot));
  if (!check.ok) {
    d.sb.append(check.error);
    return;
  }
  out.renameTo(arg.trim());
}

export function runAttachCommand(d: CommandDeps, cmd: ParsedCommand, setMode: (m: string) => void, sendInput: (t: string) => void): CommandOutcome {
  let out = new CommandOutcome();

  if (cmd.kind == CMD_HELP) { d.sb.append("\n" + attachHelpText()); d.paint(); return out; }

  if (cmd.kind == CMD_SKILLS) {
    let skillInput = runSkillCommand(d.workspaceRoot, cmd.arg, d.sb);
    d.paint();
    if (skillInput != "") { sendInput(skillInput); }
    return out;
  }

  if (cmd.kind == CMD_MODEL) { handleModel(d, cmd.arg); d.paint(); return out; }

  if (cmd.kind == CMD_MODE) {
    if (cmd.arg == "") { d.sb.append("\nmode: " + d.approvalLog.mode); } else { setMode(cmd.arg); }
    d.paint();
    return out;
  }

  if (cmd.kind == CMD_SESSION) {
    handleSession(d, cmd.arg, out);
    if (!out.leave) { d.paint(); }
    return out;
  }

  if (cmd.kind == CMD_RENAME) {
    handleRename(d, cmd.arg, out);
    if (!out.leave) { d.paint(); }
    return out;
  }

  if (cmd.kind == CMD_SHARE) {
    d.client.publish(encodeShareRequest({ v: PROTOCOL_VERSION, seq: 0, type: SHARE_REQUEST }));
    d.sb.append("\nasking the daemon to share this session over the relay");
    d.paint();
    return out;
  }

  if (cmd.kind == CMD_LOGIN) { beginSignIn(d.sb, d.input, d.signin, d.serverBase, cmd.arg); d.paint(); return out; }

  if (cmd.kind == CMD_LOGOUT) { d.sb.append(logoutText(d.serverBase.base, cmd.arg)); d.paint(); return out; }

  if (cmd.kind == CMD_CAT) { d.sb.append(catText(d.workspaceRoot, cmd.arg)); d.paint(); return out; }

  if (cmd.kind == CMD_MEMORY) { d.sb.append(memoryCommandText(cmd.arg)); d.paint(); return out; }

  if (cmd.kind == CMD_MOUSE) {
    d.sb.append(runMouseCommand(d.mouse, cmd.arg));
    applyMouseState(d.sb, d.mouse.on);
    d.paint();
    return out;
  }

  if (cmd.kind == CMD_COLOR) { d.sb.append(runColorCommand(cmd.arg)); d.paint(); return out; }

  if (cmd.kind == CMD_TASKS) {
    d.client.publish(encodeTasksRequest({ v: PROTOCOL_VERSION, seq: 0, type: TASKS_REQUEST, arg: cmd.arg }));
    d.paint();
    return out;
  }

  if (cmd.kind == CMD_CLEAR) { d.sb.clear(); d.paint(); return out; }

  if (cmd.kind == CMD_EXIT) { out.leave = true; return out; }

  d.sb.append("\nunknown command: /" + cmd.arg);
  d.paint();
  return out;
}

test("the attach help text keeps the shared commands and adds the daemon-only one", () => {
  let text = attachHelpText();
  expect(text.includes("/stop-daemon"));
  expect(text.includes("/session"));
});
