import type { ProviderId } from "@/config/models";
import { anthropic } from "./anthropic";
import { google } from "./google";
import { openai } from "./openai";
import type { ProviderAdapter } from "./types";
import { xai } from "./xai";

export const ADAPTERS: Record<ProviderId, ProviderAdapter> = { openai, anthropic, google, xai };

const KEY_ENV: Record<ProviderId, string> = {
  openai: "OPENAI_API_KEY",
  anthropic: "ANTHROPIC_API_KEY",
  google: "GEMINI_API_KEY",
  xai: "XAI_API_KEY",
};

/** LIVE_MODELS=on → real provider calls (with budget checks). Anything else → mock replies, no cost. */
export function isLive(env: Record<string, string | undefined> = process.env): boolean {
  return (env.LIVE_MODELS ?? "").trim().toLowerCase() === "on";
}

/** The server-side API key for a provider, or null if it isn't set. Never send this to the client. */
export function apiKeyFor(provider: ProviderId, env: Record<string, string | undefined> = process.env): string | null {
  const v = env[KEY_ENV[provider]]?.trim();
  return v ? v : null;
}
