/**
 * WP-INT integration harness: the REAL daemon composition (apps/cli `startServerDaemon` → `@mitori/server`
 * `createServer`) in-process, with a temp `MITORI_HOME`, platform adapters, the server's Worker entries and the
 * embedded-asset table of the source checkout. Tests talk HTTP/SSE to it like the CLI and the browser do.
 */
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Spawner } from "@mitori/agent";
import { API_PREFIX, type SessionId, type WorkspaceKey, type WorkspaceStatus, type WorkspaceSummary } from "@mitori/core";
import type { ServerDeps } from "@mitori/server";
import { type ServerDaemon, startServerDaemon } from "../../apps/cli/src/daemon/server.ts";
import { openSse, type SseReader } from "../../packages/server/src/http/test/sse-reader.ts";
import type { WorkspaceDomain } from "../../packages/server/src/wiring/workspace.ts";

export interface IntOptions {
  /** Reuse a home (restart scenarios). */
  home?: string;
  /** `~/.mitori/config.json` written before start. */
  config?: unknown;
  spawner?: Spawner;
  overrides?: Partial<ServerDeps>;
}

export interface Int {
  d: ServerDaemon;
  home: string;
  origin: string;
  /** CLI caller (bearer). */
  cli(method: string, path: string, body?: unknown): Promise<Response>;
  /** JSON of a CLI call, throwing on non-2xx. */
  json<T>(method: string, path: string, body?: unknown): Promise<T>;
  /** Browser session (nonce → exchange). */
  browser(): Promise<{ token: string; session: SessionId; req(method: string, path: string, body?: unknown): Promise<Response> }>;
  /** SSE stream of a workspace as the web client sees it. */
  sse(ws: WorkspaceKey): Promise<SseReader>;
  /** Open a directory and wait until its open scan and static doc are done. */
  open(root: string): Promise<{ ws: WorkspaceKey; ms: number; status: WorkspaceStatus }>;
  /** Domain parts of a loaded workspace (white-box assertions). */
  domain(ws: WorkspaceKey): WorkspaceDomain;
  close(opts?: { keepHome?: boolean }): Promise<void>;
}

export async function startInt(opts: IntOptions = {}): Promise<Int> {
  const home = opts.home ?? mkdtempSync(join(tmpdir(), "mitori-int-"));
  if (opts.config !== undefined) writeFileSync(join(home, "config.json"), JSON.stringify(opts.config));
  const d = await startServerDaemon({
    home,
    port: 0,
    // the CLI's version, as in the binary (the web shell shows a reload banner on a mismatch)
    version: (JSON.parse(readFileSync(join(import.meta.dir, "../../apps/cli/package.json"), "utf8")) as { version: string }).version,
    build: "test",
    // the shipped daemon detects the gate sandbox (F2); scenarios here pin "none" (consent-gated repo-code gates)
    // unless they pass one — INT-08 passes sandbox-exec to exercise the sandboxed gates
    overrides: { gateSandbox: "none", ...(opts.spawner ? { spawner: opts.spawner } : {}), ...opts.overrides },
  });
  const origin = d.url.replace(/\/$/, "");
  const cli = (method: string, path: string, body?: unknown) =>
    fetch(`${origin}${API_PREFIX}${path}`, {
      method,
      headers: { authorization: `Bearer ${d.token}`, "x-mitori-client": "cli/int", ...(body !== undefined ? { "content-type": "application/json" } : {}) },
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    });
  const json = async <T>(method: string, path: string, body?: unknown): Promise<T> => {
    const res = await cli(method, path, body);
    if (!res.ok) throw new Error(`${method} ${path} → ${res.status} ${await res.text()}`);
    return (await res.json()) as T;
  };
  const browser = async () => {
    const n = await json<{ url: string }>("POST", "/auth/nonce", { to: "/" });
    const nonce = new URL(n.url).hash.slice(3).split("&")[0] as string;
    const ex = await fetch(`${origin}${API_PREFIX}/auth/exchange`, {
      method: "POST",
      headers: { "content-type": "application/json", "sec-fetch-site": "same-origin", "x-mitori-client": "web/int" },
      body: JSON.stringify({ nonce }),
    });
    const { token, session } = (await ex.json()) as { token: string; session: SessionId };
    return {
      token,
      session,
      req: (method: string, path: string, body?: unknown) =>
        fetch(`${origin}${API_PREFIX}${path}`, {
          method,
          headers: {
            authorization: `Mitori-Session ${token}`,
            "sec-fetch-site": "same-origin",
            "x-mitori-client": "web/int",
            ...(body !== undefined ? { "content-type": "application/json" } : {}),
          },
          ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
        }),
    };
  };
  let web: Awaited<ReturnType<typeof browser>> | null = null;
  const handle = d.handle as typeof d.handle & { domain(ws: WorkspaceKey): WorkspaceDomain | null };
  return {
    d,
    home,
    origin,
    cli,
    json,
    browser,
    async sse(ws) {
      web ??= await browser();
      return openSse(origin, `Mitori-Session ${web.token}`, `?ws=${ws}`);
    },
    async open(root) {
      const t0 = performance.now();
      const s = await json<WorkspaceSummary>("POST", "/workspaces", { target: root });
      for (;;) {
        const st = await json<WorkspaceStatus>("GET", `/ws/${s.info.key}`);
        if (st.state === "ready" || st.state === "error") {
          if (st.state === "error") throw new Error(`open failed: ${JSON.stringify(st.lastError)}`);
          await handle.domain(s.info.key)?.staticReady();
          return { ws: s.info.key, ms: performance.now() - t0, status: st };
        }
        await Bun.sleep(10);
      }
    },
    domain(ws) {
      const x = handle.domain(ws);
      if (!x) throw new Error(`workspace ${ws} is not loaded`);
      return x;
    },
    async close(o = {}) {
      await d.stop("test");
      if (!o.keepHome) rmSync(home, { recursive: true, force: true });
    },
  };
}
