import { providerBaseUrl, providerLabel, PROVIDER_OPENAI, PROVIDER_DEEPSEEK, PROVIDER_CUSTOM } from "./onboarding.ts";

test("providerBaseUrl maps openai and deepseek to their base urls", () => {
  expect(providerBaseUrl(PROVIDER_OPENAI) == "https://api.openai.com/v1");
  expect(providerBaseUrl(PROVIDER_DEEPSEEK) == "https://api.deepseek.com");
});

test("providerBaseUrl returns empty for custom or an unrecognized choice", () => {
  expect(providerBaseUrl(PROVIDER_CUSTOM) == "");
  expect(providerBaseUrl("nonsense") == "");
});

test("providerLabel names each known choice and falls back to custom", () => {
  expect(providerLabel(PROVIDER_OPENAI) == "openai");
  expect(providerLabel(PROVIDER_DEEPSEEK) == "deepseek");
  expect(providerLabel(PROVIDER_CUSTOM) == "custom");
  expect(providerLabel("nonsense") == "custom");
});
