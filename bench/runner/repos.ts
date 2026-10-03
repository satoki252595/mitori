// Name → directory for `BenchDef.repo`: the pinned corpus clones (`bun run corpus:fetch`) or a built fixture.
import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { buildFixture, type FixtureName } from "@mitori/testkit";

export interface ResolvedRepo {
  path: string;
  dispose(): Promise<void>;
}

interface LockEntry {
  name: string;
  commit: string | null;
  tag?: string;
}

const noop = async () => {};

/** `<name>@<sha12>` — the cache directory scripts/fetch-corpus.ts writes. */
const cacheName = (e: LockEntry): string => `${e.name}@${e.commit ? e.commit.slice(0, 12) : (e.tag ?? "unpinned")}`;

/** `MITORI_BENCH_REPOS="flask=/abs/flask,hono=/abs/hono"` overrides the lookup (offline machines, scratch clones). */
function override(name: string, env: Record<string, string | undefined>): string | null {
  for (const pair of (env.MITORI_BENCH_REPOS ?? "").split(",")) {
    const [k, v] = pair.split("=");
    if (k?.trim() === name && v) return v.trim();
  }
  return null;
}

export async function resolveRepo(name: string, root: string, env: Record<string, string | undefined> = process.env): Promise<ResolvedRepo> {
  const forced = override(name, env);
  if (forced) {
    if (!existsSync(forced)) throw new Error(`MITORI_BENCH_REPOS: ${forced} does not exist`);
    return { path: forced, dispose: noop };
  }
  const lockFile = join(root, "bench/corpus.lock.json");
  const lock = existsSync(lockFile) ? (JSON.parse(readFileSync(lockFile, "utf8")) as { repos: LockEntry[] }) : { repos: [] };
  const entry = lock.repos.find((e) => e.name === name);
  if (entry) {
    const dir = join(env.MITORI_CORPUS_DIR ?? join(homedir(), ".cache", "mitori-corpus"), cacheName(entry));
    if (!existsSync(dir)) throw new Error(`corpus "${name}" is not fetched (${dir}): run \`bun run corpus:fetch --only ${name}\``);
    return { path: dir, dispose: noop };
  }
  const repo = await buildFixture(name as FixtureName);
  return { path: repo.root, dispose: () => repo.dispose() };
}
