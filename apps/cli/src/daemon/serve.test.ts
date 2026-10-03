import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { HealthRes } from "@mitori/core";
import { type DaemonHandle, startDaemon } from "./serve.ts";

describe("SKEL-U-04 skeleton daemon (in-process, source checkout assets)", () => {
  let home = "";
  let d: DaemonHandle;
  beforeAll(async () => {
    home = mkdtempSync(join(tmpdir(), "mitori-serve-"));
    d = await startDaemon({ home, port: 0, version: "9.9.9", build: "test" });
  });
  afterAll(async () => {
    await d?.stop();
    rmSync(home, { recursive: true, force: true });
  });

  test("health is the HealthRes contract; state DB lives in the home", async () => {
    const h = (await (await fetch(`${d.url}api/v1/health?challenge=${"0".repeat(32)}`)).json()) as HealthRes;
    expect(h).toMatchObject({ ok: true, version: "9.9.9", apiVersion: 1, pid: process.pid, build: "test" });
    expect(Number.isNaN(Date.parse(h.startedAt))).toBe(false);
    expect(d.stateDb).toBe(join(home, "state.sqlite"));
  });

  test("every response carries the security headers; / serves a page", async () => {
    for (const path of ["", "doc", "api/v1/health", "api/v1/unknown"]) {
      const res = await fetch(`${d.url}${path}`);
      expect(res.headers.get("x-content-type-options")).toBe("nosniff");
      expect(res.headers.get("cross-origin-opener-policy")).toBe("same-origin");
    }
    expect((await fetch(d.url)).headers.get("content-type")).toContain("text/html");
  });

  test("no home directory ⇒ in-memory state DB", async () => {
    const mem = await startDaemon({ home: join(home, "missing"), port: 0, version: "9.9.9", build: "test" });
    expect(mem.stateDb).toBe(":memory:");
    expect((await fetch(`${mem.url}api/v1/health`)).status).toBe(200);
    await mem.stop();
  });
});
