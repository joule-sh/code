import { PLATFORM_LINUX_X64, isMacosPlatform } from "./platform.ts";

export const MIN_BINARY_BYTES: int = 200000;

function byteAt(s: string, i: int): int {
  if (i >= s.length) { return -1; }
  return s.charCodeAt(i);
}

export function looksLikeElf(magic4: string): bool {
  return byteAt(magic4, 0) == 0x7f && byteAt(magic4, 1) == 0x45 && byteAt(magic4, 2) == 0x4c && byteAt(magic4, 3) == 0x46;
}

function matchesBytes(magic4: string, b0: int, b1: int, b2: int, b3: int): bool {
  return byteAt(magic4, 0) == b0 && byteAt(magic4, 1) == b1 && byteAt(magic4, 2) == b2 && byteAt(magic4, 3) == b3;
}

export function looksLikeMachO(magic4: string): bool {
  if (matchesBytes(magic4, 0xfe, 0xed, 0xfa, 0xce)) { return true; }
  if (matchesBytes(magic4, 0xce, 0xfa, 0xed, 0xfe)) { return true; }
  if (matchesBytes(magic4, 0xfe, 0xed, 0xfa, 0xcf)) { return true; }
  if (matchesBytes(magic4, 0xcf, 0xfa, 0xed, 0xfe)) { return true; }
  return false;
}

export function looksLikeExecutableFor(releaseTarget: string, magic4: string): bool {
  if (releaseTarget == PLATFORM_LINUX_X64) { return looksLikeElf(magic4); }
  if (isMacosPlatform(releaseTarget)) { return looksLikeMachO(magic4); }
  return false;
}

export function isRunnableBinaryForPlatform(releaseTarget: string, magic4: string, sizeBytes: int): bool {
  if (sizeBytes < MIN_BINARY_BYTES) { return false; }
  return looksLikeExecutableFor(releaseTarget, magic4);
}

export function readMagic4(filePath: string): string {
  let fd = fs.openSync(filePath, "r");
  if (fd < 0) { return ""; }
  let data = "";
  try { data = fs.readSync(fd, 4); } catch { data = ""; }
  fs.closeSync(fd);
  return data;
}

export function fileSize(filePath: string): int {
  if (!fs.existsSync(filePath)) { return -1; }
  let st = fs.statSync(filePath);
  return st.size;
}
