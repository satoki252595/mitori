/**
 * `mitori review [--round N] [--wait-sec S] [--no-open]` — the blocking Pull contract (loop spec §10.1, crit's
 * contract): long-poll `GET /review/wait` 25 s at a time with a stable `x-mitori-waiter`; on Finish print the daemon's
 * `mitori.review/1` text once on stdout and `approved: true|false` as the LAST stderr line (exit 0). A stopped or
 * unreachable daemon is never mistaken for approval: shutdown text, `approved: false`, exit 10. `--wait-sec` elapsed:
 * `status=pending`, `pending: true`, exit 11. 503 (workspace loading) is retried every 500 ms for up to 5 minutes.
 */
import { MitoriError, type ReviewWaitRes, type WorkspaceKey } from "@mitori/core";
import { intFlag, parse } from "./args.ts";
import { openInBrowser } from "./browser.ts";
import { findDaemon } from "./daemon-client.ts";
import { type Io, usage } from "./io.ts";
import { agentLabelFromEnv, REVIEW_EXIT, REVIEW_STDOUT, REVIEW_WAIT } from "./loop-contract.ts";
import { connectWorkspace, type Session } from "./session.ts";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const hex = (b: Uint8Array) => Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("");
/** Grace on top of the server's hold time before a poll counts as a lost daemon. */
const POLL_SLACK_MS = 10_000;

const nextLine = (n: number) => REVIEW_STDOUT.next.replace("{n}", String(n));

/** stdout of a review that ended without the daemon's text (lost daemon). */
export function shutdownText(n: number): string {
  return `mitori.review/1 round=${n} status=shutdown\n${REVIEW_STDOUT.shutdown}\n${nextLine(n)}\n`;
}

/** stdout of `--wait-sec` running out. */
export function pendingText(n: number): string {
  return `mitori.review/1 round=${n} status=pending\n${nextLine(n)}\n`;
}

/** The round a wait without `--round` is for: the collecting/dispatched one, else the next. */
async function roundOf(s: Session, ws: WorkspaceKey, round: number | undefined): Promise<number> {
  if (round !== undefined) return round;
  try {
    const st = await s.api.call("GET /ws/:ws/review", { params: { ws } });
    const r = st.round;
    if (!r) return 1;
    return r.state === "collecting" || r.state === "dispatched" ? r.n : r.n + 1;
  } catch {
    return 1;
  }
}

export async function run(io: Io): Promise<number> {
  const { values, positionals } = parse(
    io.argv,
    { round: { type: "string" }, "wait-sec": { type: "string" }, "no-open": { type: "boolean" }, agent: { type: "string" } },
    "review",
  );
  if (positionals.length > 0) throw usage(`unexpected argument ${positionals[0]}`, "mitori review --help");
  const round = intFlag(values.round, "round", "review", 1, 1_000_000);
  const waitSec = intFlag(values["wait-sec"], "wait-sec", "review", 1, 7 * 86_400);
  const agent = agentLabelFromEnv(values.agent, io.env);
  const waiter = `w_${hex(io.random.bytes(8))}`;
  const s = await connectWorkspace(io, { agent, waiter });
  const ws = s.ws.info.key;

  if (round !== undefined && round >= 2) {
    // idempotent; a round that does not exist (or is already complete) is fine
    try {
      await s.api.call("POST /ws/:ws/review/rounds/:n/complete", { params: { ws, n: String(round - 1) } });
    } catch (e) {
      const m = MitoriError.from(e);
      if (m.code !== "E_NOT_FOUND" && m.code !== "E_STATE_TRANSITION" && m.code !== "E_CONFLICT") throw m;
    }
  }
  io.err(`mitori: review UI ${s.daemon.origin}/w/${ws}/review\n`);
  if (round === undefined && values["no-open"] !== true) await openInBrowser(io, s, ws, `/w/${ws}/review`);

  const n = await roundOf(s, ws, round);
  const deadline = waitSec === undefined ? Number.POSITIVE_INFINITY : io.clock.now() + waitSec * 1000;
  /** Start of the current run of 503s (the 5-minute retry window is per run, not per review). */
  let notReadySince: number | null = null;
  const lost = () => {
    io.out(shutdownText(n));
    io.err(`${REVIEW_STDOUT.stderrApproved.replace("{approved}", "false")}\n`);
    return REVIEW_EXIT.shutdown;
  };
  for (;;) {
    const left = deadline - io.clock.now();
    if (left <= 0) {
      io.out(pendingText(n));
      io.err(`${REVIEW_STDOUT.stderrPending}\n`);
      return REVIEW_EXIT.pending;
    }
    const timeoutMs = Math.max(1000, Math.min(REVIEW_WAIT.pollTimeoutMs, left));
    let res: ReviewWaitRes;
    try {
      res = await s.api.call("GET /ws/:ws/review/wait", {
        params: { ws },
        query: { ...(round !== undefined ? { round } : {}), timeoutMs },
        signal: AbortSignal.timeout(timeoutMs + POLL_SLACK_MS),
      });
    } catch (e) {
      const m = MitoriError.from(e);
      if (m.code !== "E_NOT_READY" && m.code !== "E_CANCELLED") throw m;
      // a 503 from the same live daemon (workspace loading) is retried; an unreachable or replaced daemon is a shutdown
      if ((await findDaemon(io, s.home))?.registry.pid !== s.daemon.registry.pid) return lost();
      notReadySince ??= io.clock.now();
      if (io.clock.now() - notReadySince > REVIEW_WAIT.notReadyMaxMs) throw m;
      await sleep(REVIEW_WAIT.notReadyRetryMs);
      continue;
    }
    notReadySince = null;
    if (res.status === "timeout") continue;
    if (res.status === "shutdown") {
      io.out(res.stdout ?? shutdownText(res.round?.n ?? n));
      io.err(`${REVIEW_STDOUT.stderrApproved.replace("{approved}", "false")}\n`);
      return REVIEW_EXIT.shutdown;
    }
    io.out(res.stdout ?? "");
    io.err(`${REVIEW_STDOUT.stderrApproved.replace("{approved}", String(res.approved))}\n`);
    return REVIEW_EXIT.ready;
  }
}
