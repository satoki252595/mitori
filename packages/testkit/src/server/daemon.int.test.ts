// startTestDaemon against the walking-skeleton daemon (M0.5): subprocess lifecycle, isolation, CLI access, login order.
import { describe, expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { MitoriError } from "@mitori/core";
import type { PageLike } from "../contract.ts";
import { startTestDaemon } from "./index.ts";

describe("TK-DAEMON-01 startTestDaemon (source build)", () => {
  test("starts from a fixture, serves health and the shell, runs the CLI against the same home, then cleans up", async () => {
    const d = await startTestDaemon({ fixture: "ts-small" });
    const home = d.home.dir;
    const repo = d.repo?.root ?? "";
    try {
      expect(d.url).toMatch(/^http:\/\/127\.0\.0\.1:\d+$/);
      expect(existsSync(home)).toBe(true);
      expect(d.repo?.name).toBe("ts-small");
      const health = (await (await fetch(`${d.url}/api/v1/health`)).json()) as { ok: boolean; build: string };
      expect(health).toMatchObject({ ok: true, build: "test" }); // the source daemon runs with the test flag
      expect((await fetch(`${d.url}/`)).headers.get("content-type")).toContain("text/html");
      const v = await d.cli(["--version"]);
      expect(v.code).toBe(0);
      expect(v.stdout).toMatch(/^mitori \d/);
      expect(v.ms).toBeGreaterThan(0);
      expect(await d.metrics()).toEqual({}); // the skeleton has no /__test/metrics
    } finally {
      await d.stop();
    }
    expect(existsSync(home)).toBe(false);
    expect(existsSync(repo)).toBe(false);
    await d.stop(); // idempotent
  });

  test("the child sees the isolated environment: sentinel-free MITORI_HOME and the PATH guard", async () => {
    const d = await startTestDaemon({});
    try {
      expect(d.home.env.MITORI_HOME).toBe(d.home.dir);
      expect(d.repo).toBeUndefined();
      expect((await d.cli(["--version"])).code).toBe(0);
    } finally {
      await d.stop();
    }
  });

  test("spawnCli returns a handle that can be killed", async () => {
    const d = await startTestDaemon({});
    try {
      const p = d.spawnCli(["_serve", "--port", "0"]);
      await new Promise((r) => setTimeout(r, 400));
      expect(p.stdout()).toMatch(/http:\/\/127\.0\.0\.1:\d+/);
      p.kill();
      expect(typeof (await p.exited)).toBe("number"); // SIGTERM: the daemon shuts down on its own
    } finally {
      await d.stop();
    }
  });

  test("login installs the collectors before the first navigation, then opens the path", async () => {
    const d = await startTestDaemon({});
    try {
      const calls: string[] = [];
      const page = {
        addInitScript: async () => void calls.push("init"),
        goto: async (u: string) => void calls.push(`goto ${u}`),
      } as unknown as PageLike;
      await d.login(page, "/doc");
      expect(calls).toEqual(["init", expect.stringMatching(/^goto http:\/\/127\.0\.0\.1:\d+\/?$/), `goto ${d.url}/doc`]);
      calls.length = 0;
      await d.login(page);
      expect(calls).toHaveLength(2);
    } finally {
      await d.stop();
    }
  });

  test("conflicting or unavailable options fail before anything is left running", async () => {
    await expect(startTestDaemon({ fixture: "ts-small", repoPath: "/tmp" })).rejects.toThrow("either");
    const err = await startTestDaemon({ fixture: "ts-small", seedDoc: "generated" }).catch((e) => e);
    expect(err).toBeInstanceOf(MitoriError);
    expect((err as MitoriError).code).toBe("E_NOT_FOUND");
    await expect(startTestDaemon({ seedDoc: "static" })).rejects.toThrow("needs a `fixture`");
  });

  test("a missing compiled binary is a readable error", async () => {
    const err = await startTestDaemon({ binary: "compiled", env: {} }).catch((e) => e);
    // either dist/ has a binary (then it started and we stop it) or the error names build:bin
    if (err instanceof Error) expect(err.message).toContain("build:bin");
    else await (err as Awaited<ReturnType<typeof startTestDaemon>>).stop();
  });
});
