// WP-11a acceptance (MILESTONES §3, SC-04): the compiled binary, copied into a directory without node_modules,
// starts the daemon for a fixture repo, answers GET /api/v1/health within 1 s and serves the embedded shell; its
// Workers (parse / ELK / Shiki) run from the embedded files; a tampered asset lock fails the build.
// Builds dist/mitori-<host> first when it is missing or older than its sources; MITORI_BIN=<path> tests another binary.

import { Database } from "bun:sqlite";
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const ROOT = resolve(import.meta.dir, "../..");
const HOST_BIN = join(ROOT, `dist/mitori-${process.platform}-${process.arch}`);
const BIN = process.env.MITORI_BIN ?? HOST_BIN;
/** build:bin targets (scripts/build-bin.ts `TARGETS`, MILESTONES §11): elsewhere (linux-arm64) the suite needs MITORI_BIN. */
const TARGETS: readonly string[] = ["darwin-arm64", "linux-x64"];
const UNBUILDABLE = !process.env.MITORI_BIN && !TARGETS.includes(`${process.platform}-${process.arch}`);
if (UNBUILDABLE) console.warn(`skeleton: skipped — build:bin does not target ${process.platform}-${process.arch}; pass MITORI_BIN=<binary>`);
// go-small arrives with WP-00b; until then the M0 fixture stands in
const FIXTURE = join(ROOT, existsSync(join(ROOT, "fixtures/repos/go-small")) ? "fixtures/repos/go-small" : "fixtures/repos/ts-small");
const SOURCES = [
  "apps/cli/src",
  "packages",
  "apps/web/src",
  "apps/web/index.html",
  "apps/web/vite.config.ts",
  "scripts/gen-assets.ts",
  "scripts/build-bin.ts",
  "bun.lock",
];

function newestSource(): number {
  let newest = 0;
  const visit = (p: string) => {
    if (!existsSync(p)) return;
    const st = statSync(p);
    if (st.isDirectory()) for (const e of readdirSync(p)) visit(join(p, e));
    else newest = Math.max(newest, st.mtimeMs);
  };
  for (const s of SOURCES) visit(join(ROOT, s));
  return newest;
}

function ensureBinary(): void {
  if (process.env.MITORI_BIN) return;
  if (existsSync(BIN) && statSync(BIN).mtimeMs >= newestSource()) return;
  const r = Bun.spawnSync(["bun", "scripts/build-bin.ts"], { cwd: ROOT, stdout: "pipe", stderr: "pipe" });
  if (r.exitCode !== 0) throw new Error(`build:bin failed:\n${r.stdout}${r.stderr}`);
}

let iso = "";
let mitori = "";
beforeAll(() => {
  iso = mkdtempSync(join(tmpdir(), "mitori-skel-"));
  mkdirSync(join(iso, "home"));
  if (UNBUILDABLE) return; // SKEL-AT-05 (the asset lock) needs no binary and still runs
  ensureBinary();
  mitori = join(iso, "mitori");
  copyFileSync(BIN, mitori);
  Bun.spawnSync(["chmod", "755", mitori]);
}, 180_000);
afterAll(() => {
  if (iso) rmSync(iso, { recursive: true, force: true });
});

/** Spawn the binary in `iso` and wait for the URL line on stdout. */
async function startDaemon(args: string[], env: Record<string, string> = {}) {
  const t0 = performance.now();
  const proc = Bun.spawn([mitori, ...args], {
    cwd: iso,
    env: { PATH: process.env.PATH ?? "/usr/bin:/bin", HOME: iso, MITORI_HOME: join(iso, "home"), ...env },
    stdout: "pipe",
    stderr: "pipe",
  });
  // stderr is collected as it arrives (the open scan reports there once the zero-token doc is ready)
  const err = { text: "" };
  void (async () => {
    for await (const c of proc.stderr) err.text += new TextDecoder().decode(c);
  })();
  const reader = proc.stdout.getReader();
  let out = "";
  const deadline = setTimeout(() => proc.kill(), 5_000);
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    out += new TextDecoder().decode(value);
    if (/http:\/\/127\.0\.0\.1:\d+\//.test(out)) break;
  }
  clearTimeout(deadline);
  reader.releaseLock();
  const url = /http:\/\/127\.0\.0\.1:\d+\//.exec(out)?.[0];
  if (!url) throw new Error(`no URL on stdout: ${out}${err.text}`);
  return { proc, url, out, t0, err };
}

describe.skipIf(UNBUILDABLE)("SKEL-AT-01 mitori <repo> --no-open from a dir without node_modules", () => {
  let d: Awaited<ReturnType<typeof startDaemon>>;
  let healthMs = 0;
  let health: Record<string, unknown> = {};
  beforeAll(async () => {
    d = await startDaemon([FIXTURE, "--no-open"]);
    const res = await fetch(`${d.url}api/v1/health`);
    healthMs = performance.now() - d.t0;
    health = (await res.json()) as Record<string, unknown>;
  });
  afterAll(() => d?.proc.kill("SIGTERM"));

  test("GET /api/v1/health answers after spawning (the 1 s budget is timed by bench: bin.startup, srv.ttfb.health)", () => {
    // functional: it answers; a generous deadline only (a loaded machine is not a regression — bench/ gates the time)
    expect(healthMs).toBeLessThan(15_000);
    expect(health).toMatchObject({ ok: true, apiVersion: 1, pid: d.proc.pid, build: "release" });
    expect(typeof health.version).toBe("string");
    expect(d.out).toBe(`${d.url}\n`); // stdout carries the URL only (RQ-CLI-1)
  });

  test("GET / and SPA routes return the shell under the daemon CSP", async () => {
    const res = await fetch(d.url);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/html");
    expect(res.headers.get("cache-control")).toBe("no-cache");
    const csp = res.headers.get("content-security-policy") ?? "";
    expect(csp).toContain("default-src 'self'");
    expect(csp).not.toContain("{headInline}");
    expect(res.headers.get("x-content-type-options")).toBe("nosniff");
    const html = await res.text();
    expect(html).toContain('<div id="app"');
    expect(await (await fetch(`${d.url}doc`)).text()).toBe(html);
  });

  test("SRV-I-025 the shell's hashed assets are served precompressed and immutable", async () => {
    const html = await (await fetch(d.url)).text();
    const js = /src="(\/assets\/[^"]+\.js)"/.exec(html)?.[1];
    expect(js).toBeDefined();
    const br = await fetch(`${d.url}${js?.slice(1)}`, { headers: { "accept-encoding": "br" }, decompress: false });
    expect(br.status).toBe(200);
    expect(br.headers.get("content-encoding")).toBe("br");
    expect(br.headers.get("cache-control")).toContain("immutable");
    expect(br.headers.get("vary")).toBe("accept-encoding");
    const gz = await fetch(`${d.url}${js?.slice(1)}`, { headers: { "accept-encoding": "gzip" }, decompress: false });
    expect(gz.headers.get("content-encoding")).toBe("gzip");
    const plain = await fetch(`${d.url}${js?.slice(1)}`, { headers: { "accept-encoding": "identity" } });
    expect(plain.headers.get("content-encoding")).toBeNull();
    // WP-INT: the first script is WP-10a's ~0.7 KB boot module, so compare with the decoded br body instead of a size floor
    const text = await plain.text();
    expect(text.length).toBeGreaterThan(100);
    expect(text).toBe(await (await fetch(`${d.url}${js?.slice(1)}`, { headers: { "accept-encoding": "br" } })).text());
  });

  test("SRV-I-003 Host gate (421) and unknown API routes (404)", async () => {
    const port = new URL(d.url).port;
    for (const host of ["evil.example", `127.0.0.1:${Number(port) + 1}`, `localhost.evil.com:${port}`]) {
      const bad = await fetch(`${d.url}api/v1/health`, { headers: { host } });
      expect({ host, status: bad.status }).toEqual({ host, status: 421 });
      expect(((await bad.json()) as { error: { code: string } }).error.code).toBe("E_BAD_HOST");
    }
    expect((await fetch(`${d.url}api/v1/health`, { headers: { host: `localhost:${port}` } })).status).toBe(200);
    const none = await fetch(`${d.url}api/v1/nope`);
    expect(none.status).toBe(404);
    expect(((await none.json()) as { error: { code: string } }).error.code).toBe("E_NOT_FOUND");
  });

  test("the migration runner created srv_migrations in state.sqlite", () => {
    const db = new Database(join(iso, "home/state.sqlite"), { readonly: true });
    try {
      expect(db.query("SELECT name FROM sqlite_master WHERE name = 'srv_migrations'").get()).toEqual({ name: "srv_migrations" });
    } finally {
      db.close();
    }
  });

  test("SIGTERM stops the daemon cleanly; the open scan reported the workspace on stderr", async () => {
    const report = /: \d+ files, \d+ modules \(S0–S4/;
    for (let i = 0; i < 200 && !report.test(d.err.text); i++) await Bun.sleep(20);
    expect(d.err.text).toMatch(report);
    d.proc.kill("SIGTERM");
    expect(await d.proc.exited).toBe(0);
  });
});

describe.skipIf(UNBUILDABLE)("SKEL-AT-02 embedded Workers inside the compiled binary (_selftest)", () => {
  test("pinned files, parse Worker (6 grammars), ELK 300 nodes, Shiki, migrations", async () => {
    const proc = Bun.spawn([mitori, "_selftest", "--json", "--elk-runs", "5"], { cwd: iso, env: { PATH: process.env.PATH ?? "" }, stdout: "pipe" });
    const report = JSON.parse(await new Response(proc.stdout).text()) as {
      ok: boolean;
      source: string;
      standalone: boolean;
      checks: Record<string, { ok: boolean; error?: string; warmMedianMs?: number; mismatched?: string[] }>;
    };
    expect(await proc.exited).toBe(0);
    expect(report).toMatchObject({ ok: true, source: "embedded", standalone: true });
    for (const [name, c] of Object.entries(report.checks)) expect({ name, ...c }).toMatchObject({ name, ok: true });
    expect(report.checks.integrity?.mismatched).toEqual([]);
    // the embedded ELK Worker lays out (a generous deadline); its time against the 120 ms acceptance bound is the bench
    // case doc.elk.300 (bench/doc.bench.ts, gated only on a quiet reference machine)
    expect(report.checks.elk?.warmMedianMs).toBeGreaterThan(0);
    expect(report.checks.elk?.warmMedianMs).toBeLessThan(5_000);
  }, 30_000);
});

describe.skipIf(UNBUILDABLE)("SKEL-AT-03 the binary ignores bunfig.toml / .env in its working directory", () => {
  test("no preload runs and .env does not reach the daemon", async () => {
    const dir = join(iso, "hostile");
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "bunfig.toml"), 'preload = ["./evil.ts"]\n');
    writeFileSync(join(dir, "evil.ts"), 'console.log("PRELOAD-RAN");\n');
    writeFileSync(join(dir, ".env"), "MITORI_PORT=not-a-port\n");
    const v = Bun.spawnSync([mitori, "--version"], { cwd: dir, env: { PATH: process.env.PATH ?? "" } });
    expect(v.stdout.toString()).not.toContain("PRELOAD-RAN");
    const proc = Bun.spawn([mitori, "_serve"], { cwd: dir, env: { PATH: process.env.PATH ?? "", HOME: iso }, stdout: "pipe", stderr: "pipe" });
    const first = await proc.stdout.getReader().read();
    proc.kill("SIGTERM");
    expect(new TextDecoder().decode(first.value)).toMatch(/http:\/\/127\.0\.0\.1:\d+\//);
  });
});

describe.skipIf(UNBUILDABLE)("SKEL-AT-04 CLI-I-010 release binary: start-up (bin.startup limit 50 ms) and no test-only strings", () => {
  test("no /__test/, ReplaySpawner or __MITORI_TEST__ in the binary", async () => {
    const bytes = Buffer.from(await Bun.file(mitori).arrayBuffer());
    for (const s of ["/__test/", "ReplaySpawner", "__MITORI_TEST__"]) expect({ s, found: bytes.includes(s) }).toEqual({ s, found: false });
  });

  test("median of 10 runs", () => {
    const ms: number[] = [];
    for (let i = 0; i < 11; i++) {
      const t0 = performance.now();
      Bun.spawnSync([mitori, "--version"], { cwd: iso });
      if (i > 0) ms.push(performance.now() - t0);
    }
    ms.sort((a, b) => a - b);
    // bin.startup (50 ms) is gated by bench/asset/size.ts#bin-startup; here: it starts and exits, generously
    expect(ms[5] ?? Number.POSITIVE_INFINITY).toBeLessThan(2_000);
  });
});

// not skipped where build:bin has no target: the lock check runs before any compile (an explicit, supported target)
describe("SKEL-AT-05 asset lock (SEC-16)", () => {
  test("the committed lock matches the installed files", () => {
    const r = Bun.spawnSync(["bun", "scripts/gen-assets.ts", "--verify-only"], { cwd: ROOT, stderr: "pipe" });
    expect(r.exitCode).toBe(0);
  });

  test("a sha256 mismatch fails build:bin before compiling", () => {
    const lock = JSON.parse(readFileSync(join(ROOT, "apps/cli/src/build/assets.lock.json"), "utf8")) as { assets: { id: string; sha256: string }[] };
    const go = lock.assets.find((a) => a.id === "grammar.go");
    if (!go) throw new Error("grammar.go missing from the lock");
    go.sha256 = `${go.sha256.startsWith("0") ? "1" : "0"}${go.sha256.slice(1)}`;
    const tampered = join(iso, "tampered.lock.json");
    writeFileSync(tampered, JSON.stringify(lock));
    const target = UNBUILDABLE ? "linux-x64" : `${process.platform}-${process.arch}`;
    const out = join(ROOT, `dist/mitori-${target}`);
    const before = existsSync(out) ? statSync(out).mtimeMs : 0;
    const r = Bun.spawnSync(["bun", "scripts/build-bin.ts", "--target", target, "--lock", tampered], { cwd: ROOT, stdout: "pipe", stderr: "pipe" });
    expect(r.exitCode).toBe(1);
    expect(r.stderr.toString()).toContain("grammar.go: sha256");
    expect(existsSync(out) ? statSync(out).mtimeMs : 0).toBe(before);
  });
});
