/**
 * Incremental parser of the SSE wire format (api §10): frames end with a blank line; `data:` lines are joined with
 * `\n`; `id:` is the seq (the JSON envelope carries it too); comment lines (`: hb`) and unknown fields are skipped.
 */

export interface SseFrame {
  id: string | null;
  data: string;
}

export function createFrameParser(onFrame: (f: SseFrame) => void): { push(chunk: string): void } {
  let buf = "";
  let id: string | null = null;
  let data: string[] = [];
  const line = (l: string) => {
    if (l === "") {
      if (data.length > 0) onFrame({ id, data: data.join("\n") });
      id = null;
      data = [];
      return;
    }
    if (l.startsWith(":")) return;
    const colon = l.indexOf(":");
    const field = colon === -1 ? l : l.slice(0, colon);
    let value = colon === -1 ? "" : l.slice(colon + 1);
    if (value.startsWith(" ")) value = value.slice(1);
    if (field === "data") data.push(value);
    else if (field === "id") id = value;
  };
  return {
    push(chunk) {
      buf += chunk;
      let start = 0;
      for (let nl = buf.indexOf("\n"); nl !== -1; nl = buf.indexOf("\n", start)) {
        const raw = buf.slice(start, nl);
        start = nl + 1;
        line(raw.endsWith("\r") ? raw.slice(0, -1) : raw);
      }
      buf = buf.slice(start);
    },
  };
}
