/** Server-sent events from a byte stream: yields the JSON `data:` payload of each event (multi-byte safe). */
export async function* sseEvents(body: ReadableStream<Uint8Array>): AsyncGenerator<Record<string, unknown>> {
  const reader = body.getReader();
  const dec = new TextDecoder();
  let buf = "";
  const parse = (block: string): Record<string, unknown> | null => {
    const data = block
      .split("\n")
      .filter((l) => l.startsWith("data:"))
      .map((l) => l.slice(5).trimStart())
      .join("\n");
    if (data.length === 0) return null;
    try {
      const v = JSON.parse(data) as unknown;
      return typeof v === "object" && v !== null ? (v as Record<string, unknown>) : null;
    } catch {
      return null;
    }
  };
  try {
    for (;;) {
      const { value, done } = await reader.read();
      buf += done ? dec.decode() : dec.decode(value, { stream: true });
      buf = buf.replace(/\r\n/g, "\n");
      let i = buf.indexOf("\n\n");
      while (i >= 0) {
        const ev = parse(buf.slice(0, i));
        buf = buf.slice(i + 2);
        if (ev) yield ev;
        i = buf.indexOf("\n\n");
      }
      if (done) break;
    }
    const tail = parse(buf);
    if (tail) yield tail;
  } finally {
    reader.releaseLock();
  }
}
