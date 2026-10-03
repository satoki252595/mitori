import { describe, expect, test } from "bun:test";
import { type EngineSettings, PRICING } from "@mitori/core";
import {
  type BridgePaths,
  CLAUDE_ARGV,
  CLAUDE_CLI_INVARIANTS,
  CLAUDE_FORBIDDEN_FLAGS,
  CLAUDE_FORBIDDEN_PERMISSION_MODES,
  CLAUDE_FORBIDDEN_TOOLS,
  ENV_ALLOWLIST,
  ENV_DENYLIST,
  ENV_INJECT,
  type EngineMode,
  type EngineRequest,
  type SpawnSpec,
} from "../contract.ts";
import { testHasher } from "../testing.ts";
import { expectedTools } from "./engine.ts";
import { systemPromptRel } from "./fsports.ts";
import { agentPathsOk, buildClaudeSpawn, claudeUserMessage, editPermissionRule } from "./index.ts";

const HOME = "/Users/u/.mitori";
const EMPTY = `${HOME}/run/empty`;
const WT = `${HOME}/wt/ws_ab12cd34ef56/j_0123456789`;
const PROMPT =
  'PROMPT-SENTINEL MBF/1 mode=patch\n<<<DATA q8r2m4tz>>>\n41|const max = cfg.maxRetries ?? "3";\n<<<END q8r2m4tz>>>\nASK\n> 再試行回数を直して\nEND';
const SCHEMA = { type: "object", properties: { summary: { type: "string" } }, required: ["summary"] };
const MODES: readonly EngineMode[] = ["answer", "findings", "patch", "agent", "generate"];

const settings = (o: Partial<EngineSettings["claude-cli"]> = {}): EngineSettings["claude-cli"] => ({
  enabled: true,
  binary: "claude",
  inheritUserSettings: false,
  envPassthrough: [],
  warmPool: 0,
  persistSessions: false,
  ...o,
});

function reqFor(mode: EngineMode, o: Partial<EngineRequest> = {}): EngineRequest {
  const cwd = mode === "agent" ? WT : EMPTY;
  return {
    ref: "j_0123456789",
    mode,
    cwd,
    model: "claude-sonnet-5-5",
    effort: mode === "agent" ? "medium" : "low",
    tools: mode === "agent" ? "read_edit" : "none",
    writeScope: mode === "agent" ? ["internal/auth/login.go", "internal/auth/login_test.go"] : [],
    system: `You are mitori-fixer.\nWorking directory: ${cwd}\nReturn JSON.`,
    promptVer: `loop.${mode}@1`,
    prompt: PROMPT,
    contract: "patch/1",
    ...(mode === "findings" || mode === "patch" || mode === "agent" ? { jsonSchema: SCHEMA } : {}),
    keepAlive: mode === "patch" || mode === "agent" || mode === "generate",
    persistSession: false,
    budget: { usd: mode === "agent" ? 0.25 : 0.1, inTokens: 30_000, outTokens: 4000, ms: 180_000 },
    ...o,
  };
}

const pathsFor = (req: EngineRequest): BridgePaths => ({
  claudeBinary: "/Users/u/.local/bin/claude",
  systemPromptFile: `${HOME}/${systemPromptRel(testHasher, req.system)}`,
  emptyCwd: EMPTY,
});

const PARENT_ENV: Record<string, string> = {
  PATH: "/usr/bin:/bin",
  HOME: "/Users/u",
  USER: "u",
  LANG: "ja_JP.UTF-8",
  TERM: "xterm-256color",
  ANTHROPIC_API_KEY: "sk-ant-api03-FAKE",
  ANTHROPIC_AUTH_TOKEN: "x",
  CLAUDE_CODE_OAUTH_TOKEN: "x",
  GH_TOKEN: "ghp_x",
  MITORI_TOKEN: "t",
  MITORI_HOME: "/tmp/h",
  NODE_OPTIONS: "--require /tmp/evil.js",
  DYLD_INSERT_LIBRARIES: "/tmp/evil.dylib",
  AWS_PROFILE: "prod",
  RANDOM_VAR: "leak",
  CLAUDE_CODE_PROMPT_CACHE_TTL: "1h",
};

interface Ctx {
  req: EngineRequest;
  settings: EngineSettings["claude-cli"];
  paths: BridgePaths;
  env: Record<string, string>;
}

const after = (argv: readonly string[], flag: string): string | undefined => {
  const i = argv.indexOf(flag);
  return i >= 0 ? argv[i + 1] : undefined;
};
const has = (argv: readonly string[], flag: string) => argv.includes(flag);
const fail = (cond: boolean, msg: string): string[] => (cond ? [] : [msg]);

/** One checker per invariant: the `rule` of CLAUDE_CLI_INVARIANTS applied to a SpawnSpec. */
const CHECKS: Record<(typeof CLAUDE_CLI_INVARIANTS)[number]["id"], (s: SpawnSpec, c: Ctx) => string[]> = {
  I1: (s, c) => [
    ...(c.req.mode === "agent"
      ? [...fail(has(s.argv, "--restricted"), "agent needs --restricted"), ...fail(!has(s.argv, "--setting-sources"), "agent must not pass --setting-sources")]
      : [
          ...fail(after(s.argv, "--setting-sources") === (c.settings.inheritUserSettings ? "user" : ""), "--setting-sources must be '' (or user)"),
          ...fail(!has(s.argv, "--restricted"), "--restricted is agent-only"),
        ]),
    ...fail(has(s.argv, "--strict-mcp-config"), "--strict-mcp-config missing"),
    ...fail(has(s.argv, "--disable-slash-commands"), "--disable-slash-commands missing"),
  ],
  I2: (s, c) => {
    const bytes = s.argv.map((a) => new TextEncoder().encode(a).length);
    return [
      ...fail(!s.argv.some((a) => a.includes("PROMPT-SENTINEL") || a.includes(c.req.prompt)), "prompt text in argv"),
      ...fail(s.stdin === claudeUserMessage(c.req.prompt), "stdin is not one stream-json user message"),
      ...fail(s.stdin.indexOf("\n") === s.stdin.length - 1, "stdin must be exactly one line"),
      ...fail(
        bytes.every((b) => b <= 8192),
        "argv element > 8 KiB",
      ),
      ...fail(bytes.reduce((a, b) => a + b + 1, 0) <= 16384, "argv > 16 KiB"),
    ];
  },
  I3: (s, c) => {
    const f = after(s.argv, "--system-prompt-file") ?? "";
    return [
      ...fail(f === c.paths.systemPromptFile, "--system-prompt-file missing"),
      ...fail(f === `${HOME}/${systemPromptRel(testHasher, c.req.system)}`, "system prompt file is not run/sp/<sha256[:32]>.txt of its content"),
      ...fail(/\/run\/sp\/[0-9a-f]{32}\.txt$/.test(f), "bad system prompt file name"),
      ...fail(c.req.system.includes(`Working directory: ${c.req.cwd}`), "system prompt must state the working directory"),
      ...fail(!has(s.argv, "--system-prompt") && !has(s.argv, "--append-system-prompt"), "inline system prompt flags are not used"),
    ];
  },
  I4: (s, c) =>
    c.settings.persistSessions && c.req.persistSession
      ? fail(has(s.argv, "--session-id") || has(s.argv, "--resume"), "persisted sessions need --session-id/--resume")
      : [
          ...fail(has(s.argv, "--no-session-persistence"), "--no-session-persistence missing"),
          ...fail(!has(s.argv, "--session-id") && !has(s.argv, "--resume"), "no session flags without persistSessions"),
        ],
  I5: (s, c) => {
    const allowed = new Set<string>([...ENV_ALLOWLIST, ...c.settings.envPassthrough, ...Object.keys(ENV_INJECT[c.req.mode]), "CLAUDE_CODE_PROMPT_CACHE_TTL"]);
    const keys = Object.keys(s.env);
    return [
      ...keys.filter((k) => !allowed.has(k)).map((k) => `env ${k} outside the allowlist`),
      ...keys.filter((k) => (ENV_DENYLIST as readonly string[]).includes(k) || k.startsWith("MITORI_")).map((k) => `denied env ${k}`),
      ...fail(s.env.ANTHROPIC_API_KEY === undefined, "ANTHROPIC_API_KEY leaked"),
      ...fail(s.env.HOME === c.env.HOME && s.env.PATH === c.env.PATH, "allowlisted env not passed"),
      ...Object.entries(ENV_INJECT[c.req.mode])
        .filter(([k]) => !(k === "CLAUDE_CODE_PROMPT_CACHE_TTL" && c.settings.persistSessions && c.req.persistSession))
        .flatMap(([k, v]) => fail(s.env[k] === v.replace("{maxOutTokens}", String(c.req.budget.outTokens)), `ENV_INJECT ${k} not set`)),
    ];
  },
  I6: (s, c) => [
    ...fail(after(s.argv, "--model") === c.req.model && (after(s.argv, "--model") ?? "") in PRICING, "--model must be the full id"),
    ...fail(after(s.argv, "--effort") === c.req.effort, "--effort missing"),
  ],
  I7: (s) => [
    ...s.argv.filter((a) => (CLAUDE_FORBIDDEN_FLAGS as readonly string[]).includes(a.split("=")[0] as string)).map((a) => `forbidden flag ${a}`),
    ...s.argv
      .filter((_, i) => s.argv[i - 1] === "--permission-mode")
      .filter((m) => (CLAUDE_FORBIDDEN_PERMISSION_MODES as readonly string[]).includes(m))
      .map((m) => `forbidden permission mode ${m}`),
    ...s.argv
      .filter((_, i) => s.argv[i - 1] === "--tools" || s.argv[i - 1] === "--allowedTools")
      .flatMap((v) => v.split(/[,\s]+/))
      .filter((t) => (CLAUDE_FORBIDDEN_TOOLS as readonly string[]).includes(t.replace(/\(.*$/, "")))
      .map((t) => `forbidden tool ${t}`),
    ...fail(s.argv.filter((a) => a === "--tools").length <= 1, "--tools given twice"),
  ],
  I8: (s, c) => {
    const schema = c.req.mode === "findings" || c.req.mode === "patch" || c.req.mode === "agent";
    const common = [
      ...fail(after(s.argv, "--permission-prompts") === "none", "--permission-prompts none missing"),
      ...fail(!schema || after(s.argv, "--json-schema") === JSON.stringify(c.req.jsonSchema), "--json-schema missing"),
    ];
    if (c.req.mode !== "agent")
      return [...common, ...fail(after(s.argv, "--tools") === "", "--tools '' missing"), ...fail(!has(s.argv, "--allowedTools"), "no rules without tools")];
    const i = s.argv.indexOf("--allowedTools");
    const rules =
      i < 0
        ? []
        : s.argv.slice(
            i + 1,
            s.argv.findIndex((a, j) => j > i && a.startsWith("--")),
          );
    const want = ["Read", "Glob", "Grep", ...c.req.writeScope.map((p) => `Edit(//${c.req.cwd.slice(1)}/${p})`)];
    return [
      ...common,
      ...fail(after(s.argv, "--tools") === `Read,Edit,Glob,Grep${(c.req.newFiles?.length ?? 0) > 0 ? ",Write" : ""}`, "agent --tools"),
      ...fail(after(s.argv, "--permission-mode") === "dontAsk", "agent --permission-mode dontAsk"),
      ...fail(JSON.stringify(rules) === JSON.stringify(want), `agent --allowedTools ${JSON.stringify(rules)}`),
    ];
  },
  I9: (s, c) =>
    c.req.mode === "agent"
      ? fail(s.cwd === c.req.cwd && s.cwd !== c.paths.emptyCwd, "agent cwd = worktree")
      : fail(s.cwd === c.paths.emptyCwd, "cwd = empty sandbox"),
  I10: (s) => [
    ...fail(has(s.argv, "-p"), "-p missing"),
    ...fail(after(s.argv, "--input-format") === "stream-json", "--input-format stream-json"),
    ...fail(after(s.argv, "--output-format") === "stream-json", "--output-format stream-json"),
    ...fail(has(s.argv, "--verbose"), "--verbose"),
    ...fail(has(s.argv, "--include-partial-messages"), "--include-partial-messages"),
  ],
  I11: (s, c) => {
    // the init expectation the engine checks must describe exactly what argv grants
    const tools = expectedTools(c.req);
    const granted = (after(s.argv, "--tools") ?? "").split(",").filter(Boolean);
    return [
      ...fail(tools.includes("StructuredOutput") === has(s.argv, "--json-schema"), "StructuredOutput expectation ≠ --json-schema"),
      ...fail(JSON.stringify(tools.filter((t) => t !== "StructuredOutput").sort()) === JSON.stringify([...granted].sort()), "tool expectation ≠ --tools"),
    ];
  },
  I12: (s, c) => fail(after(s.argv, "--max-budget-usd") === c.req.budget.usd.toFixed(4), "--max-budget-usd = job budget"),
  I13: (s, c) =>
    fail(s.keepStdinOpen === ((c.req.mode === "patch" || c.req.mode === "agent" || c.req.mode === "generate") && c.req.keepAlive), "keepStdinOpen per I13"),
  I14: (s, c) => [
    ...fail(!/project|local/.test(after(s.argv, "--setting-sources") ?? ""), "project/local settings source"),
    ...["--settings", "--mcp-config", "--plugin-dir", "--plugin-url", "--add-dir", "--agents", "--agent"].flatMap((f) => fail(!has(s.argv, f), `${f} present`)),
    ...fail(c.req.mode === "agent" ? has(s.argv, "--restricted") : s.cwd === c.paths.emptyCwd, "canary-proof cwd / restricted"),
  ],
};

const ctxFor = (mode: EngineMode, o: Partial<EngineRequest> = {}, so: Partial<EngineSettings["claude-cli"]> = {}): Ctx & { spec: SpawnSpec } => {
  const req = reqFor(mode, o);
  const s = settings(so);
  const paths = pathsFor(req);
  return { req, settings: s, paths, env: PARENT_ENV, spec: buildClaudeSpawn(req, s, paths, PARENT_ENV) };
};
const allViolations = (spec: SpawnSpec, c: Ctx): string[] => Object.values(CHECKS).flatMap((f) => f(spec, c));

describe("AGT-U-I01…I14 claude-cli spawn invariants (CLAUDE_CLI_INVARIANTS)", () => {
  test("AGT-U-I00 the checks cover exactly the invariant ids (lint)", () => {
    expect(Object.keys(CHECKS).sort()).toEqual(CLAUDE_CLI_INVARIANTS.map((i) => i.id).sort());
  });

  for (const inv of CLAUDE_CLI_INVARIANTS) {
    const id = `AGT-U-I${inv.id.slice(1).padStart(2, "0")}`;
    test(`${id} ${inv.rule.slice(0, 80)}`, () => {
      for (const mode of MODES) {
        const c = ctxFor(mode);
        expect({ mode, v: CHECKS[inv.id](c.spec, c) }).toEqual({ mode, v: [] });
        const h = ctxFor(mode, { model: "claude-haiku-4-5" }); // I6: --effort for haiku too
        expect({ mode, v: CHECKS[inv.id](h.spec, h) }).toEqual({ mode, v: [] });
      }
    });
  }

  test("AGT-U-I01 inheritUserSettings ⇒ --setting-sources user (never project)", () => {
    const c = ctxFor("answer", {}, { inheritUserSettings: true });
    expect(after(c.spec.argv, "--setting-sources")).toBe("user");
    expect(allViolations(c.spec, c)).toEqual([]);
    expect(ctxFor("agent", {}, { inheritUserSettings: true }).spec.argv).not.toContain("--setting-sources");
  });

  test("AGT-U-I02 oversized argv is refused (schema element > 8 KiB)", () => {
    const big = { type: "object", description: "x".repeat(9000) };
    expect(() => ctxFor("patch", { jsonSchema: big })).toThrow(/8 KiB/);
  });

  test("AGT-U-I03 a system prompt without the working directory is refused", () => {
    expect(() => ctxFor("answer", { system: "You are mitori-explainer." })).toThrow(/Working directory/);
    const req = reqFor("answer");
    expect(() => buildClaudeSpawn(req, settings(), { ...pathsFor(req), systemPromptFile: "/tmp/sp.txt" }, PARENT_ENV)).toThrow(/run\/sp/);
  });

  test("AGT-U-I04 persistSessions ⇒ --session-id <uuidv4> issued by mitori, resume ⇒ --resume", () => {
    const req = reqFor("patch", { persistSession: true });
    const paths = { ...pathsFor(req), sessionId: "0f8fad5b-d9cb-469f-a165-70867728950e" };
    const s = settings({ persistSessions: true });
    const spec = buildClaudeSpawn(req, s, paths, PARENT_ENV);
    expect(after(spec.argv, "--session-id")).toBe(paths.sessionId);
    expect(spec.argv).not.toContain("--no-session-persistence");
    expect(spec.env.CLAUDE_CODE_PROMPT_CACHE_TTL).toBe("1h");
    expect(allViolations(spec, { req, settings: s, paths, env: PARENT_ENV })).toEqual([]);
    const resumed = buildClaudeSpawn({ ...req, resume: "0f8fad5b-d9cb-469f-a165-70867728950e" }, s, pathsFor(req), PARENT_ENV);
    expect(after(resumed.argv, "--resume")).toBe("0f8fad5b-d9cb-469f-a165-70867728950e");
    // no per-thread exception: persistSession without the global setting stays non-persistent
    expect(ctxFor("patch", { persistSession: true }).spec.argv).toContain("--no-session-persistence");
    expect(() => buildClaudeSpawn({ ...req, resume: "x" }, settings(), pathsFor(req), PARENT_ENV)).toThrow(/resume/);
    expect(() => buildClaudeSpawn(req, s, pathsFor(req), PARENT_ENV)).toThrow(/uuidv4/);
  });

  test("AGT-U-I05 every denylisted variable is removed even when passed through; MITORI_* too", () => {
    const env = Object.fromEntries([...ENV_DENYLIST.map((k) => [k, "v"]), ["MITORI_ANY", "v"], ["HOME", "/Users/u"], ["PATH", "/usr/bin"], ["FOO_OK", "1"]]);
    const req = reqFor("answer");
    const spec = buildClaudeSpawn(req, settings({ envPassthrough: [...ENV_DENYLIST, "MITORI_ANY", "FOO_OK"] }), pathsFor(req), env);
    for (const k of ENV_DENYLIST) expect(spec.env[k]).toBeUndefined();
    expect(spec.env.MITORI_ANY).toBeUndefined();
    expect(spec.env.FOO_OK).toBe("1");
    expect(spec.env.RANDOM_VAR).toBeUndefined();
  });

  test("AGT-U-I05 ENV_INJECT overrides inherited values; generate gets CLAUDE_CODE_MAX_OUTPUT_TOKENS", () => {
    const g = ctxFor("generate", { budget: { usd: 0.5, inTokens: 0, outTokens: 6000, ms: 0 } });
    expect(g.spec.env.CLAUDE_CODE_PROMPT_CACHE_TTL).toBe("5m");
    expect(g.spec.env.CLAUDE_CODE_MAX_OUTPUT_TOKENS).toBe("6000");
    expect(ctxFor("answer").spec.env.CLAUDE_CODE_MAX_OUTPUT_TOKENS).toBeUndefined();
  });

  test("AGT-U-I06 aliases are rejected", () => {
    expect(() => ctxFor("answer", { model: "sonnet" as EngineRequest["model"] })).toThrow(/full Claude model id/);
  });

  test("AGT-U-I08 new files add Write; unsafe paths cannot become permission rules (SEC-09)", () => {
    const c = ctxFor("agent", { writeScope: ["src/new.ts", "src/old.ts"], newFiles: ["src/new.ts"] });
    expect(after(c.spec.argv, "--tools")).toBe("Read,Edit,Glob,Grep,Write");
    expect(allViolations(c.spec, c)).toEqual([]);
    for (const bad of ["a b.ts", "a,b.ts", "-x.ts", "../x.ts", "a/./b.ts", "x*.ts", "a(b).ts", "日本.ts", "a​b.ts", "a%b.ts"]) {
      expect(agentPathsOk([bad])).toBe(false);
      expect(() => editPermissionRule(WT, bad)).toThrow();
    }
    expect(agentPathsOk(["internal/auth/login.go", ".github/x.yml", "a@b+c-d_e.ts"])).toBe(true);
    expect(editPermissionRule(WT, "internal/auth/login.go")).toBe(`Edit(//${WT.slice(1)}/internal/auth/login.go)`);
    expect(() => ctxFor("agent", { writeScope: ["a b.ts"] })).toThrow();
    expect(() => editPermissionRule("/Users/John Doe/wt", "a.ts")).toThrow();
  });

  test("AGT-U-I09 non-agent modes must run in the empty sandbox; agent never there", () => {
    expect(() => ctxFor("answer", { cwd: WT, system: `Working directory: ${WT}` })).toThrow(/empty sandbox/);
    expect(() => ctxFor("agent", { cwd: EMPTY, system: `Working directory: ${EMPTY}` })).toThrow(/worktree/);
    expect(() => ctxFor("answer", { tools: "read_edit" })).toThrow(/without tools/);
  });

  test("AGT-U-I13 answer/findings close stdin even if keepAlive is asked", () => {
    expect(ctxFor("answer", { keepAlive: true }).spec.keepStdinOpen).toBe(false);
    expect(ctxFor("findings", { keepAlive: true }).spec.keepStdinOpen).toBe(false);
    expect(ctxFor("patch", { keepAlive: false }).spec.keepStdinOpen).toBe(false);
  });

  test("AGT-U-I00 argv equals the spec §6.2.4 example for agent mode", () => {
    const c = ctxFor("agent");
    expect(c.spec.argv).toEqual([
      "-p",
      "--model",
      "claude-sonnet-5-5",
      "--effort",
      "medium",
      "--strict-mcp-config",
      "--disable-slash-commands",
      "--system-prompt-file",
      c.paths.systemPromptFile,
      "--input-format",
      "stream-json",
      "--output-format",
      "stream-json",
      "--verbose",
      "--include-partial-messages",
      "--no-session-persistence",
      "--permission-prompts",
      "none",
      "--max-budget-usd",
      "0.2500",
      "--restricted",
      "--tools",
      "Read,Edit,Glob,Grep",
      "--permission-mode",
      "dontAsk",
      "--allowedTools",
      "Read",
      "Glob",
      "Grep",
      `Edit(//${WT.slice(1)}/internal/auth/login.go)`,
      `Edit(//${WT.slice(1)}/internal/auth/login_test.go)`,
      "--json-schema",
      JSON.stringify(SCHEMA),
    ]);
    expect(c.spec.processGroup).toBe(true);
    expect(c.spec.command).toBe("/Users/u/.local/bin/claude");
  });
});

/** Flags that take one value. `--allowedTools` takes every following non-flag element. */
const VALUE_FLAGS = new Set([
  "--model",
  "--effort",
  "--system-prompt-file",
  "--input-format",
  "--output-format",
  "--permission-prompts",
  "--max-budget-usd",
  "--setting-sources",
  "--tools",
  "--json-schema",
  "--permission-mode",
  "--session-id",
  "--resume",
]);

function withoutFlag(argv: readonly string[], i: number): string[] {
  const flag = argv[i] as string;
  let n = 1;
  if (VALUE_FLAGS.has(flag)) n = 2;
  else if (flag === "--allowedTools") while (i + n < argv.length && !(argv[i + n] as string).startsWith("--")) n++;
  return [...argv.slice(0, i), ...argv.slice(i + n)];
}

describe("AGT-U-I mutation smoke (testing spec §10 AC-15)", () => {
  test("AGT-U-I15 removing any one flag from any mode's argv makes an invariant check fail", () => {
    for (const mode of MODES) {
      const c = ctxFor(mode);
      expect(allViolations(c.spec, c)).toEqual([]);
      c.spec.argv.forEach((el, i) => {
        if (!el.startsWith("-")) return;
        const mutated = { ...c.spec, argv: withoutFlag(c.spec.argv, i) };
        expect({ mode, flag: el, caught: allViolations(mutated, c).length > 0 }).toEqual({ mode, flag: el, caught: true });
      });
    }
  });

  test("AGT-U-I15 deleting any element of the CLAUDE_ARGV data (the implementation's source) is caught", () => {
    for (const mode of MODES) {
      for (const key of ["common", mode] as const) {
        const arr = CLAUDE_ARGV[key] as unknown as string[];
        for (let i = 0; i < arr.length; i++) {
          const [removed] = arr.splice(i, 1);
          try {
            let caught = false;
            try {
              const c = ctxFor(mode);
              caught = allViolations(c.spec, c).length > 0;
            } catch {
              caught = true; // the builder refused the mutated template
            }
            expect({ mode, key, removed, caught }).toEqual({ mode, key, removed, caught: true });
          } finally {
            arr.splice(i, 0, removed as string);
          }
        }
      }
    }
  });

  test("AGT-U-I15 re-adding any denylisted variable, a forbidden flag or flipping stdin is caught", () => {
    const c = ctxFor("patch");
    for (const k of ENV_DENYLIST) expect(allViolations({ ...c.spec, env: { ...c.spec.env, [k]: "x" } }, c).length).toBeGreaterThan(0);
    for (const f of CLAUDE_FORBIDDEN_FLAGS) expect(allViolations({ ...c.spec, argv: [...c.spec.argv, f] }, c).length).toBeGreaterThan(0);
    expect(allViolations({ ...c.spec, keepStdinOpen: false }, c).length).toBeGreaterThan(0);
    expect(allViolations({ ...c.spec, cwd: "/repo" }, c).length).toBeGreaterThan(0);
    expect(allViolations({ ...c.spec, argv: [...c.spec.argv, "--tools", "Bash"] }, c).length).toBeGreaterThan(0);
    expect(allViolations({ ...c.spec, argv: c.spec.argv.map((a) => (a === "claude-sonnet-5-5" ? "sonnet" : a)) }, c).length).toBeGreaterThan(0);
  });
});
