import { releasePlatform, releaseAssetName, releaseDirName, releaseDownloadUrl, unsupportedPlatformError, isMacosPlatform, PLATFORM_LINUX_X64, PLATFORM_MACOS_ARM64, PLATFORM_MACOS_X64 } from "./platform.ts";

test("releasePlatform maps the three shipped os/arch pairs", () => {
  expect(releasePlatform("linux", "x64") == PLATFORM_LINUX_X64);
  expect(releasePlatform("darwin", "arm64") == PLATFORM_MACOS_ARM64);
  expect(releasePlatform("darwin", "x64") == PLATFORM_MACOS_X64);
});

test("releasePlatform reports no match for anything else", () => {
  expect(releasePlatform("win32", "x64") == "");
  expect(releasePlatform("linux", "arm64") == "");
  expect(releasePlatform("", "") == "");
});

test("isMacosPlatform is true for both macOS targets and false for linux", () => {
  expect(isMacosPlatform(PLATFORM_MACOS_ARM64));
  expect(isMacosPlatform(PLATFORM_MACOS_X64));
  expect(!isMacosPlatform(PLATFORM_LINUX_X64));
});

test("releaseAssetName and releaseDirName follow the release workflow's naming", () => {
  expect(releaseAssetName(PLATFORM_LINUX_X64) == "code-x86_64-linux.tar.gz");
  expect(releaseDirName(PLATFORM_MACOS_ARM64) == "code-aarch64-macos");
});

test("releaseDownloadUrl builds the exact GitHub release asset URL", () => {
  let url = releaseDownloadUrl("v0.6.2", PLATFORM_LINUX_X64);
  expect(url == "https://github.com/joule-sh/code/releases/download/v0.6.2/code-x86_64-linux.tar.gz");
});

test("unsupportedPlatformError names the platform and the built list", () => {
  let msg = unsupportedPlatformError("win32", "x64");
  expect(msg.indexOf("win32-x64") >= 0);
  expect(msg.indexOf(PLATFORM_LINUX_X64) >= 0);
});
