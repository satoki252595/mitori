import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { FORMAT } from "@mitori/core";
import { CASES } from "../../src/bundle/test/cases.ts";
import { hasher } from "../../src/bundle/test/fake-anchor.ts";
import { GOLDEN_ROOT } from "../../src/bundle/test/golden.ts";

// SC-09: MBF/1 is frozen when WP-08a is done. The digest below covers the bytes of every golden bundle; regenerating a
// golden changes it, and the only legitimate way to accept that is a new format version — bump `FORMAT.bundle`
// (core) together with this pin, in a `golden:` commit, and re-record the cassettes that embed bundles.

const FROZEN = { format: "mitori.bundle/1", digest: "62dcf40fc00567ec" } as const;

describe("MBF/1 freeze (SC-09)", () => {
  test("the golden bundles still have the bytes of mitori.bundle/1", () => {
    const names = CASES.map((c) => `go-small/bundles/${c.name}.${c.tier}.txt`).sort();
    const digest = hasher.xxh3(names.map((n) => `${n}\n${readFileSync(join(GOLDEN_ROOT, n), "utf8")}`).join("\u0000"));
    if (FORMAT.bundle === FROZEN.format) expect(digest).toBe(FROZEN.digest);
    else expect(FORMAT.bundle).not.toBe(FROZEN.format); // a bumped format: re-pin `FROZEN` for the new version
  });

  test("the version string is the one the header's tag stands for", () => {
    expect(FORMAT.bundle).toBe("mitori.bundle/1");
  });
});
