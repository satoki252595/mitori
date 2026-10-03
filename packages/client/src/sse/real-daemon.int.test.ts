import { afterAll, describe, expect, test } from "bun:test";
import { mkdtempSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { API_PREFIX, type Clock, type Random } from "@mitori/core";
import type { ConnectionState } from "../contract.ts";
import { createApiClient } from "../http/index.ts";
import { probeDaemon } from "../http/probe.ts";
import { createSseClient } from "./index.ts";

/**
 * End to end against the REAL daemon (server package), run as a child process because @mitori/client may not import
 * @mitori/server: SRV-AT-05 / SRV-I-029 (stop → start: the open tab is live again ≤ 5 s, never 401, one resync) and
 * SRV-AT-09 (the CLI's health challenge verifies the real daemon's proof before the token is used).
 */
const DAEMON = new URL("../../../server/src/http/test/daemon-proc.ts", import.meta.url).pathname;
const clock: Clock = { now: () => Date.now(), iso: () => new Date().toISOString() };
const random: Random = { bytes: (n) => crypto.getRandomValues(new Uint8Array(n)) };
const home = realpathSync(mkdtempSync(join(tmpdir(), "mitori-client-e2e-")));
const procs: ReturnType<typeof Bun.spawn>[] = [];

afterAll(() => {
  for (const p of procs) p.kill("SIGKILL");
  rmSync(home, { recursive: true, force: true });
});

async function startDaemon(): Promise<{ port: number; token: string; pid: number; proc: ReturnType<typeof Bun.spawn> }> {
  const proc = Bun.spawn([process.execPath, DAEMON], { env: { ...process.env, MITORI_TEST_HOME: home }, stdout: "pipe", stderr: "inherit" });
  procs.push(proc);
  const reader = (proc.stdout as ReadableStream<Uint8Array>).getReader();
  const dec = new TextDecoder();
  let buf = "";
  while (!buf.includes("\n")) {
    const { done, value } = await reader.read();
    if (done) throw new Error("daemon exited before announcing its port");
    buf += dec.decode(value, { stream: true });
  }
  reader.releaseLock();
  return { ...(JSON.parse(buf.slice(0, buf.indexOf("\n"))) as { port: number; token: string; pid: number }), proc };
}

const until = async (cond: () => boolean, ms: number) => {
  const end = performance.now() + ms;
  while (!cond()) {
    if (performance.now() > end) throw new Error("timed out");
    await Bun.sleep(10);
  }
};

describe("@mitori/client against the real daemon", () => {
  test("SRV-AT-09 + SRV-AT-05: proof checked before the token is used; stop → start ⇒ the tab is live again ≤ 5 s, no 401, one resync", async () => {
    const first = await startDaemon();
    const origin = `http://127.0.0.1:${first.port}`;

    // CLI side: verify the daemon BEFORE sending the bearer, then mint a login nonce
    const health = await probeDaemon({ origin, token: first.token, challenge: random.bytes(16) });
    expect(health?.pid).toBe(first.pid);
    expect(await probeDaemon({ origin, token: "not-the-token", challenge: random.bytes(16) })).toBeNull();
    const cli = createApiClient({
      base: `${origin}${API_PREFIX}`,
      auth: { scheme: "bearer", token: () => first.token },
      client: { kind: "cli", version: "test" },
    });
    const { url } = await cli.call("POST /auth/nonce", { params: {}, body: { to: "/" } });
    const nonce = new URL(url).hash.slice(3).split("&")[0] as string;

    // browser side: exchange the nonce, open the one SSE stream
    const web = createApiClient({ base: `${origin}${API_PREFIX}`, auth: { scheme: "session", token: () => null }, client: { kind: "web", version: "test" } });
    const { token } = await web.call("POST /auth/exchange", { params: {}, body: { nonce } });
    const states: ConnectionState[] = [];
    const resyncs: string[] = [];
    const tab = createSseClient({
      base: `${origin}${API_PREFIX}`,
      auth: { scheme: "session", token: () => token },
      client: { kind: "web", version: "0.1.0-test" },
      random,
      clock,
      onState: (s) => void states.push(s),
    });
    tab.on("resync", (e) => void resyncs.push(e.reason));
    try {
      tab.connect(null);
      await until(() => tab.state.kind === "live", 5000);

      first.proc.kill("SIGTERM");
      await first.proc.exited;
      expect(states.some((s) => s.kind === "stopped")).toBe(true); // server.shutdown reached the tab

      const t0 = performance.now();
      const second = await startDaemon();
      expect(second.port).toBe(first.port); // origin kept ⇒ localStorage (the session token) survives
      expect(second.token).not.toBe(first.token); // the CLI bearer rotates
      await until(() => tab.state.kind === "live", 5000);
      const liveMs = performance.now() - t0;
      console.log(`SRV-AT-05 restart → live ${liveMs.toFixed(0)} ms (daemon process start included)`);
      expect(liveMs).toBeLessThanOrEqual(5000);
      expect(states.some((s) => s.kind === "auth_expired")).toBe(false);
      expect(resyncs).toEqual(["restart"]);
      // the restarted daemon still accepts the session for plain requests too
      const settings = await fetch(`${origin}${API_PREFIX}/settings`, { headers: { authorization: `Mitori-Session ${token}`, "x-mitori-client": "web/t" } });
      expect(settings.status).toBe(200);
      second.proc.kill("SIGTERM");
      await second.proc.exited;
    } finally {
      tab.close();
    }
  }, 30_000);
});
