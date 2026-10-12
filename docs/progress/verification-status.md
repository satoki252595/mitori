# 検証状況（README から移動した記録）

> README は利用者の手順に絞り、各環境・各LLMの検証の詳細はここに置く。2026-10-11 時点の記述はそのまま残し、2026-10-12 の追加結果は末尾に追記する。

## 2026-10-11 時点の LLM 別の確認（旧 README より）

Ollamaの動作・回答品質はモデルとメモリ容量に依存します。今回の128GiB Macでは、取得済み`qwen3-coder-next:latest`（約51.7GB）で短い説明と出典を確認しました。小型の`qwen3:4b`は出力600token上限をthinkingに使い切り、本文が空になりました。`/no_think`を加えても同じ結果でした。設定が保存できたことと、実回答が成功したことを区別してください。[モデルごとの結果](docs/progress/startup-matrix-20261007/README.md)。

2026-10-11の本人環境では、Codex・Cursor・Grokと、共通設定を使うAntigravity 2.12.2で各8ツールの接続を確認しました。Codexは初回の隔離設定の失敗を保存し、検証用の子プロセスだけで他の連携を無効にして再確認しました。この接続確認でLLM要求・MCPツール実行・追加LLM費用は0です。**この4クライアントからの文書生成は未実行**です。[設定先と実クライアントでの確認](docs/progress/startup-matrix-20261007/README.md)。

## 2026-10-11 時点の対応環境と確認状況（旧 README より）

| 環境 | 状況 |
| --- | --- |
| macOS Apple Silicon | Nix・通常Bun 1.4.2の起動、実Codex/Muse/Ollama/LM Studioの短いExplain、Chrome実操作・CodexのOSS文書生成を確認。PR #17の全browser380件・共有2件・a11y8件が成功。[CI記録](docs/progress/remaining-20261011/ci.md) |
| Linux arm64 / Docker | frozen install、コンテナ内部の画面・設定プレビュー・MCP共通通信を確認。実LLM・ホストブラウザ接続は対象外 |
| Linux x64 | バイナリビルド・バージョン表示と既存CIを検証済み。今回のDocker起動確認はarm64 |
| Windows x64 | head89f228eaでNixクロスビルド・native対象14テスト・配布内6チェック成功。Git / shadowの自動起動・HTML保存・後始末、既存daemon再利用を確認。通常Bun起動・実LLM互換性は対象外 |

バイナリは`bun run build:bin`で実行環境向けに作ります。macOSは`dist/mitori-darwin-arm64`、Linuxは`dist/mitori-linux-x64`を直接実行できます。現在のコンパイル対象は上記3種類です。

Windowsの後続確認は2026-10-12 JST（実ログは2026-10-11 UTC）の[実Windows CI](https://github.com/satoki252595/mitori/actions/runs/38149209280)で成功しました。選択した14テスト・109 assertionsと製品のバージョン表示・自己診断6項目の結果で、Windowsの全操作や各LLMでの実生成を確認したものではありません。変更を含む[PR #15](https://github.com/satoki252595/mitori/pull/15)は通常merge `e34178c` でmainへ統合し、対象headのUbuntu CIも成功しました。

2026-10-11の確認状況です。**設定プレビュー**は設定を書かない`setup … --print`、**実回答**はmitoriの実Explain APIで本文と引用先を確認した結果です。

| LLM | Nix / 通常ローカル | 実利用の確認状況 |
| --- | --- | --- |
| Muse | 両方の設定プレビュー・実回答成功 | native 1.4.3、Contributor / max。現在の認証の課金先・サブスク枠は未確認 |
| Ollama | 両方の設定プレビュー・実回答成功 | `qwen3-coder-next:latest`の短いExplainのみ。`qwen3:4b`は上記の失敗あり |
| Claude Code | 両方の設定プレビュー成功 | CLIあり・ログアウト中。公式ログイン後の実回答は未確認 |
| LM Studio | 両方の設定プレビュー・実回答成功 | 取得済みGGUFで本文・引用を確認。有効引用各1件、不正0件、ローカル費用$0 |
| Codex | 両方の設定プレビュー・MCP接続・実回答成功 | native 0.160.0 / gpt-6.1-solでJev/m3e生成・ソース照合を確認。本人projectのMCPも8ツール確認。外部MCPセッションからの生成、請求額・契約残量は未確認 |
| Cursor | 両方の設定プレビュー・公式CLIのMCP接続成功 | 本人project設定で8ツールを確認。外部セッションからの文書生成は未実行 |
| Grok Build | 両方の設定プレビュー・公式CLIのMCP接続成功 | 本人project設定で8ツールを確認。公式ログイン状態は未確認、外部セッションからの文書生成は未実行 |
| Antigravity | 両方の設定プレビュー・公式アプリのMCP接続成功 | 本体2.12.2の共通設定で8ツールを確認。project設定の制約は上記参照。公式ログイン状態は未確認、外部セッションからの文書生成は未実行 |

LM Studioの確認は取得済みGGUF `qwen/qwen3.8-27b`によるNix・通常ローカルの短いExplainまでで、本格的な文書生成は未検証です。[実検証記録](docs/progress/remaining-20261011/lmstudio-explain.md)。

先行する隔離設定のCLI試験に加え、本人環境でも4クライアントのMCP接続を確認しました。既存設定を保ってmitoriを登録し、Codexは検証用の子プロセスだけで他の連携を無効にして初期化・8ツール取得、Antigravityは公式アプリのRefresh後の8ツール表示を確認しています。接続確認で認証操作・LLM要求・MCPツール実行は行っていません。Codex nativeの実回答・文書生成は別途確認した結果です。初回の接続失敗も検証記録に残しています。DockerではClaude/Muse CLI未導入を正しく表示し、他の設定プレビューとMCP共通通信を確認しました。DockerでLLM認証・推論は行いません。[起動・LLM別の検証記録](docs/progress/startup-matrix-20261007/README.md)、[前回のmock・UI回帰](docs/progress/onboarding-20261006.md)、[LLM起動条件](docs/design/adr/0015-configurable-llm.md)。

既存の3 OSS（m3e-canvas、jev-ultrafast、Laya）では実Muse生成とソース照合を行いました。無効な引用先は1,421件中0件でしたが、説明の省略・曖昧さは残ります。[以前の品質検証](docs/progress/oss-quality-2026-10-05/README.md)。追加のCodex検証ではJevの処理順序と上限値、m3eの変更先・4言語・省略寸法の補完を確認しました。弱い引用窓は残して記録しています。[最新の検証一覧](docs/progress/remaining-20261011/README.md)。

Chromium・Firefox・WebKitは既存CIで、実Chromeは設定と確定済み日本語検索を確認。実IME変換は本人の後日確認待ち、実Safariは今回の必須外です。

Go7kスキャンの最新正式中央値は1,554.114ms（8 Worker）で、上限1,500msは未達です。追加の最適化候補は改善を確認できず採用していません。[正式時間・メモリの結果](docs/progress/remaining-20261011/idx-performance-tiers.md)、[候補の比較と判断](docs/progress/remaining-20261011/idx-cold.md)。

リポジトリは公開（MIT、ルートの LICENSE）である。同梱する依存は [THIRD_PARTY_NOTICES.md](../../THIRD_PARTY_NOTICES.md) に載せる。

## 2026-10-12 の追加結果

- **トレンドOSS 3件の実生成（Muse high）**: rea・gods-eye-view・text-to-cad で全タスク完了・失敗0、出典の存在100 %、主張と出典の一致 92〜96 %。詳細と見つけた問題・修正は [trend-quality-20261012](trend-quality-20261012/README.md)。
- **外部クライアントからの実生成**: Antigravity（`agy` 1.3.3）と Cursor（`cursor-agent`）が「生成手順をコピー」の文面だけで準備→生成→取り込みを完走（coverage 100 %、対象repo無変更）。Grok Build は利用残高切れ（402）、Codex は利用上限（10/18 まで）で実行できず。
- **Go7k コールドスキャン**: 解析ワーカーのGC方針を変更し、正式ケース `idx.s01.cold.7kfiles` が中央値 1,431.5 ms（上限 1,500 ms 以内、目標 1,200 ms は WARN）。証跡は [gc-policy.json](trend-quality-20261012/gc-policy.json)。
- **React のピーク RSS**: 同じ日の同条件で旧方式 1,019.6 MB・新方式 1,005.9 MB とも上限 1,000 MB を僅かに超過（以前の記録は 986.7 MB）。今回の変更による悪化ではないが、Worker 8 本化以降の境界問題として残る。
- **実 IME**: Chrome での OS の日本語変換確定は、エージェントからは OS 入力を操作できないため未確認（利用者の後日確認待ち）。

## 2026-10-12 後半の追加結果

実装・調査は Muse（muse-spark-1.3-contributor・high）が各作業ツリーで行い、方針と重要な判断はオーケストレーター（Claude）が行った。

- **古い Bun での起動**: PATH 先頭の Nix 由来 Bun 1.3.13 で止まっていた。`scripts/start.ts` が新しい Bun を探して同じ引数で起動し直す。実機の Bun 1.3.13 で `bun run start -- --version` が成功。
- **実 IME は確認済みとして閉じる**: W3C UI Events と MDN の推奨ガードに照らし、実装（`apps/web/src/shell/ime.ts`・keys-controller・パレット・Composer）とテスト（`e2e/web/ime.pw.ts`、`ime.webkit.pw.ts`）が全項目を満たす。Safari の逆順序は対応済み。
- **引用の追加2生成（Muse high）**: m3e `s6/lib-tokens` は主張44・L1 一致37・不一致0・判定不能7、Jev `s9` は主張22・一致17・不一致2・判定不能3。API 換算の推計 $0.023 と $0.005。原文との突き合わせで内容の誤りは0件。m3e の不足は解消、Jev のホットパスは不一致のまま、新規1件（record_dir）は内容は正しいが引用範囲が短い。検証器は緩めない。証跡は [citation-review-muse.md](trend-quality-20261012/citation-review-muse.md)。
- **外部セッションからの生成（Muse）**: 「生成手順をコピー」と同じ文面で3フェーズの準備→生成→取り込みを完走（coverage 100 %、`git status` クリーン）。この時点の外部セッションの実生成は Antigravity・Cursor・Muse の3つで確認。Grok Build は当時、残高切れ（402）のまま（10-12 深夜に解消し完走。下の追加分）。
- **修正（すべて回帰テスト付き。e2e はホストで実行）**: 差分再生成で古い「主要な流れ」が残る問題（prompt 本文と `prompts.lock.json` は不変）／HTML 書き出しの gzip 圧縮（rea 10.6→1.81 MB、gods-eye-view 10.1→1.72 MB、text-to-cad 12.4→2.02 MB、展開後の内容は一致。Chrome 80+ / Firefox 113+ / Safari 16.4+、ビューアー JS 60,000 B（予算ちょうど））／生成中の `/ui` 全体再取得（表示に関係ないイベントでは取り直さず、確定ブロックの反映は約2秒に1回へ間引く）／使用量を返さないエンジンの見積り（バイト換算で出し「（バイト換算の上限推計）」と表示。実測で記録/見積り 2.02 倍 → 見積り/記録 1.20 倍）／React 規模のピークメモリ（S1 完了直後に解析 Worker を待機1本へ縮める。`idx.rss.peak` 中央値 786.4 MB で上限 1,000 MB を解消、目標 700 MB は WARN。Go 7k は同時刻で中央値 1,487 ms。証跡は [formal-bench-after-pool-shrink.json](trend-quality-20261012/formal-bench-after-pool-shrink.json)）。
- **2026-10-12 夜の追加分**: 画面用ファイルの並行ビルドの競合を解消（各ビルドを `dist/.build.tmp-<pid>-<seq>` で組み立ててから入れ替える。成果物のバイト・名前・`assets.lock.json` は不変。`scripts/gen-assets-conc.int.test.ts` は修正前に失敗・修正後に成功）／書き出しビューアー JS を 60,000 B → 59,553 B（関門 60,000 B、余裕 447 B。`ViewerIcon.svelte` の分離、アプリ専用 i18n キー1件の除外、重複定義の共通化。58,000 B 以下は見送り）／書き出しの使えない操作（引用ポップアップの「横に固定」「エディタで開く」、未生成の節の「生成」ボタン）を DOM から除き、未生成の節は「未生成」と静的表示（アプリ本体は不変、e2e で両方を確認）。Jev のホットパスの引用は閉じた（検証器の「不一致」判定は正しく、モデルの選び方の問題のため。検証器は緩めない）。

## 2026-10-12 深夜〜10-13 の追加分

PR #20 で2件の修正を統合した。`mitori setup` は engines・pins を cli 専用の `PATCH /settings/exec` で書いたあと残りを web 専用の `PATCH /settings` で書いていたため、どの provider でも `E_FORBIDDEN` で途中まで保存されて止まっていた（`7de8638` で `PATCH /settings` を cli にも開き、`EXEC_SETTING_KEYS` の拒否は不変）。版が常に `0.0.0` で `git pull` 後も古い daemon に接続し続けた問題は、版を `0.0.0+<build>`（ソースのハッシュ12桁）にし、空いている別ビルドの daemon だけ後に起動した CLI が入れ替える方式で直した（`404dd54`）。Grok Build（`grok` 1.0.50）は 2026-10-12 23:27〜23:48 に go-small のコピーで3フェーズを約21分で完走し、対象 repo の `git status` はクリーン、抜き取りの引用は1件の言い回し（`flag.ExitOnError` の失敗時）を除き原文と一致した。これで外部セッションの実生成は Antigravity・Cursor・Muse・Grok Build の4つで確認。正式測定（2026-10-12 23:25、`bdff6af`、iCloud 同期で load 3〜6）は `idx.s01.cold.7kfiles` 中央値 1,492 ms（p95 1,528、上限 1,500、目標 1,200）、`idx.rss.peak` 中央値 774.1 MB（p95 797.2、上限 1,000、目標 700）。性能の候補ブランチ `muse/wp16`（`fa437b5`）は load 10〜15 の ABBA で効果を確かめられず未統合。Mac の3ブラウザ CI は PR #20 でも事前チェックで停止し、ホストで書き出し e2e（Chrome）31/31・引用ポップアップ 4/4 を確認して統合した。

## 2026-10-13 早朝の追加分

性能の候補 `muse/wp16` は 8巡の ABBA（負荷 5.3〜8.3）で速くならず（Go −19.6 ms・React −2.0 ms、信頼区間は0を跨ぐ）、React RSS が +19.8 MB 悪化したため統合しない。正式測定（`1715479`）は `idx.s01.cold.7kfiles` 中央値 1,449 ms・`idx.rss.peak` 中央値 792.2 MB（いずれも上限内・目標は WARN）。Mac のホストで3ブラウザ e2e（`e2e/web`、chromium・firefox・webkit）が 386 件成功・失敗 0・省略 14、共有の結合テスト2件・`@a11y` 8件も成功。詳細は [perf-20261013](perf-20261013/README.md)。CI の `browsers` ジョブが止まっていた原因は runner の macOS バックグラウンド優先度（高効率コアのみ、校正が約2倍）で、LaunchAgent の登録し直しで復旧した。再実行は校正 0.978 倍で通過し、残った2件（overage の強制クリックが本体への入れ替わりの瞬間に当たったもの）はテスト側を再試行に直した。

