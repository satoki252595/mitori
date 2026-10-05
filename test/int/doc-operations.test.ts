import { expect, test } from "bun:test";
import { synth } from "@mitori/agent/testing";
import type { BlockId, BlockOpRes, BlockView, Job, JobDetail, JobEstimate, ThreadDetail } from "@mitori/core";
import { buildFixture } from "@mitori/testkit";
import { FAKE_CLAUDE_CONFIG, fakeClaude } from "./fake-claude.ts";
import { startInt } from "./harness.ts";

test("doc note creates pending scoped proposals; accept/revert preserve human hash guard and Undo history; dry generation and agent PR cannot write", async () => {
  const repo = await buildFixture("go-small");
  let block = "" as BlockId;
  const spawner = fakeClaude({
    respond: (prompt, spec) =>
      prompt.includes("out=docpatch/1")
        ? synth.text("", {
            dtMs: 1,
            tools: ["StructuredOutput"],
            model: spec.argv[spec.argv.indexOf("--model") + 1] ?? "claude-sonnet-5-5",
            structured: { blocks: [{ id: block, op: "update", md: "確認済みの文書変更を提案します。" }] },
          })
        : null,
  });
  const int = await startInt({ config: FAKE_CLAUDE_CONFIG, spawner });
  try {
    const { ws } = await int.open(repo.root),
      x = int.domain(ws),
      web = await int.browser();
    await int.json("POST", `/ws/${ws}/init`, { lang: "ja", commit: false, agentsBlock: false });
    await x.staticReady();
    const ge = await int.json<{ id: string }>("POST", `/ws/${ws}/gen/estimate`, { effort: "standard", scope: ["s1"] });
    await int.json("POST", `/ws/${ws}/gen/runs`, { estimateId: ge.id, confirm: true });
    await x.gen.idle();
    block = Object.values(x.doc.index().blocks).find((b) => b.kind === "prose")!.id;
    const before = x.doc.block(block)!;
    const api = async <T>(method: string, path: string, body?: unknown): Promise<T> => {
      const r = await web.req(method, `/ws/${ws}${path}`, body);
      if (!r.ok) throw new Error(`${r.status}: ${await r.text()}`);
      return (await r.json()) as T;
    };
    const th = await api<ThreadDetail>("POST", "/threads", {
      anchor: { primary: "doc", doc: { block } },
      intent: "note",
      body: "この文書の説明を簡潔にしてください",
      draft: false,
    });
    await api("PATCH", `/threads/${th.id}`, { version: th.version, sendToAi: true });
    const est = await api<JobEstimate>("POST", "/jobs/estimate", { kind: "explain", threads: [th.id] });
    expect(est.route.contract).toBe("docpatch/1");
    const created = await api<Job>("POST", "/jobs", { kind: "explain", threads: [th.id], estimate: est.estimate.id });
    let job: JobDetail | undefined;
    for (let i = 0; i < 300; i++) {
      job = await api<JobDetail>("GET", `/jobs/${created.id}`);
      if (job.state === "done" || job.state === "failed") break;
      await Bun.sleep(10);
    }
    if (job?.state === "failed") throw new Error(JSON.stringify(job.failure));
    expect(job?.state).toBe("done");
    expect(job?.writeScope).toEqual([]);
    expect(job?.proposals).toHaveLength(1);
    expect(x.doc.block(block)!.hash).toBe(before.hash);
    const proposal = x.doc.proposals().find((p) => p.id === job!.proposals[0])!;
    expect(proposal).toMatchObject({ state: "pending", block, baseHash: before.hash, source: { kind: "job", id: created.id } });
    const accepted = await api<BlockView>("POST", `/doc/proposals/${proposal.id}/accept`, {});
    expect(accepted.hash).not.toBe(before.hash);
    const old = x.doc.history(block).find((h) => h.hash === before.hash)!;
    const stale = await web.req("POST", `/ws/${ws}/doc/blocks/${block}/revert`, { rev: old.rev, baseHash: before.hash });
    expect(stale.status).toBe(409);
    const reverted = await api<BlockView>("POST", `/doc/blocks/${block}/revert`, { rev: old.rev, baseHash: accepted.hash });
    expect(reverted.hash).toBe(before.hash);
    expect(x.doc.history(block).length).toBeGreaterThan(old.rev);
    const n = spawner.turns.length;
    for (const path of [`/doc/blocks/${block}/simplify`, `/doc/blocks/${block}/translate`, `/doc/sections/${encodeURIComponent(before.section)}/translate`]) {
      const res = await api<BlockOpRes>("POST", path, { confirm: false, lang: before.lang === "ja" ? "en" : "ja" });
      expect(res.estimate).toBeDefined();
      expect(res.run).toBeUndefined();
    }
    expect(spawner.turns.length).toBe(n);
    const policy = await web.req("POST", `/ws/${ws}/doc/blocks/${block}/simplify`, { confirm: true });
    expect(policy.status).toBe(403);
    expect((await policy.json()).error.code).toBe("E_FORBIDDEN");
    expect(spawner.turns.length).toBe(n);
    const cached = x.doc.propose({
      op: "update",
      block,
      section: before.section,
      baseHash: x.doc.block(block)!.hash,
      md: "確認用の保存済みの簡潔な説明です。",
      source: { kind: "simplify", id: "gr_cached01" },
      reason: "cached fixture",
    });
    const hit = await api<BlockOpRes>("POST", `/doc/blocks/${block}/simplify`, { confirm: true });
    expect(hit.cached).toBe(true);
    expect(hit.proposal?.id).toBe(cached.id);
    expect(spawner.turns.length).toBe(n);
    const denied = await int.cli("POST", `/ws/${ws}/jobs/${created.id}/pr`, { title: "t", body: "b", draft: true });
    expect(denied.status).toBe(403);
    expect((await denied.json()).error.code).toBe("E_FORBIDDEN");
  } finally {
    await int.close();
    await repo.dispose();
  }
}, 60_000);
