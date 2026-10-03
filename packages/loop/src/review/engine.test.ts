import { describe, expect, test } from "bun:test";
import { MitoriError, type ThreadId } from "@mitori/core";
import { createReviewEngine } from "./engine.ts";
import { harness } from "./test/fakes.ts";
import { capUtf8 } from "./text.ts";

const code = (path = "internal/meta/fetch.go", start = 40, end = 52) => ({ primary: "code" as const, code: { path, start, end } });
const docSel = (block = "b_flow0002" as const, selStart = 0, selEnd = 10) => ({ primary: "doc" as const, doc: { block, selStart, selEnd } });

describe("LOOP §2.1 threads and messages", () => {
  test("create submitted: open, round 1, title, verbatim body (CRLF → LF only), snapshots, SSE", () => {
    const { engine, events } = harness();
    const body = "  リトライは 1 回だけ？\r\n\r\n  \tインデント\tも原文のまま  \r\n";
    const th = engine.create({ anchor: code(), intent: "question", body, draft: false }, "human");
    expect([th.state, th.round, th.version, th.anchorHealth, th.stale]).toEqual(["open", 1, 1, "ok", false]);
    expect(th.title).toBe("リトライは 1 回だけ？");
    expect(th.messages[0]?.body).toBe("  リトライは 1 回だけ？\n\n  \tインデント\tも原文のまま  \n");
    expect(th.messages[0]?.html).toContain("<p>");
    expect(events.map((e) => e.type)).toEqual(["review.round", "thread.message", "thread.upsert"]);
    const snaps = engine.snapshots(th.id);
    expect(snaps.map((s) => `${s.member}/${s.kind}`)).toEqual(["code/captured", "code/last_ok"]);
    expect(snaps[0]).toMatchObject({ spanLines: 12, symStart: 1, text: "range text" });
  });

  test("snapshot text is capped at 4 KiB of UTF-8 (not 4,096 UTF-16 units), never splitting a character", () => {
    const { deps } = harness();
    const engine = createReviewEngine({
      ...deps,
      captureAnchor: (input) => ({ ...deps.captureAnchor(input, null), aux: { code: { text: `a${"あ".repeat(3000)}🚀` } } }),
    });
    const th = engine.create({ anchor: code(), intent: "change", body: "x", draft: false }, "human");
    const text = engine.snapshots(th.id).find((s) => s.kind === "captured")?.text as string;
    expect(new TextEncoder().encode(text).length).toBeLessThanOrEqual(4096);
    expect(text).toBe(`a${"あ".repeat(1365)}`);
    expect(capUtf8("ab🚀", 5)).toBe("ab");
    expect(capUtf8("ab🚀", 6)).toBe("ab🚀");
  });

  test("title: first non-empty line, whitespace-collapsed, ≤ 60 UTF-16 units", () => {
    const { engine } = harness();
    const th = engine.create({ anchor: code(), intent: "change", body: `\n\n${"あ".repeat(70)}\n2行目`, draft: false }, "human");
    expect(th.title).toBe("あ".repeat(60));
  });

  test("drafts: lazy (no round row until submit), patch body/anchor/intent, delete; empty submit refused", () => {
    const { engine } = harness();
    const d = engine.create({ anchor: code(), intent: "change", body: "", draft: true }, "human");
    expect(d.state).toBe("draft");
    expect(engine.status().round).toBeNull();
    expect(() => engine.transition(d.id, { on: "submit", version: d.version }, "human")).toThrow(MitoriError);
    const p = engine.patch(d.id, { version: d.version, body: "関数名を直す", anchor: code("a/b.go", 3, 4), intent: "note" });
    expect([p.title, p.anchor.code?.path, p.intent, p.sendToAi, p.version]).toEqual(["関数名を直す", "a/b.go", "note", false, 2]);
    expect(engine.snapshots(d.id).find((s) => s.kind === "captured")?.anchor).toMatchObject({ path: "a/b.go" });
    const s = engine.transition(d.id, { on: "submit", version: p.version }, "human");
    expect([s.state, s.round]).toEqual(["open", 1]);
    expect(() => engine.patch(d.id, { version: s.version, body: "x" })).toThrow(MitoriError);
    expect(() => engine.remove(d.id)).toThrow(MitoriError);
    const d2 = engine.create({ anchor: code(), intent: "question", body: "x", draft: true }, "human");
    engine.remove(d2.id);
    expect(engine.get(d2.id)).toBeNull();
  });

  test("agents cannot submit; version conflicts are E_CONFLICT", () => {
    const { engine } = harness();
    expect(() => engine.create({ anchor: code(), intent: "change", body: "x", draft: false }, "agent:claude-cli/claude-sonnet-5-5")).toThrow(MitoriError);
    const th = engine.create({ anchor: code(), intent: "change", body: "x", draft: false }, "human");
    try {
      engine.addMessage(th.id, "y", th.version - 1);
      throw new Error("no conflict");
    } catch (e) {
      expect(MitoriError.is(e, "E_CONFLICT")).toBe(true);
    }
  });

  test("a human reply moves answered/rejected/failed/needs_input back to open (pending)", () => {
    const { engine, db } = harness();
    for (const st of ["answered", "rejected", "failed", "needs_input"] as const) {
      const th = engine.create({ anchor: code(), intent: "question", body: "q", draft: false }, "human");
      db.run("UPDATE rev_threads SET state = ? WHERE id = ?", [st, th.id]);
      const r = engine.addMessage(th.id, "追記", th.version);
      expect(r.state).toBe("open");
      expect(r.messages.length).toBe(2);
      expect(engine.status().pending).toContain(th.id);
    }
  });

  test("events are published only after the transaction commits", () => {
    const { engine, events } = harness();
    const th = engine.create({ anchor: code(), intent: "change", body: "x", draft: false }, "human");
    const before = events.length;
    expect(() => engine.reply(th.id, { kind: "done", body: "ok", docUpdate: "new md" }, "claude-code")).toThrow(MitoriError);
    expect(events.length).toBe(before);
    expect(engine.get(th.id)?.state).toBe("open");
  });
});

describe("LOOP §1.7 carry-forward: applyReanchor / markStale / manual reanchor", () => {
  test("own threads never become stale; others do on overlap / rewrite / fuzzy / outdated; drafts untouched", () => {
    const { engine } = harness();
    const mk = () => engine.create({ anchor: code(), intent: "change", body: "x", draft: false }, "human");
    const [a, b, c, d] = [mk(), mk(), mk(), mk()];
    const draft = engine.create({ anchor: code(), intent: "change", body: "x", draft: true }, "human");
    const moved = { ...a.anchor, code: { ...(a.anchor.code as NonNullable<typeof a.anchor.code>), start: 50, end: 62 } };
    const res = engine.applyReanchor(
      [
        { thread: a.id, anchor: moved, health: "moved", method: "symbol", overlapped: true, blockRewritten: false },
        { thread: b.id, anchor: moved, health: "moved", method: "symbol", overlapped: true, blockRewritten: false },
        { thread: c.id, anchor: c.anchor, health: "outdated", method: "none", overlapped: true, blockRewritten: false },
        { thread: d.id, anchor: d.anchor, health: "ok", method: "identity", overlapped: false, blockRewritten: false },
        { thread: draft.id, anchor: moved, health: "moved", method: "symbol", overlapped: true, blockRewritten: false },
      ],
      [a.id],
    );
    expect(res).toEqual({ moved: [a.id, b.id], outdated: [c.id], stale: [b.id, c.id] });
    expect(engine.get(a.id)).toMatchObject({ stale: false, anchorHealth: "moved", anchor: moved });
    expect(engine.get(c.id)?.anchorHealth).toBe("outdated");
    expect(engine.get(d.id)?.version).toBe(d.version); // nothing changed ⇒ no write
    expect(engine.get(draft.id)?.anchor).toEqual(draft.anchor);
    expect(
      engine
        .inbox("outdated")
        .map((i) => i.id)
        .sort(),
    ).toEqual([b.id, c.id].sort());
    const re = engine.reanchor(c.id, moved, (engine.get(c.id) as { version: number }).version);
    expect([re.anchorHealth, re.stale]).toEqual(["ok", false]);
  });

  test("markStale: overlapping code ranges on the same path, excluding own and resolved", () => {
    const { engine } = harness();
    const a = engine.create({ anchor: code("x.go", 10, 20), intent: "change", body: "a", draft: false }, "human");
    const b = engine.create({ anchor: code("x.go", 30, 40), intent: "change", body: "b", draft: false }, "human");
    const c = engine.create({ anchor: code("x.go", 15, 16), intent: "change", body: "c", draft: false }, "human");
    expect(engine.markStale([{ path: "x.go", start: 18, end: 25 }], [c.id])).toEqual([a.id]);
    expect(engine.get(b.id)?.stale).toBe(false);
    const dismissed = engine.patch(a.id, { version: (engine.get(a.id) as { version: number }).version, dismissStale: true });
    expect(dismissed.stale).toBe(false);
  });
});

describe("LOOP §2.4 Finish (push)", () => {
  test("partitions per module, dispatch with batchRound, jobs per partition, savings, notes held", async () => {
    const { engine, jobs } = harness();
    const q = engine.create({ anchor: code("internal/meta/fetch.go", 1, 5), intent: "question", body: "q", draft: false }, "human");
    const c1 = engine.create({ anchor: code("internal/meta/fetch.go", 10, 20), intent: "change", body: "c1", draft: false }, "human");
    const c2 = engine.create({ anchor: code("internal/meta/parse.go", 3, 9), intent: "change", body: "c2", draft: false }, "human");
    const note = engine.create({ anchor: code("internal/meta/fetch.go", 30, 31), intent: "note", body: "メモ", draft: false }, "human");
    expect(engine.status().heldNotes).toEqual([note.id]);
    const est = await engine.estimateFinish(null);
    expect(est.partitions.map((p) => [p.kind, p.threads])).toEqual([
      ["explain", [q.id]],
      ["fix", [c1.id, c2.id]],
    ]);
    expect(est.separateTokens).toBeGreaterThan(est.batchTokens);
    const res = await engine.finish({ mode: "push", estimateId: est.estimateId });
    expect(res.round).toMatchObject({ n: 1, mode: "push", state: "dispatched", threads: [q.id, c1.id, c2.id] });
    expect(res.jobs.length).toBe(2);
    expect(res.savedTokens).toBe(est.separateTokens - est.batchTokens);
    for (const id of [q.id, c1.id, c2.id]) expect(engine.get(id)).toMatchObject({ state: "queued", batchRound: 1, round: 1 });
    expect(engine.get(c1.id)?.jobs).toEqual([res.jobs[1]?.id as NonNullable<(typeof res.jobs)[number]>["id"]]);
    expect(engine.get(note.id)?.state).toBe("open");
    expect(jobs.created.map((j) => j.kind)).toEqual(["explain", "fix"]);
    expect(engine.status().round).toMatchObject({ n: 2, state: "collecting" });
  });

  test("sendToAi notes are sent (explain); 0 pending ⇒ approved round, no jobs", async () => {
    const { engine } = harness();
    const r0 = await engine.finish({ mode: "push" });
    expect(r0.round).toMatchObject({ n: 1, state: "complete", approved: true });
    const note = engine.create({ anchor: code(), intent: "note", body: "memo", draft: false }, "human");
    engine.patch(note.id, { version: note.version, sendToAi: true });
    const est = await engine.estimateFinish(null);
    expect(est.partitions.map((p) => p.kind)).toEqual(["explain"]);
  });

  test("over the confirmation threshold ⇒ E_PRECONDITION until the estimate is confirmed", async () => {
    const { engine } = harness({ confirmAbove: 1000 });
    engine.create({ anchor: code(), intent: "change", body: "c", draft: false }, "human");
    try {
      await engine.finish({ mode: "push" });
      throw new Error("not refused");
    } catch (e) {
      expect(MitoriError.is(e, "E_PRECONDITION")).toBe(true);
      expect((e as MitoriError).params?.estimate).toBe(3000);
    }
    const est = await engine.estimateFinish(null);
    const res = await engine.finish({ mode: "push", estimateId: est.estimateId, confirm: true });
    expect(res.jobs.length).toBe(1);
  });

  test("a partition whose job cannot be created goes back to open with a system message", async () => {
    const { engine } = harness({ jobs: { failKinds: ["explain"] } });
    const q = engine.create({ anchor: code(), intent: "question", body: "q", draft: false }, "human");
    const c = engine.create({ anchor: code("z.go", 1, 2), intent: "change", body: "c", draft: false }, "human");
    const res = await engine.finish({ mode: "push" });
    expect(res.jobs.length).toBe(1);
    expect(engine.get(q.id)?.state).toBe("open");
    expect(engine.get(q.id)?.messages.at(-1)).toMatchObject({ by: "system", kind: "system" });
    expect(engine.get(c.id)?.state).toBe("queued");
    // Never sent ⇒ not "carried": the next pull round shows the original question.
    const back = engine.get(q.id);
    expect([back?.round, back?.batchRound]).toEqual([1, undefined]);
    await engine.finish({ mode: "pull", threads: [q.id] });
    const res2 = await engine.wait(2, 10, new AbortController().signal);
    expect(res2.stdout).toContain(`## ${q.id} question R2 internal/meta/fetch.go:40-52\n> q\n`);
  });
});

describe("LOOP §2.5 Finish (pull) / wait / reply / complete", () => {
  test("waiter released by Finish(pull): stdout, T3' start, idempotent re-delivery", async () => {
    const { engine } = harness({ bundleTokens: 1120 });
    const a = engine.create({ anchor: code("internal/meta/fetch.go", 40, 52), intent: "change", body: "リトライを 2 回に", draft: false }, "human");
    const ctl = new AbortController();
    const waiting = engine.wait(null, 5_000, ctl.signal);
    expect(engine.waiters()).toBe(1);
    const fin = await engine.finish({ mode: "pull" });
    const res = await waiting;
    expect(res.status).toBe("ready");
    expect(res.approved).toBe(false);
    expect(res.next).toBe("mitori review --round 2");
    expect(res.stdout).toContain(`## ${a.id} change R1 internal/meta/fetch.go:40-52 bundle≈1.1k\n> リトライを 2 回に\n`);
    expect(engine.get(a.id)?.state).toBe("running");
    const again = await engine.wait(fin.round.n, 10, ctl.signal);
    expect(again.stdout).toBe(res.stdout);
    expect(engine.waiters()).toBe(0);
  });

  test("Finish(pull) with nobody waiting stays dispatched; the next `mitori review` picks it up", async () => {
    const { engine } = harness();
    const a = engine.create({ anchor: code(), intent: "question", body: "q", draft: false }, "human");
    const fin = await engine.finish({ mode: "pull" });
    expect(fin.round.state).toBe("dispatched");
    expect(engine.get(a.id)?.state).toBe("queued");
    const res = await engine.wait(null, 10, new AbortController().signal);
    expect([res.status, res.round?.n]).toEqual(["ready", 1]);
  });

  test("reply: answer / done / question, second reply in the round only adds a message, agents cannot resolve", async () => {
    const { engine, domain } = harness();
    const a = engine.create({ anchor: code(), intent: "question", body: "q", draft: false }, "human");
    const b = engine.create({ anchor: code("x.go", 1, 2), intent: "change", body: "c", draft: false }, "human");
    await engine.finish({ mode: "pull" });
    await engine.wait(null, 10, new AbortController().signal);
    expect(engine.reply(a.id, { kind: "answer", body: "はい、1 回です" }, "claude-code").state).toBe("answered");
    expect(engine.reply(a.id, { kind: "done", body: "ついでに直した", files: ["internal/meta/fetch.go"] }, "claude-code").state).toBe("answered");
    expect(engine.get(a.id)?.messages.map((m) => m.by)).toEqual(["human", "agent:claude-code", "agent:claude-code"]);
    expect(domain.at(-1)).toEqual({ type: "files.touched", paths: ["internal/meta/fetch.go"], source: "cli" });
    expect(engine.reply(b.id, { kind: "done", body: "done" }, "claude-code").state).toBe("applied");
    const bv = engine.get(b.id)?.version as number;
    expect(() => engine.transition(b.id, { on: "resolve", version: bv, resolution: "applied" }, "agent")).toThrow(MitoriError);
    expect(() => engine.reply(a.id, { kind: "answer", body: "x".repeat(8001) }, "claude-code")).toThrow(MitoriError);
    expect(() => engine.reply(a.id, { kind: "answer", body: "token ghp_abcdefghijklmnopqrstuvwxyz0123456789AB" }, "claude-code")).toThrow(MitoriError);
    engine.proposeResolution(b.id, { resolution: "applied", note: "済み" }, "claude-code");
    expect(engine.inbox("mine").map((i) => i.id)).toContain(b.id);
  });

  test("reply on an open thread outside a round: implicit dispatch (T2' system → T3' agent); docUpdate → agent_reply proposal", () => {
    const { engine, doc } = harness();
    const a = engine.create({ anchor: docSel(), intent: "change", body: "直して", draft: false }, "human");
    const t = engine.reply(a.id, { kind: "done", body: "直しました", docUpdate: "新しい本文" }, "codex");
    expect(t.state).toBe("applied");
    expect(doc.proposals.at(-1)).toMatchObject({ block: "b_flow0002", op: "update", source: { kind: "agent_reply", id: a.id }, md: "新しい本文" });
    expect(() => engine.reply(a.id, { kind: "answer", body: "again" }, "codex")).toThrow(MitoriError);
  });

  test("completeRound: unanswered threads back to open with 「R1 で返信なし」, round.completed with done + files", async () => {
    const { engine, domain } = harness();
    const a = engine.create({ anchor: code(), intent: "change", body: "a", draft: false }, "human");
    const b = engine.create({ anchor: code("y.go", 1, 1), intent: "change", body: "b", draft: false }, "human");
    await engine.finish({ mode: "pull" });
    await engine.wait(1, 10, new AbortController().signal);
    engine.reply(a.id, { kind: "done", body: "ok", files: ["y.go"] }, "claude-code");
    const r = engine.completeRound(1);
    expect(r.state).toBe("complete");
    expect(engine.get(b.id)?.state).toBe("open");
    expect(engine.get(b.id)?.messages.at(-1)?.body).toBe("R1 で返信なし");
    expect(domain.at(-1)).toEqual({ type: "round.completed", round: 1, doneThreads: [a.id], files: ["y.go"] });
    expect(engine.completeRound(1).state).toBe("complete"); // idempotent
  });

  test("Finish(pull) while the previous pull round is dispatched completes it implicitly; carried=R1 for re-sent threads", async () => {
    const { engine } = harness();
    const a = engine.create({ anchor: code(), intent: "change", body: "一回目", draft: false }, "human");
    await engine.finish({ mode: "pull" });
    await engine.wait(1, 10, new AbortController().signal);
    expect(engine.get(a.id)?.state).toBe("running");
    const second = engine.create({ anchor: code("b.go", 1, 1), intent: "question", body: "二件目", draft: false }, "human");
    await engine.finish({ mode: "pull", threads: [second.id] });
    expect(engine.get(a.id)?.state).toBe("open"); // implicit complete of R1
    const v = engine.get(a.id)?.version as number;
    engine.addMessage(a.id, "二回目の指示", v);
    await engine.finish({ mode: "pull", threads: [a.id] });
    const res = await engine.wait(3, 10, new AbortController().signal);
    expect(res.stdout).toContain(`## ${a.id} change R3 carried=R1 internal/meta/fetch.go:40-52\n> 二回目の指示\n`);
    expect(res.stdout).not.toContain("一回目");
  });

  test("withdraw: running → open (human), round withdrawn", async () => {
    const { engine } = harness();
    const a = engine.create({ anchor: code(), intent: "change", body: "a", draft: false }, "human");
    await engine.finish({ mode: "pull" });
    await engine.wait(null, 10, new AbortController().signal);
    const r = engine.withdrawRound(1);
    expect(r.state).toBe("withdrawn");
    expect(engine.get(a.id)?.state).toBe("open");
  });

  test("daemon shutdown ⇒ shutdown + approved:false for every waiter and later waits; abort ⇒ shutdown; timeout", async () => {
    const { engine } = harness();
    const t = await engine.wait(1, 5, new AbortController().signal);
    expect([t.status, t.approved]).toEqual(["timeout", false]);
    const ctl = new AbortController();
    const aborted = engine.wait(1, 5_000, ctl.signal);
    ctl.abort();
    expect((await aborted).status).toBe("shutdown");
    const w = engine.wait(null, 5_000, new AbortController().signal);
    engine.shutdown();
    const res = await w;
    expect(res).toMatchObject({ status: "shutdown", approved: false });
    expect(res.stdout).toBe("mitori.review/1 round=1 status=shutdown\nThe mitori daemon stopped before the review finished.\nNEXT: mitori review --round 1\n");
    expect((await engine.wait(2, 5_000, new AbortController().signal)).status).toBe("shutdown");
    expect(engine.waiters()).toBe(0);
  });

  test("0 pending Finish(pull) ⇒ approved round delivered as approved", async () => {
    const { engine } = harness();
    const w = engine.wait(null, 5_000, new AbortController().signal);
    await engine.finish({ mode: "pull" });
    const res = await w;
    expect([res.status, res.approved, res.next]).toEqual(["ready", true, "none"]);
    expect(res.stdout).toBe("mitori.review/1 round=1 threads=0 approved=true\nNo open threads. The review is approved.\nNEXT: none\n");
  });
});

describe("LOOP §2.6 promotion and doc_edit", () => {
  test("promote to decision: resolves (promoted), deterministic Markdown, secrets redacted, via DocStore.writeDecision", async () => {
    const { engine, doc } = harness();
    const a = engine.create(
      {
        anchor: { ...code(), doc: { block: "b_flow0002", selStart: 0, selEnd: 0 } },
        intent: "question",
        body: "なぜ 1 回？ key=sk-ant-REDACTMEREDACTMEREDACTME123",
        draft: false,
      },
      "human",
    );
    await engine.finish({ mode: "pull" });
    await engine.wait(null, 10, new AbortController().signal);
    engine.reply(a.id, { kind: "answer", body: "上流の制限のためです" }, "claude-code");
    const r = await engine.promote(a.id, "decision", "リトライは 1 回");
    expect(engine.get(a.id)).toMatchObject({ state: "resolved", resolution: "promoted" });
    expect(r.decision).toMatchObject({ title: "リトライは 1 回", status: "accepted", thread: a.id, blocks: ["b_flow0002"] });
    const md = doc.decisions[0]?.md as string;
    expect(md).toContain("- code: [internal/meta/fetch.go:40-52](../../internal/meta/fetch.go#L40-L52)");
    expect(md).toContain("- doc: [§s3 主要フロー](../doc/03-key-flows.md#b_flow0002)");
    expect(md).toContain("## Decision\n\n上流の制限のためです\n");
    expect(md).toContain("«redacted:secret»");
    expect(md).not.toContain("sk-ant-");
  });

  test("promote to doc: answered thread ⇒ insert proposal after the block (faq), resolved(promoted)", async () => {
    const { engine, doc } = harness();
    const a = engine.create({ anchor: docSel(), intent: "question", body: "どこで？", draft: false }, "human");
    engine.reply(a.id, { kind: "answer", body: "ここです [[internal/meta/fetch.go:40-52]]" }, "claude-code");
    const r = await engine.promote(a.id, "doc");
    expect(r.proposal).toBeDefined();
    expect(doc.proposals.at(-1)).toMatchObject({
      op: "insert",
      block: null,
      after: "b_flow0002",
      section: "s3",
      source: { kind: "answer_promote" },
      md: "ここです [internal/meta/fetch.go:40-52](internal/meta/fetch.go#L40-L52)",
    });
    expect(engine.get(a.id)?.resolution).toBe("promoted");
  });

  test("docEditToCode: base check, deterministic ask, draft doc_edit thread (not pending), job estimate", async () => {
    const { engine } = harness();
    await expect(engine.docEditToCode("b_flow0001", { baseHash: "stale", md: "x", mdForm: "marker", apply: "code" })).rejects.toThrow(MitoriError);
    const r = await engine.docEditToCode("b_flow0001", { baseHash: "h_b_flow0001", md: "新しい本文\n2 行目", mdForm: "marker", apply: "code" });
    const th = engine.get(r.thread?.id as ThreadId);
    expect(th).toMatchObject({ intent: "doc_edit", state: "draft" });
    expect(th?.messages[0]?.body).toBe(
      "設計書をこの版に合わせてコードを変更してください。\n--- 現在の設計書\n> b_flow0001 の本文。\n> 生成失敗時は正確に 1 回だけ再試行する。\n+++ 新しい設計書\n> 新しい本文\n> 2 行目",
    );
    expect(r.estimate?.bundle.tokens).toBe(3000);
    expect(engine.status().pending).toEqual([]);
  });
});

describe("LOOP §2.7 inbox and list", () => {
  test("tags and filters; empty drafts hidden; list cursor", () => {
    const { engine, db } = harness();
    const ids = ["open", "running", "proposed", "failed", "answered", "resolved"].map((st) => {
      const th = engine.create({ anchor: code(), intent: "change", body: st, draft: false }, "human");
      db.run("UPDATE rev_threads SET state = ? WHERE id = ?", [st, th.id]);
      return th.id;
    }) as [ThreadId, ThreadId, ThreadId, ThreadId, ThreadId, ThreadId];
    engine.create({ anchor: code(), intent: "change", body: "", draft: true }, "human");
    const withBody = engine.create({ anchor: code(), intent: "change", body: "下書き", draft: true }, "human");
    expect(engine.inbox("working").map((i) => i.id)).toEqual([ids[1]]);
    expect(engine.inbox("review").map((i) => i.id)).toEqual([ids[2]]);
    expect(engine.inbox("failed").map((i) => i.id)).toEqual([ids[3]]);
    expect(engine.inbox("draft").map((i) => i.id)).toEqual([withBody.id]);
    expect(
      engine
        .inbox("mine")
        .map((i) => i.id)
        .sort(),
    ).toEqual([ids[2], ids[3], ids[4]].sort());
    expect(engine.inbox(null).length).toBe(7);
    expect(engine.inbox("resolved")[0]).toMatchObject({
      kind: "thread",
      href: `/w/ws_000000000001/threads/${ids[5]}`,
      anchor: { path: "internal/meta/fetch.go", line: 40 },
    });
    const p1 = engine.list({ limit: 3 });
    const p2 = engine.list({ limit: 3, cursor: p1.next as string });
    const p3 = engine.list({ limit: 3, cursor: p2.next as string });
    expect([p1.items.length, p2.items.length, p3.items.length, p3.next]).toEqual([3, 3, 2, null]);
    expect(engine.list({ states: ["failed"] }).items.map((t) => t.id)).toEqual([ids[3]]);
  });
});

describe("edge cases", () => {
  test("intent cannot change while a job runs; resolution proposals need a live thread; push rounds are not completed", async () => {
    const { engine, db } = harness();
    const a = engine.create({ anchor: code(), intent: "change", body: "a", draft: false }, "human");
    db.run("UPDATE rev_threads SET state = 'running' WHERE id = ?", [a.id]);
    expect(() => engine.patch(a.id, { version: a.version, intent: "question" })).toThrow(MitoriError);
    db.run("UPDATE rev_threads SET state = 'resolved' WHERE id = ?", [a.id]);
    expect(() => engine.proposeResolution(a.id, { resolution: "wontfix" }, "claude-code")).toThrow(MitoriError);
    const b = engine.create({ anchor: code(), intent: "change", body: "b", draft: false }, "human");
    const fin = await engine.finish({ mode: "push" });
    expect(engine.completeRound(fin.round.n).state).toBe("dispatched");
    expect(engine.get(b.id)?.state).toBe("queued");
    expect(() => engine.withdrawRound(fin.round.n)).toThrow(MitoriError);
    expect(() => engine.completeRound(99)).toThrow(MitoriError);
  });

  test("Finish(pull) with nothing new while R1 is unanswered: R1 completes first, its thread is re-sent (not approved)", async () => {
    const { engine } = harness();
    const a = engine.create({ anchor: code(), intent: "change", body: "直して", draft: false }, "human");
    await engine.finish({ mode: "pull" });
    await engine.wait(1, 10, new AbortController().signal);
    expect(engine.get(a.id)?.state).toBe("running");
    const fin = await engine.finish({ mode: "pull" });
    expect(fin.round).toMatchObject({ n: 2, state: "dispatched", approved: false, threads: [a.id] });
    const res = await engine.wait(2, 10, new AbortController().signal);
    expect([res.status, res.approved]).toEqual(["ready", false]);
    expect(res.stdout).toContain(`## ${a.id} change R2 carried=R1 internal/meta/fetch.go:40-52\n`);
    expect(engine.get(a.id)?.messages.map((m) => m.body)).toEqual(["直して", "R1 で返信なし"]);
  });

  test("agents cannot reply to a thread a push job is running; a secret in docUpdate is refused like one in the body", async () => {
    const { engine, doc } = harness();
    const a = engine.create({ anchor: code(), intent: "change", body: "a", draft: false }, "human");
    await engine.finish({ mode: "push" });
    const t = engine.get(a.id) as NonNullable<ReturnType<typeof engine.get>>;
    engine.transition(a.id, { on: "start", version: t.version }, "system");
    try {
      engine.reply(a.id, { kind: "done", body: "done" }, "claude-code");
      throw new Error("not refused");
    } catch (e) {
      expect(MitoriError.is(e, "E_STATE_TRANSITION")).toBe(true);
    }
    expect(engine.get(a.id)?.state).toBe("running");
    const d = engine.create({ anchor: docSel(), intent: "change", body: "d", draft: false }, "human");
    const leak = "新しい本文 token ghp_abcdefghijklmnopqrstuvwxyz0123456789AB";
    expect(() => engine.reply(d.id, { kind: "done", body: "直しました", docUpdate: leak }, "codex")).toThrow(MitoriError);
    expect(doc.proposals.length).toBe(0);
    expect(engine.get(d.id)?.state).toBe("open");
  });

  test("applyReanchor: an anchor that stays fuzzy without overlap does not turn stale again after a dismiss", () => {
    const { engine } = harness();
    const a = engine.create({ anchor: code(), intent: "change", body: "a", draft: false }, "human");
    const u = { thread: a.id, anchor: a.anchor, health: "fuzzy" as const, method: "diff" as const, overlapped: false, blockRewritten: false };
    expect(engine.applyReanchor([u], []).stale).toEqual([a.id]);
    const v = engine.get(a.id)?.version as number;
    engine.patch(a.id, { version: v, dismissStale: true });
    expect(engine.applyReanchor([u], []).stale).toEqual([]);
    expect(engine.get(a.id)?.stale).toBe(false);
    expect(engine.applyReanchor([{ ...u, health: "outdated", method: "none" }], []).stale).toEqual([a.id]);
    // resolve clears stale too (§1.7), so a reopened thread does not come back flagged.
    const r = engine.transition(a.id, { on: "resolve", version: engine.get(a.id)?.version as number, resolution: "obsolete" }, "human");
    expect([r.state, r.stale]).toEqual(["resolved", false]);
    expect(engine.transition(a.id, { on: "reopen", version: r.version }, "human").stale).toBe(false);
  });

  test("lists attach each thread's own jobs (one lookup for the page)", async () => {
    const { engine } = harness();
    const a = engine.create({ anchor: code("p/a.go", 1, 2), intent: "question", body: "a", draft: false }, "human");
    const b = engine.create({ anchor: code("q/b.go", 1, 2), intent: "question", body: "b", draft: false }, "human");
    const c = engine.create({ anchor: code("r/c.go", 1, 2), intent: "question", body: "c", draft: false }, "human");
    const res = await engine.finish({ mode: "push", threads: [a.id, b.id] });
    const byId = new Map(engine.list({}).items.map((t) => [t.id, t.jobs]));
    expect(byId.get(a.id)).toEqual(res.jobs.filter((j) => j.threads.includes(a.id)).map((j) => j.id));
    expect(byId.get(b.id)).toEqual(res.jobs.filter((j) => j.threads.includes(b.id)).map((j) => j.id));
    expect(byId.get(c.id)).toEqual([]);
    expect(new Set([...(byId.get(a.id) ?? []), ...(byId.get(b.id) ?? [])]).size).toBe(2);
  });

  test("a reply before delivery starts the queued pull thread (T3' agent) then answers", async () => {
    const { engine } = harness();
    const a = engine.create({ anchor: code(), intent: "question", body: "q", draft: false }, "human");
    await engine.finish({ mode: "pull" });
    expect(engine.reply(a.id, { kind: "answer", body: "a" }, "claude-code").state).toBe("answered");
  });
});

describe("budgets", () => {
  test("loop.threadCreate: create (submitted) p95 ≤ 100 ms with 500 threads in the DB", () => {
    const { engine } = harness();
    const ms: number[] = [];
    for (let i = 0; i < 500; i++) {
      const t0 = performance.now();
      engine.create({ anchor: code("a/b.go", (i % 50) + 1, (i % 50) + 3), intent: "change", body: `直して ${i}`, draft: false }, "human");
      ms.push(performance.now() - t0);
    }
    ms.sort((x, y) => x - y);
    const p95 = ms[Math.floor(ms.length * 0.95)] as number;
    console.log(`loop.threadCreate p95: ${p95.toFixed(3)} ms (target 30, limit 100)`);
    expect(p95).toBeLessThanOrEqual(100);
  });

  test("GET /review and the inbox stay flat in the job count (500 threads × 1,000 jobs)", () => {
    const { engine, db } = harness();
    const ids = Array.from(
      { length: 500 },
      (_, i) => engine.create({ anchor: code(`m${i % 20}/f.go`, 1, 3), intent: "change", body: `t ${i}`, draft: false }, "human").id,
    );
    for (let j = 0; j < 1000; j++)
      db.run(
        "INSERT INTO job_jobs (id, kind, threads, engine, route, state, estimate, write_scope, prompt_ver, created_at) VALUES (?, 'fix', ?, 'claude-cli', '{}', 'done', '{}', '[]', 'p@1', ?)",
        [`j_${String(j).padStart(10, "0")}`, JSON.stringify([ids[j % 500], ids[(j * 7) % 500]]), "2026-10-03T00:00:00.000Z"],
      );
    const time = (fn: () => unknown) => {
      fn();
      const t0 = performance.now();
      fn();
      return performance.now() - t0;
    };
    const status = time(() => engine.status());
    const inbox = time(() => engine.inbox(null));
    console.log(`review status: ${status.toFixed(2)} ms, inbox(all): ${inbox.toFixed(2)} ms (500 threads, 1,000 jobs)`);
    expect(status).toBeLessThanOrEqual(20);
    expect(inbox).toBeLessThanOrEqual(20);
  });
});
