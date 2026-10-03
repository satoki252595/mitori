/**
 * In-process daemon for WP-09 integration tests (the shared `startTestServer` of @mitori/testkit is still a stub):
 * real Bun.serve on 127.0.0.1, bun:sqlite state DB in a temp `MITORI_HOME`, fake domain parts.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { brotliCompressSync, gzipSync } from "node:zlib";
import { API_PREFIX, type Clock, type Random, type ScanSummaryView, type SessionId, type WorkspaceKey, type WorkspaceSummary } from "@mitori/core";
import type { DomainProviders } from "../../routes/services.ts";
import type { RouteHandlers } from "../../routes/types.ts";
import type { WorkspaceManagerDeps, WorkspaceParts } from "../../ws/manager.ts";
import { type Daemon, type DaemonOptions, startDaemon } from "../daemon.ts";
import { SERVER_STATE_MIGRATIONS, SERVER_WORKSPACE_MIGRATIONS } from "../schema.ts";
import type { Assets } from "../static.ts";
import type { Timers } from "../timers.ts";
import {
  cryptoRandom,
  fsLockPort,
  fsReader,
  fsSafeWriter,
  migrate,
  noopMetrics,
  realClock,
  removeDir,
  silentLogger,
  sqliteDb,
  tempDir,
  testHasher,
} from "./fakes.ts";

export const TEST_VERSION = "0.1.0-test";

export const SCAN_SUMMARY: ScanSummaryView = {
  files: 3,
  included: 3,
  excluded: {},
  loc: 42,
  languages: [],
  modules: 1,
  facts: {},
  tokensNaive: 100,
  tokensFiltered: 80,
  ms: 1,
};

export interface FakeDomain {
  scans: number;
  loads: number;
  closes: number;
  busy: boolean;
  scanGate: Promise<void> | null;
}

/** Domain parts that only answer what the manager calls (`doc.load`, `indexer.scan`). */
export function fakeAssemble(state: FakeDomain): WorkspaceManagerDeps["assemble"] {
  return async () => {
    const parts: WorkspaceParts = {
      indexer: {
        scan: async () => {
          state.scans += 1;
          if (state.scanGate) await state.scanGate;
          return SCAN_SUMMARY;
        },
        snapshot: () => null,
        setActive() {},
      } as unknown as WorkspaceParts["indexer"],
      doc: {
        load: async () => {
          state.loads += 1;
          return {};
        },
      } as unknown as WorkspaceParts["doc"],
      gen: {} as WorkspaceParts["gen"],
      loop: {} as WorkspaceParts["loop"],
      busy: () => state.busy,
      close: async () => {
        state.closes += 1;
      },
      summary: (): Pick<WorkspaceSummary, "counts" | "doc"> => ({
        counts: { files: 3, loc: 42, modules: 1, openThreads: 0, staleBlocks: 0, runningJobs: 0 },
        doc: { exists: false, generatedAt: null, effort: null, lang: null, commitsBehind: null },
      }),
    };
    return parts;
  };
}

/** A one-page shell with an inline head script (CSP hash) and a hashed asset. */
export function testAssets(): Assets {
  const enc = new TextEncoder();
  const html = `<!doctype html><html><head><script>document.documentElement.dataset.t="1"</script></head><body><div id="app"></div><script type="module" src="/assets/app-abc123.js"></script></body></html>`;
  const js = enc.encode("console.log(1)");
  return new Map([
    ["/index.html", { raw: enc.encode(html), immutable: false }],
    ["/assets/app-abc123.js", { raw: js, br: new Uint8Array(brotliCompressSync(js)), gz: new Uint8Array(gzipSync(js)), immutable: true }],
  ]);
}

export interface HarnessOptions {
  home?: string;
  clock?: Clock;
  timers?: Timers;
  random?: Random;
  handlers?: RouteHandlers;
  domain?: DomainProviders;
  build?: "release" | "test";
  version?: string;
  port?: number;
  idleExitMs?: number;
  idlePollMs?: number;
  workspace?: Partial<DaemonOptions["workspace"]>;
  hooks?: DaemonOptions["hooks"];
  pid?: number;
}

export interface Harness {
  daemon: Daemon;
  home: string;
  port: number;
  origin: string;
  token: string;
  domain: FakeDomain;
  /** Raw request to an API path (`/health`) with optional bearer/session auth. */
  req(method: string, path: string, opts?: ReqOpts): Promise<Response>;
  /** CLI caller: bearer + `x-mitori-client: cli/test`. */
  cli(method: string, path: string, body?: unknown, headers?: Record<string, string>): Promise<Response>;
  /** Log a browser in through nonce → exchange; returns its session token. */
  browser(): Promise<{
    token: string;
    session: SessionId;
    req(method: string, path: string, body?: unknown, headers?: Record<string, string>): Promise<Response>;
  }>;
  /** Create a project directory and open it through `POST /workspaces`. */
  openProject(name?: string): Promise<WorkspaceKey>;
  close(opts?: { keepHome?: boolean }): Promise<void>;
}

export interface ReqOpts {
  body?: unknown;
  rawBody?: BodyInit;
  headers?: Record<string, string>;
  bearer?: string;
  session?: string;
}

export async function startHarness(opts: HarnessOptions = {}): Promise<Harness> {
  const home = opts.home ?? tempDir("mitori-home-");
  const userHome = tempDir("mitori-user-");
  const domain: FakeDomain = { scans: 0, loads: 0, closes: 0, busy: false, scanGate: null };
  const started = await startDaemon({
    home,
    userHome,
    version: opts.version ?? TEST_VERSION,
    build: opts.build ?? "test",
    pid: opts.pid ?? process.pid,
    clock: opts.clock ?? realClock,
    random: opts.random ?? cryptoRandom,
    hasher: testHasher,
    log: silentLogger,
    metrics: noopMetrics,
    ...(opts.timers ? { timers: opts.timers } : {}),
    fs: fsReader,
    safeWrite: fsSafeWriter(),
    lock: fsLockPort,
    openState: () => migrate(sqliteDb(`${home}/state.sqlite`), SERVER_STATE_MIGRATIONS),
    ...(opts.port !== undefined ? { port: opts.port } : {}),
    assets: testAssets(),
    ...(opts.handlers ? { handlers: opts.handlers } : {}),
    ...(opts.domain ? { domain: opts.domain } : {}),
    workspace: {
      openDb: (path) => sqliteDb(path),
      migrate: (db) => void migrate(db, SERVER_WORKSPACE_MIGRATIONS),
      sandbox: "none",
      assemble: fakeAssemble(domain),
      ...opts.workspace,
    },
    ...(opts.hooks ? { hooks: opts.hooks } : {}),
    ...(opts.idleExitMs !== undefined ? { idleExitMs: opts.idleExitMs } : {}),
    ...(opts.idlePollMs !== undefined ? { idlePollMs: opts.idlePollMs } : {}),
  });
  if (started.kind !== "started") throw new Error(`daemon already running (pid ${started.holder.pid})`);
  const daemon = started.daemon;
  const origin = `http://127.0.0.1:${daemon.port}`;
  const token = daemon.registry.token;
  const req = (method: string, path: string, o: ReqOpts = {}) => {
    const headers: Record<string, string> = { ...o.headers };
    if (o.bearer) headers.authorization = `Bearer ${o.bearer}`;
    if (o.session) headers.authorization = `Mitori-Session ${o.session}`;
    let body: BodyInit | undefined = o.rawBody;
    if (o.body !== undefined) {
      body = JSON.stringify(o.body);
      headers["content-type"] ??= "application/json";
    }
    return fetch(`${origin}${API_PREFIX}${path}`, { method, headers, ...(body !== undefined ? { body } : {}) });
  };
  const cli = (method: string, path: string, body?: unknown, headers: Record<string, string> = {}) =>
    req(method, path, { bearer: token, headers: { "x-mitori-client": "cli/test", ...headers }, ...(body !== undefined ? { body } : {}) });
  return {
    daemon,
    home,
    port: daemon.port,
    origin,
    token,
    domain,
    req,
    cli,
    async browser() {
      const n = (await (await cli("POST", "/auth/nonce", { to: "/" })).json()) as { url: string };
      const nonce = new URL(n.url).hash.slice(3).split("&")[0] as string;
      const ex = await req("POST", "/auth/exchange", { body: { nonce }, headers: { "sec-fetch-site": "same-origin", "x-mitori-client": "web/test" } });
      const { token: t, session } = (await ex.json()) as { token: string; session: SessionId };
      return {
        token: t,
        session,
        req: (method, path, body, headers = {}) =>
          req(method, path, {
            session: t,
            headers: { "sec-fetch-site": "same-origin", "x-mitori-client": "web/test", ...headers },
            ...(body !== undefined ? { body } : {}),
          }),
      };
    },
    async openProject(name = "proj") {
      const dir = `${userHome}/${name}`;
      mkdirSync(dir, { recursive: true });
      writeFileSync(`${dir}/package.json`, "{}");
      const res = await cli("POST", "/workspaces", { target: dir });
      if (res.status !== 200) throw new Error(`open failed: ${res.status} ${await res.text()}`);
      return ((await res.json()) as WorkspaceSummary).info.key;
    },
    async close(o = {}) {
      await daemon.stop("test");
      removeDir(userHome);
      if (!o.keepHome) removeDir(home);
    },
  };
}
