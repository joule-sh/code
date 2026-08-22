import { jsonStringMemberAt } from "https://lumen-lang.org/package/std-contrib/ai/core/jsonscan.ts";
import { configDirPath } from "../providers/config.ts";

export const CHECK_INTERVAL_MS: i64 = 86400000;

export type UpdateCache = { checkedAt: i64, latestSeen: string };

function parseI64(s: string): i64 {
  let out: i64 = 0;
  let i: int = 0;
  if (s.length == 0) { return -1; }
  while (i < s.length) {
    let c = s.charAt(i);
    let code = c.charCodeAt(0) - "0".charCodeAt(0);
    if (code < 0 || code > 9) { return -1; }
    out = out * 10 + code;
    i = i + 1;
  }
  return out;
}

export function updateCachePath(): string {
  return configDirPath() + "/update-check.json";
}

export function emptyUpdateCache(): UpdateCache {
  let c: UpdateCache = { checkedAt: 0, latestSeen: "" };
  return c;
}

export function parseUpdateCache(text: string): UpdateCache {
  let trimmed = text.trim();
  if (!trimmed.startsWith("{")) { return emptyUpdateCache(); }
  let rawCheckedAt = jsonStringMemberAt(trimmed, 0, "checkedAt");
  let checkedAt = parseI64(rawCheckedAt);
  if (checkedAt < 0) { checkedAt = 0; }
  let c: UpdateCache = { checkedAt: checkedAt, latestSeen: jsonStringMemberAt(trimmed, 0, "latestSeen") };
  return c;
}

export function loadUpdateCache(path: string): UpdateCache {
  if (!fs.existsSync(path)) { return emptyUpdateCache(); }
  let text = "";
  try { text = fs.readFileSync(path); } catch { return emptyUpdateCache(); }
  return parseUpdateCache(text);
}

export function saveUpdateCache(filePath: string, cache: UpdateCache): void {
  let dir = path.dirname(filePath);
  if (dir != "" && !fs.existsSync(dir)) {
    fs.mkdirSync(dir, true);
  }
  let body = "{\"checkedAt\":" + JSON.stringify(`${cache.checkedAt}`) + ",\"latestSeen\":" + JSON.stringify(cache.latestSeen) + "}";
  try { fs.writeFileSync(filePath, body); } catch { return; }
}

export function isCacheFresh(cache: UpdateCache, nowMs: i64, intervalMs: i64): bool {
  if (cache.checkedAt <= 0) { return false; }
  if (nowMs < cache.checkedAt) { return true; }
  return nowMs - cache.checkedAt < intervalMs;
}

export function markChecked(path: string, nowMs: i64, latestSeen: string): void {
  let c: UpdateCache = { checkedAt: nowMs, latestSeen: latestSeen };
  saveUpdateCache(path, c);
}
