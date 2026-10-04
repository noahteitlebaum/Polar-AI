// Models shown in the picker. Exact provider model IDs and prices are TBD:
// verify against each provider's official docs before promising them publicly.
export type ProviderId = "openai" | "anthropic" | "google" | "xai";

export interface ModelOption {
  id: string;          // our internal id (stable, used in stored messages)
  label: string;       // what students see
  provider: ProviderId;
  providerLabel: string;
  enabled: boolean;
}

export const MODELS: ModelOption[] = [
  { id: "openai-default", label: "GPT", provider: "openai", providerLabel: "OpenAI", enabled: true },
  { id: "anthropic-default", label: "Claude", provider: "anthropic", providerLabel: "Anthropic", enabled: true },
  { id: "google-default", label: "Gemini", provider: "google", providerLabel: "Google", enabled: true },
  { id: "xai-default", label: "Grok", provider: "xai", providerLabel: "xAI", enabled: true },
];

export const DEFAULT_MODEL_ID = MODELS[0].id;

export function getModel(id: string | undefined): ModelOption | undefined {
  return MODELS.find((m) => m.id === id);
}
