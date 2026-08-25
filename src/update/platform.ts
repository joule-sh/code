export const PLATFORM_LINUX_X64: string = "x86_64-linux";
export const PLATFORM_MACOS_ARM64: string = "aarch64-macos";
export const PLATFORM_MACOS_X64: string = "x86_64-macos";

export const RELEASE_REPO: string = "joule-sh/code";

export function releasePlatform(nodePlatform: string, nodeArch: string): string {
  if (nodePlatform == "linux" && nodeArch == "x64") { return PLATFORM_LINUX_X64; }
  if (nodePlatform == "darwin" && nodeArch == "arm64") { return PLATFORM_MACOS_ARM64; }
  if (nodePlatform == "darwin" && nodeArch == "x64") { return PLATFORM_MACOS_X64; }
  return "";
}

export function isMacosPlatform(releaseTarget: string): bool {
  return releaseTarget == PLATFORM_MACOS_ARM64 || releaseTarget == PLATFORM_MACOS_X64;
}

export function signsAdHoc(releaseTarget: string): bool {
  return releaseTarget == PLATFORM_MACOS_ARM64;
}

export function releaseAssetName(releaseTarget: string): string {
  return "code-" + releaseTarget + ".tar.gz";
}

export function releaseDirName(releaseTarget: string): string {
  return "code-" + releaseTarget;
}

export function releaseDownloadUrl(tag: string, releaseTarget: string): string {
  return "https://github.com/" + RELEASE_REPO + "/releases/download/" + tag + "/" + releaseAssetName(releaseTarget);
}

export function unsupportedPlatformError(nodePlatform: string, nodeArch: string): string {
  return "no release is published for " + nodePlatform + "-" + nodeArch + " (built platforms: " + PLATFORM_LINUX_X64 + ", " + PLATFORM_MACOS_ARM64 + ", " + PLATFORM_MACOS_X64 + ")";
}
