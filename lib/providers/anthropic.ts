import { readSse } from "./sse";
import { errorForStatus, normalizeTurns, ProviderError, type ProviderAdapter } from "./types";

// Anthropic Messages API (streaming). Claude has no image generation.
export const anthropic: ProviderAdapter = {
  id: "anthropic",

  async *stream({ model, system, history, maxOutput, apiKey, signal }) {
    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
        "content-type": "application/json",
      },
      body: JSON.stringify({
        model: model.apiModel,
        max_tokens: maxOutput,
        system,
        messages: normalizeTurns(history),
        stream: true,
      }),
      signal,
    });
    if (!res.ok || !res.body) throw errorForStatus(res.status);

    let input = 0;
    let cached = 0;
    let output = 0;
    for await (const { data } of readSse(res.body)) {
      const ev = JSON.parse(data);
      switch (ev.type) {
        case "message_start": {
          const u = ev.message?.usage ?? {};
          cached = (u.cache_read_input_tokens ?? 0) + (u.cache_creation_input_tokens ?? 0);
          input = (u.input_tokens ?? 0) + cached;
          output = u.output_tokens ?? 0;
          break;
        }
        case "content_block_delta":
          if (ev.delta?.type === "text_delta" && ev.delta.text) yield { delta: ev.delta.text as string };
          break;
        case "message_delta":
          if (ev.usage?.output_tokens != null) output = ev.usage.output_tokens;
          break;
        case "message_stop":
          yield { usage: { input, output, reasoning: 0, cached } };
          return;
        case "error":
          throw new ProviderError(ev.error?.type === "overloaded_error" ? "unavailable" : "unknown", undefined, true);
      }
    }
  },
};
