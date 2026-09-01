import { jsonStringMemberAt } from "https://lumen-lang.org/package/std-contrib/ai/core/jsonscan.ts";
import { ProviderConfig } from "./openai.ts";
import { resolveServer, serverOrigin, ServerOrigin, SERVER_ENV } from "../auth/server.ts";
import { envOr, homeDir } from "../vendor/platform/platform.ts";

export type ConfigFile = { baseUrl: string, model: string, apiKey: string, server: string, updateCheck: string, mouse: string, color: string };

function firstNonEmpty(a: string, b: string): string {
  if (a != "") { return a; }
  return b;
}

export function resolveConfig(flagModel: string, flagBaseUrl: string, envBaseUrl: string, envModel: string, envApiKey: string, fileBaseUrl: string, fileModel: string, fileApiKey: string): ProviderConfig {
  let cfg: ProviderConfig = {
    baseUrl: firstNonEmpty(flagBaseUrl, firstNonEmpty(envBaseUrl, fileBaseUrl)),
    model: firstNonEmpty(flagModel, firstNonEmpty(envModel, fileModel)),
    apiKey: firstNonEmpty(envApiKey, fileApiKey),
  };
  return cfg;
}

function emptyConfigFile(): ConfigFile {
  let f: ConfigFile = { baseUrl: "", model: "", apiKey: "", server: "", updateCheck: "", mouse: "", color: "" };
  return f;
}

export function parseConfigFile(text: string): ConfigFile {
  let trimmed = text.trim();
  if (!trimmed.startsWith("{")) {
    return emptyConfigFile();
  }
  let f: ConfigFile = {
    baseUrl: jsonStringMemberAt(trimmed, 0, "baseUrl"),
    model: jsonStringMemberAt(trimmed, 0, "model"),
    apiKey: jsonStringMemberAt(trimmed, 0, "apiKey"),
    server: jsonStringMemberAt(trimmed, 0, "server"),
    updateCheck: jsonStringMemberAt(trimmed, 0, "updateCheck"),
    mouse: jsonStringMemberAt(trimmed, 0, "mouse"),
    color: jsonStringMemberAt(trimmed, 0, "color"),
  };
  return f;
}

function flagValue(argv: string[], name: string): string {
  let i = 0;
  while (i < argv.length) {
    if (argv[i] == name && i + 1 < argv.length) {
      return argv[i + 1];
    }
    i = i + 1;
  }
  return "";
}

export function configDirPath(): string {
  let home = homeDir();
  return home + "/.config/joule-code";
}

export function configFilePath(): string {
  return configDirPath() + "/config.json";
}

export function loadConfigFile(path: string): ConfigFile {
  if (!fs.existsSync(path)) {
    return emptyConfigFile();
  }
  return parseConfigFile(fs.readFileSync(path));
}

export function saveConfigFile(filePath: string, file: ConfigFile): void {
  let dir = path.dirname(filePath);
  if (dir != "" && !fs.existsSync(dir)) {
    fs.mkdirSync(dir, true);
  }
  fs.writeFileSync(filePath, JSON.stringify(file));
}

export function loadConfig(argv: string[]): ProviderConfig {
  let flagModel = flagValue(argv, "--model");
  let flagBaseUrl = flagValue(argv, "--base-url");
  let envBaseUrl = envOr("JOULE_CODE_BASE_URL", "");
  let envModel = envOr("JOULE_CODE_MODEL", "");
  let envApiKey = envOr("JOULE_CODE_API_KEY", "");
  let envApiKeyFile = envOr("JOULE_CODE_API_KEY_FILE", "");
  if (envApiKeyFile != "") {
    envApiKey = "file:" + envApiKeyFile;
  }
  let file = loadConfigFile(configFilePath());
  return resolveConfig(flagModel, flagBaseUrl, envBaseUrl, envModel, envApiKey, file.baseUrl, file.model, file.apiKey);
}

export function loadServerOrigin(argv: string[]): ServerOrigin {
  let flagServer = flagValue(argv, "--server");
  let envServer = envOr(SERVER_ENV, "");
  let file = loadConfigFile(configFilePath());
  return serverOrigin(flagServer, envServer, file.server);
}

export function loadServerBase(argv: string[]): string {
  let flagServer = flagValue(argv, "--server");
  let envServer = envOr(SERVER_ENV, "");
  let file = loadConfigFile(configFilePath());
  return resolveServer(flagServer, envServer, file.server);
}

export function withServer(existing: ConfigFile, server: string): ConfigFile {
  let file: ConfigFile = {
    baseUrl: existing.baseUrl, model: existing.model, apiKey: existing.apiKey,
    server: server, updateCheck: existing.updateCheck, mouse: existing.mouse, color: existing.color,
  };
  return file;
}

export function rememberServer(server: string): void {
  let target = configFilePath();
  saveConfigFile(target, withServer(loadConfigFile(target), server));
}

export function withMouse(existing: ConfigFile, mouse: string): ConfigFile {
  let file: ConfigFile = {
    baseUrl: existing.baseUrl, model: existing.model, apiKey: existing.apiKey,
    server: existing.server, updateCheck: existing.updateCheck, mouse: mouse, color: existing.color,
  };
  return file;
}

export function rememberMouse(mouse: string): void {
  let target = configFilePath();
  saveConfigFile(target, withMouse(loadConfigFile(target), mouse));
}

export function withColor(existing: ConfigFile, color: string): ConfigFile {
  let file: ConfigFile = {
    baseUrl: existing.baseUrl, model: existing.model, apiKey: existing.apiKey,
    server: existing.server, updateCheck: existing.updateCheck, mouse: existing.mouse, color: color,
  };
  return file;
}

export function rememberColor(color: string): void {
  let target = configFilePath();
  saveConfigFile(target, withColor(loadConfigFile(target), color));
}
