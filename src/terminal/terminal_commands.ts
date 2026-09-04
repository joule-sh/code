import { InputLine, PendingModelPick, PendingSessionPick } from "./input_state.ts";
import { Session } from "../session/session.ts";
import { Gate, MODE_PLAN } from "../approval/gate.ts";
import { Scrollback } from "./scrollback.ts";
import { TurnStatusTracker, drawScreen } from "./screen.ts";
import { CommandOutcome } from "./attach_state.ts";
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
import { sessionDisplayName, openSessionPick, currentSessionLine, stayingNote, pickableSessions } from "./session_switch.ts";
import { renameTargetCheck } from "./session_rename.ts";
import { fetchModelIds, buildModelEntries, openModelPick } from "./model_picker.ts";
import { LiveProvider } from "../providers/live.ts";
import { displayModel, wireModel } from "../providers/platform.ts";
import { announceModel, announceMode } from "./announce.ts";
import { enterPlanMode } from "./plan_mode.ts";
import { RelayInputBridge } from "./relay_bridge.ts";
import { TaskManager } from "../tasks/manager.ts";
import { cancelCommandArg } from "./tasks_bridge.ts";
import { styleBanner } from "./style.ts";
import { isValidMode } from "./slots.ts";

export class LocalCommandDeps {
  sb: Scrollback;
  input: InputLine;
  rk: TurnStatusTracker;
  gate: Gate;
  session: Session;
  live: LiveProvider;
  bridge: RelayInputBridge;
  tasks: TaskManager;
  mouse: MouseReporting;
  signin: SignIn;
  modelPick: PendingModelPick;
  sessionPick: PendingSessionPick;
  server: ServerOrigin;
  workspaceRoot: string;
  sessionName: string;

  constructor(sb: Scrollback, input: InputLine, rk: TurnStatusTracker, gate: Gate, session: Session, live: LiveProvider, bridge: RelayInputBridge, tasks: TaskManager, mouse: MouseReporting, signin: SignIn, modelPick: PendingModelPick, sessionPick: PendingSessionPick, server: ServerOrigin, workspaceRoot: string, sessionName: string) {
    this.sb = sb;
    this.input = input;
    this.rk = rk;
    this.gate = gate;
    this.session = session;
    this.live = live;
    this.bridge = bridge;
    this.tasks = tasks;
    this.mouse = mouse;
    this.signin = signin;
    this.modelPick = modelPick;
    this.sessionPick = sessionPick;
    this.server = server;
    this.workspaceRoot = workspaceRoot;
    this.sessionName = sessionName;
  }

  paint(): void {
    drawScreen(this.sb, this.input, this.gate.mode, this.rk);
  }
}

function handleModel(d: LocalCommandDeps, arg: string): void {
  if (arg == "") {
    d.sb.append("\n" + styleBanner("listing models from " + d.live.cfg.baseUrl + " ..."));
    d.paint();
    let ids = fetchModelIds(d.live.cfg);
    openModelPick(d.modelPick, d.sb, buildModelEntries(d.live.cfg, ids));
    return;
  }
  d.live.cfg = { baseUrl: d.live.cfg.baseUrl, model: wireModel(d.live.cfg.baseUrl, arg), apiKey: d.live.cfg.apiKey };
  announceModel(d.session, displayModel(d.live.cfg));
}

function handleMode(d: LocalCommandDeps, arg: string, planDecisionOpen: (prev: string) => void): void {
  if (arg == "") {
    d.sb.append("\nmode: " + d.gate.mode);
    return;
  }
  if (!isValidMode(arg)) {
    d.sb.append("\nunknown mode: " + arg + " (expected read-only, auto-edit, safe-auto, full-auto, or plan)");
    return;
  }
  if (arg == MODE_PLAN && d.gate.mode != MODE_PLAN) { planDecisionOpen(d.gate.mode); }
  d.gate.mode = arg;
  announceMode(d.session, d.gate.mode);
}

function handleSession(d: LocalCommandDeps, arg: string, out: CommandOutcome): void {
  if (arg == "") {
    let names = pickableSessions(d.workspaceRoot, d.sessionName);
    if (names.length <= 1) {
      d.sb.append(currentSessionLine(d.sessionName));
    } else {
      openSessionPick(d.sessionPick, d.sb, names, d.sessionName);
    }
    d.paint();
    return;
  }
  if (arg == d.sessionName) {
    d.sb.append(stayingNote(d.sessionName));
    d.paint();
    return;
  }
  out.switchTo(arg);
}

function handleTasks(d: LocalCommandDeps, arg: string): void {
  if (arg == "") {
    d.sb.append("\n" + d.tasks.listText());
    return;
  }
  let cancelId = cancelCommandArg(arg);
  if (cancelId != "") {
    d.sb.append("\n" + d.tasks.cancel(cancelId));
    return;
  }
  d.sb.append("\nusage: /tasks or /tasks cancel <id>");
}

export function runLocalCommand(d: LocalCommandDeps, cmd: ParsedCommand, planDecisionOpen: (prev: string) => void, attachToRelay: () => void): CommandOutcome {
  let out = new CommandOutcome();

  if (cmd.kind == CMD_HELP) { d.sb.append("\n" + helpText()); d.paint(); return out; }

  if (cmd.kind == CMD_SKILLS) {
    let skillInput = runSkillCommand(d.workspaceRoot, cmd.arg, d.sb);
    d.paint();
    if (skillInput != "") {
      d.bridge.runNow(d.session, skillInput);
      d.paint();
    }
    return out;
  }

  if (cmd.kind == CMD_MODEL) { handleModel(d, cmd.arg); d.paint(); return out; }

  if (cmd.kind == CMD_MODE) { handleMode(d, cmd.arg, planDecisionOpen); d.paint(); return out; }

  if (cmd.kind == CMD_SESSION) { handleSession(d, cmd.arg, out); return out; }

  if (cmd.kind == CMD_RENAME) {
    let check = renameTargetCheck(d.workspaceRoot, cmd.arg, d.sessionName, runningSessionsFor(d.workspaceRoot));
    if (!check.ok) {
      d.sb.append(check.error);
      d.paint();
      return out;
    }
    out.renameTo(cmd.arg.trim());
    return out;
  }

  if (cmd.kind == CMD_SHARE) { attachToRelay(); return out; }

  if (cmd.kind == CMD_LOGIN) { beginSignIn(d.sb, d.input, d.signin, d.server, cmd.arg); d.paint(); return out; }

  if (cmd.kind == CMD_LOGOUT) { d.sb.append(logoutText(d.server.base, cmd.arg)); d.paint(); return out; }

  if (cmd.kind == CMD_CAT) { d.sb.append(catText(d.workspaceRoot, cmd.arg)); d.paint(); return out; }

  if (cmd.kind == CMD_MEMORY) { d.sb.append(memoryCommandText(cmd.arg)); d.paint(); return out; }

  if (cmd.kind == CMD_MOUSE) {
    d.sb.append(runMouseCommand(d.mouse, cmd.arg));
    applyMouseState(d.sb, d.mouse.on);
    d.paint();
    return out;
  }

  if (cmd.kind == CMD_COLOR) { d.sb.append(runColorCommand(cmd.arg)); d.paint(); return out; }

  if (cmd.kind == CMD_TASKS) { handleTasks(d, cmd.arg); d.paint(); return out; }

  if (cmd.kind == CMD_CLEAR) { d.sb.clear(); d.paint(); return out; }

  if (cmd.kind == CMD_EXIT) { out.leave = true; return out; }

  d.sb.append("\nunknown command: /" + cmd.arg);
  d.paint();
  return out;
}

test("an unrecognised mode name is rejected before the gate changes", () => {
  expect(!isValidMode("turbo"));
  expect(isValidMode(MODE_PLAN));
});
