import { ProviderConfig } from "./openai.ts";

export const PLATFORM_MARK: string = "/";

export function platformOf(baseUrl: string): string {
  let url = baseUrl.toLowerCase();
  if (url.indexOf("api.deepseek.com") >= 0) { return "deepseek"; }
  if (url.indexOf("api.openai.com") >= 0) { return "openai"; }
  if (url.indexOf("api.anthropic.com") >= 0) { return "anthropic"; }
  if (url.indexOf("api.mistral.ai") >= 0) { return "mistral"; }
  if (url.indexOf("aiplatform.googleapis.com") >= 0) { return "vertex"; }
  return "";
}

export function qualifiedModel(baseUrl: string, model: string): string {
  if (model == "") { return model; }
  if (model.indexOf(PLATFORM_MARK) >= 0) { return model; }
  let platform = platformOf(baseUrl);
  if (platform == "") { return model; }
  return platform + PLATFORM_MARK + model;
}

export function wireModel(baseUrl: string, chosen: string): string {
  let platform = platformOf(baseUrl);
  if (platform == "") { return chosen; }
  let prefix = platform + PLATFORM_MARK;
  if (chosen.length <= prefix.length) { return chosen; }
  if (chosen.slice(0, prefix.length) != prefix) { return chosen; }
  return chosen.slice(prefix.length, chosen.length);
}

export function displayModel(cfg: ProviderConfig): string {
  return qualifiedModel(cfg.baseUrl, cfg.model);
}
