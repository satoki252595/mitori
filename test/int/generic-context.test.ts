import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { createFakeSpawner } from "@mitori/agent/testing";
import type { Job, JobDetail, JobEstimate, ThreadDetail, TrustRequest, UnixMs } from "@mitori/core";
import { createSpawner } from "@mitori/platform";
import { buildFixture } from "@mitori/testkit";
import { type Int, startInt } from "./harness.ts";

test("generic context requests are supplied once on first/repair turns from the authorized current head", async () => {
  const repo = await buildFixture("go-small");
  const path = "internal/store/memory.go";
  const original = readFileSync(join(repo.root, path), "utf8");
  const lines = original.split("\n");
  const start = lines.findIndex((l) => l.includes("func (m *MemoryStore) Delete")) + 1;
  const target = lines.findIndex((l, i) => i >= start && l === "\t\treturn ErrNotFound") + 1;
  const importLine = lines.indexOf('\t"context"') + 1;
  const real = createSpawner({ safePath: process.env.PATH ?? "/usr/bin:/bin" });
  const fake = createFakeSpawner();
  const prompts: string[] = [];
  let mode: "initial" | "repair" = "initial";
  let turn = 0;
  let threadId = "";
  let skew = 0;
  const clock = { now: () => (Date.now() + skew) as UnixMs, iso: () => new Date(Date.now() + skew).toISOString() as never };
  const needs = { summary: "Need imports", edits: [], doc_updates: [], threads: [], needs_more_context: [`${path}:1-300`, "internal/server/server.go:1-30"] };
  fake.script(
    () => true,
    (spec) => {
      prompts.push(spec.stdin);
      const n = turn++;
      if (mode === "initial" || n === 1) return { stdout: [JSON.stringify(needs)] };
      const edits =
        n === 0
          ? [{ path, start: target, end: target, first_line: lines[target - 1], new_text: '\t\treturn fmt.Errorf("book %d not found: %w", id, ErrNotFound)' }]
          : [{ path, start: importLine, end: importLine, first_line: lines[importLine - 1], new_text: '\t"context"\n\t"fmt"' }];
      return {
        stdout: [JSON.stringify({ summary: "Id in not-found error", edits, doc_updates: [], threads: [{ id: threadId, status: "done", body: "Done" }] })],
      };
    },
  );
  let int: Int | null = null;
  try {
    int = await startInt({
      spawner: { spawn: (spec) => (spec.command === process.execPath ? fake.spawn(spec) : real.spawn(spec)) },
      config: {
        defaultEngine: "generic",
        engines: {
          "claude-cli": { enabled: false },
          generic: { enabled: true, argv: [process.execPath], protocol: "text", pricing: { inPerMTok: 0.1, outPerMTok: 0.2, cacheReadPerMTok: 0 } },
        },
        models: { patch: "generic:scripted" },
      },
      overrides: { clock, gateSandbox: "none" },
    });
    const app = int;
    const { ws } = await app.open(repo.root);
    const web = await app.browser();
    const api = <T>(method: string, url: string, body?: unknown) => app.json<T>(method, `/ws/${ws}${url}`, body);
    const browser = async <T>(method: string, url: string, body: unknown): Promise<T> => {
      const res = await web.req(method, `/ws/${ws}${url}`, body);
      if (!res.ok) throw new Error(await res.text());
      return (await res.json()) as T;
    };
    const until = async (id: string): Promise<JobDetail> => {
      const began = Date.now();
      for (;;) {
        const job = await api<JobDetail>("GET", `/jobs/${id}`);
        if (["ready", "failed"].includes(job.state)) return job;
        if (Date.now() - began > 30_000) throw new Error(`job stuck in ${job.state}`);
        await Bun.sleep(20);
      }
    };
    for (const phase of ["initial", "repair"] as const) {
      mode = phase;
      turn = 0;
      const before = prompts.length;
      const thread = await api<ThreadDetail>("POST", "/threads", {
        anchor: { primary: "code", code: { path, start, end: start + 9 } },
        intent: "change",
        body: "Include id in Delete's not-found error",
        draft: false,
      });
      threadId = thread.id;
      const req = { kind: "fix", threads: [thread.id], engine: "generic", mode: "patch" };
      const estimate = await api<JobEstimate>("POST", "/jobs/estimate", req);
      const created = await api<Job>("POST", "/jobs", { ...req, estimateId: estimate.estimate.id, confirm: estimate.estimate.requiresConfirm });
      let job = await until(created.id);
      if (phase === "repair") {
        expect(job.state).toBe("ready");
        const pending = (await api<TrustRequest[]>("GET", "/trust")).filter((t) => t.item === "gates" && t.status === "pending");
        skew += 120_000;
        for (const t of pending) await browser("POST", `/trust/${t.id}`, { decision: "trusted" });
        await browser("POST", `/jobs/${created.id}/gates/run`, {});
        job = await until(created.id);
        expect(job.state, JSON.stringify(job.failure)).toBe("ready");
        expect(job.attempt).toBe(3);
        expect(job.events.some((e) => e.t === "phase" && e.phase === "repair" && e.detail === "typecheck:go-vet")).toBe(true);
        const ran = await browser<Job>("POST", `/jobs/${created.id}/gates/run`, {});
        expect(ran.gateVerdict).toBe("passed");
        await api("POST", `/jobs/${created.id}/reject`, {});
      } else {
        expect(job.state).toBe("failed");
        expect(job.failure?.code).toBe("E_PRECONDITION");
        expect(job.attempt).toBe(2);
      }
      expect(prompts.length - before).toBe(phase === "initial" ? 2 : 3);
      expect(job.writeScope).toEqual([path]);
      expect(job.events.filter((e) => e.t === "phase" && e.phase === "repair" && e.detail === "context")).toHaveLength(1);
      const supplement = prompts[prompts.length - 1]?.split("MBF/1 mode=repair")[1] ?? "";
      expect(supplement).toContain("package store");
      expect(supplement).toMatch(/CODE internal\/store\/memory.go:1-35 base=[a-f\d]{7}/);
      expect(supplement).not.toContain("CODE internal/server/server.go");
      if (phase === "repair") expect(supplement).toContain('return fmt.Errorf("book %d not found: %w", id, ErrNotFound)');
      expect(readFileSync(join(repo.root, path), "utf8")).toBe(original);
    }
  } finally {
    await int?.close();
    await repo.dispose();
  }
}, 60_000);
