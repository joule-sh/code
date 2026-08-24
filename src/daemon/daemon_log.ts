import { frameType, frameSeq } from "../protocol/frames.ts";

export function shortConnId(connId: string): string {
  if (connId.length <= 8) { return connId; }
  return connId.slice(0, 8);
}

export function describeFrame(frameJson: string): string {
  let t = frameType(frameJson);
  if (t == "") { t = "unrecognised"; }
  let seq = frameSeq(frameJson);
  if (seq <= 0) { return t; }
  return t + " seq " + `${seq}`;
}

export function logDaemon(line: string): void {
  console.log("joule-daemon: " + line);
}

export function logReceived(connId: string, frameJson: string): void {
  logDaemon("received " + describeFrame(frameJson) + " from " + shortConnId(connId));
}

export function logDispatched(frameJson: string): void {
  logDaemon("dispatching " + describeFrame(frameJson));
}

export function logUndeliverable(connId: string, frameJson: string, reason: string): void {
  logDaemon("dropped " + describeFrame(frameJson) + " from " + shortConnId(connId) + ": " + reason);
}
