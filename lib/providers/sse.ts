// Minimal Server-Sent Events reader for provider streams: yields each event's `data` (and `event` name).
export async function* readSse(body: ReadableStream<Uint8Array>): AsyncGenerator<{ event?: string; data: string }> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  try {
    for (;;) {
      const { done, value } = await reader.read();
      buffer += done ? decoder.decode() : decoder.decode(value, { stream: true });
      buffer = buffer.replace(/\r\n/g, "\n");
      let sep: number;
      while ((sep = buffer.indexOf("\n\n")) >= 0) {
        const raw = buffer.slice(0, sep);
        buffer = buffer.slice(sep + 2);
        const parsed = parseEvent(raw);
        if (parsed) yield parsed;
      }
      if (done) {
        const parsed = parseEvent(buffer);
        if (parsed) yield parsed;
        return;
      }
    }
  } finally {
    reader.releaseLock();
  }
}

function parseEvent(raw: string): { event?: string; data: string } | null {
  let event: string | undefined;
  const data: string[] = [];
  for (const line of raw.split("\n")) {
    if (line.startsWith(":")) continue;
    const i = line.indexOf(":");
    const field = i < 0 ? line : line.slice(0, i);
    const value = i < 0 ? "" : line.slice(i + 1).replace(/^ /, "");
    if (field === "event") event = value;
    else if (field === "data") data.push(value);
  }
  return data.length ? { event, data: data.join("\n") } : null;
}
