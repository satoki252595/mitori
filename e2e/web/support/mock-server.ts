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
import {
  buildPlanModel,
  type GenRun,
  type InitialUiRenderer,
  MitoriError,
  mapSvgPresentation,
  planData,
  type SectionId,
  type SseEvent,
  type ThreadSummary,
} from "@mitori/core";
import { DEFAULTS, docFixture, engines, estimate, type FixtureOptions, mapView, paletteItems, settings, streamBlock, WS, workspaceStatus } from "./fixture.ts";

const PORT = Number(process.argv[2] ?? process.env.MOCK_PORT ?? 4317);
const DIST = process.env.MITORI_E2E_DIST ? resolve(process.env.MITORI_E2E_DIST) : resolve(import.meta.dir, "../../../apps/web/dist");
const VERSION = process.env.MITORI_E2E_VERSION ?? "dev";
const SSR = process.env.MITORI_E2E_SSR ?? resolve(import.meta.dir, "../../../dist/.build/e2e-initial/initial.js");
// Playwright starts this daemon before globalSetup builds. Import only on the first UI request after setup.
let initialRenderer: Promise<InitialUiRenderer> | null = null;
function renderer() {
  initialRenderer ??= import(SSR).then((module) => module.renderInitialUi as InitialUiRenderer);
  return initialRenderer;
}

let opts: FixtureOptions = { ...DEFAULTS };
let doc = docFixture(opts);
let log: { method: string; path: string; body?: unknown; at: number }[] = [];
let seq = 100;
let estSeq = 0;
let currentGen: GenRun | null = null;
const threads = new Map<string, ThreadSummary>();
let settingsVersion = 3;
let acked = opts.policyAcked;
/** The reader level a PATCH saved (the first visit saves 「初めて」, NC-08); reset by configure. */
let savedLevel: string | null = null;
/** The UI language a PATCH saved (NC-14: a reload in English stays English); reset by configure. */
let savedLang: string | null = null;
/** Bumped by an emitted `index.changed` (an accept / Undo touched the files): the files are another version now. */
let fileRev = 0;
const streams = new Set<ReadableStreamDefaultController<Uint8Array>>();
const enc = new TextEncoder();
const gz = new Map<string, Uint8Array>();

function configure(o: Partial<FixtureOptions>) {
  opts = { ...DEFAULTS, ...o };
  doc = docFixture(opts);
  log = [];
  acked = opts.policyAcked;
  savedLevel = null;
  savedLang = null;
  fileRev = 0;
  estSeq = 0;
  currentGen = null;
  threads.clear();
}

const currentStatus = () => ({ ...workspaceStatus(opts), gen: currentGen });

function withSaved<T extends { settings: { ui: { readerLevel: string; lang: string } } }>(v: T): T {
  const ui = { ...v.settings.ui, ...(savedLevel ? { readerLevel: savedLevel } : {}), ...(savedLang ? { lang: savedLang } : {}) };
  return { ...v, settings: { ...v.settings, ui } };
}

function emit(e: Partial<SseEvent> & { type: string }) {
  // A real daemon commits canonical views before publishing the event. SSR refresh observes that same state.
  const event = e as SseEvent;
  if (event.type === "thread.upsert") threads.set(event.thread.id, event.thread);
  else if (event.type === "thread.removed") threads.delete(event.id);
  if (event.type === "gen.run") currentGen = event.run;
  if (event.type === "doc.block.upsert") {
    const view = doc.sections.get(event.block.section);
    if (view) {
      const blocks = [...view.blocks.filter((b) => b.id !== event.block.id), event.block].sort((a, b) => a.ord - b.ord);
      doc.sections.set(event.block.section, { ...view, blocks });
    }
  } else if (event.type === "doc.block.removed") {
    for (const [id, view] of doc.sections) doc.sections.set(id, { ...view, blocks: view.blocks.filter((b) => b.id !== event.block) });
  } else if (event.type === "doc.freshness") {
    const changed = new Set(event.blocks);
    for (const [id, view] of doc.sections)
      doc.sections.set(id, { ...view, blocks: view.blocks.map((b) => (changed.has(b.id) ? { ...b, freshness: event.freshness } : b)) });
  } else if (event.type === "doc.claims") {
    const claims = new Map(event.claims.map((c) => [c.id, c]));
    for (const [id, view] of doc.sections)
      doc.sections.set(id, { ...view, blocks: view.blocks.map((b) => ({ ...b, claimViews: b.claimViews.map((c) => ({ ...c, ...claims.get(c.id) })) })) });
  }
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

async function api(req: Request, url: URL, body: unknown): Promise<Response> {
  const p = url.pathname.replace(/^\/api\/v1/, "");
  const m = req.method;
  if (m === "GET" && p === `/ws/${WS}/ui`) {
    try {
      const renderInitialUi = await renderer();
      const view = await renderInitialUi(
        url.searchParams,
        async (path) => {
          if (!path.startsWith("/") || path.startsWith("//") || path.includes("/ui")) throw new Error("invalid initial mock read");
          const response = await api(new Request(`http://127.0.0.1:${PORT}/api/v1${path}`), new URL(`http://127.0.0.1:${PORT}/api/v1${path}`), undefined);
          if (!response.ok) throw new Error(`initial mock read: ${response.status}`);
          return response.json();
        },
        async (effort, engine) => {
          const path = `/api/v1/ws/${WS}/gen/estimate`;
          const body = { effort, engine };
          log.push({ method: "POST", path, body, at: Date.now() });
          const response = await api(new Request(`http://127.0.0.1:${PORT}${path}`, { method: "POST" }), new URL(`http://127.0.0.1:${PORT}${path}`), body);
          return response.json();
        },
      );
      return new Response(gzipSync(JSON.stringify(view)), {
        headers: { "content-type": "application/json", "content-encoding": "gzip", "cache-control": "no-store" },
      });
    } catch (error) {
      const e = MitoriError.from(error);
      if (e.code === "E_INVALID_INPUT") return err(e.code, 400);
      console.error("initial mock render", error);
      return err("E_INTERNAL", 500);
    }
  }
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
            `id: ${seq}\ndata: ${JSON.stringify({ type: "hello", version: VERSION, apiVersion: 1, resumedFrom: null, boot: "boot1", seq, ws: null, rev: null, at: new Date().toISOString() })}\n\n`,
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
      version: VERSION,
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
        fiveHour: { utilization: opts.utilization, resetsAt: "2026-10-03T05:00:00Z" },
        sevenDay: { utilization: 0.08 },
        billing: opts.billing,
        observedAt: "2026-10-03T00:00:00Z",
        source: "claude-cli",
      },
      estimateAccuracyPct: 12,
    });
  if (m === "GET" && p === "/settings") {
    const s = withSaved(settings({ ...opts, policyAcked: acked }));
    return json({ ...s, version: settingsVersion });
  }
  if (m === "PATCH" && p === "/settings") {
    const b = body as { patch?: { privacy?: { dataPolicyAck?: unknown }; ui?: { readerLevel?: string; lang?: string } } };
    if (b?.patch?.privacy?.dataPolicyAck) acked = true;
    if (b?.patch?.ui?.readerLevel) savedLevel = b.patch.ui.readerLevel;
    if (b?.patch?.ui?.lang) savedLang = b.patch.ui.lang;
    settingsVersion++;
    return json({ ...withSaved(settings({ ...opts, policyAcked: acked })), version: settingsVersion });
  }
  if (m === "GET" && p === "/engines") return json(engines(opts));
  if (m === "GET" && p === "/workspaces") {
    const crit = workspaceStatus(opts);
    const other = {
      ...crit,
      info: {
        ...crit.info,
        key: "ws_h0n000000000",
        name: "hono",
        root: "/Users/me/src/github.com/honojs/hono/packages/hono-base/a/very/long/nested/checkout/path",
        lastOpenedAt: "2026-10-01T00:00:00Z",
      },
    };
    return json([other, crit]);
  }
  if (m === "POST" && p === "/workspaces") {
    const t = (body as { target?: string })?.target ?? "";
    if (t.includes("github.com/nope")) return err("E_GIT_CLONE_FAILED", 424);
    return t.includes("crit") ? json(workspaceStatus(opts)) : err("E_WS_NOT_FOUND", 404);
  }
  const wm = /^\/ws\/(ws_[0-9a-z]+)(\/.*)?$/.exec(p);
  if (!wm) return err("E_NOT_FOUND", 404);
  const rest = wm[2] ?? "";
  if (m === "GET" && rest === "") return json(currentStatus());
  if (m === "GET" && rest === "/map") {
    const view = mapView(opts);
    if (url.searchParams.get("svg") !== "true") return json(view);
    const plan = buildPlanModel(view);
    return json({ ...view, plan: planData(plan), svg: mapSvgPresentation(view, WS, url.searchParams.get("lang") === "en" ? "en" : "ja", plan) });
  }
  if (m === "GET" && rest === "/doc") return json(doc.outline);
  if (m === "GET" && rest.startsWith("/doc/sections/")) {
    const sec = decodeURIComponent(rest.slice("/doc/sections/".length)) as SectionId;
    const v = doc.sections.get(sec);
    if (!v) return err("E_NOT_FOUND", 404);
    // a page view also carries its same-file children (exercises both client paths)
    const blocks = sec === "s3" ? [...v.blocks, ...(doc.sections.get("s3/review-cycle")?.blocks ?? [])] : v.blocks;
    if (!url.searchParams.has("from") && !url.searchParams.has("limit")) return json({ ...v, blocks });
    const from = Math.min(Number(url.searchParams.get("from") ?? 0), blocks.length);
    const limit = Number(url.searchParams.get("limit") ?? 150);
    return json({
      ...v,
      total: blocks.length,
      from,
      blocks:
        url.searchParams.get("outline") === "false"
          ? blocks.slice(from, from + limit)
          : blocks.map((b, i) => ({ ...b, html: i >= from && i < from + limit ? b.html : "" })),
    });
  }
  // the HTML export (UXP-18): what the file WOULD be for these options — with excerpts it is bigger and says how many
  if (m === "POST" && rest === "/export") {
    const b = (body ?? {}) as { level?: string; excerpts?: boolean };
    const html = `<!doctype html><title>crit</title><meta name="mitori-level" content="${b.level ?? "standard"}">${b.excerpts ? "<pre>x</pre>".repeat(400) : ""}`;
    return json({
      html,
      bytes: b.excerpts ? 1_080_000 : 561_000,
      sha256: "0".repeat(64),
      redactions: 1,
      codeExcerpts: b.excerpts ? { count: 12, files: 4 } : { count: 0, files: 0 },
    });
  }
  if (m === "GET" && /^\/doc\/blocks\/[^/]+\/history$/.test(rest)) {
    const bid = rest.split("/")[3];
    return json([
      { block: bid, rev: 1, hash: "0000000000000001", by: "agent:claude-sonnet-5-5", at: "2026-10-02T09:00:00Z", source: "generate" },
      { block: bid, rev: 2, hash: "0000000000000002", by: "human", at: "2026-10-03T10:30:00Z", source: "human_edit" },
      { block: bid, rev: 3, hash: "0000000000000003", by: "human", at: "2026-10-03T11:00:00Z", round: 2, source: "accept_job" },
    ]);
  }
  if (m === "POST" && /^\/doc\/blocks\/[^/]+\/verify$/.test(rest)) {
    const bid = rest.split("/")[3];
    for (const v of doc.sections.values()) {
      const b = v.blocks.find((x) => x.id === bid);
      if (b) {
        const on = (body as { verified?: boolean } | undefined)?.verified !== false;
        return json({
          ...b,
          ...(on ? { lock: "human-verified", verifiedBy: "me" } : { lock: undefined, verifiedBy: undefined }),
          claimViews: b.claimViews.map((c) => ({ ...c, verdict: on ? "human-verified" : c.verdict })),
          html: on ? b.html.replace(/data-verdict="(inferred|verified|cited)"/g, 'data-verdict="human-verified"') : b.html,
        });
      }
    }
    return err("E_NOT_FOUND", 404);
  }
  if (m === "GET" && rest === "/threads") return json({ items: [...threads.values()], next: null });
  if (m === "GET" && /^\/threads\/th_[0-9a-z]+$/.test(rest)) {
    // a thread anchored on the first block of §3.1 (thread permalink redirect)
    const block = doc.outline.blocks.find((x) => x[1] === "s3/review-cycle")?.[0];
    return json({ id: rest.slice(9), ws: WS, state: "open", intent: "note", anchor: { doc: { block } }, messages: [], createdAt: "2026-10-03T00:00:00Z" });
  }
  if (m === "GET" && rest === "/jobs") {
    // slow on purpose: a /review deep link must wait for the jobs before choosing where to go
    if (opts.readyJob) await Bun.sleep(150);
    return json({
      items: opts.readyJob
        ? [{ id: "j_0000000001", ws: WS, kind: "fix", state: "ready", threads: [], createdAt: "2026-10-03T00:00:00Z", finishedAt: "2026-10-03T00:01:00Z" }]
        : [],
      next: null,
    });
  }
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
      // like the daemon (server wiring/views.ts shikiLines): a `span.line[data-line]` per line, the number is the client's gutter
      (_, i) => `<span class="line" data-line="${first + i}">  h.Write([]byte(cwd)) // line ${first + i}</span>`,
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
    const html = Array.from({ length: end - start + 1 }, (_, i) => `<span class="line" data-line="${start + i}">  return sha256.Sum(${start + i})</span>`).join(
      "\n",
    );
    return json({
      path,
      blob: fileRev === 0 ? "d94e6b7a1c" : `c0ffee${fileRev}a1`,
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
      if ((body as { type?: string }).type === "index.changed") fileRev++;
      emit(body as SseEvent);
      return json({ ok: true, tabs: streams.size });
    }
    if (url.pathname === "/__mock/log") return json(log);
    // streaming (ux.md §4.3.9): a run, block upserts / partials, a section's state flip + doc.outline
    if (url.pathname === "/__mock/gen") {
      const b = body as { state: "running" | "done" };
      const e = estimate(opts, "standard", "claude-cli", 0);
      const run = {
        id: "gr_run00000",
        ws: WS,
        effort: "standard",
        trigger: "user",
        engine: "claude-cli",
        scope: [],
        state: b.state,
        concurrency: 3,
        estimate: e,
        progress: { total: 14, done: b.state === "done" ? 14 : 1, failed: 0, blocks: b.state === "done" ? 40 : 1 },
        usage: { calls: 1, in: 1000, cacheWrite: 0, cacheRead: 0, out: 200, apiUsd: 0.01 },
        startedAt: new Date(Date.now() - 5000).toISOString(),
        ...(b.state === "done" ? { finishedAt: new Date().toISOString() } : {}),
      };
      emit({ type: "gen.run", run } as never);
      return json({ ok: true });
    }
    if (url.pathname === "/__mock/stream") {
      const b = body as { section: SectionId; ord: number; partial?: string };
      if (b.partial !== undefined) emit({ type: "doc.block.partial", section: b.section, text: b.partial } as never);
      else emit({ type: "doc.block.upsert", block: streamBlock(5000 + b.ord, b.section, b.ord) } as never);
      return json({ ok: true });
    }
    if (url.pathname === "/__mock/section") {
      const b = body as { section: SectionId; state: "generated" | "generating" };
      const node = doc.outline.sections.find((x) => x.id === b.section);
      if (node) node.state = b.state;
      doc.outline = { ...doc.outline, outlineRev: doc.outline.outlineRev + 1 };
      emit({ type: "doc.outline", outlineRev: doc.outline.outlineRev } as never);
      return json({ ok: true });
    }
    if (url.pathname.startsWith("/api/")) {
      log.push({ method: req.method, path: url.pathname + url.search, body, at: Date.now() });
      return api(req, url, body);
    }
    return staticFile(url, req.headers.get("accept-encoding")) ?? new Response("not found", { status: 404 });
  },
});
console.log(`mock daemon on http://127.0.0.1:${PORT} (dist: ${DIST})`);
