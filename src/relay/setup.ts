import { loadServerBase } from "../providers/config.ts";
import { loadCredential } from "../auth/credentials.ts";
import { RelayClient } from "./client.ts";
import { loadRelayConfig, shareProblem } from "./client_logic.ts";

export function configureRelayFromDisk(relay: RelayClient, argv: string[]): void {
  if (relay.isAttached()) { return; }
  let serverBase = loadServerBase(argv);
  let cred = loadCredential(serverBase);
  let cfg = loadRelayConfig(cred.relayUrl, cred.relayWsUrl, cred.webUrl);
  relay.host = cfg.host;
  relay.httpPort = cfg.httpPort;
  relay.wsPort = cfg.wsPort;
  relay.webBaseUrl = cfg.webBaseUrl;
  relay.tmpDir = cfg.tmpDir;
  relay.credentialSecret = cred.secret;
  relay.configProblem = shareProblem(serverBase, cred.secret, cfg);
}
