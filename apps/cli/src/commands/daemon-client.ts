/**
 * Finding and talking to the daemon (ARCHITECTURE §2.2, server spec §1.1–§1.2, SEC-06): `~/.mitori/daemon.json`
 * (`DaemonRegistry`, 0600) → PID alive → `GET /health?challenge=<16 random bytes>` with `proof = HMAC(token,
 * challenge)` verified BEFORE the bearer token is sent anywhere (`probeDaemon`) → version handshake. Write commands
 * start `mitori _serve` detached when there is none; `touch` never does.
 */
import { readFileSync, statSync } from "node:fs";
import { type ApiClient, createApiClient, probeDaemon } from "@mitori/client";
import { API_PREFIX, type ClientKind, type DaemonRegistry, type HealthRes, HTTP_HEADERS, MitoriError } from "@mitori/core";
import type { Io } from "./io.ts";

/** A daemon that proved it holds the registry's token. */
export interface Daemon {
  /** `http://127.0.0.1:<port>`. */
  origin: string;
  registry: DaemonRegistry;
  health: HealthRes;
  /** This call's child is still alive and owns the verified registry (not another concurrent starter). */
  startedHere?: true;
}

/** Start/stop waits (MCP `daemonStartMs` 5 s; stop = server `DAEMON.drainMs` 10 s + flush). */
export const DAEMON_WAIT = { startMs: 5000, stopMs: 15_000, pollMs: 25 } as const;
/** `DAEMON.healthTimeoutMs` (server contract). */
const HEALTH_TIMEOUT_MS = 1500;
const API_VERSION = 1;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Same check as platform `pidAlive` (EPERM = alive but not ours to signal). */
export function pidAlive(pid: number): boolean {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    return (err as { code?: string }).code === "EPERM";
  }
}

/** The registry, or null when missing/unreadable. Pure and silent (`touch` must print nothing whatever it finds). */
export function readRegistry(home: string): DaemonRegistry | null {
  let reg: DaemonRegistry;
  try {
    reg = JSON.parse(readFileSync(`${home}/daemon.json`, "utf8")) as DaemonRegistry;
  } catch {
    return null;
  }
  return typeof reg?.port === "number" && typeof reg.token === "string" && typeof reg.pid === "number" ? reg : null;
}

/** True when the registry (it holds the bearer token) is readable by other users. */
export function registryExposed(home: string): boolean {
  try {
    return (statSync(`${home}/daemon.json`).mode & 0o077) !== 0;
  } catch {
    return false;
  }
}

/** The running daemon when its PID is alive and its health proves the token; else null (never sends the token). */
export async function findDaemon(io: Io, home: string, timeoutMs = HEALTH_TIMEOUT_MS): Promise<Daemon | null> {
  const registry = readRegistry(home);
  if (!registry || !pidAlive(registry.pid)) return null;
  const origin = `http://127.0.0.1:${registry.port}`;
  const health = await probeDaemon({ origin, token: registry.token, challenge: io.random.bytes(16), fetch: io.fetch, timeoutMs });
  // a reused PID or a squatter on the port cannot produce the proof; a pid mismatch means a stale registry
  if (!health || health.pid !== registry.pid) return null;
  return { origin, registry, health };
}

/** Typed API client with the bearer token, `x-mitori-client` and the Pull headers. */
export function apiOf(io: Io, d: Daemon, opts: { kind?: ClientKind; agent?: string; waiter?: string } = {}): ApiClient {
  const headers: Record<string, string> = {};
  if (opts.agent) headers[HTTP_HEADERS.agent] = opts.agent;
  if (opts.waiter) headers[HTTP_HEADERS.waiter] = opts.waiter;
  return createApiClient({
    base: `${d.origin}${API_PREFIX}`,
    auth: { scheme: "bearer", token: () => d.registry.token },
    client: { kind: opts.kind ?? "cli", version: io.version },
    headers,
    fetch: io.fetch,
  });
}

/** Version decision (server spec §1.2) — the table of server `decideVersionAction`, without loading the daemon code. */
export function versionAction(
  cli: { version: string; apiVersion: number },
  daemon: { version: string; apiVersion: number; idle: boolean },
): "use" | "restart" | "error" {
  if (cli.version === daemon.version) return "use";
  if (daemon.idle) return "restart";
  return cli.apiVersion === daemon.apiVersion ? "use" : "error";
}

async function waitFor<T>(io: Io, ms: number, probe: () => Promise<T | null> | T | null): Promise<T | null> {
  const until = io.clock.now() + ms;
  for (;;) {
    const v = await probe();
    if (v !== null) return v;
    if (io.clock.now() >= until) return null;
    await sleep(DAEMON_WAIT.pollMs);
  }
}

/**
 * Stop `d` and wait until it is gone: its process exited, or it removed its registry — the last step of its shutdown
 * (a daemon whose parent has not reaped it yet still answers `kill(pid, 0)`).
 */
export async function stopDaemon(io: Io, d: Daemon, reason: string, home: string, opts: { onlyIfIdle?: boolean } = {}): Promise<boolean> {
  try {
    await apiOf(io, d).call("POST /daemon/shutdown", { params: {}, body: { reason, ...opts } });
  } catch {
    if (opts.onlyIfIdle) return false;
    // already going away
  }
  const gone = () => !pidAlive(d.registry.pid) || readRegistry(home)?.pid !== d.registry.pid;
  return (await waitFor(io, DAEMON_WAIT.stopMs, () => (gone() ? true : null))) === true;
}

async function idle(io: Io, d: Daemon): Promise<boolean> {
  try {
    const s = await apiOf(io, d).call("GET /daemon", { params: {} });
    return s.scheduler.running === 0 && s.scheduler.queued === 0;
  } catch {
    return false;
  }
}

/**
 * The daemon, started headless when there is none (single writer: write commands go through it). A daemon of
 * another version is restarted when idle, used with a warning when busy with the same API version, and refused
 * (`E_VERSION_MISMATCH`) when busy with another API version. `restart: false` preserves existing daemons.
 */
export async function ensureDaemon(io: Io, home: string, opts: { restart?: boolean } = {}): Promise<Daemon> {
  const found = await findDaemon(io, home);
  if (found && registryExposed(home))
    io.err(`mitori: warning: ${home}/daemon.json is readable by other users (it holds the daemon token); run \`mitori stop\` and start again\n`);
  if (found) {
    if (found.health.version === io.version) return found;
    const action = versionAction(
      { version: io.version, apiVersion: API_VERSION },
      { ...found.health, idle: opts.restart !== false && (await idle(io, found)) },
    );
    if (action === "use") {
      io.err(`mitori: warning: the running daemon is v${found.health.version} (this CLI is v${io.version}); it stays\n`);
      return found;
    }
    if (action === "error")
      throw new MitoriError("E_VERSION_MISMATCH", `the running daemon speaks API v${found.health.apiVersion} and is busy`, {
        params: { daemon: found.health.version, cli: io.version },
      });
    if (!(await stopDaemon(io, found, "version", home))) throw new MitoriError("E_CONFLICT", `the v${found.health.version} daemon did not stop`);
  }
  const child = io.spawnDaemon(home);
  let exited = false;
  void child?.exited.then(() => {
    exited = true;
  });
  const d = await waitFor(io, DAEMON_WAIT.startMs, () => findDaemon(io, home, 500));
  if (!d) throw new MitoriError("E_NOT_READY", "the mitori daemon did not start", { hint: `see ${home}/logs` });
  return child?.pid === d.registry.pid && !exited ? { ...d, startedHere: true } : d;
}
