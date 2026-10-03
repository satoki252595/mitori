import { describe, expect, test } from "bun:test";
import { existsSync, statSync } from "node:fs";
import { delimiter } from "node:path";
import { BIN_GUARD_DIR, guardedPath } from "./home.ts";
import { collectingSink, createTestHome, seededRandom } from "./index.ts";

describe("TK-HOME-01 createTestHome", () => {
  test("creates a private directory and an env that pins MITORI_HOME, git, time and the PATH guard", async () => {
    const home = await createTestHome();
    try {
      expect(statSync(home.dir).mode & 0o777).toBe(0o700);
      expect(home.env).toMatchObject({
        MITORI_HOME: home.dir,
        GIT_CONFIG_GLOBAL: "/dev/null",
        GIT_CONFIG_NOSYSTEM: "1",
        GIT_TERMINAL_PROMPT: "0",
        GIT_AUTHOR_NAME: "mitori-test",
        GIT_COMMITTER_EMAIL: "test@mitori.invalid",
        GIT_AUTHOR_DATE: "2026-01-01T00:00:00Z",
        TZ: "UTC",
        LANG: "C.UTF-8",
      });
      expect(home.env.PATH?.split(delimiter)[0]).toBe(BIN_GUARD_DIR);
    } finally {
      await home.cleanup();
    }
    expect(existsSync(home.dir)).toBe(false);
  });

  test("keep: true leaves the directory behind", async () => {
    const home = await createTestHome({ keep: true });
    await home.cleanup();
    expect(existsSync(home.dir)).toBe(true);
    const again = await createTestHome();
    expect(again.dir).not.toBe(home.dir);
    await again.cleanup();
    (await import("node:fs")).rmSync(home.dir, { recursive: true, force: true });
  });

  test("live suites get the real PATH (no guard)", () => {
    expect(guardedPath("/usr/bin:/bin", true)).toBe("/usr/bin:/bin");
    expect(guardedPath("/usr/bin:/bin", false)).toBe(`${BIN_GUARD_DIR}:/usr/bin:/bin`);
    expect(guardedPath(`${BIN_GUARD_DIR}:/usr/bin`, false)).toBe(`${BIN_GUARD_DIR}:/usr/bin`); // idempotent
  });
});

describe("TK-HOME-02 seededRandom", () => {
  test("the same seed gives the same bytes, a different seed a different stream", () => {
    const a = seededRandom("20261003").bytes(37);
    const b = seededRandom("20261003").bytes(37);
    const c = seededRandom(20261004).bytes(37);
    expect(a).toEqual(b);
    expect(a).not.toEqual(c);
    expect(a).toHaveLength(37);
  });

  test("successive calls continue the stream; bytes(0) is empty; bad lengths throw", () => {
    const r = seededRandom(1);
    const first = r.bytes(8);
    const second = r.bytes(8);
    expect(first).not.toEqual(second);
    expect(seededRandom(1).bytes(16)).toEqual(new Uint8Array([...first, ...second]));
    expect(r.bytes(0)).toHaveLength(0);
    expect(() => r.bytes(-1)).toThrow(RangeError);
    expect(() => r.bytes(1.5)).toThrow(RangeError);
  });

  test("number and string seeds with the same text agree", () => {
    expect(seededRandom(7).bytes(4)).toEqual(seededRandom("7").bytes(4));
  });
});

describe("TK-HOME-03 collectingSink", () => {
  test("records in emit order and clears", () => {
    const s = collectingSink<number>();
    s.emit(1);
    s.emit(2);
    expect(s.events).toEqual([1, 2]);
    s.clear();
    expect(s.events).toEqual([]);
  });

  test("waitFor resolves with a past event at once and with a future one when it arrives", async () => {
    const s = collectingSink<{ t: string }>();
    s.emit({ t: "a" });
    expect(await s.waitFor((e) => e.t === "a")).toEqual({ t: "a" });
    const later = s.waitFor((e) => e.t === "b");
    s.emit({ t: "x" });
    s.emit({ t: "b" });
    expect(await later).toEqual({ t: "b" });
  });

  test("waitFor rejects after the timeout and names how many events it saw", async () => {
    const s = collectingSink<number>();
    s.emit(1);
    await expect(s.waitFor((e) => e === 9, 20)).rejects.toThrow("1 event(s) recorded");
  });

  test("a throwing predicate rejects its own waiter and never throws into emit", async () => {
    const s = collectingSink<number>();
    const w = s.waitFor(() => {
      throw new Error("bad predicate");
    });
    expect(() => s.emit(1)).not.toThrow();
    await expect(w).rejects.toThrow("bad predicate");
  });
});
