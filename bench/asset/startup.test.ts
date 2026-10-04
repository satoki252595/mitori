import { afterAll, describe, expect, test } from "bun:test";
import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { judgeStartup, measureStartup } from "./startup.ts";

const dir = mkdtempSync(join(tmpdir(), "mitori-startup-"));
afterAll(() => rmSync(dir, { recursive: true, force: true }));
const script = (name: string, body: string): string => {
  const p = join(dir, name);
  writeFileSync(p, `#!/bin/sh\n${body}\n`);
  chmodSync(p, 0o755);
  return p;
};

describe("ASSET-U-05 bin.startup", () => {
  test("times `--version` once to warm up and then `runs` times; the median is of the measured runs", () => {
    const calls = join(dir, "calls");
    const bin = script("mitori-ok", `echo x >> ${calls}\necho "mitori 0.0.0 (api 1)"`);
    const s = measureStartup(bin, 5);
    expect(s.samples).toHaveLength(5);
    expect(s.median).toBeGreaterThan(0);
    expect(s.median).toBeLessThan(500);
    expect(readFileSync(calls, "utf8").trim().split("\n")).toHaveLength(6); // 1 discarded + 5
  });

  test("a binary that fails is an error, not a number", () => {
    expect(() => measureStartup(script("mitori-bad", "echo boom >&2\nexit 3"), 2)).toThrow("exited 3");
  });

  test("within the limit no calibration is run; over target is yellow", () => {
    let calibrated = false;
    const factor = () => {
      calibrated = true;
      return 1;
    };
    const budget = { target: 20, limit: 50 };
    expect(judgeStartup({ samples: [], median: 12 }, budget, factor)).toMatchObject({ level: "green", hard: false });
    expect(judgeStartup({ samples: [], median: 35 }, budget, factor)).toMatchObject({ level: "yellow", hard: false });
    expect(calibrated).toBe(false);
  });

  test("over the limit it fails only on the reference machine", () => {
    const budget = { target: 20, limit: 50 };
    const quiet = { loadavg: 2, cores: 18 };
    expect(judgeStartup({ samples: [], median: 80 }, budget, () => 1.02, quiet)).toMatchObject({ level: "red", hard: true, factor: 1.02 });
    expect(judgeStartup({ samples: [], median: 80 }, budget, () => 1.8, quiet)).toMatchObject({ level: "red", hard: false, factor: 1.8 });
  });

  test("a loaded reference machine reports an over-limit start-up instead of failing (the bench runner's rule)", () => {
    const budget = { target: 20, limit: 50 };
    const v = judgeStartup({ samples: [], median: 80 }, budget, () => 1.02, { loadavg: 30, cores: 18 });
    expect(v).toMatchObject({ level: "red", hard: false, factor: 1.02 });
    expect(v.skipped).toContain("under load");
    expect(judgeStartup({ samples: [], median: 80 }, budget, () => 1.02, { loadavg: 8, cores: 18 }).hard).toBe(true);
  });
});
