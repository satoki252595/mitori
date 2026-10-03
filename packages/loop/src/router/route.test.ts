import { describe, expect, test } from "bun:test";
import { AGENT_PATH_ALLOWED_RE } from "@mitori/agent";
import { type EngineId, INTENT_JOB_KIND, type ModelId, type RouteReason, type ThreadIntent } from "@mitori/core";
import { settings } from "../bundle/test/builders.ts";
import { ROUTER_RULES, type RouteInput } from "../contract.ts";
import { route } from "./index.ts";

const S = settings();
const base = (over: Partial<RouteInput> & { primary?: "doc" | "code" | "diagram" } = {}): RouteInput & { primary?: "doc" | "code" | "diagram" } => ({
  intents: ["change"],
  single: true,
  threads: 1,
  codeAnchored: true,
  anchoredLines: 40,
  files: 1,
  newFiles: 0,
  bundleTokens: 1500,
  history: [],
  agentPathsOk: true,
  engine: { id: "claude-cli", tools: true, jsonSchema: true, claudeCliAvailable: true },
  ...over,
});
const ok = (input: ReturnType<typeof base>, s = S) => {
  const r = route(input, s);
  if (!r.ok) throw new Error(`expected ok, got ${r.error.code}: ${r.error.message}`);
  return r.value;
};
const err = (input: ReturnType<typeof base>, s = S) => {
  const r = route(input, s);
  if (r.ok) throw new Error(`expected an error, got ${r.value.decision.mode}/${r.value.decision.reason}`);
  return r.error;
};
const actions = (e: { params?: Record<string, unknown> }) => String(e.params?.actions ?? "").split(",");

describe("AC-L20 route — the table rows", () => {
  test("R3 question → answer/1", () => {
    const { decision, engine } = ok(base({ intents: ["question"], codeAnchored: false }));
    expect(decision).toMatchObject({
      mode: "answer",
      contract: "answer/1",
      reason: "intent_question",
      model: "claude-sonnet-5-5",
      effort: "low",
      tools: "none",
      requiresConfirm: false,
    });
    expect(engine).toBe("claude-cli");
  });
  test("R4 review → findings/1 in answer mode", () => {
    expect(ok(base({ intents: ["review"] })).decision).toMatchObject({ mode: "answer", contract: "findings/1", reason: "intent_review", tools: "none" });
  });
  test("R5 small change → patch/1", () => {
    expect(ok(base()).decision).toMatchObject({
      mode: "patch",
      contract: "patch/1",
      reason: "small_change",
      tools: "none",
      effort: "low",
      requiresConfirm: false,
    });
  });
  test("R5 applies to change and doc_edit together", () => {
    expect(ok(base({ intents: ["change", "doc_edit"], threads: 2 })).decision.mode).toBe("patch");
  });
  test("R6 large change → agent/1 with read_edit", () => {
    expect(ok(base({ anchoredLines: 400, files: 5 })).decision).toMatchObject({
      mode: "agent",
      contract: "agent/1",
      reason: "large_change",
      tools: "read_edit",
      effort: "medium",
      requiresConfirm: false,
    });
  });
  test("R7 a change with no code scope is E_PRECONDITION (narrow_scope)", () => {
    const e = err(base({ codeAnchored: false }));
    expect(e.code).toBe("E_PRECONDITION");
    expect(actions(e)).toEqual(["narrow_scope"]);
  });
  test("R8 mixed intents are refused: the caller partitions first", () => {
    for (const intents of [
      ["question", "change"],
      ["review", "doc_edit"],
      ["question", "review"],
      ["note", "change"],
      ["note", "question"],
    ] as ThreadIntent[][]) {
      expect(err(base({ intents, single: false })).code).toBe("E_INVALID_INPUT");
    }
  });
  test("decision carries the anchored size", () => {
    expect(ok(base({ anchoredLines: 77, files: 2 })).decision).toMatchObject({ anchoredLines: 77, files: 2 });
  });
});

describe("AC-L20 route — R5 boundaries", () => {
  const mode = (over: Partial<RouteInput>) => ok(base(over)).decision.mode;
  test("120 / 121 anchored lines", () => {
    expect(mode({ anchoredLines: 120 })).toBe("patch");
    expect(mode({ anchoredLines: 121 })).toBe("agent");
  });
  test("2 / 3 files", () => {
    expect(mode({ files: 2 })).toBe("patch");
    expect(mode({ files: 3 })).toBe("agent");
  });
  test("6 / 7 threads", () => {
    expect(mode({ threads: 6 })).toBe("patch");
    expect(mode({ threads: 7 })).toBe("agent");
  });
  test("0 / 1 new files", () => {
    expect(mode({ newFiles: 0 })).toBe("patch");
    expect(mode({ newFiles: 1, files: 1 })).toBe("agent");
  });
  test("bundle at / over limits.bundleMaxTokens", () => {
    expect(mode({ bundleTokens: 12000 })).toBe("patch");
    expect(mode({ bundleTokens: 12001 })).toBe("agent");
  });
  test("the thresholds come from settings", () => {
    const s = settings({ limits: { patchMaxLines: 10, patchMaxFiles: 1, bundleMaxTokens: 500 } });
    expect(ok(base({ anchoredLines: 11 }), s).decision.mode).toBe("agent");
    expect(ok(base({ anchoredLines: 10, files: 1, bundleTokens: 500 }), s).decision.mode).toBe("patch");
    expect(ok(base({ anchoredLines: 10, files: 2 }), s).decision.mode).toBe("agent");
  });
});

describe("AC-L20 route — escalation by history (R1, R2)", () => {
  test.each(["patch_apply_failed", "gates_failed_twice", "needs_more_context"] as RouteReason[])("R2: %s → agent with the same reason", (reason) => {
    const { decision } = ok(base({ history: [reason] }));
    expect(decision).toMatchObject({
      mode: "agent",
      contract: "agent/1",
      reason,
      model: "claude-sonnet-5-5",
      effort: "medium",
      tools: "read_edit",
      requiresConfirm: false,
    });
  });
  test("R2 records the LAST matching reason of the history", () => {
    expect(ok(base({ history: ["patch_apply_failed", "small_change", "gates_failed_twice"] })).decision.reason).toBe("gates_failed_twice");
  });
  test("R1: agent_failed → escalate model, high effort, confirm required", () => {
    expect(ok(base({ history: ["agent_failed"] })).decision).toMatchObject({
      mode: "agent",
      reason: "agent_failed",
      model: "claude-opus-5-5",
      effort: "high",
      requiresConfirm: true,
    });
  });
  test("R1 beats R2 when both are in the history", () => {
    expect(ok(base({ history: ["gates_failed_twice", "agent_failed"] })).decision.reason).toBe("agent_failed");
  });
  test("a history reason that is not an escalation does not escalate", () => {
    expect(ok(base({ history: ["small_change", "user_override"] })).decision.mode).toBe("patch");
  });
  test("escalation applies to change-like intents only", () => {
    expect(ok(base({ intents: ["question"], history: ["agent_failed"] })).decision.reason).toBe("intent_question");
  });
  test("the escalate model and efforts follow settings", () => {
    const s = settings();
    (s.global.models as { escalate: ModelId }).escalate = "claude-sonnet-5-5";
    (s.global.reasoning as { agent: string }).agent = "high";
    expect(ok(base({ history: ["agent_failed"] }), s).decision.model).toBe("claude-sonnet-5-5");
    expect(ok(base({ history: ["needs_more_context"] }), s).decision.effort).toBe("high");
  });
  test("no code scope beats escalation (R7)", () => {
    expect(err(base({ history: ["agent_failed"], codeAnchored: false })).code).toBe("E_PRECONDITION");
  });
});

describe("AC-L20 route — agentPathsOk = false", () => {
  test("R6 is unavailable: E_UNSUPPORTED (narrow_scope, copy_prompt)", () => {
    const e = err(base({ anchoredLines: 500, agentPathsOk: false }));
    expect(e.code).toBe("E_UNSUPPORTED");
    expect(actions(e)).toEqual(["narrow_scope", "copy_prompt"]);
  });
  test("R1/R2 are skipped; R5 still applies when the change is small", () => {
    expect(ok(base({ history: ["agent_failed"], agentPathsOk: false })).decision.mode).toBe("patch");
    expect(err(base({ history: ["needs_more_context"], anchoredLines: 500, agentPathsOk: false })).code).toBe("E_UNSUPPORTED");
  });
  test("answer routes do not care", () => {
    expect(ok(base({ intents: ["question"], agentPathsOk: false })).decision.mode).toBe("answer");
  });
});

describe("AC-L20 route — overrides", () => {
  test("answer is always allowed, even for a change with no scope", () => {
    const { decision } = ok(base({ codeAnchored: false, override: { mode: "answer" } }));
    expect(decision).toMatchObject({ mode: "answer", contract: "answer/1", reason: "user_override", tools: "none" });
  });
  test("answer override on a question or review keeps its row", () => {
    expect(ok(base({ intents: ["question"], override: { mode: "answer" } })).decision.reason).toBe("intent_question");
    expect(ok(base({ intents: ["review"], override: { mode: "answer" } })).decision.contract).toBe("findings/1");
  });
  test("patch ignores the line/file thresholds but needs scope, no new files, a bundle that fits", () => {
    expect(ok(base({ anchoredLines: 900, files: 6, threads: 9, override: { mode: "patch" } })).decision).toMatchObject({
      mode: "patch",
      reason: "user_override",
    });
    expect(err(base({ newFiles: 1, override: { mode: "patch" } })).code).toBe("E_INVALID_INPUT");
    expect(err(base({ bundleTokens: 12001, override: { mode: "patch" } })).code).toBe("E_INVALID_INPUT");
    expect(err(base({ codeAnchored: false, override: { mode: "patch" } })).code).toBe("E_PRECONDITION");
  });
  test("agent is allowed for any change-like intents", () => {
    expect(ok(base({ intents: ["doc_edit"], override: { mode: "agent" } })).decision).toMatchObject({
      mode: "agent",
      reason: "user_override",
      tools: "read_edit",
    });
    expect(err(base({ agentPathsOk: false, override: { mode: "agent" } })).code).toBe("E_UNSUPPORTED");
  });
  test("patch/agent overrides are invalid for question, review and note", () => {
    for (const intents of [["question"], ["review"], ["note"]] as ThreadIntent[][]) {
      for (const mode of ["patch", "agent"] as const) expect(err(base({ intents, single: false, override: { mode } })).code).toBe("E_INVALID_INPUT");
    }
  });
  test("any model id is accepted; haiku for an answer adds a warning note", () => {
    expect(ok(base({ override: { model: "claude-opus-5-5" } })).decision.model).toBe("claude-opus-5-5");
    expect(ok(base({ override: { model: "codex:gpt-x" } })).decision.model).toBe("codex:gpt-x");
    const haiku = ok(base({ intents: ["question"], override: { model: "claude-haiku-4-5" } }));
    expect(haiku.decision.model).toBe("claude-haiku-4-5");
    expect(haiku.note).toContain("haiku");
    expect(ok(base({ override: { model: "claude-haiku-4-5" } })).note).toBeUndefined();
  });
});

describe("AC-L20 route — engine capability", () => {
  const generic = { id: "generic" as EngineId, tools: false, jsonSchema: false };
  test("agent mode on an engine without tools switches to claude-cli with a note", () => {
    const r = ok(base({ anchoredLines: 400, engine: { ...generic, claudeCliAvailable: true } }));
    expect(r.engine).toBe("claude-cli");
    expect(r.note).toBe("agent mode は claude-cli で実行");
  });
  test("…and fails with E_AGENT_CAPABILITY (copy_prompt, other_engine) when claude-cli is unavailable", () => {
    const e = err(base({ anchoredLines: 400, engine: { ...generic, claudeCliAvailable: false } }));
    expect(e.code).toBe("E_AGENT_CAPABILITY");
    expect(actions(e)).toEqual(["copy_prompt", "other_engine"]);
  });
  test.each(["anthropic-api", "codex-cli", "generic"] as EngineId[])("patch and answer keep %s", (id) => {
    const engine = { id, tools: false, jsonSchema: id !== "generic", claudeCliAvailable: false };
    expect(ok(base({ engine })).engine).toBe(id);
    expect(ok(base({ intents: ["question"], engine })).engine).toBe(id);
  });
  test("an engine with tools runs agent mode as chosen", () => {
    expect(ok(base({ anchoredLines: 400 })).engine).toBe("claude-cli");
  });
});

describe("AC-L20 route — notes (R0, R0b)", () => {
  test("R0: a note dispatched on its own is refused", () => {
    const e = err(base({ intents: ["note"], single: true }));
    expect(e.code).toBe("E_INVALID_INPUT");
  });
  test("R0b: a sent note never writes — doc-primary ⇒ docpatch/1, code-primary ⇒ answer/1", () => {
    const doc = ok(base({ intents: ["note"], single: false, primary: "doc" })).decision;
    expect(doc).toMatchObject({
      mode: "answer",
      contract: "docpatch/1",
      reason: "intent_note",
      tools: "none",
      model: "claude-sonnet-5-5",
      requiresConfirm: false,
    });
    const code = ok(base({ intents: ["note"], single: false, primary: "code" })).decision;
    expect(code).toMatchObject({ mode: "answer", contract: "answer/1", reason: "intent_note", tools: "none" });
  });
  test("R0b without `primary`: code-less ⇒ docpatch/1, code-anchored ⇒ answer/1", () => {
    expect(ok(base({ intents: ["note"], single: false, codeAnchored: false })).decision.contract).toBe("docpatch/1");
    expect(ok(base({ intents: ["note"], single: false, codeAnchored: true })).decision.contract).toBe("answer/1");
  });
  test("a note needs no code scope and is never escalated", () => {
    expect(ok(base({ intents: ["note"], single: false, codeAnchored: false, history: ["agent_failed"] })).decision.mode).toBe("answer");
  });
});

describe("AC-L20 route — properties (seeded)", () => {
  function rng(seed: number) {
    let a = seed >>> 0;
    return () => {
      a = (a + 0x6d2b79f5) >>> 0;
      let t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  const INTENTS: ThreadIntent[] = ["question", "change", "review", "note", "doc_edit"];
  const REASONS: RouteReason[] = [
    "small_change",
    "needs_more_context",
    "patch_apply_failed",
    "gates_failed_twice",
    "agent_failed",
    "user_override",
    "large_change",
  ];
  function random(r: () => number) {
    const pick = <T>(xs: readonly T[]): T => xs[Math.floor(r() * xs.length)] as T;
    const n = 1 + Math.floor(r() * 3);
    const intents = Array.from({ length: n }, () => pick(INTENTS));
    const engine = pick([
      { id: "claude-cli" as EngineId, tools: true, jsonSchema: true, claudeCliAvailable: true },
      { id: "generic" as EngineId, tools: false, jsonSchema: false, claudeCliAvailable: r() < 0.5 },
      { id: "anthropic-api" as EngineId, tools: false, jsonSchema: true, claudeCliAvailable: r() < 0.5 },
    ]);
    const input = base({
      intents,
      single: r() < 0.5,
      threads: 1 + Math.floor(r() * 9),
      codeAnchored: r() < 0.8,
      anchoredLines: Math.floor(r() * 300),
      files: Math.floor(r() * 5),
      newFiles: r() < 0.2 ? 1 : 0,
      bundleTokens: Math.floor(r() * 14000),
      history: Array.from({ length: Math.floor(r() * 3) }, () => pick(REASONS)),
      agentPathsOk: r() < 0.85,
      engine,
      ...(r() < 0.3 ? { override: { mode: pick(["answer", "patch", "agent"] as const) } } : {}),
    });
    return input;
  }
  const keyOf = (i: ThreadIntent): string => (i === "note" ? "note" : INTENT_JOB_KIND[i]);

  test("1,500 random inputs satisfy the invariants", () => {
    const r = rng(8);
    for (let k = 0; k < 1500; k++) {
      const input = random(r);
      const first = route(input, S);
      expect(route(input, S)).toEqual(first); // deterministic
      const groups = new Set(input.intents.map(keyOf));
      const noteOnly = input.intents.every((i) => i === "note");
      if (groups.size > 1) {
        expect(first.ok).toBe(false); // mixed ⇒ partition first
        continue;
      }
      if (noteOnly && input.single) {
        expect(first.ok).toBe(false); // a note is never a job unless it is sent
        continue;
      }
      if (!first.ok) continue;
      const { decision, engine } = first.value;
      expect(decision.tools).toBe(decision.mode === "agent" ? "read_edit" : "none");
      if (decision.mode !== "answer") expect(decision.contract).toBe(decision.mode === "patch" ? "patch/1" : "agent/1");
      if (noteOnly) expect(decision.mode).toBe("answer");
      if (decision.mode === "patch") {
        expect(input.codeAnchored && input.newFiles === 0 && input.bundleTokens <= 12000).toBe(true);
        expect(input.intents.every((i) => i === "change" || i === "doc_edit")).toBe(true);
      }
      if (decision.mode === "agent") {
        expect(input.agentPathsOk && input.codeAnchored).toBe(true);
        expect(engine === "claude-cli" || input.engine.tools).toBe(true);
      }
      if (decision.requiresConfirm) expect(decision.reason).toBe("agent_failed");
      if (decision.reason === "small_change") {
        expect(input.anchoredLines <= 120 && input.files <= 2 && input.threads <= 6).toBe(true);
      }
    }
  });

  test("partitioning mixed intents by job kind always yields routable parts", () => {
    const r = rng(21);
    for (let k = 0; k < 300; k++) {
      const input = random(r);
      const { override: _o, ...rest } = input;
      const parts = new Map<string, ThreadIntent[]>();
      for (const i of rest.intents) parts.set(keyOf(i), [...(parts.get(keyOf(i)) ?? []), i]);
      for (const intents of parts.values()) {
        const res = route(
          {
            ...rest,
            intents,
            single: false,
            codeAnchored: true,
            agentPathsOk: true,
            engine: { id: "claude-cli", tools: true, jsonSchema: true, claudeCliAvailable: true },
          },
          S,
        );
        expect(res.ok).toBe(true);
      }
    }
  });
});

describe("AC-L20 ROUTER_RULES stays the single source of the table", () => {
  test("every row's model key exists in settings.models and every effort resolves", () => {
    const models = S.global.models as unknown as Record<string, string>;
    for (const rule of ROUTER_RULES) {
      expect(typeof models[rule.model]).toBe("string");
      expect(
        rule.effort.startsWith("reasoning.")
          ? ["answer", "patch", "agent"].includes(rule.effort.slice(10))
          : ["low", "medium", "high", "xhigh", "max"].includes(rule.effort),
      ).toBe(true);
    }
  });
  test("only the escalation rows may require confirmation", () => {
    expect(ROUTER_RULES.filter((r) => r.confirm).map((r) => r.id)).toEqual(["R1-escalate-final"]);
  });
});

describe("agentPathsOk — AGENT_PATH_ALLOWED_RE allowlist (SEC-09), 23 examples", () => {
  const allowed = [
    "src/a.ts",
    "a",
    "a/b/c.d.e",
    "src/@scope/pkg-1.0/x+y.ts",
    "my_file.test.ts",
    "dir/.hidden",
    ".github/ci.yml",
    "a-b/c-d",
    "x@1/y",
    "UPPER/Case.GO",
    "pkg/v1.2.3/lib.rs",
  ];
  const rejected = [
    "-flag",
    "a/-b",
    "a b.ts",
    "a,b.ts",
    "a*.ts",
    "a?.ts",
    "a[1].ts",
    "a{b}.ts",
    "(a).ts",
    "a!b.ts",
    "a#b.ts",
    "a\\b.ts",
    "a&b.ts",
    "a%b.ts",
    "a^b.ts",
    "ファイル.ts",
    `a${String.fromCodePoint(0x200b)}b.ts`,
    "a\tb",
    "./a",
    "a/../b",
    "a//b",
    "",
    "/abs",
  ];
  test("examples that are safe inside Edit(//…) rules are allowed", () => {
    expect(allowed).toHaveLength(11);
    for (const p of allowed) expect([p, AGENT_PATH_ALLOWED_RE.test(p)]).toEqual([p, true]);
  });
  test("space, comma, glob, bracket, shell and Windows-significant characters, Unicode, leading dash and dot segments are rejected", () => {
    for (const p of rejected) expect([p, AGENT_PATH_ALLOWED_RE.test(p)]).toEqual([p, false]);
  });
  test("agentPathsOk=false from such a path makes a large change E_UNSUPPORTED", () => {
    const ok = rejected.slice(0, 3).every((p) => !AGENT_PATH_ALLOWED_RE.test(p));
    expect(err(base({ anchoredLines: 400, agentPathsOk: !ok })).code).toBe("E_UNSUPPORTED");
  });
});
