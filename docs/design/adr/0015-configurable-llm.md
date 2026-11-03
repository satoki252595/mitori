# ADR-0015: 任意 LLM は generic のテキスト契約を使う

- 状態: 採用（2026-10-04）。関連: ADR-0005、ADR-0011、ADR-0013、ADR-0014。

## Context

生成・回答・構造化提案でモデルを選べるようにする。今回は Muse `muse-spark-1.3-contributor`、effort `max` を使う。モデルごとの agent 実装や新しい依存は増やさず、既存の generic CLI と生成パイプラインを使う。

## Decision

1. 実行ファイルと argv、`protocol: text | muse-jsonl`、任意の単価（USD/百万 token）はユーザーのグローバル設定に置く。repo 設定から実行設定を変更できない。モデル名は `generic:<provider model id>`。argv の `{model}`、`{effort}`、`{promptFile}`、`{emptyCwd}` は文字列置換し、shell を使わない。実行設定・モデル設定の hash を既存の engine policy 承認識別子にする。
2. CLI は確認済みの空ディレクトリで起動する。許可済み bundle と system prompt、構造化出力契約だけを送る。修復の cold retry は `promptBlocks` をすべて含める。stdin を読めない CLI には既存の SafeWriter による内容 hash 付き prompt ファイルを渡し、stdin は空にする。回答と生成は stdout のテキスト、patch/findings は既存の JSON 抽出・検証を使う。generic の agent mode と tool request は拒否する。
3. Muse は検証済みバイナリと次の argv のみを受け入れる（順序変更可、重複・追加 option は拒否）。自動更新を行う launcher は検証対象に含めない。

   ```text
   exec --json --model {model} --reasoning-effort {effort}
   --prompt-file {promptFile} --workspace {emptyCwd} --worktree off
   --disable-shell --disable-write --disable-web-tools
   --no-foreign-personal-context --no-session-log --max-model-steps 1
   --approval-mode untrusted --approval-judge off
   ```

4. Muse の設定は detect と run の両方で検査し、user hooks、MCP（`mcpServers` / `mcp_servers`）、plugins、presets、agent definitions、managed plugins/skills、runtime capability の非空設定は `E_CFG_INVALID` で拒否する。設定内容やコマンド、認証情報をログへ出さない。`managed_hooks_path` は SafeWriter が作った `{"hooks":{}}` に `TBH_MANAGED_HOOKS_PATH` で置き換える。各呼び出しで `XDG_CONFIG_HOME` を mitori home 内の専用ディレクトリへ置き換え、`muse/settings.json` は `{"schema_version":1,"run":{"toolset":[]}}` とする。設定0600・ディレクトリ0700を既存 SafeWriter で作る。元の `auth.json` が regular/non-symlink かつ読み取り前後の inode/mtime/ctime/size が同じときだけ byte 列をコピーし、他の user 設定はコピーしない。認証内容はログへ出さず、child 終了後・起動失敗・キャンセルでコピーを削除する。ユーザーの設定・ログイン状態を変更しない。
5. Muse protocol のときだけ固定環境変数を注入する。`MUSE_EXPERIMENTAL_` の TODO/MEMORY/SKILL/GOAL/VERIFY/SCOPE_REMINDER、PLUGINS、HOOK_SELECTED_SKILLS、HOOK_SELECTED_SKILLS_APPLY、AGENTS、WORKFLOW_TOOL、ARTIFACT_TOOL、MONITOR、VOICE、LOCAL_SESSION_MESSAGING は `off`、FOREIGN_PERSONAL_CONTEXT_KILL は `on`。JSONL の hook/MCP/tool/reminder/delegation 実行を検知したら停止・失敗にする。正常終了には completed terminal record が必要。
6. 今回の Muse JSONL は token usage を返さない。generic は完全な入力と出力の UTF-8 byte 数を保守的な本文 token 推計にし、設定した単価で換算して `usageEstimated: true` を保存する。hidden thinking と provider 内部の prompt・キャッシュは観測できず、実請求額の上限を保証しない。単価不明なら caller の USD 上限を予約扱いにし、無料と表示しない。推計は予算に算入し、キャッシュ校正には使わない。モデルはJSONLの configured model、effort は要求値として記録する。実providerが採用したモデルとeffortの独立した応答metadataは未取得。ネイティブ usage は schema を実測後に追加する。
7. AI の提案は引き続きアンカー済み・範囲限定・ゲート済み・人が確認・未コミット・Undo 可。provider は許可済み repo 内容を受け取る。任意 CLI の実行ファイルはユーザーが信頼する境界であり、悪意ある CLI に対する OS 隔離をこの契約で保証しない。

## Verification and limits

2026-10-06 追記: Grok・Ollama・LM Studio は既存の generic に `protocol: openai-chat` と `api: {baseUrl, keyEnv?}` を加え、CLI を介さず `POST /v1/chat/completions` を使う。`argv` は空、モデルは同じ `generic:<id>`。遠隔は HTTPS と環境変数の key、HTTP は文字通りの localhost / 127.0.0.1 / [::1] に限定し、URL の資格情報・query・fragment と redirect を拒否する。key 自体を設定・ログ・ledgerへ保存せず、失敗応答や transport exception の内容を表示しない。tool declaration は送らず、agent / tool request と応答の tool call は拒否する。出力は 1 MiB、壁時計 timeout・cancel は AbortSignal で止める。回答・生成と既存 JSON 抽出を共用し、追加 SDK は使わない。

HTTP usage の prompt / completion があればその報告値を使い、total に含まれる reasoning を出力へ算入する。usage 欠落は UTF-8 byte 推計、価格不明は承認済み cap の予約扱い。出力 token の承認は1以上必須で、`max_tokens` はその値を変更せず送る。USD 0 の承認は明示ゼロ単価のローカルだけ許可する。`-cloud` / `:cloud` で終わるモデルは localhost 経由でもゼロ単価を拒否する。生成 planner は価格不明のまま実行しない。明示ゼロ単価は localhost の実ローカルモデル用で、名前から分からない proxy の課金を検証するものではない。provider 固有の reasoning option や tools、Responses API は送らない。無償 loopback HTTP と fake response で検証し、Grok / 実 Ollama / 実 LM Studio のモデル実行は今回行っていない。

provider の登録時は `api` を一つの接続として置き換え、Grok → ローカル切替で元の keyEnv を残さない。CLI protocol を明示して戻すと古い api metadata を取り除く。その他の部分設定は既存 deep merge を維持する。

## 2026-11-03 追記: Grok Build CLI（WP36、CR wp36-3）と Codex effort（CR wp36-2）

Grok は generic の HTTP ではなく公式 CLI（`grok` 1.0.70）を直接使う engine（`grok-cli`）を追加した。Muse（§4）と同じ考え方で、呼び出しごとに mitori home 内の専用 `GROK_HOME` を SafeWriter で作り、空の `config.toml` と認証ファイルだけを regular/non-symlink 確認つきでコピーし、終了・失敗・キャンセルで消す。根拠は `grok --help`・`grok agent --help`・`grok inspect`・バイナリ内蔵の headless 文書（いずれもネットワーク不要の実測）:

- 設定の読み場所は `~/.grok`（auth.json・config.toml・hooks/skills/memory/sessions・`leader.sock`）で、`GROK_HOME` が上書きする（内蔵文書の `$HOME` / `$GROK_HOME` 記述と `GROK_LEADER_SOCKET`・`leader.sock` 既定 `~/.grok/leader.sock` で確認）。`--leader-socket` を隔離 root 内に向け、利用者の leader プロセスに繋がない。`HOME` も同時に置き換え、`~/.claude` 互換読み・project の AGENTS.md/skills（`--cwd` は検証済み空 dir）・memory が届かない。
- 組み込み tool を全部外すのは `--tools` の空指定ではできない（内蔵文書: 何も指名しない entry は他を残して警告するだけ）。shell route の id（`run_terminal_cmd`・`task` 等）・表示名（`spawn_subagent`・`CallMcpTool` 等）・daemon route 名・`Agent` を `--disallowed-tools` で全列挙する。未知 entry は警告だけで何も残さないため過剰列挙は安全。`--max-turns 1`・`--no-subagents`・`--no-plan`・`--disable-web-search`・`--prompt-file`（stdin 空）・`--verbatim` を付け、`--always-approve` や permission bypass は使わない。
- 出力は `--output-format streaming-json`（`text` 蓄積・`end.usage` の input/output/cache_read/cache_creation/reasoning、tool 系 event の検知で失敗。`--output-format json` には usage が無い）。ログイン状態は LLM を呼ばず `grok models`（未ログインは "You are not authenticated."）で出す。
- 特定できなかった部分: `streaming-json` の event 名の網羅（未知の非 tool 系は無視、tool 系は type 名と `tool_use`/`tool_result` block で検知）、`--json-schema` の実機受理、`end.stopReason` の語彙（`end` 到達は成功扱い）。いずれも fake の子プロセスと cassette だけで検証し、実 grok 呼び出しは未実行（作業時は未ログイン）。

Codex は `-c model_reasoning_effort=<e>`（従来の argv）に加え、生成する model catalog の `default_reasoning_level` に要求の effort を入れる。`codex exec --help` に `--effort` flag は無く、`-c` override が 0.160.0 の検証済み profile と一致する。catalog だけでは古い版が effort を無視する可能性があり、`-c` だけでは catalog 既定が `low` のまま残るため両方で渡す。`ultra` は mitori の `ReasoningEffort` に無いため対象外。

追記の回帰: `scripts/nd bun test packages/agent/src/adapters/grok-policy.test.ts packages/agent/src/adapters/grok-engine.test.ts packages/agent/src/adapters/adapters.test.ts packages/agent/src/adapters/codex-engine.test.ts`、`scripts/nd bun test packages/server/src/settings/settings.test.ts`、`scripts/nd bun test apps/web/src/settings/provider.test.ts`、`scripts/nd bunx --no-install tsc -b packages/agent packages/server --pretty false`（いずれも成功。daemon/client の socket・HTTP 系は sandbox の bind 制限で環境要因、ホストで再実行）。

追記の回帰: `scripts/nd bun test packages/agent/src/adapters/generic-http.test.ts`（8件成功）、`scripts/nd bun test packages/server/src/settings/settings.test.ts`（19件成功、接続切替・rollback を含む）、`scripts/nd bunx --no-install tsc -b packages/agent packages/server --pretty false`（成功）。

- 検証対象: Muse Code `1.4.2-R4684.1`、2026-10-04、この Mac。`exec --help` で上記 option、モデル profile で `max` 対応を確認。`config status` の enterprise defaults/policy はこの機械では absent。
- 無償 `--provider echo` では通常起動と `--preset native-basic` の両方に自動リマインダーが現れた。固定 gate 後は 13 JSONL records、reminder child run 0。native-basic 自体を lean の保証として採用しない。
- 管理 SessionStart hook の canary は安全 flag だけでは実行された。管理ファイルの override 後は canary 未実行、hook record 0、reminder record 0、terminal completed。echo の本文・terminal envelope は実測済み。
- bounded 実 provider probe は `OK`、16 records、configured `model_id: muse-spark-1.3-contributor`、hook/tool/reminder 0。usage と observed effort は記録に含まれない。`model-profile show muse-spark-1.3-contributor --effort max` の受理と spawn argv の `--reasoning-effort max` を確認した。81 in / 2 out / USD 0.000009 は本文推計であり実請求額ではない。
- 修復ケースの初回は `tool.read_file` を実際に提案した。`--disable-shell/write/web-tools` は読み取り tool を除かないため、guard は維持して上記隔離設定を追加した。無償 echo の retained record で model request の toolset が `source: settings / mode: named / active_tools: []`、terminal completed を確認した。禁止の prompt だけで無ツール起動を保証していない。
- 隔離設定後の実修復は2 completed terminal、task/operation は `model.meta.response` のみ。go-vet失敗後の修復で3ゲートが成功し、最後はrejectでユーザーtreeを維持した。generic の追加contextは初回/repair/reviseを通して1 job 1回、同じWRITEファイル・current head・既存30行hintとbudgetに限定する。無償回帰で初回/repairを確認した。証跡と限界は `docs/progress/continuation-live.md`。
- 実行ファイルを更新した際、企業管理設定が加わった際は同じ canary と usage 検証を再実施する。echo は LLM の実生成品質・費用を検証しない。
- 回帰確認: `scripts/nd bun test packages/agent/src/adapters/adapters.test.ts`。

## 2026-11-03 追記: thinking 予算と実行全体上限（WP36b）

実測（ai-job-search・11タスク、オーケストレーターがホストで実生成）: effort high の呼び出しは thinking 4〜7k tokenを報告するのに、見積もりと出力上限は本文の長さだけだった。Claude CLI は thinking が `CLAUDE_CODE_MAX_OUTPUT_TOKENS`（= GenCall.maxOutTokens）を使い切って本文が出ず `E_GEN_COVERAGE_LOW`、Codex は thinking 込みの実績が見積もり超過で `E_BUDGET_EXCEEDED` となり、返ってきた結果（費用支払い済み）を捨てていた。

- native thinking は hard cap できない（本 ADR の前提は維持）。代わりの方針: タスク単位の見積もり超過を理由に返ってきた結果を捨てない。結果は採用し、超過分を ledger（実績 usage + 見積もりの行は既存の形）と run の report（`gen_tasks.metrics.overrunUsd`）に記録する。守るのは利用者が確認した実行全体の上限で、次のタスクを始める前に「使った額 + 実行中タスクの予約額 + 次の見積もり ≤ 上限」を確かめ、超えるなら新しいタスクを始めず run を `budget` で止める（実行中のものは終わらせて採用する）。1タスクが自分の見積もりの 4 倍を超えたら以降のタスクを止める（暴走の歯止め、そのタスク自身は採用）。codex-cli の admit フック（native preflight による精密な事前予約）は残し、pump 側の粗い見積もりチェックは他 engine のみにする。価格不明の Codex モデルは起動前に拒否のまま。
- 見積もりと上限には effort ごとの thinking 予算を1呼び出しごとに入れる（low 1,024 / medium 4,096 / high 8,192 / xhigh 16,384 / max 32,768、`THINKING_BUDGET_TOKENS`）。ledger の EMA は入力 token しか校正しないため thinking 予算は固定のままで、既存の校正には載せない。Claude CLI の上限（`CLAUDE_CODE_MAX_OUTPUT_TOKENS` を決める箇所。thinking を別に上限指定する環境変数・flag は CLI 側になく、mitori の argv にも `--effort` 以外はない）は「本文の上限 + thinking 予算」とし、本文の分を必ず残す。
- Grok CLI（grok 1.0.70、ホスト実測の訂正）: `--tools ""` は受け付けられる（WP36 の「空指定では外せない」は旧版の内蔵文書の記述）ので argv に足し、denylist も残す。`--output-format json`（1つの JSON）を第一にし、`text` を本文、`usage` の input/cache_read/cache_creation/output/reasoning を usage に（reasoning は thinking）、`stopReason` は `end_turn` を正常・それ以外を打ち切り（budget 扱いで coverage retry へ）、`num_turns > 1` は失敗とする。`total_cost_usd` は ledger の参考値（`reportedUsd`、表示は mitori 単価のまま）。1呼び出しごとの固定入力 ≈ 18k〜25k token に対し見積もりに固定 20,000 token（`GROK_FIXED_INPUT_TOKENS`）を足す。`XAI_API_KEY` は子プロセスに渡さない（従量 API 課金に切り替わるおそれ。API 利用は `setup grok --api` の HTTP 経路）。pin 追従は Claude と同じく保存した `pin.path` の再解決で、`--version` と `grok --help` の能力確認（渡す flag が全部あること）を通ったときだけ追従する。

## Sources

2026-10-04 に [Muse Code Configuration and context](https://dev.meta.ai/docs/muse-code/configuration)（headless flags、user settings、managed config）と [Muse Code Developer Docs: Hooks](https://meta-models.github.io/muse-code-sdk/next/guides/extend/hooks/)（managed/user hook は project trust を要しない）を確認。[Extending Muse Code](https://meta-models.github.io/muse-code-sdk/next/guides/extend/) は MCP の旧表記も設定で受け付けると記載する。環境 gate と管理 hook override の効き方は公開仕様ではなく上記バージョンのローカル実測による。

2026-10-06 に [xAI Chat Completions](https://docs.x.ai/developers/rest-api-reference/inference/chat-completions)、[Ollama OpenAI compatibility](https://docs.ollama.com/api/openai-compatibility)、[LM Studio Chat Completions](https://lmstudio.ai/docs/developer/openai-compat/chat-completions) を確認。xAI は新規接続で Responses API を推奨するが、ここでは三者に共通する現行 Chat Completions を使用する。
