import { describe, expect, test } from "bun:test";
import type { SseEventPayload, WorkspaceKey } from "@mitori/core";
import { fakeClock, fakeTimers } from "../http/test/fakes.ts";
import { createWaiterRegistry } from "./waiters.ts";

const WS = "ws_wwwwwwwwwwww" as WorkspaceKey;

describe("review waiters (server spec §7.4, UXP-01)", () => {
  test("a waiter counts during its poll and 35 s after; re-polls within the grace do not flap; changes publish review.waiting", () => {
    const clock = fakeClock();
    const timers = fakeTimers(clock);
    const events: SseEventPayload[] = [];
    const w = createWaiterRegistry({ clock, timers, publish: (p) => void events.push(p) });
    const end1 = w.begin(WS, "w1", "claude-code", 2);
    expect(w.count(WS)).toBe(1);
    expect(events).toEqual([{ type: "review.waiting", round: 2, clients: 1, agents: ["claude-code"] }]);
    timers.advance(25_000);
    end1();
    timers.advance(10_000); // re-poll inside the 35 s grace
    const end2 = w.begin(WS, "w1", "claude-code", 2);
    expect(events.length).toBe(1);
    const other = w.begin(WS, "w2", "codex", 2);
    expect(events.at(-1)).toEqual({ type: "review.waiting", round: 2, clients: 2, agents: ["claude-code", "codex"] });
    other();
    end2();
    timers.advance(34_999);
    expect(w.count(WS)).toBe(2);
    timers.advance(1);
    expect(w.count(WS)).toBe(0);
    expect(w.count()).toBe(0);
    expect(events.at(-1)).toEqual({ type: "review.waiting", round: 0, clients: 0, agents: [] });
    w.close();
    expect(timers.pending()).toBe(0);
  });
});
