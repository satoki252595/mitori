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
- 組み込み tool を全部外すのは `--tools ""` の空指定と `--disallowed-tools` の併用で行う（WP36 の「空指定では外せない」は旧版の内蔵文書の記述で、1.0.70 の実機では空指定が受け付けられる）。denylist は実機の `available_commands` が報告する 22 個そのままに plan-mode の出入りの pair を加えた 24 個にする。旧 denylist は実在しない id を含み（8 個が「no tool, so they remove nothing」と警告されるだけ）、`write` を外せていなかった。未知 entry は警告だけで何も残さないため、実在しない名を足しても害はないが、実測と一致させる。`--max-turns 1`・`--no-subagents`・`--no-plan`・`--disable-web-search`・`--prompt-file`（stdin 空）・`--verbatim` を付け、`--always-approve` や permission bypass は使わない。
- 出力は `--output-format streaming-json`（1 行 1 event。`available_commands`（空であること）・`thought`（無視）・`text`（連結して本文）・`usage`（input/cache_read/cache_creation/output/reasoning、reasoning は thinking。input は非キャッシュ分で cache_read と並ぶ）・`end`（`stopReason`、`end_turn` が正常）を扱う。`available_commands` の `tools` が空でない event を見たら子プロセスをその場で止めて失敗にする（fail-closed: 新しい grok が tool を足してもモデルに渡る前に止まる。要更新の旨を日本語メッセージで返す）。tool・permission を名に含む type の event と stderr の `permission required:` は tool 実行として失敗にする。それ以外の未知 event は無視する。`--output-format json` は複数行に整形された 1 つの JSON になり行ごとの fold では読めないため使わない。ログイン状態は LLM を呼ばず `grok models`（未ログインは "You are not authenticated."）で出す。
- 特定できなかった部分: `--json-schema` の実機受理、`end.stopReason` の語彙（`end` 到達は成功扱い）。`streaming-json` の event 名は 1.0.70 の実機出力で確認した（`available_commands`・`thought`・`text`・`usage`・`end`）。いずれも fake の子プロセスと cassette だけで検証し、実 grok 呼び出しは未実行（作業時は未ログイン）。

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
- Grok CLI（grok 1.0.70、ホスト実測の訂正、WP36e）: 旧 argv（旧 denylist + `--output-format json`）では組み込み tool が実際には外れていなかった。モデルは `write` を使おうとし（"I'll write `PWNED` to that file with the write tool."）、headless の既定許可が `permission required: Write <path>` で止めていた。`--tools ""` は受け付けられるので argv に残し、denylist は実機の `available_commands` が報告する 22 個（`run_terminal_command`・`read_file`・`search_replace`・`list_dir`・`grep`・`kill_command_or_subagent`・`todo_write`・`get_command_or_subagent_output`・`scheduler_create`・`scheduler_delete`・`scheduler_list`・`monitor`・`search_tool`・`use_tool`・`workflow`・`ask_user_question`・`send_feedback`・`image_gen`・`image_edit`・`image_to_video`・`reference_to_video`・`write`）に plan-mode の出入りの pair を加えた正確な 24 個にした。実在しない名 8 個（旧 denylist 由来の警告）は外した。出力は `--output-format streaming-json`（1 行 1 event。`available_commands`・`thought`・`text`・`usage`・`end`。`--output-format json` は複数行整形の 1 JSON で行 fold では読めない）。`usage` の input は非キャッシュ分で cache_read と並ぶ（実測 661 + 3,200 ≈ 3,900）。`available_commands` の `tools` が空でない event を見たら子プロセスをその場で止めて `E_AGENT_PROTOCOL` で失敗にする（fail-closed。メッセージは「grok <version> に mitori が知らないツールがあります（名前一覧）。mitori の更新が必要です」）。この 24 個での実測は `available_commands` がすべて `[]` で 1 呼び出しの固定入力 ≈ 3,900（661 + cache read 3,200）のため、見積もりの固定加算は 4,000 token（`GROK_FIXED_INPUT_TOKENS`、キャッシュ読みを含む）に下げた。`stopReason` は `end_turn` を正常・それ以外を打ち切り（budget 扱いで coverage retry へ）、`num_turns > 1` は失敗とする。`XAI_API_KEY` は子プロセスに渡さない（従量 API 課金に切り替わるおそれ。API 利用は `setup grok --api` の HTTP 経路）。pin 追従は Claude と同じく保存した `pin.path` の再解決で、`--version` と `grok --help` の能力確認（渡す flag が全部あること）を通ったときだけ追従する。

## 2026-11-03 追記: Grok backend ツールの無効化と fail-closed（WP36f）

WP36e の argv（`--tools ""`・24 個の `--disallowed-tools`・`--disable-web-search`）では、grok 1.0.70 のサーバー側（backend）ツールは消えない。ホスト実測（ai-job-search、11 タスク）: 2/11 成功、9 件が `E_AGENT_EXIT: grok exited with code 130 and no terminal end record`（retryable: true）で 39 分。同じ argv で 34 KB の要約プロンプト（effort high）を手で流すと 197 秒・exit 0 だが、streaming-json に `tool_call`（`toolName: "X search:"`、`rawInput: {variant: XSearch, backend: true}`）が 3 回出る（`x_keyword_search` で `repo:MadsLorentzen/ai-job-search`、`x_semantic_search`、`x_thread_fetch`）。`available_commands.tools` は `[]` のまま。repo 名が外部の検索に送られている。`~/.grok/docs/user-guide/14-headless-mode.md:54` によれば `XSearch` という名前が効くのは daemon route だけで、CLI の flag では backend ツールに届かない。

対策は呼び出しごとの隔離 `config.toml` の内容（1 か所の定数 `GROK_ISOLATED_CONFIG_TOML`）:

```toml
disable_web_search = true

[features]
backend_tools = false
session_search = false
write_file = false
web_fetch = false
image_gen = false
video_gen = false
ask_user_question = false
feedback = false
telemetry = "off"
campaigns = false
codebase_indexing = false
session_recap = false
turn_summary = false
title_refresh = false
auto_wake = false
```

各キーの意味は `~/.grok/docs/user-guide/26-config-reference.md` の `features` 表（`features.backend_tools`: "Enable or disable backend_tools. Default true. Also GROK_BACKEND_SEARCH."）。同じ argv・同じ種類のプロンプトで tool_call は 0 回、86 秒・exit 0、本文 7,391 文字、usage `input 8,643 / cache read 2,048 / output 5,167 / reasoning 1,217`。出力速度は約 60 token/秒。

fail-closed の方針（`packages/agent/src/adapters/grok-engine.ts`）: `tool_call`（`tool_call_update` を含む）・`server_tool_use` 相当の event を 1 つでも見たら、その場で子プロセスに SIGINT して失敗にする。エラーは retry しない種類（`E_AGENT_PROTOCOL`、同じプロンプトは再びツールを使う）で、メッセージに tool の名前を入れる（例: 「grok がツール "X search" を使おうとしたので止めました」）。timeout で止めたときは「grok が時間内（N 秒）に終わりませんでした」と分け、どちらも 130 の一般的な文面にしない。mitori 自身の kill は end record を残さず子は 130 で死ぬため、停止理由（cancel/timeout）の判定を `!ended` の exit-130 分岐より前に置く（従来は timeout が `E_AGENT_EXIT` に誤分類されていた）。止めた呼び出しの usage は、grok が usage を報告していなければ 0 にする（報告があれば採用。WP36d の方針を timeout・tool 停止にも適用）。

grok の時間（`packages/gen/src/planner/params.ts`・`execute.ts`・`runner.ts`）: gen の見積もりと timeout は grok 用の出力 50 token/秒（実測 60 に対する保守値、`GROK_OUTPUT_TOKENS_PER_SEC`）を使う。1 呼び出しの timeout は「見積もり時間の 3 倍、最低 600 秒（WP36g で 300 秒から引き上げ）、最大は settings の `turnMs`（既定 900 秒、`GROK_DEFAULT_TURN_MS`。WP36g で generate 期限 600 秒から変更）」。`run.turnMs` は runner が grok-cli の settings から運ぶ。`setup grok --cli` の既定 effort は `medium`（high は thinking が多いと 300 秒を超える実測のため、WP36g で変更）。見積もりの thinking 予算は grok-cli high だけ 12,000 token（実測最大 10,836 に対応）、medium 以下は WP36b の既定のまま。

live テスト（`MITORI_LIVE=1`、ホストのみ）に 1 件追加: 「まず X とウェブで調べてから答えて」と頼んでも tool_call が出ない（出たら engine が止める）こと。live helper も本番と同じ定数の config を書く。

追記の回帰: `scripts/nd bun test packages/agent/src/adapters/grok-policy.test.ts packages/agent/src/adapters/grok-engine.test.ts packages/gen/src/orchestrator/execute.test.ts packages/gen/src/planner/planner.test.ts`、`scripts/nd bun run check`、`scripts/nd bun run golden`。実 LLM は呼ばない（live テストと実生成はホスト）。

## WP36h: grok の生成は「推論が長すぎる」（2026-11-03 ホスト実測）

同じ 82 KB tools プロンプトを同じ隔離設定・同じ argv で手流し: grok-4.7 low 355 秒（reasoning 21,540）/ medium 20 分で未完（本文 0 字、推論要約 11 万字）/ build-fast low 117 秒（reasoning 10,749）/ medium 569 秒（reasoning 64,045）。grok は mitori の規則の多いプロンプトで本文全体を推論の中で何度も書き直す。止まっていたのではなく推論を流し続けていた。報告額からの逆算単価: grok-4.7 は in 2 / out 6、build-fast は約 in 4 / out 12（USD/百万 token、公式表ではない）。`[models] max_completion_tokens = 6000` は組み込みモデルの推論を止めない。

決定: `mitori setup grok --cli` の既定はモデル `grok-4.7-build-fast`・effort `low`（`--model grok-4.7` は選択可）。既定価格は build-fast が in 4 / out 12 / cache read 1、grok-4.7 が in 2 / out 6 / cache read 0.5（grok の報告額からの逆算、公式表ではない）。見積もり用 thinking 予算は grok-cli の low 12,000 / medium 64,000 / high 64,000。1 呼び出し timeout は 3×見積もり・最低 900 秒・上限 `turnMs`（既定 900 秒→1,200 秒）。setup と Web で grok に medium 以上を選ぶと「生成が非常に長くなる（1タスク 10 分以上）」と警告する（止めない）。

取り残しの子プロセス: 実生成のキャンセル後、mitori が起動した grok の子が PPID 1 で動き続けた。daemon 停止・run キャンセル・タスク timeout で grok の子（とその子）を必ず止める。spawn はプロセスグループ（`processGroup: true`、SIGKILL はグループへ届く）で、grok engine は claude-cli と同じく live の子を追い、`closeAll`（scheduler drain 経由）で SIGINT→grace→SIGKILL する。run キャンセル・timeout の既存経路は変えない。他 engine も fake の子で「キャンセル後に子が残らない」を確かめる。

追記の回帰: `scripts/nd bun test packages/agent/src/adapters/grok-engine.test.ts packages/agent/src/adapters/codex-engine.test.ts packages/agent/src/adapters/adapters.test.ts apps/cli/src/commands/setup.test.ts apps/web/src/settings/provider.test.ts packages/gen/src/planner/planner.test.ts packages/gen/src/orchestrator/execute.test.ts packages/server/src/settings/settings.test.ts`、`scripts/nd bun run check`、`scripts/nd bun run golden`。実 LLM は呼ばない。

## WP40: Gemini を Antigravity CLI（agy）経由で使う（2026-11-04 ホスト実測）

- 呼び出しは `--input-format stream-json --output-format stream-json --model <id-effort> --agent mitori-text --disable-slash-commands -p=`（`-p=` が最後。後ろに flag を置くと prompt と誤読する）。prompt は argv に載せず、stdin に 1 行 `{"event":"user","message":{"content":"<prompt>"}}` を書いて閉じる（ホスト確認済み）。
- 1 行 1 JSON: `init`（`tools` は 60 個のまま並ぶので当てにしない）、`step_update`（`agent_response` の `text_delta` を連結したものが本文。`tool` など他 `step_type` は fail-closed）、`result`（`status`・`response`・`usage{input_tokens,output_tokens,thinking_tokens,cache_read_tokens}`・`denied_actions`）。
- 隔離は呼び出しごとの一時 HOME（中身は `Library/Keychains` → 本物の `~/Library/Keychains` の symlink だけ。認証は macOS のキーチェーン）と空の作業ディレクトリ（中身は `.agents/agents/mitori-text.md` だけ。frontmatter `tools: []`・`mainAgent: true`・`subagent: false`、`--agent mitori-text`）。入力の固定分は約 2,200 トークン（本物の HOME だと 10,000〜15,500）。
- モデルは `gemini-4-argon`・`gemini-3.8-flash`、effort は low|medium|high（id の末尾）。既定 `gemini-3.8-flash`・effort low（速さ優先）。価格は第三者のまとめの上限側の値（公式表は未確認）: Argon in $4 / out $20 / cache 読み $0.20、Flash in $1.50 / out $7.50 / cache 読み 0.1×入力。thinking は出力として数える。
- 認証が無いと stderr に Google のログイン URL を出して 60 秒待つ → URL を見たら子をすぐ止めて `mitori auth antigravity` を案内する（待たない）。

追記の回帰: `scripts/nd bun test packages/agent/src/adapters/antigravity-policy.test.ts packages/agent/src/adapters/antigravity-engine.test.ts packages/agent/src/adapters/antigravity-live.test.ts apps/cli/src/commands/setup.test.ts apps/web/src/settings/provider.test.ts packages/web/src/map/map.test.ts packages/gen/src/planner/planner.test.ts packages/gen/src/orchestrator/execute.test.ts packages/server/src/settings/settings.test.ts`、`scripts/nd bun run check`、`scripts/nd bun run golden`。live 以外は実 LLM を呼ばない。

## WP40h: agy は result の後に終わらない・error_message・manage_task（2026-11-05 ホスト実測）

ai-job-search の live 生成（gemini-3.8-flash / low）で S5 module の 3 件が `E_AGENT_TIMEOUT`（900 秒）になった。section は 10〜30 秒で終わっていた。agy の入出力を記録して調べた（記録は手元だけ、リポジトリには入れない）:

- module の prompt（72〜100 KB）でも、agy は 24〜33 秒で `{"event":"result","result":{"status":"SUCCESS",...}}` を出す。その後プロセスが終わらない（stdin はファイルで EOF 済みでも 2 分以上残る）。agy のログ: `Print mode: stream input closed after 1 turn(s)` → `CLI store manager shutting down` → `Stopping conversation stream` のあと止まる。SIGTERM で `Got signal terminated, shutting down` → 約 5 秒後に `Language server shutdown timed out` で終わる。
- 短い prompt（overview・section）では result の直後に終わる。agy 側の終了処理のハングで、mitori は exit を待って 900 秒で timeout にしていた。
- 長い live 実行中に Mac がスリープすると、agy の通信が `connection reset by peer` で切れ、`error_message` ステップと再試行が続いた（環境要因。mitori の不具合ではない）。

決定:

1. `result` イベントを受け取ったらその turn は終わりとする。stdin を閉じ、2 秒待って終わらなければプロセスグループに SIGTERM、さらに 8 秒で SIGKILL（tool KillPolicy の SIGTERM → 2 s と engine の grace 8 s。`packages/agent` の engine は注入された Timers port で待つため、`packages/platform` の `stopChild` は直接使わず同じ方針を実装する）。`result.status` が SUCCESS なら停止は成功扱い（exit code で失敗にしない）。停止したことは debug ログ（`agent.antigravity.result_shutdown`）に残す。
2. `result` の前に exit した、`result` が来ないまま turnMs を超えた、は今まで通り失敗。
3. `step_type:"error_message"` は失敗の前兆として扱い、`result` が SUCCESS でも本文を使わず失敗にする（retryable の `E_AGENT_EXIT`）。fixture に無いため、実物の形 `{"event":"step_update","step_update":{"conversation_id":"…","step_index":2,"state":"DONE","step_type":"error_message","duration_seconds":0}}` を元にした変種で回帰する。
4. 別件の安全事実: `tools: []` の agent でも `manage_task` だけは呼べて実行される（`{"Action":"list"}` → "No background tasks are currently running."）。`search_web`・`read_url_content`・`view_file`・`invoke_subagent`・`ask_question` は使えないと答えて呼ばれなかった。mitori は tool ステップで fail closed するので結果は捨てられる（正しい）。

追記の回帰: `scripts/nd bun test packages/agent/src/adapters/antigravity-policy.test.ts packages/agent/src/adapters/antigravity-engine.test.ts`、`scripts/nd bun run check`、`scripts/nd bun run golden`。live はオーケストレーターが実行する。

## Sources

2026-10-04 に [Muse Code Configuration and context](https://dev.meta.ai/docs/muse-code/configuration)（headless flags、user settings、managed config）と [Muse Code Developer Docs: Hooks](https://meta-models.github.io/muse-code-sdk/next/guides/extend/hooks/)（managed/user hook は project trust を要しない）を確認。[Extending Muse Code](https://meta-models.github.io/muse-code-sdk/next/guides/extend/) は MCP の旧表記も設定で受け付けると記載する。環境 gate と管理 hook override の効き方は公開仕様ではなく上記バージョンのローカル実測による。

2026-10-06 に [xAI Chat Completions](https://docs.x.ai/developers/rest-api-reference/inference/chat-completions)、[Ollama OpenAI compatibility](https://docs.ollama.com/api/openai-compatibility)、[LM Studio Chat Completions](https://lmstudio.ai/docs/developer/openai-compat/chat-completions) を確認。xAI は新規接続で Responses API を推奨するが、ここでは三者に共通する現行 Chat Completions を使用する。
