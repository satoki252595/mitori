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

- 検証対象: Muse Code `1.4.2-R4684.1`、2026-10-04、この Mac。`exec --help` で上記 option、モデル profile で `max` 対応を確認。`config status` の enterprise defaults/policy はこの機械では absent。
- 無償 `--provider echo` では通常起動と `--preset native-basic` の両方に自動リマインダーが現れた。固定 gate 後は 13 JSONL records、reminder child run 0。native-basic 自体を lean の保証として採用しない。
- 管理 SessionStart hook の canary は安全 flag だけでは実行された。管理ファイルの override 後は canary 未実行、hook record 0、reminder record 0、terminal completed。echo の本文・terminal envelope は実測済み。
- bounded 実 provider probe は `OK`、16 records、configured `model_id: muse-spark-1.3-contributor`、hook/tool/reminder 0。usage と observed effort は記録に含まれない。`model-profile show muse-spark-1.3-contributor --effort max` の受理と spawn argv の `--reasoning-effort max` を確認した。81 in / 2 out / USD 0.000009 は本文推計であり実請求額ではない。
- 修復ケースの初回は `tool.read_file` を実際に提案した。`--disable-shell/write/web-tools` は読み取り tool を除かないため、guard は維持して上記隔離設定を追加した。無償 echo の retained record で model request の toolset が `source: settings / mode: named / active_tools: []`、terminal completed を確認した。禁止の prompt だけで無ツール起動を保証していない。
- 隔離設定後の実修復は2 completed terminal、task/operation は `model.meta.response` のみ。go-vet失敗後の修復で3ゲートが成功し、最後はrejectでユーザーtreeを維持した。generic の追加contextは初回/repair/reviseを通して1 job 1回、同じWRITEファイル・current head・既存30行hintとbudgetに限定する。無償回帰で初回/repairを確認した。証跡と限界は `docs/progress/continuation-live.md`。
- 実行ファイルを更新した際、企業管理設定が加わった際は同じ canary と usage 検証を再実施する。echo は LLM の実生成品質・費用を検証しない。
- 回帰確認: `scripts/nd bun test packages/agent/src/adapters/adapters.test.ts`。

## Sources

2026-10-04 に [Muse Code Configuration and context](https://dev.meta.ai/docs/muse-code/configuration)（headless flags、user settings、managed config）と [Muse Code Developer Docs: Hooks](https://meta-models.github.io/muse-code-sdk/next/guides/extend/hooks/)（managed/user hook は project trust を要しない）を確認。[Extending Muse Code](https://meta-models.github.io/muse-code-sdk/next/guides/extend/) は MCP の旧表記も設定で受け付けると記載する。環境 gate と管理 hook override の効き方は公開仕様ではなく上記バージョンのローカル実測による。
