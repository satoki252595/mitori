/**
 * `mitori review` waiters (server spec §7.4, UXP-01): a waiter (`x-mitori-waiter`, one per CLI process) counts while
 * its long-poll is open and for `DAEMON.waiterGraceMs` after it returns, so the 25 s re-polls do not flap the count.
 * Any change of the count or of the agent labels publishes `review.waiting` for the workspace.
 */
import type { Clock, SseEventPayload, WorkspaceKey } from "@mitori/core";
import { DAEMON } from "../contract.ts";
import type { TimerHandle, Timers } from "../http/timers.ts";

interface Waiter {
  agent: string | null;
  round: number;
  open: number;
  lastSeen: number;
  expiry: TimerHandle | null;
}

export interface WaiterRegistry {
  /** A long-poll started; call the returned function when it ends. */
  begin(ws: WorkspaceKey, waiter: string, agent: string | null, round: number): () => void;
  /** Live waiters (all workspaces when omitted). */
  count(ws?: WorkspaceKey): number;
  /** Drop every waiter and timer. */
  close(): void;
}

export function createWaiterRegistry(opts: {
  clock: Clock;
  timers: Timers;
  publish: (payload: SseEventPayload, ws: WorkspaceKey) => void;
  graceMs?: number;
}): WaiterRegistry {
  const grace = opts.graceMs ?? DAEMON.waiterGraceMs;
  const byWs = new Map<WorkspaceKey, Map<string, Waiter>>();
  const last = new Map<WorkspaceKey, string>();

  const announce = (ws: WorkspaceKey) => {
    const live = [...(byWs.get(ws)?.values() ?? [])];
    const agents = [...new Set(live.map((w) => w.agent).filter((a): a is string => a !== null))].sort();
    const round = live.reduce((m, w) => Math.max(m, w.round), 0);
    const sig = `${live.length}|${agents.join(",")}|${round}`;
    if (last.get(ws) === sig) return;
    last.set(ws, sig);
    opts.publish({ type: "review.waiting", round, clients: live.length, agents }, ws);
  };

  const expire = (ws: WorkspaceKey, id: string) => {
    const m = byWs.get(ws);
    const w = m?.get(id);
    if (!m || !w) return;
    w.expiry = null;
    if (w.open > 0) return;
    const left = w.lastSeen + grace - opts.clock.now();
    if (left > 0) {
      w.expiry = opts.timers.setTimeout(() => expire(ws, id), left, { unref: true });
      return;
    }
    m.delete(id);
    if (m.size === 0) byWs.delete(ws);
    announce(ws);
  };

  return {
    begin(ws, waiter, agent, round) {
      const m = byWs.get(ws) ?? new Map<string, Waiter>();
      byWs.set(ws, m);
      const w = m.get(waiter) ?? { agent, round, open: 0, lastSeen: opts.clock.now(), expiry: null };
      opts.timers.clearTimeout(w.expiry);
      w.expiry = null;
      w.open += 1;
      w.agent = agent ?? w.agent;
      w.round = round;
      w.lastSeen = opts.clock.now();
      m.set(waiter, w);
      announce(ws);
      let ended = false;
      return () => {
        if (ended) return;
        ended = true;
        w.open -= 1;
        w.lastSeen = opts.clock.now();
        if (w.open === 0) w.expiry = opts.timers.setTimeout(() => expire(ws, waiter), grace, { unref: true });
      };
    },
    count(ws) {
      if (ws !== undefined) return byWs.get(ws)?.size ?? 0;
      let n = 0;
      for (const m of byWs.values()) n += m.size;
      return n;
    },
    close() {
      for (const m of byWs.values()) for (const w of m.values()) opts.timers.clearTimeout(w.expiry);
      byWs.clear();
    },
  };
}
