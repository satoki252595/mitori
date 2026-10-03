// WP-12 acceptance: "asset limit exceeded ⇒ `nd bun run size` exits non-zero" — the served-bytes gate on synthetic web dists,
// served through the in-process dist server (same negotiation and headers as the daemon).
import { afterAll, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { brotliCompressSync, gzipSync } from "node:zlib";
import { listDist, serveDist } from "./dist-server.ts";
import { measureAssets } from "./measure.ts";

const ROOT = resolve(import.meta.dir, "../..");
const made: string[] = [];
afterAll(() => {
  for (const d of made) rmSync(d, { recursive: true, force: true });
});

/** Deterministic, practically incompressible bytes (a compressed size ≈ the raw size). */
function noise(bytes: number, seed = 1): Uint8Array {
  const out = new Uint8Array(bytes);
  let a = seed >>> 0;
  for (let i = 0; i < bytes; i++) {
    a = (Math.imul(a, 1664525) + 1013904223) >>> 0;
    out[i] = a >>> 24;
  }
  return out;
}

interface DistFile {
  path: string;
  body: Uint8Array | string;
  /** Write `.br` and `.gz` siblings (default true). */
  precompress?: boolean;
}

function dist(files: readonly DistFile[], opts: { html?: string } = {}): string {
  const dir = mkdtempSync(join(tmpdir(), "mitori-dist-"));
  made.push(dir);
  const put = (rel: string, body: Uint8Array | string, pre = true) => {
    const file = join(dir, rel);
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, body);
    if (pre) {
      writeFileSync(`${file}.br`, brotliCompressSync(Buffer.from(body)));
      writeFileSync(`${file}.gz`, gzipSync(Buffer.from(body)));
    }
  };
  const refs = files.map((f) =>
    f.path.endsWith(".css")
      ? `<link rel="stylesheet" href="${f.path}">`
      : f.path.endsWith(".js") && f.path.includes("index")
        ? `<script type="module" src="${f.path}"></script>`
        : "",
  );
  put("index.html", opts.html ?? `<!doctype html><html><head>${refs.join("")}</head><body><div id="app"></div></body></html>`, false);
  for (const f of files) put(f.path.slice(1), f.body, f.precompress ?? true);
  return dir;
}

async function size(dir: string, ...flags: string[]): Promise<{ code: number; out: string; err: string }> {
  const proc = Bun.spawn(["bun", join(ROOT, "bench/asset/size.ts"), "--dist", dir, ...flags], { cwd: ROOT, stdout: "pipe", stderr: "pipe" });
  const [out, err, code] = await Promise.all([new Response(proc.stdout).text(), new Response(proc.stderr).text(), proc.exited]);
  return { code, out, err };
}

const OK_JS = "export const answer = 42;\n".repeat(200);

describe("ASSET-AT-01 bench/asset/size.ts fails when a served-bytes limit is exceeded", () => {
  test("a small, precompressed, immutable shell passes", async () => {
    const dir = dist([
      { path: "/assets/index-AAAAAAAA.js", body: OK_JS },
      { path: "/assets/index-BBBBBBBB.css", body: "body{margin:0}\n".repeat(100) },
    ]);
    const r = await size(dir);
    expect(r.err).toBe("");
    expect(r.code).toBe(0);
    expect(r.out).toContain("asset.js.initial.gz");
    expect(r.out).toContain("web assets ok");
  });

  test("initial JS over 150 KB gzip fails (served bytes, not file size)", async () => {
    const dir = dist([{ path: "/assets/index-AAAAAAAA.js", body: noise(160_000) }]);
    const r = await size(dir);
    expect(r.code).toBe(1);
    expect(r.out).toMatch(/asset\.js\.initial\.gz\s+1[5-9]\d\.\d+ KB/);
    expect(r.out).toContain("FAIL");
  });

  test("a big file that compresses well stays under the limit: the budget is on served bytes", async () => {
    const dir = dist([{ path: "/assets/index-AAAAAAAA.js", body: "x".repeat(2_000_000) }]);
    expect((await size(dir)).code).toBe(0);
  });

  test("CSS over 25 KB gzip fails", async () => {
    const dir = dist([
      { path: "/assets/index-AAAAAAAA.js", body: OK_JS },
      { path: "/assets/index-BBBBBBBB.css", body: noise(30_000, 7) },
    ]);
    const r = await size(dir);
    expect(r.code).toBe(1);
    expect(r.out).toContain("asset.css.gz");
  });

  test("any web font response fails", async () => {
    const dir = dist([
      { path: "/assets/index-AAAAAAAA.js", body: OK_JS },
      { path: "/assets/inter-CCCCCCCC.woff2", body: noise(2000, 3), precompress: false },
    ]);
    const r = await size(dir);
    expect(r.code).toBe(1);
    expect(r.out).toContain("asset.font");
    expect(r.out).toContain("inter-CCCCCCCC.woff2");
  });

  test("a lazy chunk over its limit only warns before M3; --strict fails it", async () => {
    const dir = dist([
      { path: "/assets/index-AAAAAAAA.js", body: OK_JS },
      { path: "/assets/diagram-DDDDDDDD.js", body: noise(20_000, 5) }, // limit 5.75 KB
    ]);
    const loose = await size(dir);
    expect(loose.code).toBe(0);
    expect(loose.out).toContain("asset.chunk.diagram");
    expect(loose.out).toContain("warning until M3");
    expect((await size(dir, "--strict")).code).toBe(1);
  });

  test("files that are not precompressed are called out (warning; strict fails)", async () => {
    const dir = dist([
      { path: "/assets/index-AAAAAAAA.js", body: OK_JS },
      { path: "/assets/plain-EEEEEEEE.js", body: OK_JS, precompress: false },
    ]);
    const loose = await size(dir);
    expect(loose.code).toBe(0);
    expect(loose.out).toContain("asset.precompressed");
    expect(loose.out).toContain("plain-EEEEEEEE.js");
    expect((await size(dir, "--strict")).code).toBe(1);
  });

  test("modulepreloaded chunks count towards the initial JS", async () => {
    const html = `<html><head><script type="module" src="/assets/index-AAAAAAAA.js"></script><link rel="modulepreload" href="/assets/map-FFFFFFFF.js"></head></html>`;
    const dir = dist(
      [
        { path: "/assets/index-AAAAAAAA.js", body: noise(90_000, 1) },
        { path: "/assets/map-FFFFFFFF.js", body: noise(90_000, 2) },
      ],
      { html },
    );
    expect((await size(dir)).code).toBe(1); // 180 KB together
  });

  test("--json writes the metrics and verdicts", async () => {
    const dir = dist([{ path: "/assets/index-AAAAAAAA.js", body: OK_JS }]);
    const out = join(dir, "size.json");
    expect((await size(dir, "--json", out)).code).toBe(0);
    const doc = await Bun.file(out).json();
    expect(doc.ok).toBe(true);
    expect(doc.metrics.map((x: { id: string }) => x.id)).toContain("asset.js.initial.gz");
  });

  test("usage errors exit 2: a directory without index.html", async () => {
    const r = await size(mkdtempSync(join(tmpdir(), "mitori-empty-")));
    expect(r.code).toBe(2);
    expect(r.err).toContain("index.html");
  });
});

describe("ASSET-U-04 measureAssets over the dist server", () => {
  test("reports br and gzip bodies separately and reads headers from the response", async () => {
    const dir = dist([
      { path: "/assets/index-AAAAAAAA.js", body: OK_JS },
      { path: "/assets/cm6-GGGGGGGG.js", body: OK_JS },
      { path: "/assets/merge-HHHHHHHH.js", body: OK_JS },
    ]);
    const server = serveDist(dir);
    try {
      const m = await measureAssets(server.url, listDist(dir));
      const row = m.rows.find((r) => r.path === "/assets/index-AAAAAAAA.js");
      expect(row).toMatchObject({ initial: true, kind: "js", brEncoding: "br", gzEncoding: "gzip", immutable: true, hashed: true });
      expect(row?.br).toBe(brotliCompressSync(Buffer.from(OK_JS)).length);
      expect(row?.gz).toBe(gzipSync(Buffer.from(OK_JS)).length);
      const ids = m.metrics.map((x) => x.id);
      expect(ids).toContain("asset.chunk.cm6");
      expect(ids).toContain("asset.chunk.merge");
      expect(m.metrics.find((x) => x.id === "asset.chunk.cm6merge")?.value).toBeCloseTo(2 * ((row?.gz ?? 0) / 1000), 6);
      expect(m.metrics.find((x) => x.id === "asset.precompressed")?.value).toBe(100);
    } finally {
      await server.stop();
    }
  });
});
