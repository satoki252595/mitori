/** One-line follow-ups for vendor CLI updates the daemon could not follow (WP28 §B). Pure. */
import type { EngineId } from "@mitori/core";

export interface EngineHintStatus {
  engine: EngineId;
  problems: { code: string; message: string }[];
  path?: string;
  version?: string;
  pinVersion?: string;
}

export interface EngineHintContext {
  /** Muse `--effort` / `--model` carried over from settings. */
  museEffort?: string;
  museModel?: string;
  /** Codex `--model` / `--max-estimated-usd` carried over from settings. */
  codexModel?: string;
  codexMaxUsd?: number;
}

/**
 * One line to print after an engine failure (or in `mitori doctor`): the exact re-setup command, or the
 * Codex version notice when re-running setup cannot help. `null` when this status needs no update hint.
 * `bin` names this mitori (`mitori` from a source checkout, the binary realpath otherwise).
 */
export function engineUpdateHint(s: EngineHintStatus, ctx: EngineHintContext, lang: "ja" | "en", bin = "mitori"): string | null {
  const ja = lang === "ja";
  if (s.engine === "generic") {
    const gone = s.problems.some((p) => p.code === "E_AGENT_NOT_INSTALLED") && /\/muse-bin-[^/]+$/.test(s.path ?? "");
    if (!gone) return null;
    const effort = ctx.museEffort ? ` --effort ${ctx.museEffort}` : "";
    const model = ctx.museModel ? ` --model ${ctx.museModel}` : "";
    return ja
      ? `Museが自動更新されました: \`${bin} setup muse${effort}${model}\` を実行してください`
      : `Muse updated itself: run \`${bin} setup muse${effort}${model}\``;
  }
  if (s.engine === "claude-cli") {
    if (!s.problems.some((p) => p.code === "E_ENGINE_BINARY_CHANGED")) return null;
    return ja ? `Claude Codeが更新されました: \`${bin} setup claude\` を実行してください` : `Claude Code updated: run \`${bin} setup claude\``;
  }
  if (s.engine === "codex-cli") {
    const unverified = s.problems.find((p) => p.code === "E_AGENT_CAPABILITY" && /requires verified version (\S+)/.test(p.message));
    if (unverified) {
      const want = /requires verified version (\S+)/.exec(unverified.message)?.[1] ?? "";
      return ja
        ? `Codex ${s.version ?? ""} は未確認（確認済み ${want}）。setupのやり直しでは直りません。mitoriを更新（git pull）すると対応している場合があります`
        : `Codex ${s.version ?? ""} is unverified (supported: ${want}). Re-running setup will not fix this; updating mitori (git pull) may help`;
    }
    if (!s.problems.some((p) => p.code === "E_AGENT_CAPABILITY" && /binary changed|not pinned/i.test(p.message))) return null;
    const maxUsd = ctx.codexMaxUsd !== undefined && Number.isFinite(ctx.codexMaxUsd) && ctx.codexMaxUsd > 0 ? ` --max-estimated-usd ${ctx.codexMaxUsd}` : "";
    const model = ctx.codexModel ? ` --model ${ctx.codexModel}` : "";
    return ja
      ? `Codexの実行ファイルが変わりました: \`${bin} setup codex --native${maxUsd}${model}\` を実行してください`
      : `The Codex binary changed: run \`${bin} setup codex --native${maxUsd}${model}\``;
  }
  return null;
}
