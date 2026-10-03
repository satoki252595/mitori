import { describe, expect, test } from "bun:test";
import { LOOP_PROMPTS, type LoopPromptId } from "@mitori/agent";
import { DEFAULT_DENY_GLOBS } from "@mitori/core";
import { hasher } from "../bundle/test/fake-anchor.ts";
import { estimateTokens } from "../bundle/test/fake-indexer.ts";
import { expectGoldenText } from "../bundle/test/golden.ts";
import { AGENT_V1_ENGINE_SCHEMA, FINDINGS_V1_ENGINE_SCHEMA, PATCH_V1_ENGINE_SCHEMA } from "../contract.ts";
import { loopPromptTemplate, loopSystemPrompt } from "./index.ts";

const IDS: LoopPromptId[] = ["loop.answer", "loop.findings", "loop.patch", "loop.agent"];

describe("loop prompts (spec §6.9)", () => {
  // Pinned: change a prompt byte ⇒ bump its `@n` in @mitori/agent LOOP_PROMPTS and re-pin both here.
  const PINS: Record<LoopPromptId, { version: string; xxh3: string }> = {
    "loop.answer": { version: "loop.answer@1", xxh3: "cdc1e37a43ecb425" },
    "loop.findings": { version: "loop.findings@1", xxh3: "06643fa3c26aa8c6" },
    "loop.patch": { version: "loop.patch@1", xxh3: "713b82ff371df2a3" },
    "loop.agent": { version: "loop.agent@1", xxh3: "2670e2bf18689ca0" },
  };

  test.each(IDS)("%s: version and text bytes are pinned", (id) => {
    expect(String(LOOP_PROMPTS[id].version)).toBe(PINS[id].version);
    expect(hasher.xxh3(LOOP_PROMPTS[id].text)).toBe(PINS[id].xxh3);
  });

  test.each(IDS)("%s: {cwd} is the only variable of the text", (id) => {
    const text = LOOP_PROMPTS[id].text;
    expect([...text.matchAll(/\{[a-zA-Z]+\}/gu)].map((m) => m[0])).toEqual(["{cwd}"]);
  });
});

describe("loopSystemPrompt — the content-addressed system prompt file", () => {
  const cwd = "/tmp/mitori-wt/j_0000000001";

  test("text with {cwd}, then DENY (sorted, unique); patch and agent add the fixed ACCEPT bullets", () => {
    for (const id of IDS) {
      const file = loopSystemPrompt(id, { cwd, deny: ["b/**", ".env", "b/**"] });
      expect(file.startsWith(LOOP_PROMPTS[id].text.replaceAll("{cwd}", cwd))).toBe(true);
      expect(file).not.toContain("{cwd}");
      expect(file).toContain("\nDENY .env b/**\n");
      expect(file.endsWith("\n")).toBe(true);
      const writes = id === "loop.patch" || id === "loop.agent";
      expect(file.includes("ACCEPT\n- Only files listed in WRITE change.\n- Behaviour not mentioned in ASK stays the same.\n")).toBe(writes);
    }
  });

  test("same settings ⇒ same bytes; a different cwd or deny list ⇒ different bytes (so a different file name)", () => {
    const a = loopSystemPrompt("loop.patch", { cwd, deny: [".env"] });
    expect(loopSystemPrompt("loop.patch", { cwd, deny: [".env"] })).toBe(a);
    expect(loopSystemPrompt("loop.patch", { cwd: "/other", deny: [".env"] })).not.toBe(a);
    expect(loopSystemPrompt("loop.patch", { cwd, deny: [".env", ".git/**"] })).not.toBe(a);
    expect(loopSystemPrompt("loop.patch", { cwd, deny: [".git/**", ".env"] })).toBe(loopSystemPrompt("loop.patch", { cwd, deny: [".env", ".git/**"] }));
  });

  test.each(IDS)("%s: golden file and token count (default deny globs)", (id) => {
    const file = loopSystemPrompt(id, { cwd: "{cwd}", deny: [...DEFAULT_DENY_GLOBS] });
    const tokens = Math.round(estimateTokens(file, "markdown_en", "claude-v5"));
    expectGoldenText(`loop-prompts/${id}.txt`, file);
    expectGoldenText(`loop-prompts/${id}.tokens`, `${tokens}\n`);
    expect(tokens).toBeGreaterThan(100);
    expect(tokens).toBeLessThan(1200);
  });
});

describe("loopPromptTemplate", () => {
  test.each(IDS)("%s: id, version, contract; render = system file + the bundle as the user message", (id) => {
    const t = loopPromptTemplate(id);
    expect(t).toMatchObject({ id, version: LOOP_PROMPTS[id].version, contract: LOOP_PROMPTS[id].contract });
    const r = t.render({ cwd: "/w", deny: [".env"], bundle: "MBF/1 …\nEND\n" });
    expect(r.user).toBe("MBF/1 …\nEND\n");
    expect(r.system).toBe(loopSystemPrompt(id, { cwd: "/w", deny: [".env"] }));
  });

  test("engine schemas: patch / findings / agent carry theirs, answer streams Markdown and has none", () => {
    expect(loopPromptTemplate("loop.patch").jsonSchema).toBe(PATCH_V1_ENGINE_SCHEMA);
    expect(loopPromptTemplate("loop.findings").jsonSchema).toBe(FINDINGS_V1_ENGINE_SCHEMA);
    expect(loopPromptTemplate("loop.agent").jsonSchema).toBe(AGENT_V1_ENGINE_SCHEMA);
    expect(loopPromptTemplate("loop.answer").jsonSchema).toBeUndefined();
  });
});
