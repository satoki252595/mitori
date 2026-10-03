/**
 * Walking-skeleton daemon (WP-11a, M0.5): state DB + migration runner, `GET /api/v1/health`, the embedded shell, the
 * Host gate (421) and the security headers. `createServer` (packages/server/src/compose.ts, WP-INT) replaces the
 * fetch handler once it exists; this module then only assembles `ServerDeps` (assets, pools, platform adapters).
 */
import { existsSync } from "node:fs";
import { join } from "node:path";
import { API_PREFIX, ERROR_META, type HealthRes, type Migration, MitoriError, type SqlDb, toErrorData } from "@mitori/core";
import { loadWebAssets, type WebAssets } from "../build/assets.ts";
import { runMigrations } from "./migrate.ts";
import { openSqlite } from "./sqlite.ts";
import { createStaticHandler, securityHeaders } from "./static.ts";

export interface DaemonOptions {
  /** `~/.mitori` (or `MITORI_HOME`). null or missing directory ⇒ the state DB lives in memory. */
  home: string | null;
  /** 0 ⇒ OS-assigned. */
  port: number;
  version: string;
  build: HealthRes["build"];
}

export interface DaemonHandle {
  port: number;
  url: string;
  /** Where the state DB lives (`:memory:` when there is no home directory). */
  stateDb: string;
  stop(): Promise<void>;
}

/**
 * State-DB migrations. CR-PENDING(WP-11a): the composition root collects them per `MIGRATION_ORDER.state`
 * (server + `AGENT_MIGRATIONS`); the CLI may not import @mitori/agent, and both lists are empty at M0.
 */
const STATE_MIGRATIONS: readonly Migration[] = [];

// M0.5: the platform Clock port (WP-01) does not exist yet.
const isoNow = () => new Date().toISOString();

export interface SkeletonApp {
  assets: WebAssets;
  health(): HealthRes;
  /** The bound port (Host gate). */
  port(): number;
}

export function createSkeletonFetch(app: SkeletonApp): (req: Request) => Response {
  const index = app.assets.get("/index.html");
  const secure = securityHeaders(index ? new TextDecoder().decode(index.raw) : "");
  const serveStatic = createStaticHandler(app.assets);
  const withHeaders = (res: Response) => {
    for (const [k, v] of Object.entries(secure)) res.headers.set(k, v);
    return res;
  };
  const fail = (err: MitoriError) => Response.json({ error: toErrorData(err) }, { status: ERROR_META[err.code].http });
  return (req) => {
    const url = new URL(req.url);
    const host = req.headers.get("host");
    if (host !== `127.0.0.1:${app.port()}` && host !== `localhost:${app.port()}`)
      return withHeaders(fail(new MitoriError("E_BAD_HOST", "Host must be 127.0.0.1:<port> or localhost:<port>")));
    if (url.pathname === `${API_PREFIX}/health` && req.method === "GET") return withHeaders(Response.json(app.health()));
    if (url.pathname.startsWith("/api/")) return withHeaders(fail(new MitoriError("E_NOT_FOUND", `no route ${req.method} ${url.pathname}`)));
    return withHeaders(serveStatic(req, url) ?? fail(new MitoriError("E_NOT_FOUND", `no asset ${url.pathname}`)));
  };
}

export async function startDaemon(opts: DaemonOptions): Promise<DaemonHandle> {
  const startedAt = new Date(performance.timeOrigin).toISOString();
  const assets = await loadWebAssets();
  const stateDb = opts.home !== null && existsSync(opts.home) ? join(opts.home, "state.sqlite") : ":memory:";
  const db: SqlDb = openSqlite(stateDb);
  try {
    runMigrations(db, "state", STATE_MIGRATIONS, isoNow);
  } catch (err) {
    db.close();
    throw err;
  }
  let bound = 0;
  const health = (): HealthRes => ({ ok: true, version: opts.version, apiVersion: 1, pid: process.pid, startedAt, build: opts.build });
  const server = Bun.serve({ hostname: "127.0.0.1", port: opts.port, fetch: createSkeletonFetch({ assets, health, port: () => bound }) });
  bound = server.port ?? 0;
  return {
    port: bound,
    url: `http://127.0.0.1:${bound}/`,
    stateDb,
    async stop() {
      await server.stop(true);
      db.close();
    },
  };
}
