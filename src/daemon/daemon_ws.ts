import { Peer, send, serveWebSocket } from "../vendor/websocket/server.ts";
import { RESUME, decodeResume, frameType } from "../protocol/frames.ts";
import { Session } from "../session/session.ts";
import { Gate } from "../approval/gate.ts";
import { RelayInputBridge, dispatchInboundFrame } from "../terminal/relay_bridge.ts";
import { DaemonStore } from "./daemon_store.ts";

// A single statement (closure capture, struct literal, or a function call's
// argument list -- all three reproduce it) that references four distinct
// class-typed values at once fails native codegen with "ambiguous reference"
// / "the native backend rejected this statement's generated code". Nesting
// two pairs so no one statement ever names more than two class instances at
// once avoids it. This is that workaround, not a design preference -- see
// docs/03-daemon-spike.md for the minimal repro filed upstream.
export type StorePair = { store: DaemonStore, session: Session };
export type GatePair = { gate: Gate, bridge: RelayInputBridge };
export type DaemonContext = { sp: StorePair, gp: GatePair };

export function makeDaemonContext(store: DaemonStore, session: Session, gate: Gate, bridge: RelayInputBridge): DaemonContext {
  let sp: StorePair = { store: store, session: session };
  let gp: GatePair = { gate: gate, bridge: bridge };
  let ctx: DaemonContext = { sp: sp, gp: gp };
  return ctx;
}

function registerOnResume(ctx: DaemonContext, peer: Peer, message: string): void {
  let resume = decodeResume(message);
  let since = -1;
  if (resume != null) { since = resume.since; }
  ctx.sp.store.registerPeer(peer);
  let outcome = ctx.sp.store.ring.replaySince(since);
  if (!outcome.ok) { return; }
  for (const f of outcome.frames) {
    send(peer, f);
  }
}

function dispatchOne(ctx: DaemonContext, message: string): void {
  dispatchInboundFrame(ctx.sp.session, ctx.gp.gate, ctx.gp.bridge, message);
}

export function makeDaemonOnMessage(ctx: DaemonContext): (peer: Peer, message: string) => void {
  return (peer: Peer, message: string) => {
    let t = frameType(message);
    if (t == RESUME) {
      registerOnResume(ctx, peer, message);
      return;
    }
    dispatchOne(ctx, message);
  };
}

function daemonOnClose(peer: Peer, graceful: bool): void {
  if (peer.path == "" && graceful) { return; }
}

export function runDaemonWebSocket(port: int, ctx: DaemonContext): void {
  serveWebSocket(port, makeDaemonOnMessage(ctx), daemonOnClose);
}
