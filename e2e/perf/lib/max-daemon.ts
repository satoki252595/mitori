/** Bun child for the Node/bench perf harness: real HTTP daemon, stores and patch pipeline; scripted engine, no LLM. */
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { synth } from "@mitori/agent/testing";
import type { Job, JobDetail, JobEstimate, SectionId, ThreadDetail } from "@mitori/core";
import type { GeneratedBlock } from "@mitori/doc";
import { buildFixture } from "@mitori/testkit";
import { FAKE_CLAUDE_CONFIG, fakeClaude } from "../../../test/int/fake-claude.ts";
import { startInt } from "../../../test/int/harness.ts";

const largeOnly = process.argv.includes("--code-only");
const repo = await buildFixture(largeOnly ? "gen:large-file" : "gen:doc-1000");
const original = readFileSync(join(repo.root, "src/large.ts"), "utf8");
const spawner = fakeClaude({
  respond(prompt, spec) {
    const thread = /^TASK (th_\w+) /m.exec(prompt)?.[1];
    if (!thread) return null;
    const manifest = {
      summary: "Remove 5,000 numbered comments for the review benchmark",
      files_changed: ["src/large.ts"],
      doc_updates: [],
      threads: [{ id: thread, status: "done", body: "The proposed comments are ready for human review." }],
    };
    const cassette = synth.text("", {
      model: spec.argv[spec.argv.indexOf("--model") + 1] ?? "claude-sonnet-5-5",
      structured: manifest,
      tools: ["Read", "Edit", "Glob", "Grep", "StructuredOutput"],
      dtMs: 1,
    });
    const lines = [...cassette.lines];
    // The existing agent/1 contract handles changes above patch/1's 600-line cap. Its worktree alone changes.
    const effect = {
      dt: 1,
      line: JSON.stringify({
        type: "assistant",
        message: { content: [{ type: "tool_use", id: "toolu_bench", name: "Edit", input: { file_path: join(spec.cwd, "src/large.ts") } }] },
      }),
      run: () => writeFileSync(join(spec.cwd, "src/large.ts"), original.split("\n").slice(5000).join("\n")),
    };
    lines.splice(3, 0, effect);
    return { ...cassette, lines };
  },
});
const int = await startInt({ config: FAKE_CLAUDE_CONFIG, spawner });
const close = async () => {
  await int.close();
  await repo.dispose();
};
try {
  const ws = (await int.open(repo.root)).ws;
  const d = int.domain(ws);
  const api = <T>(method: string, path: string, body?: unknown) => int.json<T>(method, `/ws/${ws}${path}`, body);
  let review = "";
  let diffLines = 0;
  let docBlocks = 0;
  let deepSection = "";
  if (!largeOnly) {
    while (d.doc.sections().length < 20)
      d.doc.upsertFlowSection(`bench-${d.doc.sections().length}`, `Benchmark flow ${d.doc.sections().length}`, d.doc.sections().length);
    if (d.doc.sections().length !== 20) throw new Error(`max fixture has ${d.doc.sections().length} sections, expected 20`);
    deepSection = d.doc.sections().find((s) => s.id.startsWith("s3/"))?.id ?? "s1";
    const gen = { model: "claude-sonnet-5-5", engine: "claude-cli", stage: "S5", promptVer: "gen.overview@1", indexDigest: "0".repeat(16) } as const;
    const blocks: GeneratedBlock[] = Array.from({ length: 1000 }, (_, i) => ({
      id: null,
      section: "s7",
      kind: "prose",
      depth: "L0",
      audience: ["newcomer"],
      lang: "en",
      claims: [],
      gen,
      md: `Benchmark paragraph ${i + 1}. A reader can focus this block, move to the next block and open its thread without generating text.`,
    }));
    blocks.push({
      id: null,
      section: deepSection as SectionId,
      aspect: "deepdive",
      kind: "deepdive",
      depth: "L3",
      audience: ["dev"],
      lang: "en",
      claims: [],
      gen,
      md:
        "# Benchmark deep dive\n\n" +
        "The implementation keeps the working tree unchanged until a person reviews and accepts the proposed edits.\n\n".repeat(18),
    });
    const applied = d.doc.applyGenerated(blocks, {
      mode: "write",
      deletes: [],
      source: { kind: "regen", id: "gr_bench0001" },
      reason: "Deterministic perf fixture",
      listed: 0,
    });
    docBlocks = applied.written.filter((b) => d.doc.block(b)?.section === "s7").length;
    if (docBlocks !== 1000) throw new Error(`fixture wrote ${docBlocks} blocks, expected 1,000`);
    await d.doc.flush({ force: true });
    const anchor = { primary: "code", code: { path: "src/large.ts", start: 1, end: 1 } };
    for (let i = 0; i < 499; i++) await api("POST", "/threads", { anchor, intent: "note", body: `Benchmark Inbox note ${i + 1}`, draft: false });
    const thread = await api<ThreadDetail>("POST", "/threads", {
      anchor: { ...anchor, code: { ...anchor.code, end: 5000 } },
      intent: "change",
      body: "Remove the first 5,000 numbered comments for the review benchmark.",
      draft: false,
    });
    const request = { kind: "fix", threads: [thread.id], mode: "agent" };
    const est = await api<JobEstimate>("POST", "/jobs/estimate", request);
    const job = await api<Job>("POST", "/jobs", { ...request, estimateId: est.estimate.id, confirm: est.estimate.requiresConfirm });
    const deadline = Date.now() + 60_000;
    for (;;) {
      const detail = await api<JobDetail>("GET", `/jobs/${job.id}`);
      if (detail.state === "failed") throw new Error(`review fixture failed: ${JSON.stringify(detail.failure)}`);
      if (detail.state === "ready") {
        diffLines = detail.diff.flatMap((f) => f.hunks.flatMap((h) => h.lines)).length;
        if (diffLines < 5000) throw new Error(`ready diff has ${diffLines} lines, expected at least 5,000`);
        review = job.id;
        break;
      }
      if (Date.now() > deadline) throw new Error(`review fixture stuck in ${detail.state}`);
      await Bun.sleep(20);
    }
  }
  const login = await int.json<{ url: string }>("POST", "/auth/nonce", { to: `/w/${ws}/doc/s7` });
  console.log(
    `MITORI_MAX_READY ${JSON.stringify({ url: login.url, origin: int.origin, ws, token: int.d.token, review, diffLines, docBlocks, deepSection, sections: d.doc.sections().map((s) => s.id), codeLines: original.trimEnd().split("\n").length })}`,
  );
  await new Promise<void>((resolve) => {
    process.once("SIGTERM", resolve);
    process.once("SIGINT", resolve);
  });
  if (review && (await api<JobDetail>("GET", `/jobs/${review}`)).state !== "ready") throw new Error("review benchmark accepted a job");
  if (readFileSync(join(repo.root, "src/large.ts"), "utf8") !== original) throw new Error("benchmark modified the user's working tree");
} finally {
  await close();
}
