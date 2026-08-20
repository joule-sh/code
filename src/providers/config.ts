import { ProviderConfig } from "./openai.ts";

type ConfigFile = { baseUrl: string, model: string, apiKey: string };

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
  let f: ConfigFile = { baseUrl: "", model: "", apiKey: "" };
  return f;
}

export function parseConfigFile(text: string): ConfigFile {
  if (text.trim() == "") {
    return emptyConfigFile();
  }
  try {
    return JSON.parse<ConfigFile>(text);
  } catch {
    return emptyConfigFile();
  }
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

export function loadConfigFile(path: string): ConfigFile {
  if (!fs.existsSync(path)) {
    return emptyConfigFile();
  }
  return parseConfigFile(fs.readFileSync(path));
}

export function loadConfig(argv: string[]): ProviderConfig {
  let flagModel = flagValue(argv, "--model");
  let flagBaseUrl = flagValue(argv, "--base-url");
  let envBaseUrl = process.env("JOULE_CODE_BASE_URL") ?? "";
  let envModel = process.env("JOULE_CODE_MODEL") ?? "";
  let envApiKey = process.env("JOULE_CODE_API_KEY") ?? "";
  let home = process.env("HOME") ?? "";
  let file = loadConfigFile(home + "/.config/joule-code/config.json");
  return resolveConfig(flagModel, flagBaseUrl, envBaseUrl, envModel, envApiKey, file.baseUrl, file.model, file.apiKey);
}
