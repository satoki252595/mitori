import { describe, expect, test } from "bun:test";
import type { GenTaskId, PrepInfo, PromptVersion } from "@mitori/core";
import { GEN_PROMPTS, PREP_README_LINES, type PrepTaskEntry } from "../contract.ts";
import { ApplySink } from "../orchestrator/apply.ts";
import { validRouter } from "../test/fake-engine.ts";
import { makeHarness, SANDBOX, TEST_WS } from "../test/harness.ts";
import { M_AUTH, M_CORE, M_SESSION } from "../test/repo.ts";
import { testSettings } from "../test/settings.ts";
import { prepFingerprint } from "./index.ts";

/** The current version string of a prompt (tests survive version bumps). */
const v = (id: keyof typeof GEN_PROMPTS): PromptVersion => GEN_PROMPTS[id].version;

type H = ReturnType<typeof makeHarness>;
const file = (h: H, info: PrepInfo, rel: string) => h.safe.files.get(`${info.dir}/${rel}`);
const tasksOf = (h: H, info: PrepInfo) => JSON.parse(file(h, info, "tasks.json") ?? "[]") as PrepTaskEntry[];

/** Let the "user's agent" answer every task of a packet with validRouter's reply. */
function answer(h: H, info: PrepInfo, edit?: (task: PrepTaskEntry, lines: string[]) => string[]) {
  for (const t of tasksOf(h, info)) {
    const input = file(h, info, t.input) ?? "";
    const spec = Object.values(GEN_PROMPTS).find((p) => p.version === t.prompt);
    const mode = t.id && input.includes("MODULES is not available yet") ? "early" : input.includes("Use MODULES and PARENTS") ? "final" : undefined;
    const fakeCall = { spec, mode, layout: { unit: input, system: "", pack: null, shared: null, retry: null, nonce: "" } } as never;
    const lines = validRouter(fakeCall, { attempt: 1, continuation: false, message: input }).lines ?? [];
    h.safe.files.set(`${info.dir}/${t.out}`, (edit ? edit(t, lines) : lines).join("\n"));
  }
}

describe("GEN-G-050 / AC-22 the prep packet", () => {
  test("README from the byte-fixed template (≤ 1.5 KB), packet.json, fingerprint, system.md, tasks.json, batches.json, inputs", async () => {
    const h = makeHarness();
    const info = await h.gen.session.prep({ effort: "standard" });
    expect(info.phase).toBe(1);
    expect(info.dir).toBe(`/repo/.mitori/tmp/prep/${info.id}`);
    const readme = file(h, info, "README.md") ?? "";
    expect(new TextEncoder().encode(readme).length).toBeLessThanOrEqual(1500);
    expect(readme.split("\n")[0]).toBe(`# mitori.prep/1 ${info.id} (phase 1)`);
    expect(readme).toContain(`run \`mitori check .mitori/tmp/prep/${info.id}/out/<task id>.ndjson\``);
    const lines = PREP_README_LINES.filter((l) => !l.includes("{{"));
    for (const l of lines) expect(readme).toContain(l);
    expect(file(h, info, "fingerprint")).toBe(info.fingerprint);
    const packet = JSON.parse(file(h, info, "packet.json") ?? "{}");
    expect(packet).toMatchObject({ format: "mitori.prep/1", id: info.id, phase: 1, ws: TEST_WS.key, lang: "ja", effort: "standard", tasks: info.tasks });
    expect(file(h, info, "system.md")).toContain("Working directory: /repo.");
    const tasks = tasksOf(h, info);
    expect(tasks.map((t) => t.prompt)).toEqual([v("gen.overview"), v("gen.module"), v("gen.module"), v("gen.module"), v("gen.module")]);
    expect(tasks.every((t) => t.phase === 1 && t.input === `inputs/${t.id}.md` && t.out === `out/${t.id}.ndjson` && t.maxOutTokens > 0)).toBe(true);
    expect(JSON.parse(file(h, info, "batches.json") ?? "[]")).toEqual([{ batch: 1, tasks: tasks.map((t) => t.id) }]);
    expect([...h.safe.kinds.values()].every((k) => k === "prep")).toBe(true);
  });

  test("inputs/<id>.md is byte-identical to the claude-cli user message (only the system workdir differs)", async () => {
    const h = makeHarness();
    const info = await h.gen.session.prep({ effort: "standard" });
    const session = tasksOf(h, info).find((t) => (file(h, info, t.input) ?? "").includes(`module ${M_SESSION}`)) as PrepTaskEntry;
    const push = makeHarness();
    await push.gen.start((await push.gen.estimate({ effort: "standard", scope: ["s6/session"] })).id);
    await push.gen.idle();
    const pushCall = push.engine.calls.find((c) => c.call.layout.unit.includes(`module ${M_SESSION}`));
    expect(file(h, info, session.input)).toBe(pushCall?.call.layout.unit as string);
    expect(pushCall?.system).toContain(`Working directory: ${SANDBOX}.`);
  });

  test("prepFingerprint = sha256(salt ‖ canonical JSON with tasks sorted)", () => {
    const h = makeHarness();
    const a = prepFingerprint(
      {
        salt: "s",
        prep: "pr_00000000",
        phase: 1,
        ws: TEST_WS.key,
        indexDigest: "d",
        tasks: [
          ["gt_b000000000" as GenTaskId, "k2"],
          ["gt_a000000000" as GenTaskId, "k1"],
        ],
      },
      h.hasher,
    );
    const b = prepFingerprint(
      {
        salt: "s",
        prep: "pr_00000000",
        phase: 1,
        ws: TEST_WS.key,
        indexDigest: "d",
        tasks: [
          ["gt_a000000000" as GenTaskId, "k1"],
          ["gt_b000000000" as GenTaskId, "k2"],
        ],
      },
      h.hasher,
    );
    expect(a).toBe(b);
    expect(a).toMatch(/^[0-9a-f]{64}$/);
    expect(prepFingerprint({ salt: "t", prep: "pr_00000000", phase: 1, ws: TEST_WS.key, indexDigest: "d", tasks: [] }, h.hasher)).not.toBe(
      prepFingerprint({ salt: "s", prep: "pr_00000000", phase: 1, ws: TEST_WS.key, indexDigest: "d", tasks: [] }, h.hasher),
    );
  });
});

describe("GEN-U-051 ingest checks: fingerprint, expiry, drift", () => {
  test("a wrong fingerprint is E_GEN_FINGERPRINT; an expired packet is E_GEN_PREP_EXPIRED", async () => {
    const h = makeHarness();
    const info = await h.gen.session.prep({ effort: "standard" });
    answer(h, info);
    await expect(h.gen.session.ingest({ prep: info.id, fingerprint: "0".repeat(64), partial: false })).rejects.toMatchObject({ code: "E_GEN_FINGERPRINT" });
    h.clock.advance(25 * 60 * 60 * 1000);
    await expect(h.gen.session.ingest({ prep: info.id, fingerprint: info.fingerprint, partial: false })).rejects.toMatchObject({ code: "E_GEN_PREP_EXPIRED" });
  });

  test("a task whose input changed after prep is refused (named DATA label); partial ingest applies the rest", async () => {
    const h = makeHarness();
    const info = await h.gen.session.prep({ effort: "standard" });
    answer(h, info);
    h.indexer.setFile(
      "src/auth/login.ts",
      ((await h.indexer.currentText("src/auth/login.ts")) ?? "").replace("export function login(", "export function signIn("),
    );
    const strict = await h.gen.session.ingest({ prep: info.id, fingerprint: info.fingerprint, partial: false });
    expect(strict.ok).toBe(false);
    expect(strict.accepted.tasks).toBe(0);
    expect(h.doc.section("s6/session")?.blocks.filter((b) => b.origin === "ai").length).toBe(0);
    const drift = strict.errors.find((e) => e.code === "E_GEN_FINGERPRINT");
    expect(drift?.expected).toBe("inputs unchanged since prep");
    expect(drift?.actual).toContain("SKELETON");
    const partial = await h.gen.session.ingest({ prep: info.id, fingerprint: info.fingerprint, partial: true });
    expect(partial.accepted.tasks).toBe(info.tasks - 1);
    expect(h.doc.section("s6/session")?.blocks.filter((b) => b.origin === "ai").length).toBe(2);
    expect(h.doc.section("s6/auth")?.blocks.filter((b) => b.origin === "ai").length).toBe(0);
    expect(partial.next).toBeNull();
    // only the drifted task is prepared again; once it is ingested the next phase follows
    const again = await h.gen.session.prep({ effort: "standard", continueFrom: info.id });
    expect(again.phase).toBe(1);
    expect(tasksOf(h, again).map((t) => file(h, again, t.input)?.includes(`module ${M_AUTH}`))).toEqual([true]);
    expect(file(h, again, (tasksOf(h, again)[0] as PrepTaskEntry).input)).toContain("signIn");
    answer(h, again);
    const fixed = await h.gen.session.ingest({ prep: again.id, fingerprint: again.fingerprint, partial: false });
    expect(fixed.ok).toBe(true);
    expect(fixed.next).toEqual({ prep: again.id, phase: 2 });
    expect(h.doc.section("s6/auth")?.blocks.filter((b) => b.origin === "ai").length).toBe(2);
  });
});

describe("GEN-U-052 / GEN-U-053 / GEN-U-054 same validator, partial ingest, server-stamped provenance", () => {
  test("an invalid line blocks a strict ingest; partial applies the valid tasks; missing outputs are listed", async () => {
    const h = makeHarness();
    const info = await h.gen.session.prep({ effort: "standard" });
    answer(h, info, (t, lines) =>
      file(h, info, t.input)?.includes(`module ${M_AUTH}`)
        ? [...lines.slice(0, 1), '{"t":"block","id":"new:9","aspect":"interface","md":"<b>x</b>","claims":{}}', ...lines.slice(1)]
        : lines,
    );
    const first = tasksOf(h, info)[0] as PrepTaskEntry;
    h.safe.files.delete(`${info.dir}/${first.out}`);
    const strict = await h.gen.session.ingest({ prep: info.id, fingerprint: info.fingerprint, partial: false });
    expect(strict.ok).toBe(false);
    expect(strict.missing).toEqual([first.id]);
    expect(strict.errors.some((e) => e.expected.startsWith("V11") && e.at.endsWith(":2/md"))).toBe(true);
    expect(strict.accepted).toEqual({ tasks: 0, blocks: 0, claims: 0 });
    const partial = await h.gen.session.ingest({ prep: info.id, fingerprint: info.fingerprint, partial: true, model: "claude-opus-5-5" });
    expect(partial.accepted.tasks).toBe(3);
    expect(partial.coveragePct).toBe(60);
    expect(partial.next).toBeNull();
    const blk = h.doc.section("s6/session")?.blocks.find((b) => b.origin === "ai");
    expect(blk?.gen).toMatchObject({ engine: "session", model: "claude-opus-5-5", promptVer: v("gen.module"), indexDigest: h.indexer.snapshot()?.indexDigest });
  });

  test("models that are not Claude / codex are stamped generic:session; LLM-written provenance keys are ignored", async () => {
    const h = makeHarness();
    const info = await h.gen.session.prep({ effort: "standard" });
    answer(h, info, (_t, lines) => lines.map((l) => l.replace('{"t":"block",', '{"t":"block","model":"gpt-9","engine":"x",')));
    const rep = await h.gen.session.ingest({ prep: info.id, fingerprint: info.fingerprint, partial: false, model: "gpt-9" as never });
    expect(rep.ok).toBe(true);
    expect(h.doc.section("s6/session")?.blocks.find((b) => b.origin === "ai")?.gen?.model).toBe("generic:session");
  });
});

describe("AC-12 mass-delete guard on the session path", () => {
  test("deleting all 4 listed blocks of a regenerated page deletes 2 and proposes the other 2", async () => {
    const h = makeHarness();
    const seed = new ApplySink(
      { doc: h.doc, write: h.write, verifier: h.gen.verifier, log: h.log },
      {
        run: "gr_00000001",
        trigger: "user",
        engine: "claude-cli",
        model: "claude-sonnet-5-5",
        stage: "S5",
        promptVer: v("gen.module"),
        indexDigest: h.indexer.snapshot()?.indexDigest ?? "",
        lang: "ja",
        listed: 0,
        autoAccept: false,
      },
    );
    for (let i = 1; i <= 4; i++)
      seed.accept({
        t: "block",
        id: `new:${i}`,
        section: "s6/session",
        aspect: "learn",
        kind: "learn",
        depth: "L1",
        audience: ["dev"],
        md: `- 項目${i}`,
        claims: [],
      });
    await seed.finish();
    const old = seed.written;
    const info = await h.gen.session.prep({ effort: "standard", scope: ["s6/session"] });
    const t = tasksOf(h, info)[0] as PrepTaskEntry;
    expect(file(h, info, t.input)).toContain(`> ${old[0]} aspect=learn`);
    answer(h, info, (_t, lines) => [...old.map((id) => JSON.stringify({ t: "delete", id })), ...lines]);
    const rep = await h.gen.session.ingest({ prep: info.id, fingerprint: info.fingerprint, partial: false });
    expect(rep.ok).toBe(true);
    expect(old.filter((id) => h.doc.tombstones.has(id)).length).toBe(2);
    expect(h.doc.proposals({ state: "pending" }).map((p) => p.op)).toEqual(["delete", "delete"]);
  });
});

describe("GEN-I-055 / mitori check", () => {
  test("a symlinked out file is refused; check validates one file; .. paths are rejected", async () => {
    const h = makeHarness();
    const info = await h.gen.session.prep({ effort: "standard" });
    answer(h, info);
    const t = tasksOf(h, info)[1] as PrepTaskEntry;
    const ok = await h.gen.session.check(`${info.dir}/${t.out}`);
    expect(ok).toEqual({ ok: true, errors: [] });
    h.safe.files.set(`${info.dir}/${t.out}`, '{"t":"block","id":"new:1","aspect":"tldr","md":"x"}');
    const bad = await h.gen.session.check(`${info.dir}/${t.out}`);
    expect(bad.ok).toBe(false);
    expect(bad.errors[0]?.at).toBe(`${info.dir}/${t.out}:1/aspect`);
    expect((await h.gen.session.check(`${info.dir}/../../x/out/${t.id}.ndjson`)).ok).toBe(false);
    const linked = makeHarness();
    const info2 = await linked.gen.session.prep({ effort: "standard" });
    answer(linked, info2);
    const sym = new Set([`${info2.dir}/${(tasksOf(linked, info2)[0] as PrepTaskEntry).out}`]);
    (linked.deps as { fs?: unknown }).fs = (await import("../test/ports.ts")).memFs(linked.safe.files, sym);
    const relinked = (await import("../orchestrator/gen.ts")).createGenInternal(linked.deps);
    const rep = await relinked.session.ingest({ prep: info2.id, fingerprint: info2.fingerprint, partial: false });
    expect(rep.ok).toBe(false);
    expect(rep.errors.some((e) => e.code === "E_PATH_SYMLINK")).toBe(true);
  });

  test("an out/ directory that is a symlink to another place is refused", async () => {
    const h = makeHarness();
    const info = await h.gen.session.prep({ effort: "standard" });
    answer(h, info);
    // move the answers elsewhere and make out/ a link to them
    const elsewhere = "/home/u/elsewhere";
    for (const t of tasksOf(h, info)) {
      const text = file(h, info, t.out) as string;
      h.safe.files.delete(`${info.dir}/${t.out}`);
      h.safe.files.set(`${elsewhere}/${t.id}.ndjson`, text);
    }
    (h.deps as { fs?: unknown }).fs = (await import("../test/ports.ts")).memFs(h.safe.files, new Set(), new Map([[`${info.dir}/out`, elsewhere]]));
    const relinked = (await import("../orchestrator/gen.ts")).createGenInternal(h.deps);
    const rep = await relinked.session.ingest({ prep: info.id, fingerprint: info.fingerprint, partial: true });
    expect(rep.accepted.tasks).toBe(0);
    expect(rep.errors.length).toBe(info.tasks);
    expect(rep.errors.every((e) => e.code === "E_PATH_SYMLINK" && e.actual.startsWith(elsewhere))).toBe(true);
  });
});

describe("AC-45 phases: the next phase sees the previous phase's output", () => {
  test("phase 1 ingest returns next; phase 2 (S6) is prepared from it; the last phase completes the run", async () => {
    const h = makeHarness();
    const p1 = await h.gen.session.prep({ effort: "standard" });
    answer(h, p1);
    const r1 = await h.gen.session.ingest({ prep: p1.id, fingerprint: p1.fingerprint, partial: false });
    expect(r1.ok).toBe(true);
    expect(r1.next).toEqual({ prep: p1.id, phase: 2 });
    const p2 = await h.gen.session.prep({ effort: "standard", continueFrom: p1.id });
    expect(p2.phase).toBe(2);
    const t2 = tasksOf(h, p2);
    expect(t2.map((t) => t.prompt)).toEqual([v("gen.parent")]);
    const input = file(h, p2, (t2[0] as PrepTaskEntry).input) ?? "";
    expect(input).toContain(`TASK: Write the page for parent module ${M_CORE}`);
    expect(input).toContain(`> ${M_SESSION} "名前01" — 要約`);
    answer(h, p2);
    const r2 = await h.gen.session.ingest({ prep: p2.id, fingerprint: p2.fingerprint, partial: false });
    expect(r2.next).toEqual({ prep: p2.id, phase: 3 });
    const p3 = await h.gen.session.prep({ effort: "standard", continueFrom: p2.id });
    expect(tasksOf(h, p3).map((t) => t.prompt)).toEqual([v("gen.overview"), v("gen.flows"), v("gen.glossary")]);
    expect(tasksOf(h, p3).find((t) => t.prompt === v("gen.glossary"))?.after.length).toBe(2);
    answer(h, p3);
    const r3 = await h.gen.session.ingest({ prep: p3.id, fingerprint: p3.fingerprint, partial: false });
    expect(r3.ok).toBe(true);
    expect(r3.next).toBeNull();
    const runId = h.db.get<{ run: string }>("SELECT run FROM gen_prep WHERE id = ?", [p3.id])?.run as `gr_${string}`;
    expect(h.gen.run(runId)?.run.state).toBe("done");
    expect(h.gen.run(runId)?.run.usage.calls).toBe(0);
    await expect(h.gen.session.prep({ effort: "standard", continueFrom: p1.id })).rejects.toMatchObject({ code: "E_PRECONDITION" });
  });

  test("a daemon restart does not turn a session run into a push run; its packet can still be ingested", async () => {
    const h = makeHarness();
    const p1 = await h.gen.session.prep({ effort: "standard" });
    answer(h, p1);
    const h2 = makeHarness({ shared: { db: h.db, doc: h.doc, indexer: h.indexer, safe: h.safe, ids: h.ids, clock: h.clock } });
    expect(await h2.gen.recover()).toEqual([]);
    const runId = h.db.get<{ run: string }>("SELECT run FROM gen_prep WHERE id = ?", [p1.id])?.run as `gr_${string}`;
    await expect(h2.gen.control(runId, "resume")).rejects.toMatchObject({ code: "E_PRECONDITION" });
    expect(h2.engine.calls.length).toBe(0);
    const r1 = await h2.gen.session.ingest({ prep: p1.id, fingerprint: p1.fingerprint, partial: false });
    expect(r1).toMatchObject({ ok: true, next: { prep: p1.id, phase: 2 } });
  });

  test("a session run whose every task is reused from the cache completes without a packet", async () => {
    const settings = testSettings();
    settings.repo.glossary = [{ term: "積読", yomi: "つんどく", definition: "買ったまま読んでいない本。" }];
    const h = makeHarness({ settings });
    let p: PrepInfo | null = await h.gen.session.prep({ effort: "standard" });
    while (p) {
      answer(h, p);
      const r = await h.gen.session.ingest({ prep: p.id, fingerprint: p.fingerprint, partial: false });
      p = r.next ? await h.gen.session.prep({ effort: "standard", continueFrom: p.id }) : null;
    }
    // the agent's glossary omitted the repo seed: ingest merges it like the push path does
    expect(h.doc.index().glossary.map((g) => g.term)).toEqual(["セッション", "積読"]);
    h.doc.setGlossary([]);
    await expect(h.gen.session.prep({ effort: "standard" })).rejects.toMatchObject({ code: "E_PRECONDITION" });
    // the replayed glossary task wrote the glossary again
    expect(h.doc.index().glossary.map((g) => g.term)).toEqual(["セッション", "積読"]);
    const runs = h.db.all<{ id: string; state: string }>("SELECT id, state FROM gen_runs ORDER BY created_at, id");
    expect(runs.length).toBe(2);
    expect(runs.map((r) => r.state)).toEqual(["done", "done"]);
    expect(h.gen.run(runs[1]?.id as `gr_${string}`)?.tasks.every((t) => t.state === "cached")).toBe(true);
  });

  test("continuing before the phase is complete is refused", async () => {
    const h = makeHarness();
    const p1 = await h.gen.session.prep({ effort: "standard" });
    await expect(h.gen.session.prep({ effort: "standard", continueFrom: p1.id })).rejects.toMatchObject({ code: "E_PRECONDITION" });
  });
});
