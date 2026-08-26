import { Session } from "../session/session.ts";
import { LiveProvider } from "../providers/live.ts";
import { qualifiedModel, wireModel } from "../providers/platform.ts";
import { PROTOCOL_VERSION, modelSetFrameModel, MODEL_CHANGED, ModelChangedFrame, encodeModelChanged } from "../protocol/frames.ts";

export function handleModelSet(session: Session, live: LiveProvider, frameJson: string): void {
  let chosen = modelSetFrameModel(frameJson);
  if (chosen == "") { return; }
  let model = wireModel(live.cfg.baseUrl, chosen);
  live.cfg = { baseUrl: live.cfg.baseUrl, model: model, apiKey: live.cfg.apiKey };
  let shown = qualifiedModel(live.cfg.baseUrl, model);
  let changed: ModelChangedFrame = { v: PROTOCOL_VERSION, seq: session.takeSeq(), type: MODEL_CHANGED, model: shown };
  session.emit(encodeModelChanged(changed));
}
