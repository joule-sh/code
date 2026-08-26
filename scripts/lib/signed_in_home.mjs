import fs from "node:fs";
import path from "node:path";
import { scratchDir } from "../scratch.mjs";

// A HOME that looks like one /login already ran in: the per-server credential
// carrying the relay that server advertised, and the config file naming that
// server. Both are read off disk, which is the whole point - a daemon is
// spawned with only JOULE_DAEMON_PORT (src/daemon/lifecycle.ts), so anything
// a harness puts only in an environment is a fiction the real flow never has.
export function signedInHome(opts) {
  const home = scratchDir((opts.prefix ?? "joule-home") + "-");
  const dir = path.join(home, ".config", "joule-code");
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, "credentials.jsonl"), JSON.stringify({
    server: opts.server,
    secret: opts.secret,
    accountId: "",
    accountEmail: "",
    keyId: "key_harness",
    keyPrefix: "jl_ha",
    scopes: "",
    savedAt: `${Date.now()}`,
    relayUrl: opts.relayUrl,
    relayWsUrl: opts.relayWsUrl,
    webUrl: opts.webUrl ?? `${opts.server}/terminal/sessions`,
  }) + "\n");
  fs.writeFileSync(path.join(dir, "config.json"), JSON.stringify({
    baseUrl: "", model: "", apiKey: "", server: opts.server, updateCheck: "", mouse: "",
  }));
  return home;
}

// Everything a real spawn drops. Naming any of these in a harness hides the
// bug where the daemon cannot find what only the client had.
export function withoutInheritedConfig(env) {
  return {
    ...env,
    JOULE_CODE_SERVER: undefined,
    JOULE_RELAY_URL: undefined,
    JOULE_RELAY_WS_URL: undefined,
    JOULE_WEB_BASE_URL: undefined,
  };
}
