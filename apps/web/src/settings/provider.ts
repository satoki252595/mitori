import type { DeepPartial, GlobalSettings, ReasoningEffort } from "@mitori/core";

/** Generation's existing minimum turn deadline; an explicit value resets a previously saved override. */
const DEFAULT_TURN_MS = 120_000;

/** The existing CLI owns execution settings; single quotes keep JSON argv literal in a POSIX shell. */
export function genericProviderCommand(patch: DeepPartial<GlobalSettings>): string {
  return `mitori config set engines.generic '${JSON.stringify(patch.engines?.generic).replaceAll("'", "'\\''")}'`;
}

/** Build a settings patch; argv is an array, never a shell command string. */
export function genericProviderPatch(input: {
  model: string;
  argv: string;
  reasoning: ReasoningEffort;
  protocol: "text" | "muse-jsonl";
  pricing: { inPerMTok: number; outPerMTok: number; cacheReadPerMTok: number };
  turnMs?: number;
}): DeepPartial<GlobalSettings> {
  if (!/^generic:\S+$/u.test(input.model) || [...input.model].some((c) => c.charCodeAt(0) < 32)) throw new Error("settings.providerInvalid");
  const argv: unknown = JSON.parse(input.argv);
  if (!Array.isArray(argv) || !argv.length || typeof argv[0] !== "string" || !argv[0].trim() || !argv.every((v) => typeof v === "string" && !v.includes("\0")))
    throw new Error("settings.providerInvalid");
  if (!Object.values(input.pricing).every((v) => Number.isFinite(v) && v >= 0)) throw new Error("settings.providerInvalid");
  if (input.turnMs !== undefined && (!Number.isInteger(input.turnMs) || input.turnMs < 1_000 || input.turnMs > 3_600_000))
    throw new Error("settings.providerInvalid");
  const model = input.model as `generic:${string}`;
  return {
    defaultEngine: "generic",
    defaultGenEngine: "generic",
    engines: {
      generic: { enabled: true, argv, protocol: input.protocol, pricing: input.pricing, turnMs: input.turnMs ?? DEFAULT_TURN_MS },
    },
    models: { answer: model, patch: model, agent: model, genModule: model, genOverview: model, genLeaf: model, judge: model, rewrite: model, escalate: model },
    reasoning: { answer: input.reasoning, patch: input.reasoning, agent: input.reasoning, gen: input.reasoning, genOverview: input.reasoning },
  };
}

/** Muse's argv excludes the auto-updating launcher; the adapter also disables personal context / reminder hooks. */
export const MUSE_ARGS = [
  "exec",
  "--json",
  "--model",
  "{model}",
  "--reasoning-effort",
  "{effort}",
  "--prompt-file",
  "{promptFile}",
  "--workspace",
  "{emptyCwd}",
  "--worktree",
  "off",
  "--disable-shell",
  "--disable-write",
  "--disable-web-tools",
  "--no-foreign-personal-context",
  "--no-session-log",
  "--max-model-steps",
  "1",
  "--approval-mode",
  "untrusted",
  "--approval-judge",
  "off",
];
