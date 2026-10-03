// Clear §3 (the flows) of a workspace so that a scoped real run (gen-real.ts --scope s3) regenerates it from scratch:
// re-measuring one prompt after a fix without paying for the whole document. DocStore API in-process; no LLM call.
//
//   scripts/nd bun bench/measure/gen-reset.ts <repo> <home>
import { resolve } from "node:path";
import { API_PREFIX, type BlockId, type SectionId, type WorkspaceKey, type WorkspaceStatus, type WorkspaceSummary } from "@mitori/core";
import type { DocStore } from "@mitori/doc";
import { startServerDaemon } from "../../apps/cli/src/daemon/server.ts";

const [repo, home] = process.argv.slice(2) as [string, string];
const d = await startServerDaemon({ home: resolve(home), port: 0, version: "0.0.0", build: "test", overrides: {} });
const origin = d.url.replace(/\/$/, "");
const call = async <T>(method: string, path: string, body?: unknown): Promise<T> => {
  const res = await fetch(`${origin}${API_PREFIX}${path}`, {
    method,
    headers: { authorization: `Bearer ${d.token}`, "x-mitori-client": "cli/reset", ...(body !== undefined ? { "content-type": "application/json" } : {}) },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
  if (!res.ok) throw new Error(`${method} ${path} → ${res.status} ${await res.text()}`);
  return (await res.json()) as T;
};
const summary = await call<WorkspaceSummary>("POST", "/workspaces", { target: resolve(repo) });
const ws = summary.info.key;
for (;;) {
  const st = await call<WorkspaceStatus>("GET", `/ws/${ws}`);
  if (st.state === "ready") break;
  await Bun.sleep(20);
}
const dom = (
  d.handle as unknown as {
    domain(ws: WorkspaceKey): { doc: DocStore & { flush(o?: { force?: boolean }): Promise<void> }; staticReady(): Promise<void> } | null;
  }
).domain(ws);
if (!dom) throw new Error("no domain");
await dom.staticReady();
const doc = dom.doc;
const subs = doc
  .sections()
  .filter((s) => s.id.startsWith("s3/"))
  .map((s) => s.id as SectionId);
const intro = (doc.section("s3")?.blocks ?? []).filter((b) => b.origin === "ai").map((b) => b.id as BlockId);
console.log(`removing ${subs.length} flow sections and ${intro.length} intro blocks`);
for (const s of subs) doc.removeSection(s);
if (intro.length > 0) doc.tombstone(intro);
await doc.flush({ force: true });
console.log(
  `s3 now: ${(doc.section("s3")?.blocks ?? []).filter((b) => b.origin === "ai").length} AI blocks, ${doc.sections().filter((s) => s.id.startsWith("s3/")).length} flows`,
);
await d.stop("reset");
process.exit(0);
