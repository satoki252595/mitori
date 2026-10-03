/** A raw `GET /events` reader for server tests (the real client lives in @mitori/client, which server cannot import). */
import { API_PREFIX, type SseEvent } from "@mitori/core";

export interface SseReader {
  events: SseEvent[];
  comments: string[];
  /** Bytes received before the first event (`:\n\n`). */
  prelude: string;
  status: number;
  until(pred: (events: SseEvent[]) => boolean, ms?: number): Promise<void>;
  close(): void;
  closed: Promise<void>;
  /** Receive timestamps (performance.now) per event index. */
  times: number[];
}

export async function openSse(origin: string, auth: string, query = ""): Promise<SseReader> {
  const ac = new AbortController();
  const res = await fetch(`${origin}${API_PREFIX}/events${query}`, {
    headers: { authorization: auth, "x-mitori-client": "web/test", "sec-fetch-site": "same-origin" },
    signal: ac.signal,
  });
  const events: SseEvent[] = [];
  const times: number[] = [];
  const comments: string[] = [];
  const waiters = new Set<() => void>();
  const r: SseReader = {
    events,
    comments,
    times,
    prelude: "",
    status: res.status,
    async until(pred, ms = 3000) {
      const end = performance.now() + ms;
      while (!pred(events)) {
        if (performance.now() > end) throw new Error(`SSE wait timed out with ${events.length} events: ${events.map((e) => e.type).join(",")}`);
        await new Promise<void>((resolve) => {
          const t = setTimeout(resolve, 20);
          waiters.add(() => {
            clearTimeout(t);
            resolve();
          });
        });
      }
    },
    close: () => ac.abort(),
    closed: Promise.resolve(),
  };
  if (!res.body) return r;
  const reader = res.body.pipeThrough(new TextDecoderStream()).getReader();
  r.closed = (async () => {
    let buf = "";
    let first = true;
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += value;
        let idx = buf.indexOf("\n\n");
        while (idx !== -1) {
          const frame = buf.slice(0, idx);
          buf = buf.slice(idx + 2);
          if (first && frame === ":") r.prelude = ":\n\n";
          first = false;
          const data = frame
            .split("\n")
            .filter((l) => l.startsWith("data: "))
            .map((l) => l.slice(6))
            .join("\n");
          if (data) {
            events.push(JSON.parse(data) as SseEvent);
            times.push(performance.now());
          } else if (frame.startsWith(": ")) comments.push(frame.slice(2));
          idx = buf.indexOf("\n\n");
        }
        for (const w of [...waiters]) w();
        waiters.clear();
      }
    } catch {
      // aborted
    }
  })();
  return r;
}
