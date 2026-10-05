/** One-shot compiled-daemon transfer proof. No build, generation, edits or provider calls.
 * Run after the final build: scripts/nd bun docs/progress/shipping-ui-probe.ts [result.json]
 * Chromium negotiates its normal encoding; gzip equivalents are recorded separately from actual wire bytes. */
import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { gzipSync } from "node:zlib";
import type { InitialUiView } from "@mitori/core";
import { startTestDaemon } from "@mitori/testkit";
import { chromium } from "@playwright/test";
import { connect, until } from "../../e2e/export/support/daemon.ts";

const ROOT = resolve(import.meta.dirname, "../..");
const OUT = resolve(process.argv[2] ?? join(ROOT, "docs/progress/shipping-ui-20261005.json"));
const bin = join(ROOT, `dist/mitori-${process.platform}-${process.arch}`);
const sha = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");
const seal = (file: string) => ({ bytes: statSync(file).size, sha256: sha(readFileSync(file)) });
const binary = seal(bin);
const manifest = seal(join(ROOT, "dist/.build/manifest.json"));
const renderer = seal(join(ROOT, "dist/.build/initial/initial.js"));
const webManifest = seal(join(ROOT, "dist/.build/web.json"));
const web = JSON.parse(readFileSync(join(ROOT, "dist/.build/web.json"), "utf8")) as Record<string, { raw: string }>;
const userHome = mkdtempSync(join(tmpdir(), "mitori-shipping-ui-user-"));
let daemon: Awaited<ReturnType<typeof startTestDaemon>> | undefined;
let browser: Awaited<ReturnType<typeof chromium.launch>> | undefined;
const records: unknown[] = [];
try {
  daemon = await startTestDaemon({ fixture: "go-small", binary: "compiled", env: { HOME: userHome, MITORI_LIVE: "0" } });
  const api = await connect(daemon);
  await until(api, (c) => c.blocks > 0, "canonical static doc");
  const token = (JSON.parse(readFileSync(join(daemon.home.dir, "daemon.json"), "utf8")) as { token: string }).token;
  const auth = { authorization: `Bearer ${token}`, "x-mitori-client": "cli/shipping-ui-proof" };
  const before = await api.get<{ manifest: { usageTotals: { calls: number } } }>(`/ws/${api.ws}/doc`);
  browser = await chromium.launch({ headless: true });
  for (const [name, path, mark] of [
    ["S1-static", `/w/${api.ws}`, "mitori:map:painted"],
    ["S2-static", `/w/${api.ws}/doc/s4`, "mitori:section:rendered"],
  ]) {
    const context = await browser.newContext({
      viewport: { width: 1440, height: 900 },
      storageState: {
        cookies: [],
        origins: [{ origin: daemon.url, localStorage: [{ name: "mitori:firstRun", value: "2026-10-01" }] }],
      },
    });
    try {
      const page = await context.newPage();
      const errors: string[] = [];
      const requests: string[] = [];
      const assets = new Map<string, { encoding: string; gzip: number; raw: number; sha256: string; matchesManifest: boolean }>();
      const responses: Promise<void>[] = [];
      let initialUi: { raw: number; html: number; encoding: string; sections: number; blocks: number } | null = null;
      page.on("pageerror", (e) => errors.push(e.message));
      page.on("request", (r) => requests.push(new URL(r.url()).pathname));
      page.on("response", (r) => {
        const path = new URL(r.url()).pathname;
        if (!/\.(js|css)$/.test(path) && !/\/ui$/.test(path)) return;
        responses.push(
          (async () => {
            if (!r.ok()) throw new Error(`${path}: HTTP ${r.status()}`);
            const bytes = await r.body();
            const encoding = r.headers()["content-encoding"] ?? "identity";
            if (/\/ui$/.test(path)) {
              const view = JSON.parse(bytes.toString()) as InitialUiView;
              initialUi = {
                raw: bytes.length,
                html: new TextEncoder().encode(view.html).length,
                encoding,
                sections: view.snapshot.sections.length,
                blocks: view.snapshot.sections.reduce((n, s) => n + s.blocks.length, 0),
              };
            } else {
              const entry = web[path];
              assets.set(path, {
                encoding,
                gzip: gzipSync(bytes, { level: 9 }).length,
                raw: bytes.length,
                sha256: sha(bytes),
                matchesManifest: !!entry && sha(bytes) === sha(readFileSync(join(ROOT, entry.raw))),
              });
            }
          })(),
        );
      });
      const login = await fetch(`${daemon.url}/api/v1/auth/nonce`, {
        method: "POST",
        headers: { ...auth, "content-type": "application/json" },
        body: JSON.stringify({ to: path }),
      });
      if (!login.ok) throw new Error(`nonce: HTTP ${login.status}`);
      await page.goto(((await login.json()) as { url: string }).url);
      await page.waitForFunction((m) => performance.getEntriesByName(m, "mark").length > 0, mark, { timeout: 30_000 });
      const timing = await page.evaluate((m) => {
        const at = performance.getEntriesByName(m, "mark").at(-1)!.startTime;
        const nav = performance.getEntriesByType("navigation")[0] as PerformanceNavigationTiming;
        const rows = (performance.getEntriesByType("resource") as PerformanceResourceTiming[])
          .filter((r) => r.responseEnd > 0 && r.responseEnd <= at + 1)
          .map((r) => ({ path: new URL(r.name).pathname, encoded: r.encodedBodySize, decoded: r.decodedBodySize, transfer: r.transferSize }));
        const sum = (match: (path: string) => boolean) => rows.filter((r) => match(r.path)).reduce((n, r) => n + r.encoded, 0);
        return {
          at,
          document: { encoded: nav.encodedBodySize, decoded: nav.decodedBodySize, transfer: nav.transferSize },
          rows,
          jsWire: sum((p) => p.endsWith(".js")),
          cssWire: sum((p) => p.endsWith(".css")),
          dataWire: sum((p) => !/\.(js|css)$/.test(p)),
          encodedTotal: nav.encodedBodySize + rows.reduce((n, r) => n + r.encoded, 0),
          transferTotal: nav.transferSize + rows.reduce((n, r) => n + r.transfer, 0),
        };
      }, mark);
      await Promise.all(responses);
      const initialAssets = timing.rows.filter((r) => /\.(js|css)$/.test(r.path)).map((r) => ({ ...r, ...assets.get(r.path) }));
      const gzip = (extension: string) => initialAssets.filter((r) => r.path.endsWith(extension)).reduce((n, r) => n + (r.gzip ?? 0), 0);
      const jsGzip = gzip(".js"),
        cssGzip = gzip(".css");
      if (jsGzip <= 0 || jsGzip > 60 * 1024 || cssGzip > 25 * 1024) throw new Error(`${name}: initial gzip budget ${jsGzip}/${cssGzip}`);
      if (errors.length || initialAssets.some((r) => !r.matchesManifest)) throw new Error(`${name}: page errors or served asset hash mismatch`);
      if (!initialUi || requests.some((p) => /\.(woff2?|ttf)$/.test(p) || /\/assets\/(cm6|merge|main|ReaderTools|loop)-[^/]+\.js$/.test(p)))
        throw new Error(`${name}: missing canonical SSR, font or editing module loaded initially`);
      if (requests.some((p) => /\/(gen\/start|jobs|doc\/blocks\/[^/]+\/(simplify|translate))$/.test(p))) throw new Error(`${name}: generation/edit request`);
      records.push({ name, route: path.replace(api.ws, "<fixture-ws>"), mark, ...timing, jsGzip, cssGzip, initialUi, initialAssets });
    } finally {
      await context.close();
    }
  }
  const after = await api.get<typeof before>(`/ws/${api.ws}/doc`);
  if (after.manifest.usageTotals.calls !== before.manifest.usageTotals.calls) throw new Error("probe made a provider call");
  if (
    seal(bin).sha256 !== binary.sha256 ||
    seal(join(ROOT, "dist/.build/web.json")).sha256 !== webManifest.sha256 ||
    seal(join(ROOT, "dist/.build/manifest.json")).sha256 !== manifest.sha256 ||
    seal(join(ROOT, "dist/.build/initial/initial.js")).sha256 !== renderer.sha256
  )
    throw new Error("build changed during the probe");
  writeFileSync(
    OUT,
    `${JSON.stringify(
      {
        date: new Date().toISOString(),
        compiled: true,
        fixture: "go-small static doc",
        viewport: "1440x900",
        scope:
          "Completed responses through the useful mark; live SSE excluded because ResourceTiming reports no completed body. Normal Chromium content negotiation; actual wire and gzip equivalents are separate.",
        mockJsGzipBaseline: 43792,
        binary,
        manifest,
        renderer,
        webManifest,
        providerCalls: 0,
        records,
      },
      null,
      2,
    )}\n`,
  );
  console.log(
    JSON.stringify(
      {
        result: OUT,
        binary,
        records: records.map((r) => {
          const x = r as { name: string; jsWire: number; jsGzip: number; cssWire: number; cssGzip: number; encodedTotal: number; transferTotal: number };
          return {
            name: x.name,
            jsWire: x.jsWire,
            jsGzip: x.jsGzip,
            cssWire: x.cssWire,
            cssGzip: x.cssGzip,
            encodedTotal: x.encodedTotal,
            transferTotal: x.transferTotal,
          };
        }),
      },
      null,
      2,
    ),
  );
} finally {
  await browser?.close();
  await daemon?.stop();
  rmSync(userHome, { recursive: true, force: true });
}
