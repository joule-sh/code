export const DEV_VERSION: string = "dev";

export type ParsedVersion = { ok: bool, major: int, minor: int, patch: int };

export function stripLeadingV(text: string): string {
  if (text.length > 0 && (text.charAt(0) == "v" || text.charAt(0) == "V")) {
    return text.slice(1, text.length);
  }
  return text;
}

function isDigitsOnly(text: string): bool {
  if (text.length == 0) { return false; }
  let i = 0;
  while (i < text.length) {
    let code = text.charCodeAt(i) - "0".charCodeAt(0);
    if (code < 0 || code > 9) { return false; }
    i = i + 1;
  }
  return true;
}

export function parseVersion(raw: string): ParsedVersion {
  let bad: ParsedVersion = { ok: false, major: 0, minor: 0, patch: 0 };
  let text = stripLeadingV(raw.trim());
  if (text == "") { return bad; }
  let parts = text.split(".");
  if (parts.length != 3) { return bad; }
  if (!isDigitsOnly(parts[0]) || !isDigitsOnly(parts[1]) || !isDigitsOnly(parts[2])) { return bad; }
  let major = Number.parseInt(parts[0], 10);
  let minor = Number.parseInt(parts[1], 10);
  let patch = Number.parseInt(parts[2], 10);
  if (major == null || minor == null || patch == null) { return bad; }
  return { ok: true, major: major, minor: minor, patch: patch };
}

export function isNewerVersion(current: string, latest: string): bool {
  if (current.trim() == DEV_VERSION) { return false; }
  let cur = parseVersion(current);
  let lat = parseVersion(latest);
  if (!cur.ok || !lat.ok) { return false; }
  if (lat.major != cur.major) { return lat.major > cur.major; }
  if (lat.minor != cur.minor) { return lat.minor > cur.minor; }
  if (lat.patch != cur.patch) { return lat.patch > cur.patch; }
  return false;
}
