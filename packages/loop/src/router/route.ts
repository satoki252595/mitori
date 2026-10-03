import type { EffectiveSettings, EngineId, ModelId, ReasoningEffort, Result, RouteDecision, ThreadIntent } from "@mitori/core";
import { ROUTER_LIMITS, ROUTER_RULES, type RouteInput, type RouteOutcome, type RouterRule } from "../contract.ts";
import { fail } from "./result.ts";

/**
 * `RouteInput` plus the one fact R0b needs and the contract does not carry: which member of the anchor the note was
 * written on. CR-PENDING(WP-08a): without it a doc-primary note with cited claims looks code-anchored, so the router
 * falls back to `codeAnchored` (doc-primary and code-less ⇒ docpatch/1, otherwise answer/1).
 */
export type RouteInputExt = RouteInput & { primary?: "doc" | "code" | "diagram" };

type Group = "question" | "review" | "note" | "change" | "mixed";

/** Change-like intents once `note` is split off (R1: notes are memos unless sent, and then never write). */
const CHANGE: readonly ThreadIntent[] = ["change", "doc_edit"];

function groupOf(intents: readonly ThreadIntent[]): Group {
  if (intents.every((i) => CHANGE.includes(i))) return "change";
  if (intents.every((i) => i === "question")) return "question";
  if (intents.every((i) => i === "review")) return "review";
  if (intents.every((i) => i === "note")) return "note";
  return "mixed";
}

/** Pure router (spec §3.4): the first matching row of `ROUTER_RULES` after R0/R0b/R7/R8 and the override rules. */
export function routeDecision(input: RouteInputExt, settings: EffectiveSettings): Result<RouteOutcome> {
  const { limits, models, reasoning } = settings.global;
  const intents = [...new Set(input.intents)].sort();
  if (intents.length === 0 || input.threads < 1) return fail("E_INVALID_INPUT", "nothing to route: no threads");

  const effort = (src: RouterRule["effort"]): ReasoningEffort =>
    src.startsWith("reasoning.") ? reasoning[src.slice("reasoning.".length) as "answer" | "patch" | "agent"] : (src as ReasoningEffort);
  const base = { anchoredLines: input.anchoredLines, files: input.files };
  const decide = (mode: RouteDecision["mode"], d: Omit<RouteDecision, "mode" | "anchoredLines" | "files">): RouteDecision => ({ mode, ...d, ...base });
  const notes: string[] = [];

  const group = groupOf(intents);
  if (group === "mixed") {
    return fail("E_INVALID_INPUT", `mixed intents (${intents.join(", ")}): split the batch by job kind first`, { params: { intents: intents.join(",") } });
  }
  if (group === "note" && input.single)
    return fail("E_INVALID_INPUT", "a note is sent only by Finish, never as a single dispatch", { params: { intents: "note" } });

  let decision: RouteDecision | null = null;
  const override = input.override;

  // Overrides (JobReq.mode / JobReq.model).
  if (override?.mode !== undefined) {
    const mode = override.mode;
    if (mode === "answer") {
      if (group === "change")
        decision = decide("answer", {
          reason: "user_override",
          model: models.answer,
          effort: effort("reasoning.answer"),
          tools: "none",
          contract: "answer/1",
          requiresConfirm: false,
        });
      // question / review / note keep their own row (the same mode already)
    } else if (group !== "change") {
      return fail("E_INVALID_INPUT", `mode ${mode} is only available for change intents`, { params: { mode, intents: intents.join(",") } });
    } else if (!input.codeAnchored) {
      return noScope();
    } else if (mode === "patch") {
      if (input.newFiles > 0 || input.bundleTokens > limits.bundleMaxTokens) {
        return fail("E_INVALID_INPUT", "patch mode needs existing files and a bundle that fits", {
          params: { newFiles: input.newFiles, bundleTokens: input.bundleTokens, max: limits.bundleMaxTokens },
          actions: ["narrow_scope"],
        });
      }
      decision = decide("patch", {
        reason: "user_override",
        model: models.patch,
        effort: effort("reasoning.patch"),
        tools: "none",
        contract: "patch/1",
        requiresConfirm: false,
      });
    } else {
      if (!input.agentPathsOk) return agentPathsUnsupported();
      decision = decide("agent", {
        reason: "user_override",
        model: models.agent,
        effort: effort("reasoning.agent"),
        tools: "read_edit",
        contract: "agent/1",
        requiresConfirm: false,
      });
    }
  }

  if (decision === null && group === "note") {
    // R0b: a sent note never writes. Doc-primary ⇒ a doc proposal (docpatch/1), code-primary ⇒ an answer.
    const docPrimary = input.primary !== undefined ? input.primary === "doc" : !input.codeAnchored;
    decision = docPrimary
      ? decide("answer", {
          reason: "intent_note",
          model: models.rewrite,
          effort: effort("reasoning.answer"),
          tools: "none",
          contract: "docpatch/1",
          requiresConfirm: false,
        })
      : decide("answer", {
          reason: "intent_note",
          model: models.answer,
          effort: effort("reasoning.answer"),
          tools: "none",
          contract: "answer/1",
          requiresConfirm: false,
        });
  }

  if (decision === null && group === "change" && !input.codeAnchored) return noScope(); // R7

  if (decision === null) {
    for (const rule of ROUTER_RULES as readonly RouterRule[]) {
      if (!matches(rule, intents, input, limits)) continue;
      const reason = rule.after ? ([...input.history].reverse().find((r) => rule.after?.includes(r)) ?? rule.reason) : rule.reason;
      decision = decide(rule.mode, {
        reason,
        model: models[rule.model],
        effort: effort(rule.effort),
        tools: rule.tools,
        contract: rule.contract,
        requiresConfirm: rule.confirm,
      });
      break;
    }
  }

  if (decision === null) {
    // Only R6 can fall through here: a large change whose paths cannot be written into permission rules.
    return input.agentPathsOk ? fail("E_INTERNAL", "router: no rule matched") : agentPathsUnsupported();
  }

  if (override?.model !== undefined) {
    decision = { ...decision, model: override.model as ModelId };
    if (decision.mode === "answer" && override.model === "claude-haiku-4-5") notes.push("answer に haiku を指定: grounded Q&A で幻覚が出やすい（実測）");
  }

  let engine: EngineId = input.engine.id;
  if (decision.mode === "agent" && !input.engine.tools) {
    if (!input.engine.claudeCliAvailable) {
      return fail("E_AGENT_CAPABILITY", `engine ${input.engine.id} cannot run agent mode and claude-cli is unavailable`, {
        actions: ["copy_prompt", "other_engine"],
        params: { engine: input.engine.id },
      });
    }
    engine = "claude-cli";
    notes.push("agent mode は claude-cli で実行");
  }

  const outcome: RouteOutcome = { decision, engine };
  if (notes.length > 0) outcome.note = notes.join(" / ");
  return { ok: true, value: outcome };
}

function matches(rule: RouterRule, intents: readonly ThreadIntent[], input: RouteInputExt, limits: EffectiveSettings["global"]["limits"]): boolean {
  // `ROUTER_RULES` lists intents per row; a homogeneous batch matches a row when all of its intents are in it.
  if (!intents.every((i) => rule.intents.includes(i))) return false;
  if (rule.after && !input.history.some((r) => rule.after?.includes(r))) return false;
  if (rule.mode === "agent" && !input.agentPathsOk) return false;
  if (rule.small) {
    return (
      input.anchoredLines <= limits.patchMaxLines &&
      input.files <= limits.patchMaxFiles &&
      input.threads <= ROUTER_LIMITS.patchMaxThreads &&
      input.newFiles === 0 &&
      input.bundleTokens <= limits.bundleMaxTokens
    );
  }
  return true;
}

const noScope = (): Result<never> =>
  fail("E_PRECONDITION", "no code to change: the anchors give no write scope", { actions: ["narrow_scope"], hint: "point at the code with @ in the Composer" });

const agentPathsUnsupported = (): Result<never> =>
  fail("E_UNSUPPORTED", "agent mode is unavailable: a path in the write scope cannot be written into a permission rule", {
    actions: ["narrow_scope", "copy_prompt"],
  });
