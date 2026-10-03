import { afterAll, afterEach, describe, expect, test } from "bun:test";
import { mkdirSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { createSafeWriter, createSelfWriteLog } from "../fs/index.ts";
import { git, makeRepo } from "../test/repo.ts";
import { cleanupTempDirs, tempDir } from "../test/tmp.ts";
import { createFakeClock } from "../testing.ts";
import { createFsWatcher } from "./index.ts";
import type { FsChange } from "./watcher.ts";

const stops: (() => void)[] = [];
afterEach(() => {
  for (const s of stops.splice(0)) s();
});
afterAll(cleanupTempDirs);

/** Start a watcher and collect its batches. */
function collect(root: string, opts: { ignore?: string[]; gitDir?: string | null; selfWrites?: ReturnType<typeof createSelfWriteLog> } = {}) {
  const batches: { at: number; changes: FsChange[] }[] = [];
  const w = createFsWatcher(opts.selfWrites ? { selfWrites: opts.selfWrites } : {});
  const stop = w.watch(root, { ignore: opts.ignore ?? [], gitDir: opts.gitDir ?? null }, (changes) => batches.push({ at: performance.now(), changes }));
  stops.push(stop);
  const flat = () => batches.flatMap((b) => b.changes);
  const until = async (pred: () => boolean, ms = 1500) => {
    const t0 = performance.now();
    while (!pred() && performance.now() - t0 < ms) await Bun.sleep(5);
    return pred();
  };
  return { batches, flat, until, stop };
}
const settle = () => Bun.sleep(150); // FSEvents may deliver events of setup writes late
const has = (cs: FsChange[], kind: string, path?: string) => cs.some((c) => c.kind === kind && (path === undefined || ("path" in c && c.path === path)));

describe("PLAT-I-007 FsWatcher", () => {
  test("add / change / delete as repo-relative NFC paths", async () => {
    const root = tempDir();
    const w = collect(root);
    await settle();
    writeFileSync(join(root, "a.ts"), "1");
    expect(await w.until(() => has(w.flat(), "add", "a.ts"))).toBe(true);
    writeFileSync(join(root, "a.ts"), "22");
    expect(await w.until(() => has(w.flat(), "change", "a.ts"))).toBe(true);
    rmSync(join(root, "a.ts"));
    expect(await w.until(() => has(w.flat(), "delete", "a.ts"))).toBe(true);
    mkdirSync(join(root, "メモ"));
    writeFileSync(join(root, "メモ", "ノート.md".normalize("NFD")), "x");
    expect(await w.until(() => has(w.flat(), "add", "メモ/ノート.md".normalize("NFC")))).toBe(true);
  });

  test("a burst on one path within the batch window collapses to one entry per batch", async () => {
    const root = tempDir();
    const w = collect(root);
    await settle();
    for (let i = 0; i < 10; i++) writeFileSync(join(root, "hot.ts"), `v${i}`);
    await w.until(() => w.flat().length > 0);
    await Bun.sleep(100);
    for (const b of w.batches) expect(b.changes.filter((c) => "path" in c && c.path === "hot.ts").length).toBe(1);
    expect(w.batches.length).toBeLessThanOrEqual(2);
  });

  test("rename = delete(old) + add(new) in the same batch", async () => {
    const root = tempDir();
    writeFileSync(join(root, "old.ts"), "x");
    const w = collect(root);
    await settle();
    w.batches.length = 0;
    renameSync(join(root, "old.ts"), join(root, "new.ts"));
    expect(await w.until(() => has(w.flat(), "add", "new.ts") && has(w.flat(), "delete", "old.ts"))).toBe(true);
    const b = w.batches.find((x) => has(x.changes, "add", "new.ts"));
    expect(b && has(b.changes, "delete", "old.ts")).toBe(true);
  });

  test("mitori's own SafeWriter writes are not reported (hash match); a user edit right after is", async () => {
    const root = tempDir();
    const selfWrites = createSelfWriteLog();
    const writer = createSafeWriter({ selfWrites });
    const w = collect(root, { selfWrites });
    await settle();
    await writer.write(root, "doc/00-tldr.md", "# mitori wrote this\n", "doc");
    await writer.write(root, "README.md", "readme\n", "doc");
    await Bun.sleep(150);
    expect(w.flat()).toEqual([]);
    writeFileSync(join(root, "README.md"), "edited by the user\n");
    expect(await w.until(() => has(w.flat(), "change", "README.md") || has(w.flat(), "add", "README.md"))).toBe(true);
    const ev = w.flat().find((c) => "path" in c && c.path === "README.md");
    expect(ev && "source" in ev && new TextDecoder().decode(ev.source)).toBe("edited by the user\n");
    await writer.remove(root, "README.md", "doc");
    await Bun.sleep(150);
    expect(has(w.flat(), "delete", "README.md")).toBe(false);
  });

  test("ignore globs (DOC_WATCH_IGNORE), temp files and .git internals are dropped; index/HEAD/refs → {kind:'git'}", async () => {
    const root = makeRepo({ "a.ts": "1" });
    const w = collect(root, { ignore: ["cache/**", "tmp/**"], gitDir: join(root, ".git") });
    await settle();
    w.batches.length = 0;
    mkdirSync(join(root, "cache", "html"), { recursive: true });
    writeFileSync(join(root, "cache", "html", "x.json"), "{}");
    mkdirSync(join(root, "tmp", "prep"), { recursive: true });
    writeFileSync(join(root, "tmp", "prep", "y"), "y");
    writeFileSync(join(root, ".mitori-tmp-0123456789abcdef"), "temp");
    writeFileSync(join(root, "a.ts"), "2");
    git(root, ["commit", "-q", "-am", "two"]);
    // a.ts existed before the watch: its first event is `add` on FSEvents (no modify flag), `change` on inotify
    expect(await w.until(() => has(w.flat(), "git") && (has(w.flat(), "change", "a.ts") || has(w.flat(), "add", "a.ts")))).toBe(true);
    await Bun.sleep(100);
    const paths = w.flat().flatMap((c) => ("path" in c ? [c.path] : []));
    expect(paths.filter((p) => p !== "a.ts" && p !== ".mitori-tmp-0123456789abcdef")).toEqual([]);
    expect(paths).not.toContain(".mitori-tmp-0123456789abcdef");
    for (const b of w.batches) expect(b.changes.filter((c) => c.kind === "git").length).toBeLessThanOrEqual(1);
  });

  test("a git dir outside the tree (shadow repo) is watched separately", async () => {
    const dir = tempDir();
    const shadow = join(tempDir(), "shadow.git");
    git(dir, ["init", "-q", "--bare", shadow]);
    const w = collect(dir, { gitDir: shadow });
    await settle();
    writeFileSync(join(shadow, "HEAD"), "ref: refs/heads/other\n");
    expect(await w.until(() => has(w.flat(), "git"))).toBe(true);
  });

  test("files inside a newly created directory are reported", async () => {
    const root = tempDir();
    const w = collect(root);
    await settle();
    mkdirSync(join(root, "pkg", "deep"), { recursive: true });
    for (let i = 0; i < 5; i++) writeFileSync(join(root, "pkg", "deep", `f${i}.ts`), "x");
    expect(await w.until(() => [0, 1, 2, 3, 4].every((i) => has(w.flat(), "add", `pkg/deep/f${i}.ts`)))).toBe(true);
  });

  test("stop() ends delivery", async () => {
    const root = tempDir();
    const w = collect(root);
    await settle();
    w.stop();
    writeFileSync(join(root, "late.ts"), "x");
    await Bun.sleep(150);
    expect(w.flat()).toEqual([]);
  });

  test("an unwatchable root fails with E_IDX_WATCH", () => {
    expect(() => createFsWatcher().watch(join(tempDir(), "missing"), { ignore: [], gitDir: null }, () => {})).toThrow(/cannot watch/);
  });
});

describe("PLAT-I-007 batching: leading 5 ms, then max-wait 30 ms (FakeClock)", () => {
  test("first event flushes after 5 ms; events right after a flush wait 30 ms", async () => {
    const root = tempDir();
    const clock = createFakeClock();
    const batches: FsChange[][] = [];
    const stop = createFsWatcher({ timers: clock, clock }).watch(root, { ignore: [], gitDir: null }, (b) => batches.push(b));
    stops.push(stop);
    await settle();
    clock.advance(1000);
    batches.length = 0;
    writeFileSync(join(root, "a.ts"), "1");
    await Bun.sleep(100); // the raw event arrives; its flush timer lives on the fake clock
    clock.advance(4);
    expect(batches.length).toBe(0);
    clock.advance(1);
    expect(batches.length).toBe(1);
    writeFileSync(join(root, "b.ts"), "1");
    await Bun.sleep(100);
    clock.advance(29);
    expect(batches.length).toBe(1);
    clock.advance(1);
    expect(batches.length).toBe(2);
    expect(has(batches[1] as FsChange[], "add", "b.ts")).toBe(true);
  });
});

describe("PLAT-I-007 latency (MILESTONES WP-01: macOS write → event p50 ≤ 25 ms)", () => {
  test("isolated saves, 40 samples", async () => {
    const root = tempDir();
    for (let i = 0; i < 40; i++) writeFileSync(join(root, `f${i}.ts`), "0");
    const pending = new Map<string, (t: number) => void>();
    const stop = createFsWatcher().watch(root, { ignore: [], gitDir: null }, (b) => {
      const t = performance.now();
      for (const c of b) if ("path" in c) pending.get(c.path)?.(t);
    });
    stops.push(stop);
    await Bun.sleep(300);
    const lat: number[] = [];
    for (let i = 0; i < 40; i++) {
      const f = `f${i}.ts`;
      const got = new Promise<number>((res) => {
        pending.set(f, res);
        setTimeout(() => res(Number.NaN), 1000);
      });
      const t0 = performance.now();
      writeFileSync(join(root, f), `v${i}`);
      const t = await got;
      pending.delete(f);
      if (!Number.isNaN(t)) lat.push(t - t0);
      await Bun.sleep(60);
    }
    lat.sort((a, b) => a - b);
    const p50 = lat[Math.floor(lat.length / 2)] as number;
    console.log(
      `watcher write → batch (${process.platform}): p50 ${p50.toFixed(1)} ms, p95 ${lat[Math.floor(lat.length * 0.95)]?.toFixed(1)} ms, n=${lat.length}`,
    );
    expect(lat.length).toBe(40);
    expect(p50).toBeLessThanOrEqual(25);
  }, 20_000);
});
