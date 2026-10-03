/**
 * SRV-AT-03 load client: N `GET /events` streams in their own thread (like browser tabs in their own processes), so
 * the latency measured is the daemon's fan-out, not the readers competing with it for the event loop. Reports the
 * absolute arrival time (`timeOrigin + now`) of the chunk carrying each `thread.removed` frame, per connection.
 */
declare const self: Worker;

interface Start {
  origin: string;
  auth: string;
  query: string;
  connections: number;
  expect: number;
}

async function consume(start: Start, out: number[], onHello: () => void): Promise<void> {
  const res = await fetch(`${start.origin}/api/v1/events${start.query}`, { headers: { authorization: start.auth, "x-mitori-client": "web/load" } });
  const reader = (res.body as ReadableStream<Uint8Array>).getReader();
  const dec = new TextDecoder();
  let buf = "";
  let hello = false;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) return;
    const at = performance.timeOrigin + performance.now();
    buf += dec.decode(value, { stream: true });
    let end = buf.indexOf("\n\n");
    while (end !== -1) {
      const frame = buf.slice(0, end);
      buf = buf.slice(end + 2);
      if (!hello && frame.includes('"type":"hello"')) {
        hello = true;
        onHello();
      } else if (frame.includes('"type":"thread.removed"')) out.push(at);
      end = buf.indexOf("\n\n");
    }
    if (out.length >= start.expect) {
      await reader.cancel();
      return;
    }
  }
}

self.onmessage = async (msg: MessageEvent<Start>) => {
  const start = msg.data;
  const arrivals: number[][] = Array.from({ length: start.connections }, () => []);
  let ready = 0;
  await Promise.all(
    arrivals.map((out) =>
      consume(start, out, () => {
        ready += 1;
        if (ready === start.connections) self.postMessage({ kind: "ready" });
      }),
    ),
  );
  self.postMessage({ kind: "done", arrivals });
};
