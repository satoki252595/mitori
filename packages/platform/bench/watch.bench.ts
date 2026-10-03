// O3 (indexer spec §10.1): Linux watcher candidates, measured on two synthetic trees.
//   A = Bun recursive fs.watch (inotify on Linux, FSEvents on macOS)
//   B = polling `git ls-files -z -m -o --exclude-standard` + stat of the listed paths
// Measures (1) setup, (2) write → event p50/p95 over N single-file writes, (3) capture rate of a bulk write of
// 2,000 new files (+ files in directories created after setup), (4) idle CPU over 10 s, (5) RSS.
// Adoption rule: A if setup ≤ 500 ms, p95 ≤ 100 ms, capture 100 % and idle CPU ≤ 1 %; else B.
// Usage: bun packages/platform/bench/watch.bench.ts [--trees small,large] [--cands A,B] [--writes 200] [--idle 10]
//        [--poll-writes 40] [--json out.json]
// Depends only on Bun + node builtins (runs inside a bare Linux container with a copied bun binary).
import { mkdirSync, mkdtempSync, realpathSync, rmSync, statSync, watch, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

interface Tree {
  name: string;
  files: number;
  dirs: number;
}
const TREES: Record<string, Tree> = {
  small: { name: "small", files: 7768, dirs: 923 },
  large: { name: "large", files: 23304, dirs: 2800 },
};

const argv = process.argv.slice(2);
const opt = (k: string, d: string) => {
  const i = argv.indexOf(`--${k}`);
  return i >= 0 ? (argv[i + 1] ?? d) : d;
};
const trees = opt("trees", "small,large").split(",");
const cands = opt("cands", "A").split(",");
const WRITES = Number(opt("writes", "200"));
const POLL_WRITES = Number(opt("poll-writes", "40"));
const IDLE_S = Number(opt("idle", "10"));
const BULK = 2000;
const jsonOut = opt("json", "");

const sleep = (ms: number) => Bun.sleep(ms);
const pct = (xs: number[], p: number) => {
  const s = [...xs].sort((a, b) => a - b);
  return s.length ? (s[Math.min(s.length - 1, Math.floor((p / 100) * s.length))] as number) : Number.NaN;
};
const round = (x: number) => Math.round(x * 10) / 10;

/** Two-level tree: 31 top dirs, the rest below them; files round-robin over the leaf dirs. */
function buildTree(t: Tree): { root: string; files: string[]; leafDirs: string[] } {
  const root = realpathSync(mkdtempSync(join(tmpdir(), `o3-${t.name}-`)));
  const leafDirs: string[] = [];
  for (let i = 0; i < 31; i++) mkdirSync(join(root, `d${i}`));
  for (let i = 0; i < t.dirs - 31; i++) {
    const d = `d${i % 31}/s${i}`;
    mkdirSync(join(root, d));
    leafDirs.push(d);
  }
  const files: string[] = [];
  for (let i = 0; i < t.files; i++) {
    const f = `${leafDirs[i % leafDirs.length]}/f${i}.ts`;
    writeFileSync(join(root, f), `export const v${i} = ${i};\n`);
    files.push(f);
  }
  return { root, files, leafDirs };
}

function cpuMs(): number {
  const u = process.cpuUsage();
  return (u.user + u.system) / 1000;
}

interface Result {
  tree: string;
  cand: string;
  platform: string;
  setupMs: number;
  p50Ms: number;
  p95Ms: number;
  samples: number;
  missed: number;
  capturePct: number;
  newDirCapturePct: number;
  idleCpuPct: number;
  idleCpuPctByInterval?: Record<string, number>;
  rssMB: number;
}

async function benchA(t: Tree): Promise<Result> {
  const { root, files, leafDirs } = buildTree(t);
  const seen = new Map<string, number>();
  const waiters = new Map<string, (at: number) => void>();
  const rss0 = process.memoryUsage().rss;
  const t0 = performance.now();
  const w = watch(root, { recursive: true }, (_ev, name) => {
    if (!name) return;
    const at = performance.now();
    const p = String(name);
    if (!seen.has(p)) seen.set(p, at);
    const res = waiters.get(p);
    if (res) {
      waiters.delete(p);
      res(at);
    }
  });
  const setupMs = performance.now() - t0;
  await sleep(500);
  const rssMB = (process.memoryUsage().rss - rss0) / 1048576;

  const lat: number[] = [];
  let missed = 0;
  for (let i = 0; i < WRITES; i++) {
    const f = files[(i * 37) % files.length] as string;
    const got = new Promise<number>((resolve) => {
      waiters.set(f, resolve);
      setTimeout(() => resolve(Number.NaN), 2000);
    });
    const tw = performance.now();
    writeFileSync(join(root, f), `changed ${i}\n`);
    const at = await got;
    waiters.delete(f);
    if (Number.isNaN(at)) missed++;
    else lat.push(at - tw);
    // independent saves: FSEvents throttles to ≈ 35 ms when events arrive < 50 ms apart (measured), so space them
    await sleep(100);
  }

  seen.clear();
  const bulk: string[] = [];
  for (let i = 0; i < BULK; i++) {
    const f = `${leafDirs[i % leafDirs.length]}/bulk${i}.ts`;
    bulk.push(f);
    writeFileSync(join(root, f), "b\n");
  }
  for (let k = 0; k < 40 && bulk.some((f) => !seen.has(f)); k++) await sleep(100);
  const capturePct = (100 * bulk.filter((f) => seen.has(f)).length) / BULK;

  const fresh: string[] = [];
  for (let d = 0; d < 20; d++) {
    mkdirSync(join(root, `new${d}/deep`), { recursive: true });
    for (let k = 0; k < 5; k++) {
      const f = `new${d}/deep/n${k}.ts`;
      fresh.push(f);
      writeFileSync(join(root, f), "n\n");
    }
  }
  for (let k = 0; k < 20 && fresh.some((f) => !seen.has(f)); k++) await sleep(100);
  const newDirCapturePct = (100 * fresh.filter((f) => seen.has(f)).length) / fresh.length;

  const c0 = cpuMs();
  const i0 = performance.now();
  await sleep(IDLE_S * 1000);
  const idleCpuPct = (100 * (cpuMs() - c0)) / (performance.now() - i0);
  w.close();
  rmSync(root, { recursive: true, force: true });
  return {
    tree: t.name,
    cand: "A",
    platform: `${process.platform}-${process.arch}`,
    setupMs: round(setupMs),
    p50Ms: round(pct(lat, 50)),
    p95Ms: round(pct(lat, 95)),
    samples: lat.length,
    missed,
    capturePct: round(capturePct),
    newDirCapturePct: round(newDirCapturePct),
    idleCpuPct: Math.round(idleCpuPct * 100) / 100,
    rssMB: round(rssMB),
  };
}

const GIT_ENV = {
  PATH: process.env.PATH ?? "/usr/bin:/bin",
  HOME: tmpdir(),
  GIT_CONFIG_NOSYSTEM: "1",
  GIT_CONFIG_GLOBAL: "/dev/null",
  GIT_OPTIONAL_LOCKS: "0",
  GIT_AUTHOR_NAME: "o3",
  GIT_AUTHOR_EMAIL: "o3@x",
  GIT_COMMITTER_NAME: "o3",
  GIT_COMMITTER_EMAIL: "o3@x",
};

let childCpuMs = 0;
async function lsChanged(root: string): Promise<string[]> {
  const p = Bun.spawn(["git", "-c", "core.fsmonitor=false", "-c", "core.quotepath=off", "ls-files", "-z", "-m", "-o", "--exclude-standard"], {
    cwd: root,
    env: GIT_ENV,
    stdout: "pipe",
    stderr: "ignore",
  });
  const out = await new Response(p.stdout).text();
  await p.exited;
  const ru = p.resourceUsage();
  if (ru) childCpuMs += Number(ru.cpuTime.user + ru.cpuTime.system) / 1000;
  return out.split("\0").filter(Boolean);
}

/** Polling candidate: one poll = ls-files + stat of the listed paths; returns the changed set. */
function poller(root: string) {
  let prev = new Map<string, string>();
  return async (): Promise<Set<string>> => {
    const list = await lsChanged(root);
    const next = new Map<string, string>();
    const changed = new Set<string>();
    for (const p of list) {
      let key = "gone";
      try {
        const s = statSync(join(root, p), { bigint: true });
        key = `${s.size}:${s.mtimeNs}:${s.ino}`;
      } catch {}
      next.set(p, key);
      if (prev.get(p) !== key) changed.add(p);
    }
    for (const p of prev.keys()) if (!next.has(p)) changed.add(p);
    prev = next;
    return changed;
  };
}

async function benchB(t: Tree): Promise<Result> {
  const { root, files, leafDirs } = buildTree(t);
  const g = (...a: string[]) => Bun.spawnSync(["git", ...a], { cwd: root, env: GIT_ENV });
  g("init", "-q");
  g("add", "-A");
  g("commit", "-q", "-m", "tree");
  const rss0 = process.memoryUsage().rss;
  const poll = poller(root);
  const t0 = performance.now();
  await poll();
  const setupMs = performance.now() - t0;
  const INTERVAL = 250;
  let running = true;
  const seen = new Map<string, number>();
  const loop = (async () => {
    while (running) {
      const ch = await poll();
      const at = performance.now();
      for (const p of ch) if (!seen.has(p)) seen.set(p, at);
      await sleep(INTERVAL);
    }
  })();
  const lat: number[] = [];
  let missed = 0;
  for (let i = 0; i < POLL_WRITES; i++) {
    const f = files[(i * 37) % files.length] as string;
    seen.delete(f);
    const tw = performance.now();
    writeFileSync(join(root, f), `changed ${i}\n`);
    let at = Number.NaN;
    for (let k = 0; k < 200; k++) {
      const s = seen.get(f);
      if (s !== undefined && s >= tw) {
        at = s;
        break;
      }
      await sleep(5);
    }
    if (Number.isNaN(at)) missed++;
    else lat.push(at - tw);
    await sleep(Math.random() * INTERVAL);
  }
  seen.clear();
  const bulk: string[] = [];
  for (let i = 0; i < BULK; i++) {
    const f = `${leafDirs[i % leafDirs.length]}/bulk${i}.ts`;
    bulk.push(f);
    writeFileSync(join(root, f), "b\n");
  }
  await sleep(3 * INTERVAL + 1000);
  const capturePct = (100 * bulk.filter((f) => seen.has(f)).length) / BULK;
  const rssMB = (process.memoryUsage().rss - rss0) / 1048576;
  running = false;
  await loop;

  const idleBy: Record<string, number> = {};
  for (const iv of [250, 1000, 5000]) {
    const c0 = cpuMs() + childCpuMs;
    const i0 = performance.now();
    while (performance.now() - i0 < IDLE_S * 1000) {
      await poll();
      await sleep(iv);
    }
    idleBy[`${iv}ms`] = Math.round(((100 * (cpuMs() + childCpuMs - c0)) / (performance.now() - i0)) * 100) / 100;
  }
  rmSync(root, { recursive: true, force: true });
  return {
    tree: t.name,
    cand: "B",
    platform: `${process.platform}-${process.arch}`,
    setupMs: round(setupMs),
    p50Ms: round(pct(lat, 50)),
    p95Ms: round(pct(lat, 95)),
    samples: lat.length,
    missed,
    capturePct: round(capturePct),
    newDirCapturePct: Number.NaN,
    idleCpuPct: idleBy["250ms"] ?? Number.NaN,
    idleCpuPctByInterval: idleBy,
    rssMB: round(rssMB),
  };
}

const results: Result[] = [];
for (const name of trees) {
  const t = TREES[name];
  if (!t) throw new Error(`unknown tree ${name}`);
  for (const c of cands) {
    const r = c === "A" ? await benchA(t) : await benchB(t);
    results.push(r);
    console.log(JSON.stringify(r));
  }
}
const pass = (r: Result) => r.setupMs <= 500 && r.p95Ms <= 100 && r.capturePct === 100 && r.missed === 0 && r.idleCpuPct <= 1;
for (const r of results.filter((x) => x.cand === "A")) console.log(`A/${r.tree}: ${pass(r) ? "meets" : "fails"} the adoption rule`);
if (jsonOut) writeFileSync(jsonOut, `${JSON.stringify({ v: "mitori.o3/1", bun: Bun.version, results }, null, 2)}\n`);
