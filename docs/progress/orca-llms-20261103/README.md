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
