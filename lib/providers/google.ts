import { readSse } from "./sse";
import { decodeBase64, errorForStatus, normalizeTurns, ProviderError, type ProviderAdapter } from "./types";

// Gemini API (streamGenerateContent over SSE) + native image generation.
const BASE = "https://generativelanguage.googleapis.com/v1beta/models";

export const google: ProviderAdapter = {
  id: "google",

  async *stream({ model, system, history, maxOutput, apiKey, signal }) {
    const res = await fetch(`${BASE}/${encodeURIComponent(model.apiModel)}:streamGenerateContent?alt=sse`, {
      method: "POST",
      headers: { "x-goog-api-key": apiKey, "Content-Type": "application/json" },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: system }] },
        contents: normalizeTurns(history).map((t) => ({
          role: t.role === "assistant" ? "model" : "user",
          parts: [{ text: t.content }],
        })),
        generationConfig: { maxOutputTokens: maxOutput },
      }),
      signal,
    });
    if (!res.ok || !res.body) throw errorForStatus(res.status);

    let usage: { promptTokenCount?: number; candidatesTokenCount?: number; thoughtsTokenCount?: number; cachedContentTokenCount?: number } | undefined;
    for await (const { data } of readSse(res.body)) {
      const ev = JSON.parse(data);
      if (ev.error) throw new ProviderError("unavailable", ev.error.code, true);
      for (const part of ev.candidates?.[0]?.content?.parts ?? []) {
        if (part.text && !part.thought) yield { delta: part.text as string };
      }
      if (ev.usageMetadata) usage = ev.usageMetadata; // cumulative; the last one wins
    }
    if (usage) {
      const thoughts = usage.thoughtsTokenCount ?? 0;
      yield {
        usage: {
          input: usage.promptTokenCount ?? 0,
          output: (usage.candidatesTokenCount ?? 0) + thoughts, // thinking is billed as output
          reasoning: thoughts,
          cached: usage.cachedContentTokenCount ?? 0,
        },
      };
    }
  },

  async generateImage({ model, prompt, apiKey, signal }) {
    const res = await fetch(`${BASE}/${encodeURIComponent(model.apiModel)}:generateContent`, {
      method: "POST",
      headers: { "x-goog-api-key": apiKey, "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [{ role: "user", parts: [{ text: prompt }] }],
        generationConfig: { responseModalities: ["TEXT", "IMAGE"] },
      }),
      signal,
    });
    if (!res.ok) throw errorForStatus(res.status);
    const json = await res.json();
    const part = (json.candidates?.[0]?.content?.parts ?? []).find((p: { inlineData?: unknown }) => p.inlineData);
    if (!part) throw new ProviderError("bad_request", res.status, true); // usually a safety refusal
    return { mime: part.inlineData.mimeType ?? "image/png", bytes: decodeBase64(part.inlineData.data) };
  },
};
