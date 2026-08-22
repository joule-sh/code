import { loadUpdateCache, saveUpdateCache, parseUpdateCache, isCacheFresh, markChecked, emptyUpdateCache, UpdateCache, CHECK_INTERVAL_MS } from "./cache.ts";

function freshRoot(name: string): string {
  let root = "/tmp/update-cache-test-" + name;
  if (fs.existsSync(root)) {
    fs.rmSync(root, true);
  }
  fs.mkdirSync(root, true);
  return root;
}

test("a missing cache file loads as empty, not a crash", () => {
  let c = loadUpdateCache("/tmp/update-cache-test-does-not-exist/update-check.json");
  expect(c.checkedAt == 0);
  expect(c.latestSeen == "");
});

test("parseUpdateCache rejects malformed text without crashing", () => {
  let c = parseUpdateCache("not json");
  expect(c.checkedAt == 0);
  let c2 = parseUpdateCache("");
  expect(c2.checkedAt == 0);
});

test("saveUpdateCache writes a cache that loadUpdateCache reads back exactly, including a large ms timestamp", () => {
  let root = freshRoot("roundtrip");
  let target = root + "/update-check.json";
  let cache: UpdateCache = { checkedAt: 1787249645311, latestSeen: "0.6.0" };

  saveUpdateCache(target, cache);
  let loaded = loadUpdateCache(target);

  expect(loaded.checkedAt == 1787249645311);
  expect(loaded.latestSeen == "0.6.0");
});

test("markChecked creates parent directories and stamps the current time", () => {
  let root = freshRoot("mark");
  let target = root + "/nested/update-check.json";

  markChecked(target, 42, "0.6.0");
  let loaded = loadUpdateCache(target);

  expect(loaded.checkedAt == 42);
  expect(loaded.latestSeen == "0.6.0");
});

test("isCacheFresh is false for an empty cache", () => {
  expect(!isCacheFresh(emptyUpdateCache(), 1000, CHECK_INTERVAL_MS));
});

test("isCacheFresh is true within the interval and false once it has elapsed", () => {
  let cache: UpdateCache = { checkedAt: 1000, latestSeen: "" };
  expect(isCacheFresh(cache, 1000, CHECK_INTERVAL_MS));
  expect(isCacheFresh(cache, 1000 + CHECK_INTERVAL_MS - 1, CHECK_INTERVAL_MS));
  expect(!isCacheFresh(cache, 1000 + CHECK_INTERVAL_MS, CHECK_INTERVAL_MS));
  expect(!isCacheFresh(cache, 1000 + CHECK_INTERVAL_MS + 60000, CHECK_INTERVAL_MS));
});

test("the daily interval really is one day in milliseconds", () => {
  expect(CHECK_INTERVAL_MS == 86400000);
});
