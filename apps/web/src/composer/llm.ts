/**
 * Composer の「使うLLM」select (WP41): 登録済みで有効な engine を候補にし、job の mode に
 * 対応しない engine と使えない engine (未ログインなど) は理由付きで選べなくする。
 * 能力の判定は既存のものを使う: grok-cli・antigravity-cli は単発テキストのみ
 * (adapter が patch・agent を E_UNSUPPORTED にする)、使えるかは `engineProblem`。
 */
import { ENGINE_IDS, type EngineId, type EngineStatus, type ExecMode, type GlobalSettings } from "@mitori/core";
import { engineProblem } from "../map/engine.ts";

/** select で選べない理由。`composer.llm.why.<reason>` に出す。 */
export type LlmDisableReason = "notInstalled" | "capabilityLost" | "notLoggedIn" | "textOnly" | "sessionOnly";

export interface LlmOption {
  /** Engine. */
  engine: EngineId;
  /** 選べないとき真。 */
  disabled: boolean;
  /** `disabled` の理由 (選べるとき null)。 */
  reason: LlmDisableReason | null;
}

/** patch・agent を受け付けない engine (adapter が E_UNSUPPORTED)。 */
const TEXT_ONLY: readonly EngineId[] = ["grok-cli", "antigravity-cli"];

/**
 * 有効な engine の候補。`mode` が null のときは mode 判定をしない (初期値の解決用)。
 * session は送信に使えないので push の候補では常に選べない。
 */
export function llmOptions(settings: GlobalSettings, statuses: readonly EngineStatus[] | null, mode: ExecMode | null): LlmOption[] {
  const out: LlmOption[] = [];
  for (const engine of ENGINE_IDS) {
    if (!settings.engines[engine]?.enabled) continue;
    if (engine === "session") {
      out.push(mode === null ? { engine, disabled: false, reason: null } : { engine, disabled: true, reason: "sessionOnly" });
      continue;
    }
    if (mode !== null && mode !== "answer" && TEXT_ONLY.includes(engine)) {
      out.push({ engine, disabled: true, reason: "textOnly" });
      continue;
    }
    const problem = statuses === null ? null : engineProblem(statuses.find((s) => s.engine === engine) ?? null);
    out.push({ engine, disabled: problem !== null, reason: problem });
  }
  return out;
}

/** 初期値: 既定のLLM。既定が使えないときは先頭の使えるもの (無ければ既定のまま)。 */
export function defaultLlm(settings: GlobalSettings, statuses: readonly EngineStatus[] | null, mode: ExecMode | null): EngineId {
  const opts = llmOptions(settings, statuses, mode);
  if (opts.some((o) => o.engine === settings.defaultEngine && !o.disabled)) return settings.defaultEngine;
  return opts.find((o) => !o.disabled)?.engine ?? settings.defaultEngine;
}
