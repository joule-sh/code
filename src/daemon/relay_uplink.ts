import { Session } from "../session/session.ts";
import { Gate } from "../approval/gate.ts";
import { RelayClient } from "../relay/client.ts";
import { isDownstreamAllowed, webUrlFor } from "../relay/client_logic.ts";
import { RelayInputBridge, dispatchInboundFrame } from "../terminal/relay_bridge.ts";
import { frameType } from "../protocol/frames.ts";
import { MailboxReader } from "../tasks/mailbox.ts";
import { newBroadcastReader, BROADCAST_TAG_FRAME } from "./broadcast.ts";
import { ShareController, ShareResult } from "./share_controller.ts";

export class RelayUplink {
  relay: RelayClient;
  reader: MailboxReader;

  constructor(host: string, httpPort: int, wsPort: int, webBaseUrl: string, tmpDir: string, runtimeDir: string, credentialSecret: string) {
    this.relay = new RelayClient(host, httpPort, wsPort, webBaseUrl, tmpDir);
    this.relay.credentialSecret = credentialSecret;
    this.reader = newBroadcastReader(runtimeDir);
  }

  ensureStarted(workspaceRoot: string, model: string): ShareResult {
    if (this.relay.isAttached()) {
      let already: ShareResult = { ok: true, code: this.relay.code, url: webUrlFor(this.relay.webBaseUrl, this.relay.code), error: "" };
      return already;
    }
    let result = this.relay.connect(workspaceRoot, model);
    if (!result.ok) {
      let failed: ShareResult = { ok: false, code: "", url: "", error: result.error };
      return failed;
    }
    let ok: ShareResult = { ok: true, code: result.code, url: result.url, error: "" };
    return ok;
  }

  tick(session: Session, gate: Gate, bridge: RelayInputBridge): void {
    if (!this.relay.isAttached()) { return; }

    let entries = this.reader.drainNew();
    for (const e of entries) {
      if (e.tag == BROADCAST_TAG_FRAME) { this.relay.publish(e.payload); }
    }

    let frames = this.relay.pollInbound();
    for (const f of frames) {
      if (isDownstreamAllowed(frameType(f))) { dispatchInboundFrame(session, gate, bridge, f); }
    }

    this.relay.drainDiagnostics();
  }

  asShareController(): ShareController {
    return {
      ensureStarted: (workspaceRoot: string, model: string) => this.ensureStarted(workspaceRoot, model),
      tick: (session: Session, gate: Gate, bridge: RelayInputBridge) => this.tick(session, gate, bridge),
    };
  }
}
