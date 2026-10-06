import type { ImageModel, ModelOption, ProviderId } from "@/config/models";

// Provider-neutral shapes (see docs/ARCHITECTURE.md). Server-only.
export type TurnImage = { mime: string; data: string }; // base64
export type ChatTurn = { role: "user" | "assistant"; content: string; images?: TurnImage[] };

export interface Usage {
  input: number;     // prompt tokens
  output: number;    // billable output tokens, including reasoning/thinking
  reasoning: number; // part of output spent on reasoning (for reporting)
  cached: number;    // prompt tokens served from cache (reporting only; billed at full price to stay safe)
}

export type StreamEvent = { delta?: string; usage?: Usage };

export type ProviderErrorCode = "timeout" | "rate_limit" | "auth" | "unavailable" | "bad_request" | "not_configured" | "unknown";

export class ProviderError extends Error {
  constructor(public code: ProviderErrorCode, public status?: number, public started = false) {
    super(code);
  }
}

export interface StreamArgs {
  model: ModelOption;
  system: string;
  history: ChatTurn[];
  maxOutput: number;
  apiKey: string;
  signal: AbortSignal;
}

export interface ImageArgs {
  model: ImageModel;
  prompt: string;
  apiKey: string;
  signal: AbortSignal;
}

export interface GeneratedImage {
  mime: string;
  bytes: Uint8Array;
}

export interface ProviderAdapter {
  id: ProviderId;
  stream(args: StreamArgs): AsyncIterable<StreamEvent>;
  generateImage?(args: ImageArgs): Promise<GeneratedImage>;
}

export function errorForStatus(status: number): ProviderError {
  if (status === 401 || status === 403) return new ProviderError("auth", status);
  if (status === 429) return new ProviderError("rate_limit", status);
  if (status === 408 || status === 504) return new ProviderError("timeout", status);
  if (status >= 500) return new ProviderError("unavailable", status);
  if (status >= 400) return new ProviderError("bad_request", status);
  return new ProviderError("unknown", status);
}

/** Most chat APIs need strictly alternating turns that start with the user: merge repeats, drop a leading reply. */
export function normalizeTurns(history: ChatTurn[]): ChatTurn[] {
  const out: ChatTurn[] = [];
  for (const t of history) {
    if (!t.content.trim() && !t.images?.length) continue;
    if (out.length === 0 && t.role === "assistant") continue;
    const last = out[out.length - 1];
    if (last && last.role === t.role) {
      last.content = [last.content, t.content].filter(Boolean).join("\n\n");
      if (t.images?.length) last.images = [...(last.images ?? []), ...t.images];
    } else out.push({ ...t, images: t.images ? [...t.images] : undefined });
  }
  return out;
}

export function decodeBase64(b64: string): Uint8Array {
  return new Uint8Array(Buffer.from(b64, "base64"));
}
