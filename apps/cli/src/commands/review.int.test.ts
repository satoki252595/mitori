/**
 * CLI-I-004 / AC-L70 / AC-L72 `mitori review`: the blocking Pull contract against a scripted daemon — stdout is the
 * daemon's `mitori.review/1` text exactly once, the LAST stderr line is `approved: true|false`, exit codes 0 / 10 / 11,
 * 503 retried, a lost daemon is never approval, a stable `x-mitori-waiter`, the browser only on the first round.
 */
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import type { ReviewWaitRes } from "@mitori/core";
import { runCommand } from "./index.ts";
import { ApiFail, type FakeDaemon, startFakeDaemon, testIo, WS } from "./test/fake-daemon.ts";

const STDOUT =
  "mitori.review/1 round=1 threads=1 approved=false\nAddress each thread …\n\n## th_k3f9a2cq change R1 src/a.ts:1-2\n> 直して\n\nNEXT: mitori review --round 2\n";
const ready = (approved = false): ReviewWaitRes => ({ status: "ready", stdout: STDOUT, approved, next: "mitori review --round 2" });
const timeout: ReviewWaitRes = { status: "timeout", approved: false, next: "mitori review --round 1" };

let d: FakeDaemon;
beforeEach(async () => {
  d = await startFakeDaemon();
  d.route("GET /ws/:ws/review", () => ({ round: null, pending: [], heldNotes: [], waitingClients: 0, waitingAgents: [] }));
  d.route("GET /ws/:ws", () => ({ connectedTabs: 0, rev: 3, counts: {} }));
});
afterEach(() => d.cleanup());

const io = (argv: string[], env: Record<string, string> = {}) => testIo({ argv, home: d.home, cwd: d.repo, env });
const lastLine = (s: string) => s.trimEnd().split("\n").at(-1);

describe("CLI-I-004 mitori review", () => {
  test("re-polls on timeout; on Finish prints stdout once and `approved:` as the last stderr line (exit 0)", async () => {
    let n = 0;
    d.route("GET /ws/:ws/review/wait", () => (++n < 3 ? timeout : ready(false)));
    const t = io(["--no-open"], { CLAUDECODE: "1" });
    expect(await runCommand("review", t)).toBe(0);
    expect(t.stdout).toBe(STDOUT);
    expect(lastLine(t.stderr)).toBe("approved: false");
    expect(t.stderr).toContain(`mitori: review UI ${d.origin}/w/${WS}/review\n`);
    const polls = d.calls("GET /ws/:ws/review/wait");
    expect(polls.length).toBe(3);
    // one waiter id per CLI process (UXP-01), the agent label from CLAUDECODE, the client kind
    const waiters = new Set(polls.map((p) => p.headers.get("x-mitori-waiter")));
    expect(waiters.size).toBe(1);
    expect([...waiters][0]).toMatch(/^w_[0-9a-f]{16}$/);
    expect(polls[0]?.headers.get("x-mitori-agent")).toBe("claude-code");
    expect(polls[0]?.headers.get("x-mitori-client")).toBe("cli/9.9.9");
    expect(polls[0]?.query.get("timeoutMs")).toBe("25000");
    expect(t.opened).toEqual([]); // --no-open
  });

  test("approved: true when the round closed with no open threads", async () => {
    d.route("POST /ws/:ws/review/rounds/:n/complete", (c) => ({ n: Number(c.params.n), mode: "pull", state: "complete", threads: [], approved: false }));
    d.route("GET /ws/:ws/review/wait", () => ({
      ...ready(true),
      stdout: "mitori.review/1 round=2 threads=0 approved=true\nNo open threads. The review is approved.\nNEXT: none\n",
    }));
    const t = io(["--round", "2", "--no-open"]);
    expect(await runCommand("review", t)).toBe(0);
    expect(t.stdout.endsWith("NEXT: none\n")).toBe(true);
    expect(lastLine(t.stderr)).toBe("approved: true");
  });

  test("--round N completes round N-1 first (idempotent: an unknown round is fine) and waits for N", async () => {
    d.route("POST /ws/:ws/review/rounds/:n/complete", () => {
      throw new ApiFail(404, "E_NOT_FOUND");
    });
    d.route("GET /ws/:ws/review/wait", () => ready());
    const t = io(["--round", "3"]);
    expect(await runCommand("review", t)).toBe(0);
    expect(d.calls("POST /ws/:ws/review/rounds/:n/complete").map((c) => c.path)).toEqual([`/ws/${WS}/review/rounds/2/complete`]);
    expect(d.calls("GET /ws/:ws/review/wait")[0]?.query.get("round")).toBe("3");
    expect(t.opened).toEqual([]); // the browser opens on the first round only
  });

  test("the first round opens the browser through a one-time login URL when no tab is connected", async () => {
    d.route("GET /ws/:ws/review/wait", () => ready());
    const t = io([]);
    expect(await runCommand("review", t)).toBe(0);
    expect(t.opened).toEqual([`${d.origin}/auth#n=nonce123&to=/w/${WS}/review`]);
    d.route("GET /ws/:ws", () => ({ connectedTabs: 1 }));
    const again = io([]);
    await runCommand("review", again);
    expect(again.opened).toEqual([]);
  });

  test("AC-L72 shutdown from the daemon: its text, `approved: false`, exit 10", async () => {
    d.route("GET /ws/:ws/review/wait", () => ({
      status: "shutdown",
      stdout: "mitori.review/1 round=1 status=shutdown\nThe mitori daemon stopped before the review finished.\nNEXT: mitori review --round 1\n",
      approved: false,
      next: "mitori review --round 1",
    }));
    const t = io(["--no-open"]);
    expect(await runCommand("review", t)).toBe(10);
    expect(t.stdout).toContain("status=shutdown");
    expect(lastLine(t.stderr)).toBe("approved: false");
  });

  test("AC-L72 a daemon that disappears mid-wait is a shutdown (never approval): exit 10", async () => {
    d.route("GET /ws/:ws/review/wait", async () => {
      setTimeout(() => void d.stop(), 5);
      await new Promise((r) => setTimeout(r, 200));
      return ready(true);
    });
    const t = io(["--no-open"]);
    expect(await runCommand("review", t)).toBe(10);
    expect(t.stdout).toBe("mitori.review/1 round=1 status=shutdown\nThe mitori daemon stopped before the review finished.\nNEXT: mitori review --round 1\n");
    expect(lastLine(t.stderr)).toBe("approved: false");
  });

  test("AC-L72 503 E_NOT_READY (workspace loading) is retried until the round arrives", async () => {
    let n = 0;
    d.route("GET /ws/:ws/review/wait", () => {
      if (++n < 3) throw new ApiFail(503, "E_NOT_READY");
      return ready();
    });
    const t = io(["--no-open"]);
    expect(await runCommand("review", t)).toBe(0);
    expect(n).toBe(3);
    expect(lastLine(t.stderr)).toBe("approved: false");
  });

  test("--wait-sec elapsed: status=pending, `pending: true`, exit 11, NEXT repeats the round", async () => {
    d.route("GET /ws/:ws/review", () => ({ round: { n: 4, state: "collecting" }, pending: [], heldNotes: [], waitingClients: 0, waitingAgents: [] }));
    d.route("GET /ws/:ws/review/wait", async (c) => {
      await new Promise((r) => setTimeout(r, Math.min(Number(c.query.get("timeoutMs")), 1100)));
      return timeout;
    });
    const t = io(["--wait-sec", "1", "--no-open"]);
    expect(await runCommand("review", t)).toBe(11);
    expect(t.stdout).toBe("mitori.review/1 round=4 status=pending\nNEXT: mitori review --round 4\n");
    expect(lastLine(t.stderr)).toBe("pending: true");
    expect(Number(d.calls("GET /ws/:ws/review/wait")[0]?.query.get("timeoutMs"))).toBeLessThanOrEqual(1000);
  });

  test("usage errors exit 2; daemon errors are `error <CODE>: …` with exit 1", async () => {
    expect(await runCommand("review", io(["--round", "zero"]))).toBe(2);
    expect(await runCommand("review", io(["extra"]))).toBe(2);
    const t = io(["--no-open"]);
    expect(await runCommand("review", t)).toBe(1); // the fake has no /review/wait yet: 501
    expect(t.stderr).toMatch(/error E_UNSUPPORTED: /);
  });
});
