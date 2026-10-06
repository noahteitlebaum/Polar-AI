import { readSse } from "./sse";
import { decodeBase64, errorForStatus, normalizeTurns, ProviderError, type ProviderAdapter } from "./types";

// xAI (OpenAI-compatible Chat Completions, streaming) + Imagine image generation.
export const xai: ProviderAdapter = {
  id: "xai",

  async *stream({ model, system, history, maxOutput, apiKey, signal }) {
    const res = await fetch("https://api.x.ai/v1/chat/completions", {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: model.apiModel,
        messages: [{ role: "system", content: system }, ...normalizeTurns(history)],
        max_tokens: maxOutput,
        stream: true,
        stream_options: { include_usage: true },
      }),
      signal,
    });
    if (!res.ok || !res.body) throw errorForStatus(res.status);

    for await (const { data } of readSse(res.body)) {
      if (data === "[DONE]") break;
      const ev = JSON.parse(data);
      if (ev.error) throw new ProviderError("unavailable", undefined, true);
      const delta = ev.choices?.[0]?.delta?.content;
      if (delta) yield { delta: delta as string };
      if (ev.usage) {
        const reasoning = ev.usage.completion_tokens_details?.reasoning_tokens ?? 0;
        yield {
          usage: {
            input: ev.usage.prompt_tokens ?? 0,
            // Counted on top of completion tokens: if xAI already includes them we over-charge slightly, never under.
            output: (ev.usage.completion_tokens ?? 0) + reasoning,
            reasoning,
            cached: ev.usage.prompt_tokens_details?.cached_tokens ?? 0,
          },
        };
      }
    }
  },

  async generateImage({ model, prompt, apiKey, signal }) {
    const res = await fetch("https://api.x.ai/v1/images/generations", {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({ model: model.apiModel, prompt, n: 1, response_format: "b64_json" }),
      signal,
    });
    if (!res.ok) throw errorForStatus(res.status);
    const json = await res.json();
    const b64 = json.data?.[0]?.b64_json;
    if (!b64) throw new ProviderError("unknown", res.status, true);
    return { mime: "image/jpeg", bytes: decodeBase64(b64) };
  },
};
