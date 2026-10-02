# ADR-0005: 実行エンジンと規約上の姿勢

- 状態: 採用（2026-10-03） / 関連: D3/D17、06 §2–5, §11、補遺 A1/A2/A3/A8/C2/C8

## Context
ユーザーは Claude Code（サブスク）/ Codex を持っている。サブスク経由の `claude -p` の課金扱いは 2026 年に 3 回変わり、事前通知なく執行されうる。既定のまま `claude -p` を呼ぶと 1 呼び出し 18.8k〜112.7k token かかり、repo の project 設定（hook・MCP）が信頼確認なしに実行される。

## Decision
- **engine は 5 種**: `claude-cli`（既定。Push の Explain/Fix/Review と生成）、`session`（in-session Pull: `mitori gen --prep/--ingest`、`mitori review`。第一級）、`anthropic-api`（opt-in: cache breakpoint、Batch、`count_tokens`、structured outputs）、`codex-cli`（MVP 後）、`generic`（global の argv）。
- **生成は必ず事前見積り**（token、API 換算 $、並列 3 での推定時間、session C=1 の時間、5h 枠の推定）を出し、1 クリックで開始する。
- **spawn 不変条件**（`CLAUDE_CLI_INVARIANTS`）: project 設定遮断（`--setting-sources ""` か `--restricted`、+ `--strict-mcp-config`）、prompt は stdin、system prompt は `--system-prompt-file`、`--no-session-persistence`、env allowlist、完全 model ID（`claude-opus-5-5` / `claude-sonnet-5-5` / `claude-haiku-4-5`）、Bash なし、実行ごとに `apiKeySource` 検査。CI の契約テストで実 CLI に対して検証する。
- **規約上の姿勢**: ユーザーの改変されていない `claude` を spawn するだけで credential を扱わない。Cloudflare では agent を動かさない。並列は既定 3・上限 8（429 で自動低下）、ユーザーの 5h 枠が 80% を超えたら background を止める。無人ループなし（repair 最大 2 回、予算必須）。課金区分の変化（overage）を検出したら background を止め確認を必須にする。公開前に Anthropic に確認する。
- 費用の主単位は **API 換算 $**（クレジット制が再開されたらそのまま請求額になる）、5h 枠 % は観測できるときだけの副表示。

## Consequences
- lean 化で 1 呼び出しの固定 overhead は 0.6〜1.0k（tools なし）。patch mode の Fix は約 2.5k token・$0.022（実測）。
- `--bare` が `-p` の既定になるとサブスクの Push が壊れる → capability 検出で検知し、Pull / Copy as prompt に自動で落とす。
- `--system-prompt-file` は `--help` に載っていないため契約テストの対象。
- anthropic-api では Opus/Sonnet 5.5 の forced `tool_choice` が 400 なので structured outputs を使う。thinking は無効化できない（Sonnet は `between_tools`）、Opus 5.5 の effort 既定は medium なので明示、Haiku 4.5 には effort を送らない、refusal（`stop_reason: "refusal"`）を扱い `fallbacks: "default"` を付ける、履歴は append-only。

## Alternatives
- Agent SDK 依存: 221MB の platform binary、サブスク利用のグレーさ。
- 既定 flag のまま spawn: token 18〜180 倍、project hook の実行（セキュリティ境界の欠如）。
- MCP を主経路に: 常駐 ≈2k token。opt-in にとどめる（D10）。
