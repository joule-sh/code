import { resolveConfig, parseConfigFile, saveConfigFile, loadConfigFile, withServer, withMouse, ConfigFile } from "./config.ts";

function freshRoot(name: string): string {
  let root = "/tmp/config-test-" + name;
  if (fs.existsSync(root)) {
    fs.rmSync(root, true);
  }
  fs.mkdirSync(root, true);
  return root;
}

test("a flag wins over env and file", () => {
  let cfg = resolveConfig("flag-model", "flag-url", "env-url", "env-model", "env-key", "file-url", "file-model", "file-key");
  expect(cfg.model == "flag-model");
  expect(cfg.baseUrl == "flag-url");
});

test("env wins over file when no flag is given", () => {
  let cfg = resolveConfig("", "", "env-url", "env-model", "env-key", "file-url", "file-model", "file-key");
  expect(cfg.model == "env-model");
  expect(cfg.baseUrl == "env-url");
});

test("file is the last resort", () => {
  let cfg = resolveConfig("", "", "", "", "", "file-url", "file-model", "file-key");
  expect(cfg.model == "file-model");
  expect(cfg.baseUrl == "file-url");
});

test("the api key has no flag, only env then file", () => {
  let cfg = resolveConfig("", "", "", "", "env-key", "", "", "file-key");
  expect(cfg.apiKey == "env-key");

  let cfg2 = resolveConfig("", "", "", "", "", "", "", "file-key");
  expect(cfg2.apiKey == "file-key");
});

test("everything empty resolves to empty, not a crash", () => {
  let cfg = resolveConfig("", "", "", "", "", "", "", "");
  expect(cfg.model == "");
  expect(cfg.baseUrl == "");
  expect(cfg.apiKey == "");
});

test("parseConfigFile reads a well-formed file", () => {
  let f = parseConfigFile("{\"baseUrl\":\"http://localhost:8080\",\"model\":\"local-model\",\"apiKey\":\"k\"}");
  expect(f.baseUrl == "http://localhost:8080");
  expect(f.model == "local-model");
});

test("parseConfigFile on empty or malformed text returns empty, not a crash", () => {
  let f1 = parseConfigFile("");
  expect(f1.baseUrl == "");

  let f2 = parseConfigFile("not json at all");
  expect(f2.baseUrl == "");
});

test("saveConfigFile writes a config that loadConfigFile reads back exactly", () => {
  let root = freshRoot("roundtrip");
  let target = root + "/nested/config.json";
  let file: ConfigFile = { baseUrl: "https://api.example.com", model: "some-model", apiKey: "sk-abc123", server: "", updateCheck: "", mouse: "" };

  saveConfigFile(target, file);
  let loaded = loadConfigFile(target);

  expect(loaded.baseUrl == "https://api.example.com");
  expect(loaded.model == "some-model");
  expect(loaded.apiKey == "sk-abc123");
});

test("saveConfigFile overwrites a previously written config", () => {
  let root = freshRoot("overwrite");
  let target = root + "/config.json";
  let first: ConfigFile = { baseUrl: "https://first.example.com", model: "first-model", apiKey: "first-key", server: "", updateCheck: "", mouse: "" };
  let second: ConfigFile = { baseUrl: "https://second.example.com", model: "second-model", apiKey: "second-key", server: "", updateCheck: "", mouse: "" };

  saveConfigFile(target, first);
  saveConfigFile(target, second);
  let loaded = loadConfigFile(target);

  expect(loaded.baseUrl == "https://second.example.com");
  expect(loaded.model == "second-model");
  expect(loaded.apiKey == "second-key");
});

test("saveConfigFile round-trips the updateCheck toggle", () => {
  let root = freshRoot("update-check-toggle");
  let target = root + "/config.json";
  let file: ConfigFile = { baseUrl: "", model: "", apiKey: "", server: "", updateCheck: "off", mouse: "" };

  saveConfigFile(target, file);
  let loaded = loadConfigFile(target);

  expect(loaded.updateCheck == "off");
});

test("withServer replaces only the server, carrying the provider settings through untouched", () => {
  let existing: ConfigFile = { baseUrl: "https://api.openai.com/v1", model: "gpt-5", apiKey: "sk-live", server: "https://joule.sh", updateCheck: "off", mouse: "on" };
  let updated = withServer(existing, "https://joule.internal");
  expect(updated.server == "https://joule.internal");
  expect(updated.baseUrl == existing.baseUrl);
  expect(updated.model == existing.model);
  expect(updated.apiKey == existing.apiKey);
  expect(updated.updateCheck == existing.updateCheck);
  expect(updated.mouse == existing.mouse);
});

test("a config written with a chosen server reads back with it, and keeps the rest", () => {
  let root = freshRoot("withserver");
  let target = root + "/config.json";
  let existing: ConfigFile = { baseUrl: "https://api.deepseek.com", model: "deepseek-chat", apiKey: "sk-1", server: "", updateCheck: "", mouse: "" };
  saveConfigFile(target, withServer(existing, "https://joule.internal"));
  let back = loadConfigFile(target);
  expect(back.server == "https://joule.internal");
  expect(back.apiKey == "sk-1");
  expect(back.model == "deepseek-chat");
});

test("saveConfigFile round-trips the mouse reporting toggle", () => {
  let root = freshRoot("mouse-toggle");
  let target = root + "/config.json";
  let file: ConfigFile = { baseUrl: "", model: "", apiKey: "", server: "", updateCheck: "", mouse: "on" };

  saveConfigFile(target, file);
  let loaded = loadConfigFile(target);

  expect(loaded.mouse == "on");
});

test("a config file that predates the mouse setting reads back with it empty, which means off", () => {
  let f = parseConfigFile("{\"baseUrl\":\"http://localhost:8080\",\"model\":\"local-model\"}");
  expect(f.mouse == "");
});

test("withMouse replaces only the mouse setting, carrying the rest through untouched", () => {
  let existing: ConfigFile = { baseUrl: "https://api.openai.com/v1", model: "gpt-5", apiKey: "sk-live", server: "https://joule.sh", updateCheck: "off", mouse: "" };
  let updated = withMouse(existing, "on");
  expect(updated.mouse == "on");
  expect(updated.baseUrl == existing.baseUrl);
  expect(updated.model == existing.model);
  expect(updated.apiKey == existing.apiKey);
  expect(updated.server == existing.server);
  expect(updated.updateCheck == existing.updateCheck);
});
