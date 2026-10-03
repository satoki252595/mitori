/**
 * Mock daemon for the WP-10a e2e suite: serves the built SPA (`apps/web/dist`, gzip on the wire so the size
 * checks see served bytes) and the `ApiRoutes` the web app calls, from the fixtures in ./fixture.ts. Test control:
 *   POST /__mock/configure {…FixtureOptions}   reset state with options
 *   POST /__mock/emit {type, …}                 push one SSE event to every connected tab
 *   GET  /__mock/log                            requests seen since the last configure
 * Run: bun e2e/web/support/mock-server.ts [port]
 */
import { existsSync, readFileSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import { gzipSync } from "node:zlib";
import type { SectionId, SseEvent } from "@mitori/core";
import { DEFAULTS, docFixture, engines, estimate, type FixtureOptions, mapView, paletteItems, settings, WS, workspaceStatus } from "./fixture.ts";

const PORT = Number(process.argv[2] ?? process.env.MOCK_PORT ?? 4317);
const DIST = resolve(import.meta.dir, "../../../apps/web/dist");

let opts: FixtureOptions = { ...DEFAULTS };
let doc = docFixture(opts);
let log: { method: string; path: string; body?: unknown; at: number }[] = [];
let seq = 100;
let estSeq = 0;
let settingsVersion = 3;
let acked = opts.policyAcked;
const streams = new Set<ReadableStreamDefaultController<Uint8Array>>();
const enc = new TextEncoder();
const gz = new Map<string, Uint8Array>();

function configure(o: Partial<FixtureOptions>) {
  opts = { ...DEFAULTS, ...o };
  doc = docFixture(opts);
  log = [];
  acked = opts.policyAcked;
  estSeq = 0;
}

function emit(e: Partial<SseEvent> & { type: string }) {
  seq++;
  const full = { seq, ws: WS, rev: seq, at: new Date().toISOString(), ...e };
  const frame = enc.encode(`id: ${seq}\ndata: ${JSON.stringify(full)}\n\n`);
  for (const c of streams) {
    try {
      c.enqueue(frame);
    } catch {
      streams.delete(c);
    }
  }
}

const json = (v: unknown, status = 200) => Response.json(v, { status });
const err = (code: string, status: number) => json({ error: { code, message: code, retryable: false } }, status);

function api(req: Request, url: URL, body: unknown): Response | Promise<Response> {
  const p = url.pathname.replace(/^\/api\/v1/, "");
  const m = req.method;
  if (m === "GET" && p === "/events") {
    let ctrl: ReadableStreamDefaultController<Uint8Array>;
    const stream = new ReadableStream<Uint8Array>({
      start(c) {
        ctrl = c;
        streams.add(c);
        c.enqueue(enc.encode(":\n\n"));
        seq++;
        c.enqueue(
          enc.encode(
            `id: ${seq}\ndata: ${JSON.stringify({ type: "hello", version: "dev", apiVersion: 1, resumedFrom: null, boot: "boot1", seq, ws: null, rev: null, at: new Date().toISOString() })}\n\n`,
          ),
        );
      },
      cancel() {
        streams.delete(ctrl);
      },
    });
    return new Response(stream, { headers: { "content-type": "text/event-stream", "cache-control": "no-cache" } });
  }
  if (m === "POST" && p === "/auth/exchange") return json({ token: "tok_test", session: "se_000000000000", expiresAt: "2026-11-01T00:00:00Z" });
  if (m === "GET" && p === "/daemon")
    return json({
      version: "dev",
      pid: 1,
      port: PORT,
      uptimeSec: 10,
      workspaces: [WS],
      scheduler: {
        concurrency: 3,
        effective: 3,
        running: 0,
        queued: 0,
        yielding: false,
        reservedInteractive: 1,
        lanePaused: { interactive: null, doc: null, background: null },
        resident: { procs: 0, rssMb: 0 },
      },
      engines: engines(opts),
      rssMb: 80,
    });
  if (m === "GET" && p === "/usage/summary")
    return json({
      range: "today",
      totals: { calls: 4, in: 18_000, cacheWrite: 1000, cacheRead: 2000, out: 400, apiUsd: 0.14 },
      byDay: [],
      byEngine: {},
      byModel: {},
      window: {
        fiveHour: { utilization: 0.23, resetsAt: "2026-10-03T05:00:00Z" },
        sevenDay: { utilization: 0.08 },
        billing: opts.billing,
        observedAt: "2026-10-03T00:00:00Z",
        source: "claude-cli",
      },
      estimateAccuracyPct: 12,
    });
  if (m === "GET" && p === "/settings") {
    const s = settings({ ...opts, policyAcked: acked });
    return json({ ...s, version: settingsVersion });
  }
  if (m === "PATCH" && p === "/settings") {
    const b = body as { patch?: { privacy?: { dataPolicyAck?: unknown } } };
    if (b?.patch?.privacy?.dataPolicyAck) acked = true;
    settingsVersion++;
    return json({ ...settings({ ...opts, policyAcked: acked }), version: settingsVersion });
  }
  if (m === "GET" && p === "/engines") return json(engines(opts));
  if (m === "GET" && p === "/workspaces") return json([workspaceStatus(opts)]);
  if (m === "POST" && p === "/workspaces") {
    const t = (body as { target?: string })?.target ?? "";
    return t.includes("crit") ? json(workspaceStatus(opts)) : err("E_WS_NOT_FOUND", 404);
  }
  const wm = /^\/ws\/(ws_[0-9a-z]+)(\/.*)?$/.exec(p);
  if (!wm) return err("E_NOT_FOUND", 404);
  const rest = wm[2] ?? "";
  if (m === "GET" && rest === "") return json(workspaceStatus(opts));
  if (m === "GET" && rest === "/map") return json(mapView(opts));
  if (m === "GET" && rest === "/doc") return json(doc.outline);
  if (m === "GET" && rest.startsWith("/doc/sections/")) {
    const sec = decodeURIComponent(rest.slice("/doc/sections/".length)) as SectionId;
    const v = doc.sections.get(sec);
    if (!v) return err("E_NOT_FOUND", 404);
    // a page view also carries its same-file children (exercises both client paths)
    if (sec === "s3") return json({ ...v, blocks: [...v.blocks, ...(doc.sections.get("s3/review-cycle")?.blocks ?? [])] });
    return json(v);
  }
  if (m === "POST" && /^\/doc\/blocks\/[^/]+\/verify$/.test(rest)) {
    const bid = rest.split("/")[3];
    for (const v of doc.sections.values()) {
      const b = v.blocks.find((x) => x.id === bid);
      if (b)
        return json({
          ...b,
          claimViews: b.claimViews.map((c) => ({ ...c, verdict: "human-verified" })),
          html: b.html.replaceAll('data-verdict="inferred"', 'data-verdict="human-verified"'),
        });
    }
    return err("E_NOT_FOUND", 404);
  }
  if (m === "GET" && rest === "/threads") return json({ items: [], next: null });
  if (m === "GET" && rest === "/jobs") return json({ items: [], next: null });
  if (m === "GET" && /^\/jobs\/j_[0-9a-z]+$/.test(rest))
    return json({
      id: rest.slice(6),
      ws: WS,
      kind: "fix",
      threads: [],
      state: "ready",
      proposals: [],
      gates: [],
      writeScope: [],
      diff: [],
      events: [],
      createdAt: "2026-10-03T00:00:00Z",
    });
  if (m === "GET" && rest === "/inbox") return json({ items: [], next: null });
  if (m === "GET" && rest === "/facts")
    return json([
      {
        kind: "existing_doc",
        detector: "readme@1",
        path: "README.md",
        line: 1,
        blob: "0",
        role: "readme",
        title: "Review and comment on plans, code diffs, frontend elements and send feedback directly to your agent.",
      },
    ]);
  if (m === "GET" && rest === "/search/palette") return json({ digest: "0", rev: 1, items: paletteItems(opts, doc) });
  if (m === "GET" && rest === "/cite") {
    const path = url.searchParams.get("path") ?? "";
    const start = Number(url.searchParams.get("start") ?? 1);
    const end = Number(url.searchParams.get("end") ?? start);
    const first = Math.max(1, start - 3);
    const last = end + 3;
    const lines = Array.from(
      { length: last - first + 1 },
      (_, i) => `<span data-line="${first + i}"><span class="ln">${first + i}</span>  h.Write([]byte(cwd)) // line ${first + i}</span>`,
    ).join("\n");
    return json({
      path,
      start,
      end,
      blob: "d94e6b7a1c",
      currentBlob: "d94e6b7a1c",
      stale: false,
      html: lines,
      firstLine: first,
      lastLine: last,
      symbol: `${path}#SessionKey`,
      lang: "go",
    });
  }
  if (m === "GET" && rest === "/files/content") {
    const path = url.searchParams.get("path") ?? "";
    const start = Number(url.searchParams.get("start") ?? 1);
    const end = Number(url.searchParams.get("end") ?? start + 80);
    const html = Array.from(
      { length: end - start + 1 },
      (_, i) => `<span data-line="${start + i}"><span class="ln">${start + i}</span>  return sha256.Sum(${start + i})</span>`,
    ).join("\n");
    return json({
      path,
      blob: "d94e6b7a1c",
      lang: "go",
      text: "",
      startLine: start,
      totalLines: 2000,
      symbols: [],
      backlinks: [{ block: "b_00000001", section: "s3", start: 178, end: 193 }],
      html,
    });
  }
  if (m === "POST" && rest === "/gen/estimate") {
    const b = body as { effort: "overview" | "standard" | "complete"; engine?: string };
    return json(estimate(opts, b.effort, b.engine ?? "claude-cli", ++estSeq));
  }
  if (m === "POST" && rest === "/gen/runs") {
    const e = estimate(opts, "standard", "claude-cli", 0);
    return json({
      id: "gr_run00000",
      ws: WS,
      effort: "standard",
      trigger: "user",
      engine: "claude-cli",
      scope: [],
      state: "running",
      concurrency: 3,
      estimate: e,
      progress: { total: 14, done: 0, failed: 0, blocks: 0 },
      usage: { calls: 0, in: 0, cacheWrite: 0, cacheRead: 0, out: 0, apiUsd: 0 },
      startedAt: new Date().toISOString(),
    });
  }
  if (m === "POST" && rest === "/gen/prioritize") return json({ ok: true });
  if (m === "POST" && /^\/gen\/runs\/[^/]+\/control$/.test(rest)) return json({ ok: true });
  if (m === "GET" && rest.startsWith("/gen/runs")) return json({ items: [], next: null });
  return err("E_NOT_FOUND", 404);
}

function staticFile(url: URL, accept: string | null): Response | null {
  let path = url.pathname === "/" ? "/index.html" : url.pathname;
  let file = join(DIST, path);
  if (!path.startsWith("/assets/") && !existsSync(file)) {
    path = "/index.html";
    file = join(DIST, path);
  }
  if (!existsSync(file) || !statSync(file).isFile()) return null;
  const type = path.endsWith(".js")
    ? "text/javascript; charset=utf-8"
    : path.endsWith(".css")
      ? "text/css; charset=utf-8"
      : path.endsWith(".html")
        ? "text/html; charset=utf-8"
        : "application/octet-stream";
  const headers: Record<string, string> = {
    "content-type": type,
    "cache-control": path.startsWith("/assets/") ? "public, max-age=31536000, immutable" : "no-cache",
  };
  if (accept?.includes("gzip") && /\.(js|css|html)$/.test(path)) {
    let body = gz.get(file);
    if (!body) {
      body = gzipSync(readFileSync(file), { level: 9 });
      if (path !== "/index.html") gz.set(file, body);
    }
    headers["content-encoding"] = "gzip";
    return new Response(body as Uint8Array<ArrayBuffer>, { headers });
  }
  return new Response(readFileSync(file), { headers });
}

Bun.serve({
  port: PORT,
  hostname: "127.0.0.1",
  idleTimeout: 0,
  async fetch(req) {
    const url = new URL(req.url);
    let body: unknown;
    if (req.method !== "GET" && req.method !== "HEAD") {
      try {
        body = await req.json();
      } catch {
        body = undefined;
      }
    }
    if (url.pathname === "/__mock/configure") {
      configure((body ?? {}) as Partial<FixtureOptions>);
      return json({ ok: true });
    }
    if (url.pathname === "/__mock/emit") {
      emit(body as SseEvent);
      return json({ ok: true, tabs: streams.size });
    }
    if (url.pathname === "/__mock/log") return json(log);
    if (url.pathname.startsWith("/api/")) {
      log.push({ method: req.method, path: url.pathname + url.search, body, at: Date.now() });
      return api(req, url, body);
    }
    return staticFile(url, req.headers.get("accept-encoding")) ?? new Response("not found", { status: 404 });
  },
});
console.log(`mock daemon on http://127.0.0.1:${PORT} (dist: ${DIST})`);
