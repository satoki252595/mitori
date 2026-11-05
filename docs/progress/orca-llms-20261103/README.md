# Orca の LLM 対応（2026-11-03〜04）

利用者の依頼（2026-11-03）:「他の人に配る上で足りないものやこの orca で使っている LLM を利用できるようにして欲しい。設計は orca、実装やテストは muse で実行」。設計はオーケストレーター（Claude）、実装・テストは Muse（muse-spark-1.3-contributor）。opencode は Mac に無く対象外。Orca 1.4.230 の `agent-model-catalog.json` の agent は claude・codex・grok。

## マージした PR

- #26: 同じ名前のファイルの区別。ビューアー JS は rebase 後 60,058 B で予算（60,000 B）超過 → 59,447 B。
- #28: MCP ツール・Rust ルートを入口に。
- #32: v0.1.0 の配布の仕組み。tag `v*` で 4 OS のアーカイブ・SHA256SUMS・build provenance・Release の下書き。workflow_dispatch は試運転。
- #33: ホストと同じ target のバイナリが Nix の loader を参照していた問題。CI で作った linux-x64 が Nix の外で `cannot execute: required file not found`。公式 Bun runtime を sha256 固定で使い、`/nix/store` 参照を build で拒否。
- #34: Orca の LLM 対応（下の内容）。

## 配布の試運転（release.yml の workflow_dispatch）

build・4 つの verify（ubuntu-24.04 x64、ubuntu-24.04-arm、macos-15、windows-2025 で `--version` と `doctor`）がすべて成功。tag はまだ作っていない（公開は人の判断）。macOS バイナリは未署名・未公証（Apple Developer Program が年 $99 で承認が要る）。

## #34 の内容

- Claude に `claude-haiku-5-5`・`claude-fable-5-1`、価格を 2026-11-03 の公式表に（Sonnet 5.5 の cache read 0.2→0.10 の誤りを修正、Haiku 5.5 は入力 100k 超で上の段）。
- Codex に effort を渡す、モデルごとの価格。effort ごとの thinking 予算を見積りと出力上限に入れる。
- 見積り超過で結果を捨てず、実行全体の確認済み上限で止める。
- Grok Build CLI の engine（`grok-cli`、`grok:<model>`）。
- `setup claude` の既定 effort は high。

## 実生成（ai-job-search、11 タスク、concurrency 2）

L1 は主張と出典の一致（vacuous を除く）。

| 構成 | 修正前 | 修正後 |
|---|---|---|
| Muse high（比較） | 11/11、L1 99.1 %、4.1 分 | — |
| Claude Sonnet 5.5 low（旧 setup 既定） | 11/11、L1 84.2 %、1.7 分 | — |
| Claude Sonnet 5.5 high | 7/11（下の E1） | 11/11、L1 95.2 %、7.0 分 |
| Codex gpt-5.6-luna high | 3/11（下の E2） | 11/11、L1 85.5 %、9.5 分 |
| Grok grok-4.7-build-fast low | — | 11/11、L1 95.9 %、12.7 分、報告額 $2.85 |

- E1: thinking が出力上限を使い切り本文なし（`E_GEN_COVERAGE_LOW`）。
- E2: 見積り超過で結果を破棄（`E_BUDGET_EXCEEDED`）。

## Grok で分かったこと（grok 1.0.70）

1. `enter_plan_mode` だけを外すとセッションが作れない。
2. `--tools ""` と旧 denylist では `write` など 22 個の組み込みツールが残り、モデルがファイルを書こうとした（許可待ちで止まり実害なし）。
3. X 検索はサーバー側のツールで、オプションでは消えない。repo 名が X 検索に送られた（1 回）。隔離 `config.toml` の `features.backend_tools = false` で止まる。
4. grok-4.7 は mitori のプロンプトで推論が長い（gen.module 1 件: low 355 秒、medium は 20 分でも本文 0 字。build-fast low は 117 秒）。`max_completion_tokens` は推論を止めない。
5. キャンセル時に grok の子プロセスが取り残された（修正済み）。
6. 既定は build-fast・low、timeout 最低 900 秒。
7. 価格は grok の報告額からの逆算（build-fast in 4 / out 12、grok-4.7 in 2 / out 6）。

## 費用（API 換算）

Grok は実験を含めて約 $10。Claude と Codex はサブスク枠。

## 判断

- 見積り超過は結果の破棄ではなく実行全体の上限で止める（E2 の再発防止）。
- thinking 予算は見積りと出力上限に入れる（E1 の再発防止）。
- Grok の既定は build-fast・low、timeout 最低 900 秒（medium 以上は 1 タスク 10 分超えあり）。
- Grok Build CLI の単価は公式表ではなく報告額からの逆算と明示する。
- 残件は [HANDOFF](../../HANDOFF.md) §3 の通り。`setup` は人の端末でのみ動く。tag と公開、署名・公証は人の判断。

## 2026-11-05: モデル選択と Gemini

WP39（モデル選択）と WP40〜40h（Gemini 対応）の記録。

### WP39: provider ごとのモデルと effort の選択（8cec3b7）

- モデル一覧は core の MODEL_CATALOG に 1 か所（id・effort・既定 effort・単価）で持ち、setup・web・server が同じ表を使う。
- setup は `mitori setup <provider> --list-models` で選べる一覧を出し、モデルが受けない effort は使い方エラーになる。
- web のクイックセットアップはモデル select（未登録の値を書く独自欄付き）で、effort の選択肢は選んだモデルが受ける範囲に絞られる。設定画面の「モデルと推論の強さ」は設定済み engine の中で生成用と回答・修正用のモデルと effort を切り替える（実行ファイルや単価は変えない）。
- server は切り替えを検証する（checkModelSwitch）：未設定の engine・一覧に無いモデル・単価の無いモデル・モデルが受けない effort は拒否する。一覧に載り単価が分かるモデルは web の単発コマンドで --in-price/--out-price が要らなくなった。
- `setup claude` の既定 effort は high のまま。

### WP40〜40h: engine antigravity-cli（agy 経由の Gemini、サブスク）（7e1ae84〜0b0aebb）

- engine antigravity-cli は Antigravity CLI の `agy` を呼んで Gemini を使う。Antigravity 本体のログイン（サブスク）を使い、API キーは要らない。認証は macOS のキーチェーンのため macOS のみ。
- 隔離は呼び出しごとの一時 HOME（中身は本物の `~/Library/Keychains` への `Library/Keychains` の symlink だけ）と空の作業ディレクトリ（中身はツールなし agent 定義 `.agents/agents/mitori-text.md` だけ、frontmatter は `tools: []`）で、どちらも呼び出し後に消す。prompt は argv に載せず stdin に stream-json の 1 行で書いて閉じる（`ps` に出ない）。`mitori setup antigravity --cli`（既定 `antigravity:gemini-3.8-flash`・low）と `--list-models`。モデルは `antigravity:gemini-3.8-flash`・`antigravity:gemini-4-argon`、effort は low/medium/high。生成と回答だけに使い、agent と patch は拒否のまま。
- fail closed の条件：tool の step、`denied_actions` の非空、`result.status` の非 SUCCESS、未知の agent、stream と `result.response` の不一致、`error_message` の step はすべてその turn を失敗にする。`result.response` が本文（WP40g 前は usage 付き最終行の text が落ちていた）。
- ホストで見つかった実物との食い違いと直し：
  - agent 定義の frontmatter の `name` が `--agent` とずれると `unknown agent` で拒否される。
  - Nix の safe PATH では `ln` が coreutils の multi-call になり、解決した実体を起動すると argv[0] が `coreutils` で link が失敗する。`/bin/ln` を固定し、失敗時は exit code と stderr の先頭を付ける（WP40e）。
  - agy 1.4.12 の `--help` は stdout が空で stderr に出るため detect が動く実行ファイルを拒んでいた。stderr を読む（WP40f）。
  - 本文の欠け：usage 付き最終 `agent_response` 行の text が本文に入らず落ちていた。`result.response` を本文にし、stream 連結との不一致は失敗にする（WP40g）。
  - result 後に終わらない：70〜100KB の prompt でも agy は約 30 秒で SUCCESS の `result` を出した後に終了処理で残り、mitori は exit 待ちで 900 秒の timeout になっていた。`result` で turn を終わりとし、stdin を閉じて 2 秒待ち、残ればプロセスグループに SIGTERM、さらに 8 秒で SIGKILL する。SUCCESS の停止は成功扱い（WP40h）。
  - テストの fake は実物の記録の再生にした：`packages/agent/test/fixtures/agy-1.4.12`（path と OAuth の nonce は mask）に `--help`・`--version`・`--models`・成功時 stdin・tool-step・auth 欠けの記録を置き、host-only の live test で detect と 1turn を通す（WP40f）。
- `tools: []` の agent でも `manage_task` だけは呼べて実行される（`{"Action":"list"}` に回答）。`search_web`・`read_url_content`・`view_file`・`invoke_subagent`・`ask_question` は使えないと答えて呼ばれなかった。mitori は tool の step で fail closed するため結果は捨てられる（正しい）。ADR-0015 に残した（WP40h）。

### live 結果（ai-job-search 11 タスク、concurrency 2、Gemini 3.8 Flash/low）

L1 は主張と出典の一致（vacuous を除く）。

| 構成 | 結果 | L1 一致 | 時間 | API 換算 |
|---|---|---|---|---|
| Muse high（比較） | 11/11 | 99.1 % | 4.1 分 | — |
| Claude Sonnet 5.5 high | 11/11 | 95.2 % | 7.0 分 | サブスク枠 |
| Codex gpt-5.6-luna high | 11/11 | 85.5 % | 9.5 分 | サブスク枠 |
| Grok grok-4.7-build-fast low | 11/11 | 95.9 % | 12.7 分 | 報告額 $2.85 |
| Gemini gemini-3.8-flash low | 11/11 | 93.6 %（102 pass/7 fail） | 190.7 秒 | 換算 $0.539（サブスクのため請求なし） |

- Gemini の 11/11 のうち 1 タスクで 8 行が生成できず（`E_GEN_OUTPUT_INVALID`、dropped 8）。
- Gemini の単価は第三者のまとめの高いほうで、公式表は未確認（2026-11-04）。Argon in$4/out$20/cache 読み $0.20（12/1 からの正規値段で 11/30 までは $2/$10）、Flash in$1.50/out$7.50/cache 読みは入力の 0.1 倍（2027-01-01 の値段で今は $0.75/$3.75）、thinking は出力扱い。

### サンドボックスのブラウザ起動とゲート（WP40g）

- サンドボックスでブラウザを起動すると GUI 登録で abort し、ホストにクラッシュレポートが残った（2026-11-04 に Chrome 6 件・WebKit 3 件）。
- `browsersAllowed()`（`MITORI_NO_BROWSERS=1` で false）がブラウザを起動する bun test と `test/int/shots` の駆動を守り、`bun run check` の check-browsers が起動箇所の参照を検査する。
