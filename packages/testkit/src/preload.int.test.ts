// The test-isolation preload (testing spec §1.5), exercised by running real `bun test` processes with it.
import { afterAll, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const PRELOAD = fileURLToPath(new URL("./preload.ts", import.meta.url));
const dirs: string[] = [];
afterAll(() => {
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
});

async function bunTest(source: string, env: Record<string, string | undefined> = {}): Promise<{ code: number; out: string }> {
  const dir = mkdtempSync(join(tmpdir(), "mitori-preload-"));
  dirs.push(dir);
  writeFileSync(join(dir, "probe.test.ts"), source);
  const clean = { ...process.env };
  for (const k of ["MITORI_HOME", "MITORI_TEST", "MITORI_TEST_NET", "MITORI_LIVE", "TZ", "MITORI_TEST_SEED"]) delete clean[k];
  const proc = Bun.spawn(["bun", "test", "--preload", PRELOAD, join(dir, "probe.test.ts")], {
    cwd: dir,
    env: { ...clean, ...env } as Record<string, string>,
    stdout: "pipe",
    stderr: "pipe",
  });
  const [out, err, code] = await Promise.all([new Response(proc.stdout).text(), new Response(proc.stderr).text(), proc.exited]);
  return { code, out: out + err };
}

describe("TK-PRELOAD-01 isolation", () => {
  test("environment: test flags, UTC, C.UTF-8, MITORI_HOME sentinel, fixed git identity and seed", async () => {
    const r = await bunTest(`
      import { expect, test } from "bun:test";
      test("env", () => {
        expect(globalThis.__MITORI_TEST__).toBe(true);
        expect(process.env.MITORI_TEST).toBe("1");
        expect(process.env.TZ).toBe("UTC");
        expect(process.env.LANG).toBe("C.UTF-8");
        expect(process.env.LC_ALL).toBe("C.UTF-8");
        expect(process.env.MITORI_HOME).toBe("/nonexistent/mitori-home-not-set");
        expect(process.env.GIT_CONFIG_GLOBAL).toBe("/dev/null");
        expect(process.env.GIT_CONFIG_NOSYSTEM).toBe("1");
        expect(process.env.GIT_TERMINAL_PROMPT).toBe("0");
        expect(process.env.GIT_AUTHOR_NAME).toBe("mitori-test");
        expect(process.env.GIT_COMMITTER_DATE).toBe("2026-01-01T00:00:00Z");
        expect(process.env.MITORI_TEST_SEED).toBe("20261003");
        expect(new Date(0).getTimezoneOffset()).toBe(0);
      });
    `);
    expect(r.out).toContain("1 pass");
    expect(r.code).toBe(0);
  });

  test("an explicit MITORI_TEST_SEED is kept", async () => {
    const r = await bunTest(`import { expect, test } from "bun:test"; test("seed", () => expect(process.env.MITORI_TEST_SEED).toBe("42"));`, {
      MITORI_TEST_SEED: "42",
    });
    expect(r.code).toBe(0);
  });

  test("spawn guard: claude and codex exit 97 with a message; MITORI_LIVE=1 lifts it", async () => {
    const probe = `
      import { expect, test } from "bun:test";
      import { spawnSync } from "node:child_process";
      test("guard", () => {
        for (const bin of ["claude", "codex"]) {
          const r = spawnSync(bin, ["--version"], { encoding: "utf8", env: process.env });
          expect(r.status).toBe(97);
          expect(r.stderr).toContain("blocked in tests");
        }
      });
    `;
    expect((await bunTest(probe)).code).toBe(0);
    const live = await bunTest(probe, { MITORI_LIVE: "1" });
    expect(live.code).not.toBe(0); // the guard directory is no longer on PATH (a real claude, or none at all, answers instead)
  });

  test("network guard: only loopback; fetch and WebSocket to other hosts are refused", async () => {
    const r = await bunTest(`
      import { expect, test } from "bun:test";
      test("net", async () => {
        const server = Bun.serve({ port: 0, hostname: "127.0.0.1", fetch: () => new Response("pong") });
        try {
          expect(await (await fetch("http://127.0.0.1:" + server.port + "/")).text()).toBe("pong");
          expect(await (await fetch(new URL("http://localhost:" + server.port + "/"))).text()).toBe("pong");
        } finally { server.stop(true); }
        await expect(fetch("https://example.com/")).rejects.toThrow("network blocked in tests");
        await expect(fetch(new Request("http://10.0.0.1/"))).rejects.toThrow("network blocked in tests");
        expect(() => new WebSocket("wss://example.com/socket")).toThrow("network blocked in tests");
      });
    `);
    expect(r.out).toContain("1 pass");
    expect(r.code).toBe(0);
  });

  test("MITORI_TEST_NET=1 lifts the network guard (contract, live and eval suites)", async () => {
    const r = await bunTest(
      `
      import { expect, test } from "bun:test";
      test("net", async () => {
        const err = await fetch("http://nonexistent.invalid/").catch((e) => e);
        expect(String(err?.message ?? err)).not.toContain("network blocked");
      });
    `,
      { MITORI_TEST_NET: "1" },
    );
    expect(r.code).toBe(0);
  });
});

describe("TK-PRELOAD-02 noisy failures", () => {
  test("an unhandled promise rejection fails the file even though every test passed", async () => {
    const r = await bunTest(`
      import { test } from "bun:test";
      test("ok", async () => { Promise.reject(new Error("nobody awaits me")); await new Promise((r) => setTimeout(r, 20)); });
    `);
    expect(r.code).not.toBe(0);
    expect(r.out).toContain("nobody awaits me");
  });

  test("console.error fails the file (it also catches missing i18n keys)", async () => {
    const r = await bunTest(`import { test } from "bun:test"; test("ok", () => { console.error("[i18n-missing] composer.title"); });`);
    expect(r.code).not.toBe(0);
    expect(r.out).toContain("[i18n-missing] composer.title");
  });

  test("a clean file passes", async () => {
    const r = await bunTest(`import { expect, test } from "bun:test"; test("ok", () => expect(1).toBe(1));`);
    expect(r.code).toBe(0);
  });
});
