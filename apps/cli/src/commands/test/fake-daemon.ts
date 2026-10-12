/**
 * Test harness for the client commands: a loopback HTTP server that answers the health challenge like the daemon
 * (proof = HMAC-SHA256(token, challenge)), a registry in a temp `MITORI_HOME`, scripted routes, and a recording
 * {@link Io}. Routes are keyed like `ApiRoutes` (`"GET /ws/:ws/review/wait"`); unscripted routes answer 501
 * `E_UNSUPPORTED` the way the composed daemon does for unwired features.
 */
import { createHmac } from "node:crypto";
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { API_PREFIX, type DaemonRegistry, type ErrorCode, ROUTE_META, type WorkspaceSummary } from "@mitori/core";
import type { Io } from "../io.ts";

export const TOKEN = "tok_0123456789abcdefghijklmnopqrstuvwxyzABCDEFG";
export const VERSION = "9.9.9";
export const WS = "ws_0123456789ab";

export interface Seen {
  method: string;
  path: string;
  query: URLSearchParams;
  headers: Headers;
  body: unknown;
}

export interface Ctx {
  params: Record<string, string>;
  query: URLSearchParams;
  body: unknown;
  headers: Headers;
}

/** A handler returns JSON, a Response, or throws {@link ApiFail}. */
export type Handler = (ctx: Ctx) => unknown;

export class ApiFail {
  constructor(
    readonly status: number,
    readonly code: ErrorCode,
    readonly message: string = code,
  ) {}
}

export interface FakeDaemon {
  home: string;
  /** Repository root (a temp dir with `.git/`). */
  repo: string;
  dir: string;
  port: number;
  origin: string;
  seen: Seen[];
  route(key: string, h: Handler): void;
  /** Requests to `key` (method + pattern). */
  calls(key: string): Seen[];
  /** Write the registry (with overrides); `null` removes it. */
  registry(patch?: Partial<DaemonRegistry> | null): void;
  stop(): Promise<void>;
  cleanup(): Promise<void>;
}

const hmac = (token: string, challenge: string) => createHmac("sha256", token).update(challenge).digest("hex");

function match(pattern: string, path: string): Record<string, string> | null {
  const p = pattern.split("/");
  const a = path.split("/");
  if (p.length !== a.length) return null;
  const out: Record<string, string> = {};
  for (let i = 0; i < p.length; i++) {
    const seg = p[i] as string;
    if (seg.startsWith(":")) out[seg.slice(1)] = decodeURIComponent(a[i] as string);
    else if (seg !== a[i]) return null;
  }
  return out;
}

/** Default workspace summary for the fake repo. */
export function summary(root: string, extra: Partial<WorkspaceSummary["info"]> = {}): WorkspaceSummary {
  return {
    info: { key: WS as WorkspaceSummary["info"]["key"], root, kind: "git", name: "repo", docDir: ".mitori", docCommitted: false, ...extra },
    state: "ready",
    counts: { files: 3, loc: 30, modules: 1, openThreads: 2, staleBlocks: 1, runningJobs: 0 },
    doc: { exists: true, generatedAt: null, effort: null, lang: "ja", commitsBehind: null },
  };
}

export async function startFakeDaemon(
  opts: { version?: string; apiVersion?: number; token?: string; healthToken?: string; pid?: number; startedAt?: string } = {},
): Promise<FakeDaemon> {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), "mitori-cli-")));
  const home = join(dir, "home");
  const repo = join(dir, "repo");
  mkdirSync(home, { mode: 0o700 });
  mkdirSync(join(repo, ".git"), { recursive: true });
  mkdirSync(join(repo, "src"));
  const token = opts.token ?? TOKEN;
  const seen: Seen[] = [];
  const routes = new Map<string, Handler>();
  const version = opts.version ?? VERSION;
  const pid = opts.pid ?? process.pid;
  const startedAt = opts.startedAt ?? "2026-10-04T00:00:00.000Z";

  routes.set("GET /workspaces", () => [summary(repo)]);
  routes.set("POST /workspaces", () => summary(repo));
  routes.set("GET /settings", () => ({
    settings: { ui: { openBrowser: true }, defaultDocLang: "ja", defaultEngine: "claude-cli", defaultGenEngine: "claude-cli" },
    path: `${home}/config.json`,
    version: 1,
  }));
  routes.set("POST /auth/nonce", (c) => ({
    url: `http://127.0.0.1:${server.port}/auth#n=nonce123&to=${(c.body as { to?: string }).to ?? "/"}`,
    expiresAt: "2026-10-04T00:01:00.000Z",
  }));

  const server = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    async fetch(req) {
      const url = new URL(req.url);
      const path = url.pathname.slice(API_PREFIX.length) || "/";
      if (path === "/health") {
        const c = url.searchParams.get("challenge");
        return Response.json({
          ok: true,
          version,
          apiVersion: opts.apiVersion ?? 1,
          pid,
          startedAt,
          build: "test",
          ...(c ? { proof: hmac(opts.healthToken ?? token, c) } : {}),
        });
      }
      const text = req.method === "GET" ? "" : await req.text();
      const body = text === "" ? undefined : JSON.parse(text);
      seen.push({ method: req.method, path, query: url.searchParams, headers: req.headers, body });
      if (req.headers.get("authorization") !== `Bearer ${token}`)
        return Response.json({ error: { code: "E_AUTH_REQUIRED", message: "auth", retryable: false } }, { status: 401 });
      // Same gate as the real daemon (`ROUTE_META.clients` ⇒ 403 E_FORBIDDEN): CLI regressions must fail here
      // when production code calls a route that does not accept cli clients [CR setup-save-1].
      const declared = req.headers.get("x-mitori-client")?.split("/", 1)[0] ?? null;
      const kinds = ["web", "cli", "mcp", "hook"] as const;
      const client = declared !== null && (kinds as readonly string[]).includes(declared) && declared !== "web" ? declared : "cli";
      for (const [key, meta] of Object.entries(ROUTE_META)) {
        const [method, pattern] = key.split(" ") as [string, string];
        if (method !== req.method || match(pattern, path) === null) continue;
        if ("clients" in meta && meta.clients && !(meta.clients as readonly string[]).includes(client))
          return Response.json({ error: { code: "E_FORBIDDEN", message: `${key} is not available to ${client} clients`, retryable: false } }, { status: 403 });
        break;
      }
      for (const [key, h] of routes) {
        const [method, pattern] = key.split(" ") as [string, string];
        if (method !== req.method) continue;
        const params = match(pattern, path);
        if (!params) continue;
        try {
          const out = await h({ params, query: url.searchParams, body, headers: req.headers });
          if (out instanceof Response) return out;
          return typeof out === "string" ? new Response(out, { headers: { "content-type": "text/plain" } }) : Response.json(out ?? null);
        } catch (e) {
          if (e instanceof ApiFail) return Response.json({ error: { code: e.code, message: e.message, retryable: e.status === 503 } }, { status: e.status });
          throw e;
        }
      }
      return Response.json({ error: { code: "E_UNSUPPORTED", message: `no fake for ${req.method} ${path}`, retryable: false } }, { status: 501 });
    },
  });
  const port = server.port ?? 0;
  const writeRegistry = (patch: Partial<DaemonRegistry> | null = {}) => {
    const p = join(home, "daemon.json");
    if (patch === null) return rmSync(p, { force: true });
    const reg: DaemonRegistry = { pid, port, token, version, apiVersion: 1, startedAt, ...patch };
    writeFileSync(p, JSON.stringify(reg), { mode: 0o600 });
  };
  writeRegistry();
  let stopped = false;
  const stop = async () => {
    if (stopped) return;
    stopped = true;
    await server.stop(true);
  };
  return {
    home,
    repo,
    dir,
    port,
    origin: `http://127.0.0.1:${port}`,
    seen,
    route: (key, h) => void routes.set(key, h),
    calls(key) {
      const [method, pattern] = key.split(" ") as [string, string];
      return seen.filter((s) => s.method === method && match(pattern, s.path) !== null);
    },
    registry: writeRegistry,
    stop,
    async cleanup() {
      await stop();
      rmSync(dir, { recursive: true, force: true });
    },
  };
}

/** Captured streams + the knobs of a test {@link Io}. */
export interface TestIo extends Io {
  stdout: string;
  stderr: string;
  spawned: string[];
  opened: string[];
}

let seq = 0;

export function testIo(o: {
  argv: string[];
  home: string;
  cwd: string;
  env?: Record<string, string | undefined>;
  stdin?: string;
  tty?: boolean;
  answer?: boolean;
  startedAt?: string;
  onSpawn?: () => void;
}): TestIo {
  const now = () => performance.timeOrigin + performance.now();
  const io: TestIo = {
    argv: o.argv,
    version: VERSION,
    startedAt: o.startedAt ?? new Date(now()).toISOString(),
    env: { MITORI_HOME: o.home, LANG: "C.UTF-8", PATH: process.env.PATH, ...o.env },
    cwd: o.cwd,
    stdout: "",
    stderr: "",
    spawned: [],
    opened: [],
    out(t) {
      io.stdout += t;
    },
    err(t) {
      io.stderr += t;
    },
    async stdin(max) {
      const s = o.stdin ?? "";
      if (Buffer.byteLength(s) > max) throw new Error("too large");
      return s;
    },
    async *lines() {
      for (const l of (o.stdin ?? "").split("\n")) yield l;
    },
    bin: "mitori",
    isTTY: o.tty ?? false,
    async confirm() {
      return o.answer ?? false;
    },
    spawnDaemon(home) {
      io.spawned.push(home);
      o.onSpawn?.();
    },
    async openUrl(url) {
      io.opened.push(url);
    },
    clock: { now, iso: () => new Date(now()).toISOString() },
    random: {
      bytes(n) {
        const b = new Uint8Array(n);
        for (let i = 0; i < n; i++) b[i] = (seq++ * 37 + i * 11) & 0xff;
        return b;
      },
    },
    fetch: globalThis.fetch,
  };
  return io;
}
