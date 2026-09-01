import { platformOf, qualifiedModel, wireModel, displayModel } from "./platform.ts";
import { ProviderConfig } from "./openai.ts";

test("a known base url names the platform it reaches", () => {
  expect(platformOf("https://api.deepseek.com") == "deepseek");
  expect(platformOf("https://api.openai.com/v1") == "openai");
  expect(platformOf("https://api.anthropic.com") == "anthropic");
  expect(platformOf("https://api.mistral.ai/v1") == "mistral");
});

test("the platform is read whatever the case of the url", () => {
  expect(platformOf("https://API.DeepSeek.com") == "deepseek");
});

test("an unknown base url names no platform", () => {
  expect(platformOf("http://127.0.0.1:8090/api") == "");
  expect(platformOf("") == "");
});

test("a bare model is shown with the platform it came from", () => {
  expect(qualifiedModel("https://api.deepseek.com", "deepseek-chat") == "deepseek/deepseek-chat");
  expect(qualifiedModel("https://api.openai.com/v1", "gpt-4o") == "openai/gpt-4o");
});

test("a model that already names its platform is left alone", () => {
  expect(qualifiedModel("http://127.0.0.1:8090/api", "deepseek/deepseek-chat") == "deepseek/deepseek-chat");
  expect(qualifiedModel("https://api.deepseek.com", "deepseek/deepseek-chat") == "deepseek/deepseek-chat");
});

test("a model on an unknown platform is shown as it is", () => {
  expect(qualifiedModel("http://127.0.0.1:8090/api", "qwen3-4b") == "qwen3-4b");
  expect(qualifiedModel("https://api.deepseek.com", "") == "");
});

test("the wire name drops a prefix the platform already implies", () => {
  expect(wireModel("https://api.deepseek.com", "deepseek/deepseek-chat") == "deepseek-chat");
  expect(wireModel("https://api.openai.com/v1", "openai/gpt-4o") == "gpt-4o");
});

test("the wire name keeps a prefix the platform does not imply", () => {
  expect(wireModel("https://api.deepseek.com", "openai/gpt-4o") == "openai/gpt-4o");
  expect(wireModel("http://127.0.0.1:8090/api", "deepseek/deepseek-chat") == "deepseek/deepseek-chat");
  expect(wireModel("https://api.deepseek.com", "deepseek-chat") == "deepseek-chat");
});

test("what is shown goes back in as what was shown", () => {
  let shown = qualifiedModel("https://api.deepseek.com", "deepseek-chat");
  expect(shown == "deepseek/deepseek-chat");
  expect(wireModel("https://api.deepseek.com", shown) == "deepseek-chat");
});

test("a config shows the model with its platform", () => {
  let cfg: ProviderConfig = { baseUrl: "https://api.deepseek.com", model: "deepseek-chat", apiKey: "k" };
  expect(displayModel(cfg) == "deepseek/deepseek-chat");
});

test("a Vertex endpoint is named for display like the other platforms", () => {
  let base = "https://us-central1-aiplatform.googleapis.com/v1beta1/projects/p/locations/us-central1/endpoints/openapi/chat/completions";
  expect(qualifiedModel(base, "google/gemini-2.0-flash") == "google/gemini-2.0-flash");
  expect(qualifiedModel(base, "gemini-2.0-flash") == "vertex/gemini-2.0-flash");
  expect(wireModel(base, "vertex/gemini-2.0-flash") == "gemini-2.0-flash");
});
