// INT-00 (MILESTONES §5, M0.5): the compiled binary — start → health → shell → `GET /doc` (SPA route) → and, since
// the composition root is wired, the authenticated `GET /api/v1/ws/:ws/doc` outline of an opened workspace.
// Uses dist/mitori-<host> (rebuilt when older than the sources); MITORI_BIN=<path> tests another binary.
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { API_PREFIX, type DaemonRegistry, type DocOutline, type HealthRes, type WorkspaceStatus, type WorkspaceSummary } from "@mitori/core";
import { buildFixture, type FixtureRepo } from "@mitori/testkit";

const ROOT = resolve(import.meta.dir, "../..");
const HOST_BIN = join(ROOT, `dist/mitori-${process.platform}-${process.arch}`);
const SOURCES = ["apps/cli/src", "apps/web/src", "packages", "scripts/gen-assets.ts", "scripts/build-bin.ts", "bun.lock"];
/** build:bin targets (scripts/build-bin.ts `TARGETS`, MILESTONES §11): elsewhere (linux-arm64) INT-00 needs MITORI_BIN. */
const TARGETS: readonly string[] = ["darwin-arm64", "linux-x64"];
const UNBUILDABLE = !process.env.MITORI_BIN && !TARGETS.includes(`${process.platform}-${process.arch}`);
if (UNBUILDABLE) console.warn(`INT-00: skipped — build:bin does not target ${process.platform}-${process.arch}; pass MITORI_BIN=<binary>`);

function newest(p: string): number {
  if (!existsSync(p)) return 0;
  const st = statSync(p);
  return st.isDirectory() ? Math.max(0, ...readdirSync(p).map((e) => newest(join(p, e)))) : st.mtimeMs;
}

let iso = "";
let proc: ReturnType<typeof Bun.spawn> | null = null;
let url = "";
let t0 = 0;
let repo: FixtureRepo;

beforeAll(async () => {
  if (UNBUILDABLE) return;
  let bin = process.env.MITORI_BIN ?? HOST_BIN;
  if (!process.env.MITORI_BIN && (!existsSync(bin) || statSync(bin).mtimeMs < Math.max(...SOURCES.map((s) => newest(join(ROOT, s)))))) {
    const r = Bun.spawnSync(["bun", "scripts/build-bin.ts"], { cwd: ROOT, stdout: "pipe", stderr: "pipe" });
    if (r.exitCode !== 0) throw new Error(`build:bin failed:\n${r.stdout}${r.stderr}`);
  }
  iso = mkdtempSync(join(tmpdir(), "mitori-int00-"));
  mkdirSync(join(iso, "home"));
  copyFileSync(bin, join(iso, "mitori"));
  Bun.spawnSync(["chmod", "755", join(iso, "mitori")]);
  bin = join(iso, "mitori");
  repo = await buildFixture("go-small");
  t0 = performance.now();
  proc = Bun.spawn([bin, "_serve"], {
    cwd: iso,
    env: { PATH: process.env.PATH ?? "/usr/bin:/bin", HOME: iso, MITORI_HOME: join(iso, "home") },
    stdout: "pipe",
    stderr: "pipe",
  });
  const reader = (proc.stdout as ReadableStream<Uint8Array>).getReader();
  let out = "";
  while (!/http:\/\/127\.0\.0\.1:\d+\//.test(out)) {
    const { value, done } = await reader.read();
    if (done) break;
    out += new TextDecoder().decode(value);
  }
  reader.releaseLock();
  url = /http:\/\/127\.0\.0\.1:\d+\//.exec(out)?.[0] ?? "";
}, 180_000);
afterAll(async () => {
  proc?.kill("SIGKILL");
  await repo?.dispose();
  if (iso) rmSync(iso, { recursive: true, force: true });
});

describe.skipIf(UNBUILDABLE)("INT-00 binary → health → shell → doc", () => {
  test("health within 1 s of spawning; the shell on / and /doc", async () => {
    expect(url).not.toBe("");
    const h = (await (await fetch(`${url}api/v1/health`)).json()) as HealthRes;
    expect(performance.now() - t0).toBeLessThan(1000);
    expect(h).toMatchObject({ ok: true, apiVersion: 1, build: "release" });
    const shell = await (await fetch(url)).text();
    expect(shell).toContain('<div id="app"');
    expect(await (await fetch(`${url}doc`)).text()).toBe(shell);
  });

  test("the composed daemon serves a workspace's outline to an authenticated client", async () => {
    const reg = JSON.parse(readFileSync(join(iso, "home/daemon.json"), "utf8")) as DaemonRegistry;
    const api = async <T>(method: string, path: string, body?: unknown): Promise<T> => {
      const res = await fetch(`${url.replace(/\/$/, "")}${API_PREFIX}${path}`, {
        method,
        headers: { authorization: `Bearer ${reg.token}`, "x-mitori-client": "cli/int", ...(body ? { "content-type": "application/json" } : {}) },
        ...(body ? { body: JSON.stringify(body) } : {}),
      });
      if (!res.ok) throw new Error(`${method} ${path}: ${res.status} ${await res.text()}`);
      return (await res.json()) as T;
    };
    const ws = (await api<WorkspaceSummary>("POST", "/workspaces", { target: repo.root })).info.key;
    for (let i = 0; i < 500; i++) {
      if ((await api<WorkspaceStatus>("GET", `/ws/${ws}`)).state === "ready") break;
      await Bun.sleep(10);
    }
    const outline = await api<DocOutline>("GET", `/ws/${ws}/doc`);
    expect(outline.sections.length).toBeGreaterThan(10);
    expect(outline.blocks.length).toBeGreaterThan(10);
  }, 30_000);

  test("SIGTERM stops it cleanly", async () => {
    proc?.kill("SIGTERM");
    expect(await proc?.exited).toBe(0);
  });
});
