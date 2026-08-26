import { Scrollback } from "./scrollback.ts";
import { InputLine, PendingUpdateOffer, UPDATE_OFFER_OPTION_COUNT, UPDATE_OFFER_ACCEPT } from "./input_state.ts";
import { TurnStatusTracker, drawScreen } from "./screen.ts";
import { styleBanner } from "./style.ts";
import { updateOfferOptionsBlock } from "./renderer.ts";
import { maybeStartUpdateCheck } from "../update/startup.ts";
import { UpdateNotifier } from "../update/notifier.ts";

export function startUpdateNotifier(): UpdateNotifier {
  return maybeStartUpdateCheck(`${Date.now()}`);
}

export function pollUpdateNotice(notifier: UpdateNotifier, offer: PendingUpdateOffer, sb: Scrollback, input: InputLine, mode: string, rk: TurnStatusTracker): void {
  let notice = notifier.poll();
  if (notice == "") { return; }
  sb.append("\n" + styleBanner(notice));
  sb.appendFixed(updateOfferOptionsBlock(UPDATE_OFFER_ACCEPT));
  offer.open(notifier.latestVersion);
  offer.setOptionRows(sb.lineCount() - UPDATE_OFFER_OPTION_COUNT);
  drawScreen(sb, input, mode, rk);
}
