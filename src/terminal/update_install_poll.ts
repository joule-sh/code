import { Scrollback } from "./scrollback.ts";
import { InputLine } from "./input_state.ts";
import { TurnStatusTracker, drawScreen } from "./screen.ts";
import { styleBanner } from "./style.ts";
import { PendingUpdateInstall } from "./update_offer.ts";
import { TAG_INSTALLED } from "../update/install_worker.ts";
import { reapDaemonForUpdate } from "../daemon/attach_lifecycle.ts";
import { workspaceRoot } from "../vendor/platform/platform.ts";

export function pollUpdateInstall(install: PendingUpdateInstall, sb: Scrollback, input: InputLine, mode: string, rk: TurnStatusTracker): void {
  let msg = install.poll();
  if (msg == "") { return; }
  sb.append("\n" + styleBanner(msg));
  if (install.lastKind == TAG_INSTALLED) {
    sb.append("\n" + styleBanner("joule: " + reapDaemonForUpdate(workspaceRoot())));
  }
  drawScreen(sb, input, mode, rk);
}
