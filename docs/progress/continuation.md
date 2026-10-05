# 引き継ぎ続行（2026-10-04）

> この検証は履歴として保持する。以後の残タスク対応・新しい依存・検証結果・未完は [HANDOFF §★](../HANDOFF.md) と [2026-10-05の一覧](backlog-2026-10-05.md) を参照する。

追跡: [Issue #1](https://github.com/satoki252595/mitori/issues/1)。既存 `satoki252595/mitori` と既存の専用フォルダを再利用した。nix devShell の `scripts/nd` を使い、プロジェクトの依存 manifest / lockfile は変更していない。Linux に限る既存 Docker / apt ハーネスは今回の利用者の例外許可による。native rebuild 用の make / g++ と同梱 node-gyp の接続はその image 内だけに追加した。

## 統合

`rem/bench` → `rem/safety` → `rem/doc` → `rem/ui` を main へ順に統合した。merge commit: `8abe718` / `4c8f463` / `f393f17` / `84fa9c7`。CR 台帳の追記同士は両方残し、INT-06 は両方の import / 検証を維持した。各段階の frozen install と check は成功。2026-10-04時点では未pushだったが、10-05に利用者の指示でmainをpushし、統合済みbranchを整理した。実施記録は `git-publication-2026-10-05.md` / `.json`。

続行の実装は `8cdae9c`、scoped生成の問いの復元は `49c1575`、リスク生成のTODO状態保持は `28388df`、スレッド由来の決定の文言は `848c4d4` に保存した。検証・生成例・引き継ぎ資料はその後の資料コミットで追跡する。

## 利用者の追加指示: 任意 LLM / Muse max

既存 generic CLI にモデル、reasoning、出力 protocol、明示価格、生成 deadline を接続した。任意のモデル ID を、説明 / 構造化 patch・findings / 設計書生成に使える。stdin で全 prompt を受ける CLI と、`{promptFile}` で読む CLI に対応する。argv は shell を介さず渡す。任意 CLI の agent tools は未対応。

今回の実測は Muse `muse-spark-1.3-contributor` / 要求 effort `max`。ネイティブ CLI の model profile が max を受理し、spawn argv に指定されること、JSONL の configured model を確認した。provider が実際に使った effort と正確な token usage は観測できない。Muse Contributor の送信内容・学習利用を UI に表示し、[公開単価](https://dev.meta.ai/docs/pricing-rate-limits)を2026-10-04に確認した。

実行設定は既存 CLI の人の確認で保存する。ブラウザから `engines` を PATCH する例外は作らない（SEC-06）。Settings は argv JSON の安全なコピー用コマンドを提示し、CLI 適用結果と一致した後に model / default / reasoning を保存する。model / argv の変更は既存 privacy ack と同一扱いにしない。

Composer の同一frame予測も generic の明示単価を使い、Claude の cache 割引を使わない。新しいサーバー見積りが到着したらそちらを優先する。価格未設定は「—」、明示0単価は0として表示する。Settings の timeout 空欄は120秒を明示保存し、CLI の deepMerge が以前の600秒を残して保存を妨げる問題を修正した。

実行時は許可済み bundle だけを空 cwd に渡し、hook / reminder / MCP / delegation を禁じる。Muse の管理 hook override は canary で確認した。追加の隔離と制約は [ADR-0015](../design/adr/0015-configurable-llm.md)。任意 CLI の実行ファイル自体は利用者が信頼する境界であり、悪意ある CLI の OS 隔離を保証するものではない。

## 実デモ

`live-muse/measurements.json` と PNG が証跡。出荷版 binary と Chrome で、説明 → 修正 → gofmt / go test / go vet → 人の採用 → 未コミット確認 → Undo を通した。コンソールエラー・4xx/5xx は0。ユーザー repo の HEAD / refs / stash / worktrees / object 数の不変も検査した。

| 指標 | 結果 |
|---|---:|
| Explain 最初の本文 event | 8.413 s |
| Explain 回答・カード完了 | 10.497 s |
| Explain 楽観カード | 33 ms |
| Fix ready | 24.452 s |
| Fix 楽観カード | 18 ms |
| 採用 / Undo | 287 / 104 ms |
| 合計記録値 | USD 0.001128（本文 usage 推計） |

元の live ハーネスは AI の作者ラベル表示を「最初の本文」と数えていた。ラベルは `aiLabelVisibleMs`、本文は job の `text` event に分け、既存の測定記録も採取済み timeline を使って修正した。実 LLM をこの計測名修正だけのために再実行していない。

実修復も成功した。初回の go-vet 失敗後に attempt2 で gofmt / go test / go vet がすべて成功し、最後は reject して元の bytes を保持した。記録値は USD 0.001284（推計）、9,652 input / 1,595 output。2応答とも指定モデル・completed terminal、tool/hook/reminder/MCP 0。証跡は `repair-muse/measurements.json`。

途中で JSON schema 不足と Muse の `tool.read_file` 提案を観測した。schema は共通 boundary で渡し、tool guard は維持した。各起動で0700/0600の空 toolset profile に認証だけをコピーし、終了・キャンセル・起動失敗後に削除する。追加 context は初回・repair・revise 共通で同じWRITE範囲/current headの既存 hint resolverを1 job 1回まで使う。実修復では追加contextは不要だったため、その経路は `generic-context.test.ts` の無償回帰で確認した。実修復の37行の独自error/整数formatは品質上の残りとして扱う。

## crit 実生成

標準生成24タスク（S5=14、S6o=8、S6=2）、C=2 の見積りは約 USD 0.082、uncached input729,638 / output45,130。generic に Claude の prompt cache / subscription window の割引を流用していない。

初回実測は既定120秒の timeout で2件失敗し、生成0件のまま333.7秒でキャンセルした。本文換算の記録値 USD 0.030130、6 calls。生記録は `/tmp`、失敗 report は `gen-muse-first/report.json`。生成されなかった静的雛形の重複コピーは保存していない。停止から5秒後に child process 0 を確認した。

provider の生成 deadline を明示設定できるようにし、Muse preset は600秒とした。設定値は1〜3,600秒、API schema と UI で検査し、loop の個々の job budget は維持する。再測定ハーネスは出荷版と同じ `build: release` を使う。以前の test build は、高負荷で同期 static-doc write が55msになると50msの開発診断により rollback したため、出荷時の処理を測れていなかった。製品の write queue の同期制約・予算は変更していない。

600秒/turnの再生成は45分で20/24タスクを完了し、壁時計制限で停止した。内部retry0%、失敗0、L1 99.5%、22calls・319blocks・記録値USD0.156396。原記録は `gen-muse-window/`。子processは停止時と5秒後とも0。未完了のs3/s11/s12/s13だけを見積りUSD0.010436、上限を残額USD0.1436にして継続し、4/4成功・472.6秒・3calls・31blocks・記録値USD0.016885となった。原記録は `gen-muse/report.json`。45分の一括完走は達成していない。

ただしs13は0 callsのまま「未生成」だった。scoped planが既存本文のある依存タスクを外し、RAW質問の集約も現runだけを読んでいたため、元runの42問が失われた。現在AI本文のblock id/run/promptに対応するfinished outputを集約し、同じproducerは最新版を優先するよう共通runnerとestimateを修正した。古い版・削除済み本文・関係ないrunの全履歴は集めない。既存の空list時の非破壊契約は維持する。旧版→1module新版→s13再開の無償回帰3件・23assertions、型/Biome/check成功、実scratchの42問復元を確認した。

その後、TODOの意味逆転を防ぐ `gen.risks@3` と、問いの整理だけを上限USD0.09で実再生成し、2/2成功・283.4秒・2calls・記録値USD0.009063。43RAWから15問になり、s13の未生成表示を解消した。本文はcritの仕様/構造へ向いており、mitoriや提示DATAを問う内容は観測しなかった。TODOの「再読み込み抑止が未実装」という意味も元ソースと一致した。詳細は `continuation-quality.md`。

合成最終値は**24/24完了、27calls、内部retry0%、壁時計再開2/24=8.3%、L1 99.6%、実行時間合計3,458.4秒、USD0.182344推計**。最新finished taskのvalidator metricsと、abort/旧版を含む全usageをsemantic taskへ対応させた。初回120秒失敗を含むcritの総記録値はUSD0.212474。原記録と合成方法、最後の文書は `gen-muse-final/README.md` / `combined.json` / `doc/`。全区間で終了時と5秒後のchildは0、一時認証コピーも0。45分一括完走は未達で、native tokens/hidden thinking/請求額は不明。

EX-04脚本は新しい静的「変更の手引き」/領域目次をAIの未出典文に数えていた。既存doc codecと隣接indexのoriginを使い、同じfileのAI blocksだけを測るよう修正した。indexなしの旧方式はmixed-originと表示し、壊れたindexでは失敗する。1回帰・11assertionsで静的/human/未知ID/コード内偽ID/別fileの除外、出典、--all、legacy、不正indexを確認した。対象変更による数値低下を生成品質の改善とは扱わない。

最終AI文の測定はmodule421文中未出典48（11.4%）、コード名付き26（6.2%）、全節590文中未出典103（17.5%）。L1は引用構造の成功率であり、意味の正しさの証明ではない。生成の細部偏重・反復表現・TODO周辺文脈などの残りを `continuation-quality.md` に記録した。

## 安全API / UI / ベンチ

- Composer の context を保存・再開・見積り・prompt・送信へ渡す。引用 × は readonly cite を残して write 権限だけを除く。pull/copy の「その場で実行」禁止を除き、選択した範囲を保持する。
- pull round の変更一覧、範囲外ラベル、Undo 前の一覧・scope の再取得を配線した。変化があれば再確認を要し、既存 backend gate と Undo checkpoint を使う。
- F6: section range / outline / br・gzip、Reader の anchor 先行・idle 補充、SSE / reset / full-text search の整合。cold10kblockの同一ファイル読み込みを既存 mtime cache の進行中 Promise で共有した。
- 非同期設定保存・全文検索の stale reply、freshness の DOM 更新、Git2.43 の promisor missing object を修正した。
- cold-open ベンチの重複 id を除き、静的文書込みの canonical case を保持した。基準値・時間予算は書き換えていない。

詳細は `continuation-ui.md` / `continuation-bench.md`。

## 統合検証

全体テストは1回実行し、その後は失敗・変更した単位だけを再実行した。初回の全体実行結果を、最終ソースの全体成功へ読み替えない。

| 確認 | 結果と条件 |
|---|---|
| 最終 `scripts/nd bun run check` | 成功、10.63秒。tsc / Biome / boundaries / CR / budget / INDEX / Svelte すべて成功 |
| 最終 `scripts/nd bun run build:bin` | 成功。813 modules、web 68 files、`dist/mitori-darwin-arm64` |
| Mac 全 unit 初回 | 2,976 pass / 13 skip / 5 todo / 3 fail、2,997 tests・318 files・506.66秒 |
| Mac 失敗の限定再検証 | UXの旧safe-6期待を現在の権限解除/復元/対象無し拒否へ更新し1 pass・31 assertions。並行変更中のadapter期待を最終ソースで14 pass・139 assertions。日本語CJK空白を修正しlint 1 pass |
| 新規/変更した回帰 | generic HTTP 1 pass・11 assertions、generic context 1 pass・23 assertions、recorder privacy 1 pass・11 assertions、F1 2 pass・29 assertions。価格・設定・UI・F6は各報告書参照 |
| 最終 provider/UI 回帰 | Composer予測・session・設定helper・UI lintの27件成功、127 assertions。価格無し/明示0/有償、初回モデル選択、freshなserver価格優先、timeout空欄のCLI登録を確認 |
| 実測で発見した生成/表示の回帰 | scoped質問3件/23assertions、risksのAC-40/M4 3件/8assertions、決定の同居/人の編集保護/readonly export 5件/282assertions成功 |
| Chromium 統合 | 最終assetの32件で30 pass・CLS 2 fail。地図のtitle/見積り欄の高さを初回から確保し、失敗したCLSとsizeのみ再測定、4/4成功。CLSは2viewportで0 |
| 最終 provider browser | 上の費用・timeout修正後に出荷資産を再buildし、Settings2件/size2件の4/4成功。JSはS1/S2 87.4/91.3KB gz、CSS18.7/17.6KB。60KBのJS目標は未達 |
| 最後の生成/文言修正後のsize | 出荷assetで2/2成功。JS S1/S2 87.4/91.3KB gz、CSS18.7/16.4KB、初期font/CM6なし。150KB/25KBのhard gateは成功、JS60KB目標は未達 |
| Linux arm64 | 初回 2,844 pass / 141 skip / 4 todo / F1のみ1 fail。独立fixtureと明示consentを修正しF1 2 pass・4 macOS skip・0 fail |
| Linux install/check | native rebuildの同梱node-gyp/PATH/compiler不足をDockerだけで修正しfrozen install成功。cold checkは全項目成功でも57.25秒で30秒上限未達、warm checkは15.68秒で成功 |
| Linux watch / sandbox | watch integration14 pass、batch p50/p95 6.4/6.9ms。watch bench4ケース、bwrap sandbox10 checks成功（初回unconfined条件）。追加default/masked-procはdetect kind:none、checks:[]の正常退避（隔離10checks成功とは別） |

Macの簡潔な証拠は `continuation-checks/`、browserの測定条件は `continuation-ui.md`、Linuxのlog/コマンド/環境は `linux-continuation/README.md` に保存した。誤った古いassetを使った最初のbrowser実行は判定に含めていない。

## 未完了

初期 JS は現在 S1 約87.4 / S2約91.3 KB gz で60 KB未達。大きな節の配信は実装済み。未計測ベンチ7件、静かな基準機、runner登録、Windows・Firefox/Safari実機、Cloudflare共有、Codexagentmode、CRui-4は残る。Cloudflare deploy / Paid化と月1,000円以上の継続費用増には承認が必要。

実費は token usage 未取得のため未確定。API換算cap（demo0.60 / repair0.20 / crit0.30 USD）はプロバイダーの請求上限を保証しない。新規の継続課金・deployは行っていない。
