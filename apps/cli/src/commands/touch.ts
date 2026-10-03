/**
 * `mitori touch --stdin [--source claude-hook|codex-hook]` — the PostToolUse hook (loop spec §10.6). Reads the hook
 * JSON (≤ 1 MiB), finds the registered workspace of each edited file (never opens one, never starts a daemon) and
 * sends `POST /ws/:ws/touch` within 2 s. It prints NOTHING on stdout or stderr and always exits 0: hook output lands
 * in the agent's context, and a missing daemon must not slow the agent down (≤ 50 ms without one, AC-L74).
 * `mitori touch <path>…` does the same for paths given by hand (`source: cli`).
 */
import type { WorkspaceKey } from "@mitori/core";
import { resolveHome } from "@mitori/platform";
import { parse } from "./args.ts";
import { apiOf, findDaemon, pidAlive, readRegistry } from "./daemon-client.ts";
import type { Io } from "./io.ts";
import { parseTouchHook, TOUCH_LIMITS } from "./loop-contract.ts";
import { real, workspaceContaining } from "./workspace.ts";

const SOURCES = ["claude-hook", "codex-hook", "cli"] as const;

function withDeadline<T>(p: Promise<T>, ms: number): Promise<T | null> {
  return Promise.race([p, new Promise<null>((r) => setTimeout(() => r(null), Math.max(0, ms)).unref?.())]);
}

async function touch(io: Io): Promise<void> {
  const t0 = io.clock.now();
  const left = () => TOUCH_LIMITS.totalMs - (io.clock.now() - t0);
  const { values, positionals } = parse(io.argv, { stdin: { type: "boolean" }, source: { type: "string" } }, "touch");
  const source = (SOURCES as readonly string[]).includes(values.source ?? "")
    ? (values.source as (typeof SOURCES)[number])
    : values.stdin
      ? "claude-hook"
      : "cli";
  // the registry is the cheapest "is anything running" check: no home, no registry, no live pid ⇒ done
  const home = resolveHome({ env: io.env, create: false });
  const reg = readRegistry(home);
  if (!reg || !pidAlive(reg.pid)) return;
  let paths: string[];
  if (values.stdin) {
    const raw = await withDeadline(io.stdin(TOUCH_LIMITS.maxStdinBytes), left());
    paths = raw === null ? [] : parseTouchHook(raw);
  } else paths = positionals.map((p) => (p.startsWith("/") ? p : `${io.cwd}/${p}`));
  if (paths.length === 0) return;
  const d = await findDaemon(io, home, Math.min(TOUCH_LIMITS.daemonTimeoutMs, left()));
  if (!d) return;
  const api = apiOf(io, d, { kind: source === "cli" ? "cli" : "hook" });
  const signal = AbortSignal.timeout(Math.max(1, Math.min(TOUCH_LIMITS.daemonTimeoutMs, left())));
  const list = await api.call("GET /workspaces", { params: {}, signal });
  const byWs = new Map<WorkspaceKey, string[]>();
  for (const p of paths) {
    const abs = real(p);
    const w = workspaceContaining(list, abs) ?? workspaceContaining(list, p);
    if (w) byWs.set(w.info.key, [...(byWs.get(w.info.key) ?? []), abs]);
  }
  await Promise.all([...byWs].map(([ws, ps]) => api.call("POST /ws/:ws/touch", { params: { ws }, body: { paths: ps, source }, signal })));
}

export async function run(io: Io): Promise<number> {
  try {
    await withDeadline(touch(io), TOUCH_LIMITS.totalMs);
  } catch {
    // by contract: nothing on stdout/stderr, exit 0 (failures are the daemon's log)
  }
  return 0;
}
