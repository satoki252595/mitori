import { afterAll, describe, expect, test } from "bun:test";
import { readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { cleanupTempDirs, tempDir } from "../test/tmp.ts";
import { createFakeClock, createTestLogger } from "../testing.ts";
import { createLogger, openLogFile } from "./index.ts";

afterAll(cleanupTempDirs);

describe("PLAT-U-010 Logger", () => {
  test("NDJSON with ts/level/namespace; children join namespaces and bind fields; level filter", () => {
    const out: string[] = [];
    const clock = createFakeClock("2026-03-04T05:06:07.000Z");
    const log = createLogger({ sink: (l) => out.push(l), clock, level: "info" });
    log.debug("hidden");
    const agent = log.child("agent", { ws: "ws_1" }).child("claude", { job: "j_1" });
    agent.info("spawned", { pid: 42, ok: true, gone: undefined, nil: null });
    log.error("boom", { msg: "reserved key", t: 1 });
    expect(out.length).toBe(2);
    expect(out.every((l) => l.endsWith("\n") && !l.slice(0, -1).includes("\n"))).toBe(true);
    expect(JSON.parse(out[0] as string)).toEqual({
      t: "2026-03-04T05:06:07.000Z",
      lvl: "info",
      ns: "agent.claude",
      msg: "spawned",
      ws: "ws_1",
      job: "j_1",
      pid: 42,
      ok: true,
      nil: null,
    });
    expect(JSON.parse(out[1] as string)).toMatchObject({ ns: "", msg: "boom", _msg: "reserved key", _t: 1 });
  });

  test("content-like values (newline, > 200 chars) are omitted unless logContent", () => {
    const out: string[] = [];
    const clock = createFakeClock();
    const long = "x".repeat(201);
    createLogger({ sink: (l) => out.push(l), clock }).warn("w", { a: long, b: "line1\nline2", c: "short" });
    expect(JSON.parse(out[0] as string)).toMatchObject({ a: "«omitted:201»", b: "«omitted:11»", c: "short" });
    createLogger({ sink: (l) => out.push(l), clock, logContent: true }).warn("w", { a: long });
    expect(JSON.parse(out[1] as string).a).toBe(long);
  });

  test("a throwing sink never propagates", () => {
    const log = createLogger({
      sink: () => {
        throw new Error("disk full");
      },
      clock: createFakeClock(),
    });
    log.error("still fine");
  });

  test("TestLogger.assertNoContent fails on content-like fields, passes otherwise", () => {
    const t = createTestLogger();
    t.child("idx").info("scan", { files: 7, ms: 3.2 });
    t.assertNoContent();
    expect(t.lines[0]).toEqual({ lvl: "info", ns: "idx", msg: "scan", fields: { files: 7, ms: 3.2 } });
    t.info("leak", { source: "const a = 1;\nconst b = 2;" });
    expect(() => t.assertNoContent()).toThrow(/looks like content/);
  });
});

describe("PLAT-U-010 log file rotation (7 days / 50 MB)", () => {
  test("daily files, size-capped segments, retention by day, 0600", () => {
    const dir = join(tempDir(), "logs");
    const clock = createFakeClock("2026-05-10T12:00:00.000Z");
    const f = openLogFile({ dir, clock, maxBytes: 100, keepDays: 7 });
    expect(statSync(dir).mode & 0o777).toBe(0o700);
    const line = `${"a".repeat(39)}\n`; // 40 bytes
    f.write(line);
    f.write(line);
    f.write(line); // 120 > 100 → second segment
    expect(f.path().endsWith("daemon-20260510-1.ndjson")).toBe(true);
    clock.advance(86_400_000);
    f.write(line);
    expect(f.path().endsWith("daemon-20260511.ndjson")).toBe(true);
    expect(statSync(f.path()).mode & 0o777).toBe(0o600);
    expect(readdirSync(dir).sort()).toEqual(["daemon-20260510-1.ndjson", "daemon-20260510.ndjson", "daemon-20260511.ndjson"]);
    expect(readFileSync(join(dir, "daemon-20260510.ndjson"), "utf8")).toBe(line + line);
    // 7 days later the 10th is gone, the 11th (6 days back + today = 7 kept days) is not yet
    clock.advance(6 * 86_400_000);
    f.write(line);
    expect(readdirSync(dir).sort()).toEqual(["daemon-20260511.ndjson", "daemon-20260517.ndjson"]);
    f.close();
  });

  test("reopening continues the latest segment of today and prunes old files", () => {
    const dir = tempDir();
    writeFileSync(join(dir, "daemon-20260101.ndjson"), "old\n");
    writeFileSync(join(dir, "daemon-20260510-2.ndjson"), "seg2\n");
    writeFileSync(join(dir, "unrelated.txt"), "keep");
    const f = openLogFile({ dir, clock: createFakeClock("2026-05-10T00:00:00.000Z") });
    f.write("next\n");
    expect(f.path().endsWith("daemon-20260510-2.ndjson")).toBe(true);
    expect(readFileSync(f.path(), "utf8")).toBe("seg2\nnext\n");
    expect(readdirSync(dir).sort()).toEqual(["daemon-20260510-2.ndjson", "unrelated.txt"]);
    f.close();
  });
});
