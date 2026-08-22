import { isNewerVersion, parseVersion, stripLeadingV, DEV_VERSION } from "./version_compare.ts";

test("an older current version is offered the newer one", () => {
  expect(isNewerVersion("0.5.0", "0.6.0"));
  expect(isNewerVersion("0.6.0", "0.6.1"));
  expect(isNewerVersion("0.6.0", "1.0.0"));
});

test("an equal version is never offered", () => {
  expect(!isNewerVersion("0.6.0", "0.6.0"));
  expect(!isNewerVersion("v0.6.0", "0.6.0"));
});

test("a newer current version, a downgrade, is never offered", () => {
  expect(!isNewerVersion("0.6.1", "0.6.0"));
  expect(!isNewerVersion("1.0.0", "0.9.9"));
});

test("a dev build is never told it is out of date", () => {
  expect(!isNewerVersion(DEV_VERSION, "0.6.0"));
  expect(!isNewerVersion("dev", "99.0.0"));
  expect(!isNewerVersion(" dev ", "99.0.0"));
});

test("a malformed current or latest version is not compared, not crashed on", () => {
  expect(!isNewerVersion("", "0.6.0"));
  expect(!isNewerVersion("0.6.0", ""));
  expect(!isNewerVersion("0.6", "0.7.0"));
  expect(!isNewerVersion("0.6.0", "0.7"));
  expect(!isNewerVersion("0.6.x", "0.7.0"));
  expect(!isNewerVersion("0.6.0", "not-a-version"));
  expect(!isNewerVersion("0.6.0-beta", "0.7.0"));
  expect(!isNewerVersion("0.6.0.1", "0.7.0.0"));
});

test("the leading v release-tag prefix is accepted on either side", () => {
  expect(isNewerVersion("0.6.0", "v0.7.0"));
  expect(isNewerVersion("v0.6.0", "v0.7.0"));
});

test("stripLeadingV only removes a leading v or V", () => {
  expect(stripLeadingV("v1.2.3") == "1.2.3");
  expect(stripLeadingV("V1.2.3") == "1.2.3");
  expect(stripLeadingV("1.2.3") == "1.2.3");
  expect(stripLeadingV("") == "");
});

test("parseVersion reports ok:false rather than throwing on garbage", () => {
  let p = parseVersion("garbage");
  expect(!p.ok);
  let p2 = parseVersion("1.2.3");
  expect(p2.ok);
  expect(p2.major == 1);
  expect(p2.minor == 2);
  expect(p2.patch == 3);
});
