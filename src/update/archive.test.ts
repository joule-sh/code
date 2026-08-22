import { looksLikeElf, looksLikeMachO, looksLikeExecutableFor, isRunnableBinaryForPlatform, MIN_BINARY_BYTES, readMagic4, fileSize } from "./archive.ts";
import { PLATFORM_LINUX_X64, PLATFORM_MACOS_ARM64, PLATFORM_MACOS_X64 } from "./platform.ts";

function bytes4(a: int, b: int, c: int, d: int): string {
  return String.fromCharCode(a) + String.fromCharCode(b) + String.fromCharCode(c) + String.fromCharCode(d);
}

const ELF_MAGIC: string = bytes4(0x7f, 0x45, 0x4c, 0x46);
const MACHO_64_LE: string = bytes4(0xcf, 0xfa, 0xed, 0xfe);
const MACHO_64_BE: string = bytes4(0xfe, 0xed, 0xfa, 0xcf);
const GZIP_MAGIC: string = bytes4(0x1f, 0x8b, 0x08, 0x00);

test("looksLikeElf accepts the real ELF magic and rejects other bytes", () => {
  expect(looksLikeElf(ELF_MAGIC));
  expect(!looksLikeElf(MACHO_64_LE));
  expect(!looksLikeElf("abcd"));
  expect(!looksLikeElf(""));
});

test("looksLikeMachO accepts all four known Mach-O magic byte orders", () => {
  expect(looksLikeMachO(MACHO_64_LE));
  expect(looksLikeMachO(MACHO_64_BE));
  expect(looksLikeMachO(bytes4(0xfe, 0xed, 0xfa, 0xce)));
  expect(looksLikeMachO(bytes4(0xce, 0xfa, 0xed, 0xfe)));
  expect(!looksLikeMachO(ELF_MAGIC));
});

test("looksLikeExecutableFor requires ELF on the linux target and Mach-O on both macOS targets", () => {
  expect(looksLikeExecutableFor(PLATFORM_LINUX_X64, ELF_MAGIC));
  expect(!looksLikeExecutableFor(PLATFORM_LINUX_X64, MACHO_64_LE));
  expect(looksLikeExecutableFor(PLATFORM_MACOS_ARM64, MACHO_64_LE));
  expect(looksLikeExecutableFor(PLATFORM_MACOS_X64, MACHO_64_LE));
  expect(!looksLikeExecutableFor(PLATFORM_MACOS_ARM64, ELF_MAGIC));
});

test("looksLikeExecutableFor rejects a gzip header on every known target", () => {
  expect(!looksLikeExecutableFor(PLATFORM_LINUX_X64, GZIP_MAGIC));
  expect(!looksLikeExecutableFor(PLATFORM_MACOS_ARM64, GZIP_MAGIC));
});

test("looksLikeExecutableFor rejects an unknown platform outright", () => {
  expect(!looksLikeExecutableFor("windows-x64", ELF_MAGIC));
});

test("isRunnableBinaryForPlatform enforces the minimum size floor even with a valid magic", () => {
  expect(!isRunnableBinaryForPlatform(PLATFORM_LINUX_X64, ELF_MAGIC, 0));
  expect(!isRunnableBinaryForPlatform(PLATFORM_LINUX_X64, ELF_MAGIC, MIN_BINARY_BYTES - 1));
  expect(isRunnableBinaryForPlatform(PLATFORM_LINUX_X64, ELF_MAGIC, MIN_BINARY_BYTES));
});

test("isRunnableBinaryForPlatform rejects a large file with the wrong magic (a corrupt or truncated-then-padded download)", () => {
  expect(!isRunnableBinaryForPlatform(PLATFORM_LINUX_X64, GZIP_MAGIC, MIN_BINARY_BYTES * 2));
});

test("readMagic4 and fileSize read the real bytes of a file on disk", () => {
  let p = "/tmp/archive-test-magic-" + `${Date.now()}`;
  fs.writeFileSync(p, ELF_MAGIC + "padding-to-make-this-nonzero");
  expect(readMagic4(p) == ELF_MAGIC);
  expect(fileSize(p) > 0);
  fs.rmSync(p, false);
});

test("readMagic4 on a missing file returns empty rather than throwing", () => {
  expect(readMagic4("/tmp/archive-test-magic-does-not-exist-" + `${Date.now()}`) == "");
});

test("fileSize on a missing file returns -1", () => {
  expect(fileSize("/tmp/archive-test-size-does-not-exist-" + `${Date.now()}`) == -1);
});
