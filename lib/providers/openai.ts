import { readSse } from "./sse";
import { decodeBase64, errorForStatus, normalizeTurns, ProviderError, type ProviderAdapter } from "./types";

// OpenAI Responses API (streaming) + Images API.
export const openai: ProviderAdapter = {
  id: "openai",

  async *stream({ model, system, history, maxOutput, apiKey, signal }) {
    const res = await fetch("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: model.apiModel,
        instructions: system,
        input: normalizeTurns(history).map((t) => ({ role: t.role, content: t.content })),
        max_output_tokens: maxOutput,
        stream: true,
        store: false,
      }),
      signal,
    });
    if (!res.ok || !res.body) throw errorForStatus(res.status);

    for await (const { data } of readSse(res.body)) {
      if (data === "[DONE]") break;
      const ev = JSON.parse(data);
      if (ev.type === "response.output_text.delta" && ev.delta) yield { delta: ev.delta as string };
      else if (ev.type === "response.completed" || ev.type === "response.incomplete") {
        const u = ev.response?.usage;
        if (u) {
          yield {
            usage: {
              input: u.input_tokens ?? 0,
              output: u.output_tokens ?? 0,
              reasoning: u.output_tokens_details?.reasoning_tokens ?? 0,
              cached: u.input_tokens_details?.cached_tokens ?? 0,
            },
          };
        }
      } else if (ev.type === "response.failed" || ev.type === "error") {
        throw new ProviderError("unavailable", undefined, true);
      }
    }
  },

  async generateImage({ model, prompt, apiKey, signal }) {
    const res = await fetch("https://api.openai.com/v1/images/generations", {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({ model: model.apiModel, prompt, n: 1, size: "1024x1024" }),
      signal,
    });
    if (!res.ok) throw errorForStatus(res.status);
    const json = await res.json();
    const b64 = json.data?.[0]?.b64_json;
    if (!b64) throw new ProviderError("unknown", res.status, true);
    return { mime: "image/png", bytes: decodeBase64(b64) };
  },
};
