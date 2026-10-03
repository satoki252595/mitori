// IDX-AT-53 (no change is lost: after a bulk write, warm scan and incremental updates agree with a cold scan) and the
// second half of IDX-AT-16 (after `git checkout HEAD~1` the warm scan parses exactly the files whose blob changed).
import { afterEach, describe, expect, test } from "bun:test";
import type { Indexer } from "../contract.ts";
import { createIndexer } from "./index.ts";
import { testDeps } from "./test/deps.ts";
import { tempRepo } from "./test/repo.ts";

const cleanup: (() => unknown)[] = [];
afterEach(async () => {
  for (const f of cleanup.splice(0)) await f();
});

const N = 2_000;
const body = (i: number, v: number) =>
  `export function f${i}(a: number): number {\n  return a + ${v};\n}\n${v % 3 === 0 ? `export const k${i} = ${v};\n` : ""}`;

/** Everything a consumer can observe per file (blob, class, symbols). */
function view(idx: Indexer): string[] {
  return idx
    .files({ includeExcluded: true })
    .map(
      (f) =>
        `${f.path} ${f.blob} ${f.class} ${f.excluded ?? "-"} ${f.lines}:${f.loc} ${idx.symbols(f.path).map((s) => `${s.qualname}@${s.start}-${s.end}:${s.sigHash}:${s.bodyHash}`)}`,
    );
}

describe("IDX-AT-53 bulk writes", () => {
  test(`${N} files rewritten at once: warm scan and update() both end where a cold scan does`, async () => {
    const files: Record<string, string> = {};
    for (let i = 0; i < N; i++) files[`src/d${i % 40}/f${i}.ts`] = body(i, 0);
    const repo = tempRepo(files);
    cleanup.push(() => repo.dispose());
    const viaScan = createIndexer(testDeps(repo.root));
    const viaUpdate = createIndexer(testDeps(repo.root));
    cleanup.push(
      () => viaScan.close(),
      () => viaUpdate.close(),
    );
    await viaScan.scan();
    await viaUpdate.scan();

    // A `git checkout`-like bulk write: every file changes, some disappear, new ones appear.
    const changes: { kind: "change" | "add" | "delete"; path: string }[] = [];
    for (let i = 0; i < N; i++) {
      const p = `src/d${i % 40}/f${i}.ts`;
      if (i % 10 === 9) {
        repo.run("rm", "-q", p);
        changes.push({ kind: "delete", path: p });
      } else {
        repo.write(p, body(i, i));
        changes.push({ kind: "change", path: p });
      }
    }
    for (let i = 0; i < 50; i++) {
      repo.write(`src/new/n${i}.ts`, body(N + i, 1));
      changes.push({ kind: "add", path: `src/new/n${i}.ts` });
    }

    await viaScan.scan({ reason: "git" });
    const d = await viaUpdate.update(changes);
    expect(d.changed.length).toBe(N + 50 - 1); // f0 is rewritten with the same content
    const cold = createIndexer(testDeps(repo.root));
    cleanup.push(() => cold.close());
    await cold.scan();
    const want = view(cold);
    expect(want.length).toBe(N - N / 10 + 50);
    expect(view(viaScan)).toEqual(want);
    expect(view(viaUpdate)).toEqual(want);
    expect(viaScan.snapshot()?.indexDigest).toBe(cold.snapshot()?.indexDigest as string);
    expect(viaUpdate.snapshot()?.indexDigest).toBe(cold.snapshot()?.indexDigest as string);
  }, 60_000);
});

describe("IDX-AT-16 branch switch", () => {
  test("after checkout HEAD~1 the warm scan parses only the files whose blob changed; switching back parses nothing", async () => {
    const files: Record<string, string> = {};
    for (let i = 0; i < 30; i++) files[`m/f${i}.ts`] = body(i, 0);
    const repo = tempRepo(files);
    cleanup.push(() => repo.dispose());
    for (let i = 0; i < 7; i++) repo.write(`m/f${i}.ts`, body(i, 5));
    repo.commit("seven");
    const deps = testDeps(repo.root);
    const idx = createIndexer(deps);
    cleanup.push(() => idx.close());
    await idx.scan();
    const parsed = () => deps.counters.get("idx.parse.calls") ?? 0;
    const before = parsed();
    repo.run("checkout", "-q", "HEAD~1");
    await idx.scan({ reason: "git" });
    expect(parsed() - before).toBe(7);
    repo.run("checkout", "-q", "main");
    const mid = parsed();
    await idx.scan({ reason: "git" });
    expect(parsed() - mid).toBe(0);
    expect(idx.snapshot()?.dirty).toBe(false);
  });
});
