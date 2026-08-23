import { Session } from "../session/session.ts";
import { LiveProvider } from "../providers/live.ts";
import { PROTOCOL_VERSION, modelSetFrameModel, MODEL_CHANGED, ModelChangedFrame, encodeModelChanged } from "../protocol/frames.ts";

export function handleModelSet(session: Session, live: LiveProvider, frameJson: string): void {
  let model = modelSetFrameModel(frameJson);
  if (model == "") { return; }
  live.cfg = { baseUrl: live.cfg.baseUrl, model: model, apiKey: live.cfg.apiKey };
  let changed: ModelChangedFrame = { v: PROTOCOL_VERSION, seq: session.takeSeq(), type: MODEL_CHANGED, model: model };
  session.emit(encodeModelChanged(changed));
}
