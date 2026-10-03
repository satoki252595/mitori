// RT-31 re-trust (WP-08c, spec §7.6.2): a job's own diff that changes what a gate runs — a manifest, a lockfile, a
// runner config — gives that gate a new trust hash for the tree, so it never runs on the strength of the decision the
// human made about the unchanged repository.
import { describe, expect, test } from "bun:test";
import type { GateSpec } from "@mitori/core";
import { createHasher } from "@mitori/platform";
import { failureLine } from "./job.ts";
import { changedTrustInputs, gateTrust, treeSpecs } from "./trust.ts";

const sha256 = createHasher().sha256;
const spec = (id: string, cwd: string, trustHash: string): GateSpec =>
  ({
    id,
    kind: "test",
    argvTemplate: ["x"],
    endOfOptions: false,
    cwd,
    appliesTo: ["**/*"],
    autofix: false,
    executesRepoCode: true,
    timeoutMs: 1000,
    source: "detected",
    trustHash,
  }) as GateSpec;

const go = spec("test:go", "", "h-go");
const web = spec("test:vitest@web", "web", "h-web");
const api = spec("test:pytest@api", "api", "h-api");

describe("RT-31 re-trust when the tree changes a gate's trust inputs", () => {
  test("source-only changes keep every hash (the earlier trust stands)", () => {
    const out = treeSpecs(sha256, [go, web, api], [{ path: "internal/store/memory.go", newOid: "a".repeat(40) }]);
    expect(out.map((s) => s.trustHash)).toEqual(["h-go", "h-web", "h-api"]);
    expect(changedTrustInputs([{ path: "web/src/a.ts", newOid: null }])).toEqual([]);
  });

  test("a manifest / lockfile / runner config changes the hash of the gates of its directory, above and below — not of unrelated ones", () => {
    const pkg = treeSpecs(sha256, [go, web, api], [{ path: "web/package.json", newOid: "b".repeat(40) }]);
    expect(pkg[0]?.trustHash).toBe("h-go"); // the root gate reads the root's configs (a nested manifest has its own gate)
    expect(pkg[1]?.trustHash).not.toBe("h-web");
    expect(pkg[2]?.trustHash).toBe("h-api");
    // a root go.mod is an ancestor config of every gate
    const mod = treeSpecs(sha256, [go, web, api], [{ path: "go.mod", newOid: "c".repeat(40) }]);
    expect(mod.every((s, i) => s.trustHash !== [go, web, api][i]?.trustHash)).toBe(true);
    // a nested conftest.py is loaded by the runner of the directory above it
    const conf = treeSpecs(sha256, [go, web, api], [{ path: "api/tests/conftest.py", newOid: "d".repeat(40) }]);
    expect(conf[2]?.trustHash).not.toBe("h-api");
    expect(conf[1]?.trustHash).toBe("h-web");
    // JS config modules and requirements files count; deletions too, and the hash follows the new content
    for (const path of ["web/vitest.config.ts", "api/requirements-dev.txt", "web/bun.lock"])
      expect(changedTrustInputs([{ path, newOid: null }])).toEqual([path]);
    const a = treeSpecs(sha256, [web], [{ path: "web/package.json", newOid: "1".repeat(40) }])[0]?.trustHash;
    const b = treeSpecs(sha256, [web], [{ path: "web/package.json", newOid: "2".repeat(40) }])[0]?.trustHash;
    const gone = treeSpecs(sha256, [web], [{ path: "web/package.json", newOid: null }])[0]?.trustHash;
    expect(new Set([a, b, gone, "h-web"]).size).toBe(4);
  });

  test("a gate trusted for the repository is untrusted for a tree that rewrote its manifest, until that tree's set is trusted", () => {
    const trusted = new Set(["h-web"]);
    const state = (h: string) => (trusted.has(h) ? ("trusted" as const) : ("pending" as const));
    expect(gateTrust(state, sha256, [web]).trusted).toEqual([true]);
    const tree = treeSpecs(sha256, [web], [{ path: "web/package.json", newOid: "e".repeat(40) }]);
    const t = gateTrust(state, sha256, tree);
    expect(t.trusted).toEqual([false]);
    expect(t.set).toBe("pending");
    trusted.add(t.setHash as string);
    expect(gateTrust(state, sha256, tree).trusted).toEqual([true]);
  });
});

describe("base comparison of a failing check (live run 4)", () => {
  test("the same failure at the base and the head matches although ids, durations and addresses differ", () => {
    const head = ["goroutine 4 [running]:", "FAIL\texample.com/tsundoku/internal/meta\t0.237s", "main.go:12:3: panic at 0xc000123abc"];
    const base = ["goroutine 5 [running]:", "FAIL\texample.com/tsundoku/internal/meta\t0.241s", "main.go:14:9: panic at 0xc000999def"];
    expect(head.map(failureLine)).toEqual(base.map(failureLine));
    // a different message is still a different line
    expect(failureLine("store_test.go:20: want Count 3")).not.toBe(failureLine("store_test.go:20: want Size 3"));
  });
});
