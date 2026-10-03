/**
 * `mitori [<path>|<github-url>] [--no-open] [--force]`, `mitori _serve [--detached]` and the client subcommands.
 *
 * - Subcommands (`review`, `bundle`, … — `commands/`) run as clients of the daemon. CR-PENDING(WP-11)
 *   cr-requests/WP-11.md #4: `main.ts` (WP-11a) sends every non-flag argv here, so the command table is consulted
 *   first; `main.ts` should dispatch to `commands/` itself (and print the full usage).
 * - `mitori <path>` with no daemon running: this process IS the daemon (composition root `createServer`,
 *   daemon/server.ts), prints its URL on stdout (RQ-CLI-1), opens the workspace in-process (S0–S4 + the zero-token
 *   doc), then opens the browser through a one-time login URL unless `--no-open`, `ui.openBrowser = false` or a tab is
 *   already connected [UXP-01]. With a daemon running (lock held → `E_CONFLICT`): verify it (health proof, SEC-06),
 *   apply the version rule, open the workspace there, print its URL and exit.
 * - `mitori _serve --detached`: the headless daemon the client commands start; it never writes to stdio (the parent
 *   exits and closes the pipes) and exits 0 quietly when another daemon won the race for the lock (CR m1-5).
 *
 * The module graph of the daemon (`./server.ts` → `@mitori/server`) is imported only on the daemon paths, so client
 * commands start in milliseconds.
 */
import { realpathSync, statSync } from "node:fs";
import { basename } from "node:path";
import { parseArgs } from "node:util";
import { API_PREFIX, MitoriError, type NonceRes, type SettingsView, type WorkspaceKey, type WorkspaceStatus } from "@mitori/core";
import { resolveHome } from "@mitori/platform";
import { BUILD_FLAVOUR } from "../build/flavour.ts";
import { openInBrowser } from "../commands/browser.ts";
import { apiOf, ensureDaemon } from "../commands/daemon-client.ts";
import { isCommand, runCommand } from "../commands/index.ts";
import { exitOf } from "../commands/io.ts";
import { drainStreams, realIo } from "../commands/process-io.ts";
import { homeOf } from "../commands/session.ts";
import type { ServerDaemon } from "./server.ts";

const fail = (msg: string): number => {
  process.stderr.write(`mitori: ${msg}\n`);
  return 2;
};

/** `https://github.com/<owner>/<repo>` (owner/repo per api `OpenWorkspaceReq`, SEC-14), from `github.com/o/r` too. */
export function githubTarget(raw: string): string | null {
  const m = /^(?:https?:\/\/)?(?:www\.)?github\.com\/([A-Za-z0-9](?:[A-Za-z0-9-]{0,38}))\/([A-Za-z0-9._-]{1,100}?)(?:\.git)?\/?$/.exec(raw);
  if (!m || m[2] === "." || m[2] === "..") return null;
  return `https://github.com/${m[1]}/${m[2]}`;
}

async function self<T>(d: Pick<ServerDaemon, "url" | "token">, version: string, method: string, path: string, body?: unknown): Promise<T> {
  const res = await fetch(`${d.url.replace(/\/$/, "")}${API_PREFIX}${path}`, {
    method,
    headers: { authorization: `Bearer ${d.token}`, "x-mitori-client": `cli/${version}`, ...(body !== undefined ? { "content-type": "application/json" } : {}) },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
  if (!res.ok) throw new Error(`${method} ${path}: ${res.status}`);
  return (await res.json()) as T;
}

/** Login URL into `/w/<ws>`; opens the browser too when wanted and no tab of the workspace is connected. */
async function announce(d: ServerDaemon, ws: WorkspaceKey, version: string, open: boolean): Promise<void> {
  const nonce = await self<NonceRes>(d, version, "POST", "/auth/nonce", { to: `/w/${ws}` });
  process.stderr.write(`mitori: open ${nonce.url}\n`);
  if (!open) return;
  const [settings, status] = await Promise.all([self<SettingsView>(d, version, "GET", "/settings"), self<WorkspaceStatus>(d, version, "GET", `/ws/${ws}`)]);
  if (settings.settings.ui.openBrowser && status.connectedTabs === 0) await realIo([], version).openUrl(nonce.url);
}

/** Open `target` in-process and report on stderr once the zero-token doc is there. */
async function openWorkspace(d: ServerDaemon, target: string, force: boolean, version: string, open: boolean): Promise<void> {
  const t0 = performance.now();
  let stopped = false;
  void d.stopped.then(() => {
    stopped = true;
  });
  const rt = await d.handle.workspaces.open(target, { force });
  while (!stopped && (rt.state === "loading" || rt.state === "scanning")) await new Promise((r) => setTimeout(r, 10));
  if (stopped) return;
  const ms = performance.now() - t0;
  if (rt.state === "error") {
    process.stderr.write(`mitori: ${rt.info.name}: scan failed (see ~/.mitori/logs)\n`);
    return;
  }
  const files = rt.indexer.files().length;
  const modules = rt.indexer.modules().length;
  process.stderr.write(`mitori: ${rt.info.name}: ${files} files, ${modules} modules (S0–S4 + static doc in ${Math.round(ms)} ms)\n`);
  await announce(d, rt.info.key, version, open).catch(() => undefined);
}

/** The home already has a live daemon: verify it, apply the version rule, open the workspace there. */
async function useRunning(target: string | null, force: boolean, version: string, open: boolean): Promise<number> {
  const io = realIo([], version);
  let d: Awaited<ReturnType<typeof ensureDaemon>>;
  try {
    d = await ensureDaemon(io, homeOf(io));
  } catch (err) {
    const { text } = exitOf(err);
    process.stderr.write(text);
    return 1;
  }
  process.stdout.write(`${d.origin}/\n`);
  if (target === null) return 0;
  const api = apiOf(io, d);
  try {
    const ws = await api.call("POST /workspaces", { params: {}, body: { target, ...(force ? { force: true } : {}) } });
    const nonce = await api.call("POST /auth/nonce", { params: {}, body: { to: `/w/${ws.info.key}` } });
    process.stderr.write(`mitori: open ${nonce.url}\n`);
    if (open) await openInBrowser(io, { home: homeOf(io), daemon: d, api }, ws.info.key, `/w/${ws.info.key}`);
  } catch (err) {
    process.stderr.write(exitOf(err).text);
    return 1;
  }
  return 0;
}

export async function runDaemon(mode: "open" | "serve", argv: readonly string[], version: string): Promise<number> {
  const [first] = argv;
  if (mode === "open" && first !== undefined && isCommand(first)) {
    const code = await runCommand(first, realIo(argv.slice(1), version));
    await drainStreams();
    // a started daemon is a child in its own session: exit without waiting for it
    process.exit(code);
  }
  let parsed: ReturnType<typeof parse>;
  try {
    parsed = parse(argv);
  } catch (err) {
    return fail(`${err instanceof Error ? err.message : String(err)} (see mitori --help)`);
  }
  const { values, positionals } = parsed;
  const detached = mode === "serve" && values.detached === true;
  const port = Number(values.port ?? process.env.MITORI_PORT ?? 0);
  if (!Number.isInteger(port) || port < 0 || port > 65535) return fail(`invalid port ${values.port ?? process.env.MITORI_PORT}`);
  if (mode === "open" && values.detached) return fail("--detached is for _serve");

  let target: string | null = null;
  if (mode === "open") {
    const raw = positionals[0] ?? process.cwd();
    if (positionals.length > 1) return fail(`unexpected argument ${positionals[1]}`);
    const gh = /github\.com\//.test(raw) ? githubTarget(raw) : null;
    if (/github\.com\//.test(raw) && !gh) return fail(`${raw}: not a GitHub repository URL (https://github.com/<owner>/<repo>)`);
    if (gh) target = gh;
    else
      try {
        target = realpathSync(raw);
        if (!statSync(target).isDirectory()) throw new Error("not a directory");
      } catch {
        return fail(`${raw}: no such directory`);
      }
  } else if (positionals.length > 0) return fail("_serve takes no path");
  const open = mode === "open" && values["no-open"] !== true;

  const { startServerDaemon } = await import("./server.ts");
  const home = resolveHome();
  let d: ServerDaemon;
  try {
    d = await startServerDaemon({ home, port, version, build: BUILD_FLAVOUR, logToStderr: !detached && process.env.MITORI_LOG_STDERR === "1" });
  } catch (err) {
    const e = MitoriError.from(err);
    if (e.code === "E_CONFLICT") return detached ? 0 : useRunning(target, values.force === true, version, open);
    if (!detached) process.stderr.write(`mitori: the daemon did not start: ${e.message}\n`);
    return 1;
  }
  const signalled = new Promise<void>((resolve) => {
    process.once("SIGINT", resolve);
    process.once("SIGTERM", resolve);
  });
  // stdout carries the URL only (testing spec RQ-CLI-1: scripts, CI and eval read it)
  if (!detached) process.stdout.write(`${d.url}\n`);
  if (target !== null) {
    const t = target;
    void openWorkspace(d, t, values.force === true, version, open).catch((err: unknown) => {
      process.stderr.write(`mitori: ${basename(t)}: ${err instanceof Error ? err.message : String(err)}\n`);
    });
  }

  await Promise.race([d.stopped, signalled]);
  await d.stop("signal");
  // the daemon is down (state DB closed, Workers terminated): nothing left to wait for in this process
  process.exit(0);
}

function parse(argv: readonly string[]) {
  return parseArgs({
    args: [...argv],
    allowPositionals: true,
    strict: true,
    options: { "no-open": { type: "boolean" }, force: { type: "boolean" }, port: { type: "string" }, detached: { type: "boolean" } },
  });
}
