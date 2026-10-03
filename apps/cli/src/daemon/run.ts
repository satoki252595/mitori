/**
 * `mitori [<path>] [--no-open]` and `mitori _serve`: the daemon runs in the foreground of this process (composition
 * root `createServer`, daemon/server.ts) and prints its URL on stdout (RQ-CLI-1). With a path, the workspace is opened
 * in-process right after the URL is out: S0–S4 + the zero-token doc, then one stderr line with the counts and a login
 * URL for the browser. Detaching (`_serve` spawned headless) and opening the browser are WP-11's.
 */
import { readFileSync, realpathSync, statSync } from "node:fs";
import { basename } from "node:path";
import { parseArgs } from "node:util";
import { API_PREFIX, type DaemonRegistry, MitoriError, type NonceRes, type WorkspaceKey, type WorkspaceSummary } from "@mitori/core";
import { resolveHome } from "@mitori/platform";
import { BUILD_FLAVOUR } from "../build/flavour.ts";
import { type ServerDaemon, startServerDaemon } from "./server.ts";

const fail = (msg: string): number => {
  process.stderr.write(`mitori: ${msg}\n`);
  return 2;
};

/** Open `target` in-process and report on stderr once the zero-token doc is there. */
async function openWorkspace(d: ServerDaemon, target: string, force: boolean, version: string): Promise<void> {
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
    process.stderr.write(`mitori: ${basename(target)}: scan failed (see ~/.mitori/logs)\n`);
    return;
  }
  const files = rt.indexer.files().length;
  const modules = rt.indexer.modules().length;
  process.stderr.write(`mitori: ${basename(target)}: ${files} files, ${modules} modules (S0–S4 + static doc in ${Math.round(ms)} ms)\n`);
  const nonce = await loginUrl(d, rt.info.key, version).catch(() => null);
  if (nonce) process.stderr.write(`mitori: open ${nonce}\n`);
}

/** One-time login URL into the workspace (`POST /auth/nonce`, single use, 60 s). */
async function loginUrl(d: Pick<ServerDaemon, "url" | "token">, ws: WorkspaceKey, version: string): Promise<string> {
  const res = await fetch(`${d.url.replace(/\/$/, "")}${API_PREFIX}/auth/nonce`, {
    method: "POST",
    headers: { authorization: `Bearer ${d.token}`, "content-type": "application/json", "x-mitori-client": `cli/${version}` },
    body: JSON.stringify({ to: `/w/${ws}` }),
  });
  if (!res.ok) throw new Error(`nonce: ${res.status}`);
  return ((await res.json()) as NonceRes).url;
}

/**
 * The home already has a live daemon (its lock + health): print its URL (stdout, RQ-CLI-1) and, with a path, open the
 * workspace there. The version handshake and health proof (§1.2, SEC-06) are WP-11's `mitori` client.
 */
async function useRunning(home: string, target: string | null, force: boolean, version: string): Promise<number> {
  let reg: DaemonRegistry;
  try {
    reg = JSON.parse(readFileSync(`${home}/daemon.json`, "utf8")) as DaemonRegistry;
  } catch {
    process.stderr.write("mitori: a daemon holds the lock but its registry is not readable yet; try again\n");
    return 1;
  }
  const d = { url: `http://127.0.0.1:${reg.port}/`, token: reg.token };
  process.stdout.write(`${d.url}\n`);
  if (target === null) return 0;
  const res = await fetch(`http://127.0.0.1:${reg.port}${API_PREFIX}/workspaces`, {
    method: "POST",
    headers: { authorization: `Bearer ${reg.token}`, "content-type": "application/json", "x-mitori-client": `cli/${version}` },
    body: JSON.stringify({ target, force }),
  });
  if (!res.ok) {
    process.stderr.write(`mitori: ${basename(target)}: ${res.status} ${await res.text()}\n`);
    return 1;
  }
  const ws = ((await res.json()) as WorkspaceSummary).info.key;
  process.stderr.write(`mitori: open ${await loginUrl(d, ws, version)}\n`);
  return 0;
}

export async function runDaemon(mode: "open" | "serve", argv: readonly string[], version: string): Promise<number> {
  let parsed: ReturnType<typeof parse>;
  try {
    parsed = parse(argv);
  } catch (err) {
    return fail(`${err instanceof Error ? err.message : String(err)} (see mitori --help)`);
  }
  const { values, positionals } = parsed;
  const port = Number(values.port ?? process.env.MITORI_PORT ?? 0);
  if (!Number.isInteger(port) || port < 0 || port > 65535) return fail(`invalid port ${values.port ?? process.env.MITORI_PORT}`);

  let target: string | null = null;
  if (mode === "open") {
    const raw = positionals[0] ?? process.cwd();
    if (/^(https?:\/\/|github\.com\/)/.test(raw)) return fail("opening a GitHub URL arrives with WP-11");
    try {
      target = realpathSync(raw);
      if (!statSync(target).isDirectory()) throw new Error("not a directory");
    } catch {
      return fail(`${raw}: no such directory`);
    }
  } else if (positionals.length > 0) return fail("_serve takes no path");

  const home = resolveHome();
  let d: ServerDaemon;
  try {
    d = await startServerDaemon({ home, port, version, build: BUILD_FLAVOUR, logToStderr: process.env.MITORI_LOG_STDERR === "1" });
  } catch (err) {
    const e = MitoriError.from(err);
    if (e.code === "E_CONFLICT") return useRunning(home, target, values.force === true, version);
    process.stderr.write(`mitori: the daemon did not start: ${e.message}\n`);
    return 1;
  }
  const signalled = new Promise<void>((resolve) => {
    process.once("SIGINT", resolve);
    process.once("SIGTERM", resolve);
  });
  // stdout carries the URL only (testing spec RQ-CLI-1: scripts, CI and eval read it)
  process.stdout.write(`${d.url}\n`);
  if (target !== null)
    void openWorkspace(d, target, values.force === true, version).catch((err: unknown) => {
      process.stderr.write(`mitori: ${basename(target ?? "")}: ${err instanceof Error ? err.message : String(err)}\n`);
    });
  if (mode === "open" && !values["no-open"]) process.stderr.write("mitori: opening the browser arrives with WP-11 — use the login URL above\n");

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
    options: { "no-open": { type: "boolean" }, force: { type: "boolean" }, port: { type: "string" } },
  });
}
