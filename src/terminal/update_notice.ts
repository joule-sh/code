import { Scrollback } from "./scrollback.ts";
import { InputLine } from "./input_state.ts";
import { TurnStatusTracker, drawScreen } from "./screen.ts";
import { styleBanner } from "./style.ts";
import { maybeStartUpdateCheck } from "../update/startup.ts";
import { UpdateNotifier } from "../update/notifier.ts";

export function startUpdateNotifier(): UpdateNotifier {
  return maybeStartUpdateCheck(`${Date.now()}`);
}

export function pollUpdateNotice(notifier: UpdateNotifier, sb: Scrollback, input: InputLine, mode: string, rk: TurnStatusTracker): void {
  let notice = notifier.poll();
  if (notice == "") { return; }
  sb.append("\n" + styleBanner(notice));
  drawScreen(sb, input, mode, rk);
}
