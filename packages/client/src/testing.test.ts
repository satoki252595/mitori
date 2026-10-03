import { describe, expect, test } from "bun:test";
import type { WorkspaceKey } from "@mitori/core";
import { createFakeApiClient, createMemorySseClient } from "./testing.ts";

const WS = "ws_mmmmmmmmmmmm" as WorkspaceKey;

describe("@mitori/client/testing", () => {
  test("memory SSE client: connect ⇒ live; emit dispatches with the real dedupe rules", () => {
    const c = createMemorySseClient({ version: "1" });
    const seen: string[] = [];
    c.on("thread.upsert", (e) => void seen.push(`${e.thread.id}@${e.rev}`));
    const resyncs: string[] = [];
    c.on("resync", (e) => void resyncs.push(e.reason));
    c.connect(WS);
    expect(c.state.kind).toBe("live");
    expect(c.connectedTo()).toBe(WS);
    c.noteRev("thread:th_1", 4);
    c.emit({ type: "thread.upsert", thread: { id: "th_1" } as never, rev: 4 });
    c.emit({ type: "thread.upsert", thread: { id: "th_1" } as never, rev: 5 });
    c.emit({ type: "resync", reason: "gap" });
    expect(seen).toEqual(["th_1@5"]);
    expect(resyncs).toEqual(["gap"]);
    expect(c.rev(WS)).toBe(0); // resync forgets revs
    c.emit({ type: "server.shutdown", reason: "bye" });
    expect(c.state).toEqual({ kind: "stopped", reason: "bye" });
  });

  test("fake API client: per-route answers, onRev, unfaked routes reject like the daemon", async () => {
    const api = createFakeApiClient({ "GET /workspaces": () => [] }, { rev: () => 9 });
    const revs: number[] = [];
    expect(await api.call("GET /workspaces", { params: {}, onRev: (r) => void revs.push(r) })).toEqual([]);
    expect(revs).toEqual([9]);
    await expect(api.call("GET /daemon", { params: {} })).rejects.toThrow("is not faked");
    expect(api.calls.map((c) => c.key)).toEqual(["GET /workspaces", "GET /daemon"]);
  });
});
