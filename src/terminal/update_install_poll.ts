import { Scrollback } from "./scrollback.ts";
import { InputLine } from "./input_state.ts";
import { TurnStatusTracker, drawScreen } from "./screen.ts";
import { styleBanner } from "./style.ts";
import { PendingUpdateInstall } from "./update_offer.ts";

export function pollUpdateInstall(install: PendingUpdateInstall, sb: Scrollback, input: InputLine, mode: string, rk: TurnStatusTracker): void {
  let msg = install.poll();
  if (msg == "") { return; }
  sb.append("\n" + styleBanner(msg));
  drawScreen(sb, input, mode, rk);
}
