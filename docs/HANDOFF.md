# mitori 引き継ぎ（現在の状態）

> 最終更新 2026-10-13 JST。これより前の詳しい経緯・測定・判断は [HANDOFF-history.md](HANDOFF-history.md) にそのまま残してある。ここには「今どうなっているか」と「次に何をするか」だけを書く。

## 1. mitori とは

リポジトリを一度だけ省トークンで読み、出典付きの日本語設計書（見取り図＋本文）をローカルのブラウザ画面に出す。人が設計書の箇所にコメントすると、本人の AI（Claude Code / Codex / Muse / Cursor など）がその位置に紐づけて説明・修正提案し、人が確認して未コミットで適用・Undo できる。clone してローカルで使う（Nix・Docker・Cloudflare は通常利用に不要）。

- リポジトリ: `satoki252595/mitori`（公開、MIT）
- 使い方: [README](../README.md)、作業規約: [AGENTS.md](../AGENTS.md) / [CLAUDE.md](../CLAUDE.md)
- 検証状況の詳細: [verification-status.md](progress/verification-status.md)

## 2. 今回（2026-10-12）やったこと

利用者の依頼「残を全て実施」「そもそもの問題があれば解決」「トレンドOSS 3件を Muse high で実行し品質と UI/UX を確認」に対応した。詳細は [trend-quality-20261012](progress/trend-quality-20261012/README.md)。

- **トレンドOSS 3件の実生成**（rea / gods-eye-view / text-to-cad、Muse `muse-spark-1.3-contributor` high）: 全タスク完了・失敗0、出典の存在100 %、主張と出典の一致 92〜96 %。各約44分、API換算の推計 計 約$1.9。
- **利用者目線で見つけて直した問題**（すべて回帰テスト付き）: Codex の利用上限を「予算超過」と誤表示・誤計上／Muse 自動更新で実行ファイルが消えても「インストール済み」／生成中の画面で進捗が0のまま・全体再取得の連発／非Claudeの時間見積りが約3倍楽観的／外部セッションで生成済みでも「未生成」／「動かしてみる」が数百行の表／「主要な流れ」がWebサイトのデモや法務ページを説明／本文の初回表示で「出典 0」と空枠／利用者へNix前提の案内。
- **Go7k コールドスキャン 1,500 ms**: 解析ワーカーのフルGCを若い世代のGC中心に変え、正式ケース中央値 1,431.5 ms で上限内（目標 1,200 ms は WARN）。
- **外部クライアントからの実生成**: Antigravity と Cursor で準備→生成→取り込みを完走。
- **資料の整理**: README を利用者の手順中心にし、検証ログは [verification-status.md](progress/verification-status.md) へ。旧引き継ぎは [HANDOFF-history.md](HANDOFF-history.md) に保存。

2026-10-12 後半は実装・調査を Muse（muse-spark-1.3-contributor・high）が各作業ツリーで行い、方針と重要な判断はオーケストレーター（Claude）が行った。コミットには `Implemented-By: muse-spark-1.3-contributor (high)` を付けた。

- **古い Bun での起動**: PATH 先頭の Nix 由来 Bun 1.3.13 で `bun run start` が「Bun 1.4.2 or newer is required」で止まっていた。`scripts/start.ts` が新しい Bun を探して同じ引数で起動し直す（1行で知らせる）。実機の Bun 1.3.13 で `bun run start -- --version` が成功。
- **実 IME は確認済みとして閉じる**: W3C UI Events（`isComposing`・keyCode 229・順序）と MDN の推奨ガードに照らし、`apps/web/src/shell/ime.ts`・keys-controller・パレット・Composer とテスト（`e2e/web/ime.pw.ts`、`ime.webkit.pw.ts`）が全項目を満たす。Safari の逆順序は対応済み。利用者の指示（公式マニュアルに照らして問題なければ OK）による。
- **Codex 部分の Muse への置き換え**: 引用の追加2生成を Muse（high）で実施。m3e `s6/lib-tokens` は主張44・L1 一致37・不一致0・判定不能7、Jev `s9` は主張22・一致17・不一致2・判定不能3。API 換算の推計 $0.023 と $0.005。原文との突き合わせ（[citation-review-muse.md](progress/trend-quality-20261012/citation-review-muse.md)）で内容の誤りは0件。外部セッションからの生成も Muse で完走（coverage 100 %、`git status` クリーン）。この時点の外部セッションの実生成は Antigravity・Cursor・Muse の3つで確認。Grok Build は当時、残高切れ（402）のまま（下の追加分で解消し完走）。
- **修正（すべて回帰テスト付き。e2e はホストで実行）**: 差分再生成で古い「主要な流れ」が残る問題（prompt 本文と `prompts.lock.json` は不変）／HTML 書き出しの gzip 圧縮（rea 10.6→1.81 MB、gods-eye-view 10.1→1.72 MB、text-to-cad 12.4→2.02 MB、展開後の内容は一致。対応は Chrome 80+ / Firefox 113+ / Safari 16.4+。ビューアー JS 60,000 B（予算ちょうど））／生成中の `/ui` 全体再取得（表示に関係ないイベントでは取り直さず、確定ブロックの反映は約2秒に1回へ間引く）／使用量を返さないエンジンの見積り（記録と同じバイト換算で出し「（バイト換算の上限推計）」と表示。実測で記録/見積り 2.02 倍 → 見積り/記録 1.20 倍）／React 規模のピークメモリ（S1 完了直後に解析 Worker を待機1本へ縮める。`idx.rss.peak` 中央値 786.4 MB。Go 7k は同時刻で中央値 1,487 ms。証跡は [formal-bench-after-pool-shrink.json](progress/trend-quality-20261012/formal-bench-after-pool-shrink.json)）。

2026-10-12 夜の追加分（実装は Muse high、方針と判断はオーケストレーター）。

- **画面用ファイルのビルドが初回に失敗することがある問題**: 同じチェックアウトで `scripts/gen-assets.ts` が2つ同時に動く（`git pull` 後の `bun run start` と、MCP クライアントが起動する `scripts/start.ts mcp`、テスト中の `build:bin` など）と、後から始まった方が `dist/.build` を消し、先の方が `ENOENT …/web/assets/*` で失敗していた。`git pull` 後の最初の起動が「Browser UI build failed」で止まりうる。各ビルドを `dist/.build.tmp-<pid>-<seq>` で組み立ててから入れ替える方式に変えた。成果物のバイト・名前・`assets.lock.json` は不変。並行ビルドの回帰テスト（`scripts/gen-assets-conc.int.test.ts`）は修正前に失敗、修正後に成功。
- **書き出しビューアー JS の縮小**: 予算の関門は `e2e/export/viewer-bundle.int.test.ts`（EXP-I-05）と `e2e/export/export.spec.ts` の「≤ 60,000 B」（gzip level 9）で、超えるとテストが失敗する（`bench/budgets.json` の `asset.viewer.js` は目標 60 KB・上限 70 KB）。60,000 B → 59,553 B（余裕 447 B）。ビューアーが使う4つのアイコンだけを持つ `ViewerIcon.svelte`（`shell/Icon.svelte` と同じ線データであることを単体テストで確認）、アプリ専用の i18n キー1件を除外、重複定義の共通化。58,000 B 以下は、地図の部屋カードや本文の描画部品をビューアー用に分岐させないと届かず、保守の負担が大きいので見送った（判断）。
- **書き出しの使えない操作の除去**: 引用ポップアップの「横に固定」「エディタで開く」と、未生成の節の「生成」ボタンは、書き出しでは以前から CSS で非表示だったが、DOM には残っていた。書き出しでは描画しないようにし、未生成の節は「未生成」と静的に表示する。アプリ本体は変えていない（e2e で両方を確認）。
- **Jev のホットパスの引用は閉じる**: 検証器が「不一致」と正しく判定し、画面にもそう出ているため、製品の不具合ではなくモデルが引用範囲を選ぶ精度の問題であり、検証器は緩めない。

2026-10-12 深夜〜10-13 の追加分（実装は Muse high、方針と判断はオーケストレーター。2件の修正は PR #20 で統合）。

- **`mitori setup` の保存が必ず止まる不具合**（`7de8638`）: `setup` は engines・pins を cli 専用の `PATCH /settings/exec` で書いたあと、残り（既定のエンジン・モデル・思考の強さ）を web 専用の `PATCH /settings` で書いていたため、どの provider でも `E_FORBIDDEN` で途中まで保存されて止まっていた（利用者の実機で発生、実行ファイルのパスだけ更新）。`PATCH /settings` を cli にも開いた（`EXEC_SETTING_KEYS` の拒否は不変、mcp は拒否のまま。CR setup-save-1）。CLI が呼ぶ全 route が cli を受け付けることを静的テストで確認。途中で失敗したら何が保存済みかを表示。
- **コードを更新しても古い daemon が使われ続ける不具合**（`404dd54`）: 版が常に `0.0.0` で、`git pull` 後も前に起動した古い daemon に接続し続けた。版を `0.0.0+<build>`（ソースのハッシュ12桁。`scripts/start.ts` が環境変数 `MITORI_BUILD` で渡し、`build:bin` はバイナリに埋め込む）にした。空いている別ビルドの daemon は、それより後に起動した CLI だけが入れ替える（長く動く古い CLI が新しい daemon を巻き戻さない）。使用中なら1行の案内付きで使い続ける。一時 home で、古いバイナリの daemon が新しいビルドへ入れ替わることを確認。
- **Grok Build の外部セッション生成**（`grok` 1.0.50）: 2026-10-12 23:27〜23:48 に go-small のコピーで3フェーズ（準備→生成→取り込み、フェーズ2で見取り図のキャプションと流れ5本、用語7語）を完走。約21分（手番の上限 40 で一度止まり、同じセッションを続けて完了）。対象 repo の `git status` はクリーン。抜き取りで照合した引用は原文と一致。1か所、`flag.ExitOnError` のフラグ解析失敗を「エラーを返す」と書いていた（実際はプロセスが終了する）。これで外部セッションの実生成は Antigravity・Cursor・Muse・Grok Build の4つで確認。残高切れ（402）は解消していた。
- **正式測定**（2026-10-12 23:25、`bdff6af`、iCloud 同期で load 3〜6）: `idx.s01.cold.7kfiles` 中央値 1,492 ms（p95 1,528、上限 1,500、目標 1,200）、`idx.rss.peak` 中央値 774.1 MB（p95 797.2、上限 1,000、目標 700）。
- **性能の候補（未統合）**: ブランチ `muse/wp16`（`fa437b5`）。S1 の解析結果をバッチ完了ごとに適用し、S1 後の直列ループ（Go 53 ms・React 18 ms）を除く。load 10〜15 の ABBA では効果を確かめられず（Go 中央値 2,697 → 3,065 ms、React RSS 775.5 → 786.7 MB、いずれもぶれの範囲内）、方針どおり統合していない。試して捨てたもの（S1 末尾の縮退・Worker 減数・full GC 半減）と生データはブランチ `muse/wp16` の `docs/progress/wp16.json` にある。
- **Mac の3ブラウザ CI**: PR #20 でも静かな機械の事前チェック（load 12.9、利用者のゲームと最低優先度のベンチ）で停止。ホストで書き出し e2e（Chrome）31/31・引用ポップアップ 4/4 を確認して統合した。

2026-10-13 の公開準備（利用者が一般公開を承認。実装は Muse、方針と重要な判断はオーケストレーター）。

- **公開の形**: ライセンスは MIT（`Copyright (c) 2026 satoki252595`）。履歴全体の秘密情報の点検は済み（gitleaks、597 commit に本物なし）。同梱依存の一覧は `THIRD_PARTY_NOTICES.md`（`bun run notices` が作る）。外部の fork PR のワークフローはすべて承認制にし、`browsers` ジョブは保守者の基準 Mac でのみ動く。非公開の脆弱性報告を有効にする。公開への切り替えは 2026-10-13。

2026-10-13 後半はモジュール章の読みやすさを直した（`gen.module@12`・`gen.parent@4`。呼び出す側の目的の1文＋入口6項目まで、データは作り手と読み手。過去分は作り直さない。実生成2章で L0 100 %・L1 96.4 %。詳細は [module-readability.md](progress/trend-quality-20261012/module-readability.md)）。Muse の設定は利用者の操作で完了（`bun run start -- setup muse --effort high` を実行し、既定エンジンと全用途モデルと思考 high を保存。古い daemon は新しいソースの daemon へ自動で入れ替わった）。

2026-10-13 早朝は性能の候補 `muse/wp16` を ABBA（8巡）で測り、統合しないと判断した（Go −19.6 ms・React −2.0 ms で差なし、React RSS +19.8 MB で悪化）。正式測定は Go 7k 1,449 ms・React RSS 792.2 MB（いずれも WARN）。Mac の3ブラウザ e2e は 386 件成功・失敗 0。CI の `browsers` ジョブが止まっていた原因は runner の macOS バックグラウンド優先度（高効率コアのみ、校正が約2倍）で、LaunchAgent の登録し直しで復旧し、校正前の検出と基準の誤記録防止を入れた。詳細は [perf-20261013](progress/perf-20261013/README.md)。

## 3. 残っていること

| 残件 | 状態 | 次の一手 |
|---|---|---|
| Mac の3ブラウザ CI の再実行 | ホストで3ブラウザ全件成功（2026-10-13、386件、失敗0）。GitHub の `browsers` ジョブは runner が macOS バックグラウンド優先度（校正が約2倍）で止まっていたが LaunchAgent の登録し直しで復旧し、再実行は校正 0.978 倍で通過（残り2件はテスト側の入れ替わりの瞬間の強制クリックで修正済み） | この資料の PR の `browsers` ジョブの結果を見る |
| HTML 書き出しのビューアー JS | 59,553 B（関門 60,000 B、余裕 447 B）。残りはすべて使用中のコード | 大きく増える変更の前に、予算の見直しか分割を検討 |
| Go 7k の正式時間 | 中央値 1,449 ms（p95 1,486、上限内）・目標 1,200 ms は WARN | 目標 1,200 ms への新しい案は未着手（`muse/wp16` は効果なしで不採用） |
| React RSS の目標 700 MB | 792.2 MB で WARN（上限 1,000 MB 内。ABBA の main 側 16回の中央値は 774.8 MB） | ピークがどの段（S1 の解析 Worker か、S3 のグラフか）で出るかを測ってから案を決める |

## 4. 再開手順

1. `git status --short --branch` と `git log -3 --oneline` で main と差分を確認する。
2. 開発コマンドはすべて `scripts/nd` 経由（[CLAUDE.md](../CLAUDE.md) の表）。関門は `scripts/nd bun run check`、単体は `scripts/nd bun test <path>`、web e2e は `MITORI_E2E_CHANNEL=chrome scripts/nd bunx playwright test -c e2e/web/playwright.config.ts --project=chromium`。
3. 実 LLM を使う検証は、見積りと上限（`--max-usd`）を付けて `bench/measure/gen-real.ts` で行う。費用が月1,000円を超えそうな操作・Cloudflare の deploy / Paid 化・ソフトの直接インストールは事前に確認する。
4. 秘密情報（auth・env・生 prompt・nonce）は Git に入れない。一時ファイルは `/private/tmp` か作業用ディレクトリに置く。

## 5. 守ること（設計の約束）

- AI の変更は「アンカー済み・範囲限定・ゲート済み・人が確認・未コミットで適用・Undo 可」。対象 repo の refs/objects には書かない（side repo、ADR-0012）。
- 自動起動する LLM は lean 起動し、対象 repo の設定・hook・ツールを継承しない（ADR-0013 / ADR-0015）。
- 予算・上限値は根拠なく緩めない。未達は未達として記録する。
