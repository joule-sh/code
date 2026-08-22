import { jsonStringMemberAt } from "https://lumen-lang.org/package/std-contrib/ai/core/jsonscan.ts";
import { ProviderConfig } from "./openai.ts";
import { resolveServer, SERVER_ENV } from "../auth/server.ts";

export type ConfigFile = { baseUrl: string, model: string, apiKey: string, server: string };

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
  let f: ConfigFile = { baseUrl: "", model: "", apiKey: "", server: "" };
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

export function configFilePath(): string {
  let home = process.env("HOME") ?? "";
  return home + "/.config/joule-code/config.json";
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
  let envBaseUrl = process.env("JOULE_CODE_BASE_URL") ?? "";
  let envModel = process.env("JOULE_CODE_MODEL") ?? "";
  let envApiKey = process.env("JOULE_CODE_API_KEY") ?? "";
  let file = loadConfigFile(configFilePath());
  return resolveConfig(flagModel, flagBaseUrl, envBaseUrl, envModel, envApiKey, file.baseUrl, file.model, file.apiKey);
}

export function loadServerBase(argv: string[]): string {
  let flagServer = flagValue(argv, "--server");
  let envServer = process.env(SERVER_ENV) ?? "";
  let file = loadConfigFile(configFilePath());
  return resolveServer(flagServer, envServer, file.server);
}
