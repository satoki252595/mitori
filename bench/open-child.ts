// Child of `bench/open.bench.ts` (one cold open per process): the real daemon composition in-process (apps/cli
// `startServerDaemon` → `@mitori/server`, as the binary runs it) with the given MITORI_HOME; POST /workspaces on
// <root>, wait until the scan and the static doc are applied (`staticReady`).
// Prints one JSON line: { open, scan, timings } — open = S0–S4 + the static (0-token) doc, scan = the indexer's own
// S0–S4 total (`scan.done`), ms. A release build, as shipped: the dev / test build's slow-write-slot assertion (50 ms)
// is a development check, and on a loaded bench machine it aborted the open instead of timing it.
// Usage: bun bench/open-child.ts <root> <home> [--partition]
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { API_PREFIX, type RepoSnapshot, type WorkspaceKey, type WorkspaceStatus, type WorkspaceSummary } from "@mitori/core";
import { startServerDaemon } from "../apps/cli/src/daemon/server.ts";
import type { WorkspaceDomain } from "../packages/server/src/wiring/workspace.ts";

const [root, home, probe] = process.argv.slice(2);
if (!root || !home) {
  console.error("usage: bun bench/open-child.ts <root> <home>");
  process.exit(2);
}
const version = (JSON.parse(readFileSync(join(import.meta.dir, "../apps/cli/package.json"), "utf8")) as { version: string }).version;
const d = await startServerDaemon({ home, port: 0, version, build: "release", overrides: { gateSandbox: "none" } });
const origin = d.url.replace(/\/$/, "");
const call = async <T>(method: string, path: string, body?: unknown): Promise<T> => {
  const res = await fetch(`${origin}${API_PREFIX}${path}`, {
    method,
    headers: { authorization: `Bearer ${d.token}`, "x-mitori-client": "cli/bench", ...(body !== undefined ? { "content-type": "application/json" } : {}) },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
  if (!res.ok) throw new Error(`${method} ${path} → ${res.status} ${await res.text()}`);
  return (await res.json()) as T;
};
const handle = d.handle as typeof d.handle & { domain(ws: WorkspaceKey): WorkspaceDomain | null };
try {
  const t0 = performance.now();
  const s = await call<WorkspaceSummary>("POST", "/workspaces", { target: root });
  for (;;) {
    const st = await call<WorkspaceStatus>("GET", `/ws/${s.info.key}`);
    if (st.state === "error") throw new Error(`open failed: ${JSON.stringify(st.lastError)}`);
    if (st.state === "ready") break;
    await Bun.sleep(5);
  }
  const domain = handle.domain(s.info.key);
  await domain?.staticReady();
  const open = performance.now() - t0;
  const t = domain?.indexer.lastTimings() ?? null;
  let partition: { source: RepoSnapshot; modules: string[]; plan: string[] } | undefined;
  if (probe === "--partition") {
    if (!domain) throw new Error("opened workspace has no domain");
    await domain.doc.flush({ force: true });
    const source = domain.indexer.snapshot();
    if (!source) throw new Error("opened workspace has no source snapshot");
    const est = await domain.gen.estimate({ effort: "complete" });
    partition = {
      source,
      modules: domain.indexer
        .modules()
        .map((m) => `${m.id} ${m.slug} ${m.parent ?? "-"} ${[...m.paths].sort().join(",")}`)
        .sort(),
      plan: est.stages.map((s) => `${s.stage} tasks=${s.tasks} in=${s.inTokens}`),
    };
  }
  console.log(JSON.stringify({ open: Math.round(open * 10) / 10, scan: t ? Math.round(t.total * 10) / 10 : null, timings: t, partition }));
} finally {
  await d.stop("bench");
}
