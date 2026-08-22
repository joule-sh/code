// Deliberately the naive shape: one Session, N attached peers, all touched
// directly from whichever thread net.createServer dispatches a connection's
// handler to. This is what #139's spike exists to test, not a design already
// believed safe -- see docs/03-daemon-spike.md for what running this under
// concurrent clients actually showed.

import { Peer, send } from "../vendor/websocket/server.ts";
import { Ring } from "../relay/store.ts";

export const DAEMON_RING_CAPACITY: int = 500;

export type DaemonPeer = { id: int, peer: Peer };

export class DaemonStore {
  peers: DaemonPeer[];
  ring: Ring;
  nextPeerId: int;

  constructor() {
    this.peers = [];
    this.ring = new Ring(DAEMON_RING_CAPACITY);
    this.nextPeerId = 1;
  }

  registerPeer(peer: Peer): int {
    let id = this.nextPeerId;
    this.nextPeerId = this.nextPeerId + 1;
    this.peers.push({ id: id, peer: peer });
    return id;
  }

  removePeer(id: int): void {
    let out: DaemonPeer[] = [];
    for (const p of this.peers) {
      if (p.id != id) { out.push(p); }
    }
    this.peers = out;
  }

  peerCount(): int {
    return this.peers.length;
  }

  broadcast(frameJson: string): void {
    for (const p of this.peers) {
      if (p.peer.open) {
        send(p.peer, frameJson);
      }
    }
  }

  record(frameJson: string): void {
    this.ring.push(frameJson);
  }
}
