// Talking to a test daemon from the export e2e: the bearer token is in the daemon's registry (`$MITORI_HOME/daemon.json`),
// the same file the CLI reads.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { TestDaemon } from "@mitori/testkit";

export interface DocCounts {
  blocks: number;
  claims: number;
  verified: number;
}

export interface DaemonApi {
  ws: string;
  get<T>(path: string): Promise<T>;
  counts(): Promise<DocCounts>;
}

export async function connect(d: TestDaemon): Promise<DaemonApi> {
  const token = (JSON.parse(readFileSync(join(d.home.dir, "daemon.json"), "utf8")) as { token: string }).token;
  const get = async <T>(path: string): Promise<T> => {
    const r = await fetch(`${d.url}/api/v1${path}`, { headers: { authorization: `Bearer ${token}`, "x-mitori-client": "cli/export-e2e" } });
    if (!r.ok) throw new Error(`GET ${path} → ${r.status} ${await r.text()}`);
    return (await r.json()) as T;
  };
  const list = await get<{ info: { key: string } }[]>("/workspaces");
  const ws = list[0]?.info.key;
  if (!ws) throw new Error("the daemon has no workspace");
  return {
    ws,
    get,
    async counts() {
      const o = await get<{ counts: DocCounts }>(`/ws/${ws}/doc`);
      return o.counts;
    },
  };
}

/** Poll until `done(counts)` holds (the daemon answers 503 while it scans: those polls are retried). */
export async function until(api: DaemonApi, done: (c: DocCounts) => boolean, what: string, timeoutMs = 60_000): Promise<DocCounts> {
  const t0 = Date.now();
  let last: DocCounts | null = null;
  while (Date.now() - t0 < timeoutMs) {
    try {
      const c = await api.counts();
      last = c;
      if (done(c)) return c;
    } catch {
      /* not ready yet */
    }
    await new Promise((r) => setTimeout(r, 150));
  }
  throw new Error(`timed out waiting for ${what} (last: ${JSON.stringify(last)})`);
}

/** The doc has stopped changing: two samples 700 ms apart are equal (an import runs in several watcher batches). */
export async function settled(api: DaemonApi, min: (c: DocCounts) => boolean, what: string): Promise<DocCounts> {
  let prev = "";
  let since = Date.now();
  return until(
    api,
    (c) => {
      const cur = JSON.stringify(c);
      if (cur !== prev) {
        prev = cur;
        since = Date.now();
      }
      return min(c) && Date.now() - since >= 900;
    },
    what,
  );
}
