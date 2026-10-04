# live — レビュー → AI 修正ループを実 UI・実 daemon・実 claude で一周（branch `integrate/live`、2026-10-04）

## 最終デモ（finisher、2026-10-04）— `@` なしで、設計書の文から 説明 → 修正 → 採用 → Undo

台本 `test/int/shots/live.ts` を、監査の後の main に合わせて書き直した。スクショと計測は `docs/progress/final/`。

**実エンジンでの実行は、まだしていない**。この環境の `claude` CLI がログアウト状態（`claude auth status` → `loggedIn: false`）のため。
実費の上限は $0.60 で、このパスでの実 LLM 消費は **$0**。ログインしたら、次の 1 回で実エンジンでも通せる。

```bash
claude /login                                   # ユーザーが行う
scripts/nd bun run build:bin
scripts/nd bun test/int/shots/live.ts --engine real --out docs/progress/final   # 上限 $0.60（台帳を見て超えたら中断）
```

今回は、同じ台本を **scripted claude（`--engine fake`、0 tok）** で通した。本物の web UI（Chrome、1440×900）・本物の daemon の route・本物の git / gofmt / go vet / go test を使っている。
`test/int/live-ui.test.ts` が、これと同じ実行をテストとして回す。

| 段階 | 確認したこと | 実測（fake、ロードアベレージ ≈ 20〜50） |
|---|---|---|
| 01 最初の画面 | hero に README の 1 段落目（「積読…」）と `Go 1.23` が出る（NC-02） | shell 25 ms・map 182 ms・TOC 135 ms |
| 02b §2 | 間取り図が SVG で描かれる（`figure.mdiagram svg .dg-node`、NC-03） | — |
| 03 §4 | 先頭が 0 tok の手順で、`go run ./cmd/tsundoku` を含む（NC-06）。表に見出しがある | 節の遷移 115 ms |
| 04→06 説明 | 環境変数表の語を選び、`e` を押して、**クリックせずに**打つ。値はそのまま入る（NC-01）。`config` の `g` も消えない（EX-02）。`@` なしで、行のコード（`config.go`）が bundle の CODE に入る（EX-03） | 楽観カード 41 ms、回答済 527 ms |
| 08→09 修正 | `f` → 「どのコードを直しますか？」。1 番目の候補は行のコード（`config.go:19-38 Load`）で、⌥1 で選ぶ。`@` は使わない（CR ux-F1）。3 択（コードを直す / AI に設計書を直させる / 自分で直す、EX-06） | 楽観カード 19 ms |
| 10→12 ジョブ | running → gating → ready | 386 / 1,212 / 1,590 ms |
| 13→15 Review | 依頼の見出し、承認ダイアログ、gofmt・go test・go vet の 3 つが **pass** | Review を開く 92 ms |
| 16 採用 | 作業ツリーで変わったのは ` M internal/config/config.go` だけ（未コミット）。HEAD・ref・stash・worktree・object 数は変わらない。`gofmt -l` もクリーン | ⌘⏎ → toast 810 ms |
| 17 Undo | 元のバイト列に戻る。`git status` は空 | 108 ms |
| 18 コード画面 | 行は 1 行ずつ、行番号付き | — |

コンソールエラー 0、4xx/5xx 0。

この実行で見つけた不具合は 1 件。最初の flush の途中で `?? .mitori/` が出ていた。`.gitignore` を最初に書くように直した（`audit-resolution.md`）。


これまで通っていたのはシナリオエンジン（INT-06）とモックサーバー上の UI だけだった。今回は **コンパイル済みバイナリ**
（`dist/mitori-darwin-arm64`）を go-small の git コピー（`$TMPDIR`、新しい `MITORI_HOME`）に向け、
**インストール済み Google Chrome（Playwright `channel: "chrome"`、1440×900）で本物の UI を操作**し、
**ユーザーの `claude`（Max サブスク、mitori 自身の lean フラグ）** で Explain と Fix を 1 回ずつ通した。

- 再現: `scripts/nd bun run build:bin && scripts/nd bun test/int/shots/live.ts --engine real`（スクショと `measurements.json` は `docs/progress/live/`）
- 無料の同じ台本: `--engine fake`（in-process daemon + INT-06 のスクリプト claude、≈ 25 s）。`test/int/live-ui.test.ts` がこれをテストとして走らせる（Chrome が無い環境では skip）
- 実行回数: 実エンジンの run は **2 回**（run 1 = 全部通った。run 2 = 計測の取り直し + 修正後のスクショ。rules の「1 Explain + 1 Fix + 再試行 1」に収まる）。**API 換算の合計 = $0.0257 + $0.0229 = $0.049**（上限 $0.60 の 8 %）。各 run 内の `checkCap` が台帳（`GET /jobs` の usage）を見て $0.60 超で中断する作りだが、発動しなかった
- 通った流れ（run 2、スクショ番号）: 01 最初の画面 → 02/03 設計書（§0 は未生成の静的ドキュメント、§4 へ）→ 04 §4 の環境変数表で `TSUNDOKU_API_TOKEN` をダブルクリック選択 → 選択ツールバー → 05/06 Composer（質問、`@Fetch` `@maxRetries` のメンション）→ 07 回答カード（回答済）→ 08/09 Fix の Composer → 10/11 ジョブのステージ → 12 レビュー待ちカード → 13 Review パネル（diff・コスト）→ 14 gofmt gate の承認ダイアログ → 15 gate 通過 → 16 採用（⌘⏎）→ 17 Undo（⌘Z）→ 18 コード画面
- 採用後: `git status --porcelain` = ` M internal/meta/fetch.go` のみ（未 commit）。HEAD・全 ref・stash・worktree・object 数はバイト単位で採用前と同じ。`gofmt -l` クリーン。Undo 後は元のバイト列に戻り、`git status` は空、上の項目もすべて同じ

## 注意: 設計書に「再試行」の文章は無い

生成を走らせていない 0 トークンの静的ドキュメントには、再試行に触れる節が無い（§4 の環境変数表・コマンド表、§5 のディレクトリ表、§8 のルート表だけ）。
そこで **§4 の環境変数表（`config.go:20–36` を引用するブロック）の語を選択**し、再試行のコードは Composer の **`@` メンション**
（`@Fetch` = `internal/meta/fetch.go:46-61`、`@maxRetries` = `:19`）で束に入れた。設計書のブロックに書き込み範囲を持たない Fix は、
`@` で指さない限り `412 no code to change`（下の「残り」参照）。

## 実測（run 2。run 1 は `measurements.run1.json`、ほぼ同じ）

| 段階 | 予算（`bench/budgets`）/ 見積り | 実測 |
|---|---|---|
| ナビゲーション → 外枠描画（`ui.shellPaint` 300/500 ms） | — | 12 ms（ページ内マーク）。map 86 ms・目次 66 ms、遷移 → 静止 0.9 s。daemon の S0–S4 + 静的文書 107 ms |
| 節遷移（`ui.section` 100/150 ms） | | 126 ms（1 サンプル） |
| ⌘⏎ → 楽観的カード（`ui.card.optimistic` 100/150 ms） | | Explain 44 ms / Fix 26 ms |
| Explain: 見積りチップ | `≈1.2k in · ≈600 out · $0.007 · 約4–8秒`（ジョブ見積り p50 8 s / p90 15 s） | job 開始 → 最初の phase 20 ms、**最初の text 2.0 s**、完了 **4.7 s**（カードが「回答済」に切り替わるのも 4.8 s）。入力 1,958 tok（全部 cache write）・出力 389 tok・**$0.0088**（見積り $0.0085） |
| Fix: 見積りチップ | `≈2k in · ≈1.5k out · $0.017 · 約11–17秒`（p50 10 s / p90 18 s） | 実行中 0.3 s → gating 7.7 s → レビュー待ち 7.9 s。入力 3,386 tok（cache write 2,550 + read 834）・出力 756 tok（思考 253）・**$0.0141**（run 1: $0.0173、出力 877）。patch/1 は 1 ファイル・+10 −1・1 hunk、書き込み範囲 = `internal/meta/fetch.go` |
| `loop.patch.usd`（$/成功 Fix、0.05 / 0.1）、M3 出口の ≤ $0.05 | | OK（$0.014–0.017） |
| `loop.patch.out`（1,500 / 1,500 tok） | | OK（756 / 877） |
| `loop.patch.in`（3,000 / 3,000 tok） | mitori の見積り 2,077 | 請求上 3,386 tok（+63 %）。mitori の束に入らない claude CLI 自身の固定 overhead（Explain +0.7k、Fix +1.3k）。`agent.leanOverhead` の limit 1.5k 内だが、`loop.patch.in` を請求ベースで読むなら **3 k を超える**（要確認: この予算が束だけを指すのか） |
| Review パネルを開く | | 56 ms |
| 採用（⌘⏎ → 「反映しました」トースト、`git.accept` 300/800 ms） | | 182 ms（UI 込み） |
| Undo（⌘Z → 元のバイト列） | | 104 ms |
| 5h 枠の表示 | | ステータスバーに `5h 3%`（アカウント全体の値） |

実エンジンのターンは run あたり 2 回（Explain 1・Fix 1。repair ターンなし）。claude は初回に TOFU でピン留めされた（`2.1.288`）。

## 見つかった統合バグと修正（全部に回帰テスト。`bun run check` 緑、`bun test` 2,520 pass）

| # | 症状（実エンジン／実 UI で初めて見えた） | 原因 | 修正 | テスト |
|---|---|---|---|---|
| LIVE-01 | Explain の答えがストリームされたあと、カードが 80 秒たっても「実行中」のまま | `wireSse` の `acceptUpsert` が `SseClient.noteRev` を呼び、client は「この rev は自分の mutation の応答由来」と解釈して同じ rev の後続イベントをすべて捨てた。loop は 1 つの rev の中で `running` → `answered` を出す（自前の DB 書き込みは write queue の rev を進めない） | `acceptUpsert` / `acceptProgress` を副作用のない照会にした（記録は SseClient が済ませている） | `apps/web/src/stores/sse.test.ts`: 手書きの fake をやめ**本物の `createSseClient`**（偽の `/events` ストリーム）で、同 rev の running → answered、古い rev の破棄、自分の応答のエコー破棄を確認（旧コードで失敗） |
| LIVE-02 | claude の答えが「ASK の本文が空でした」 | Composer は下書きを 500 ms で保存、見積りは 300 ms で実行。`@` メンションで空の下書きが作られたあと、見積り（と `planFor` が覚える plan）は**空の ASK**で作られ、送信はその plan を再利用した | (1) `ComposerSession.refreshEstimate` は見積り前に保存する。送信後に打鍵が進んだら stale のまま。(2) `JobRunner.planFor` は、覚えている plan の thread の intent・anchor・メッセージ、または context chip が変わっていたら再 plan する（chip が増えたのに黙って旧 plan を実行していた。`409 estimate changed` で確認を取る） | `apps/web/src/composer/session.test.ts`（ルーン、記録する api。旧コードで失敗）、`test/int/int07.test.ts`（LIVE-02 ×2: 実ルートで、estimate 後に保存された本文と、estimate 後に増えた chip が claude に届く） |
| LIVE-03 | 入るたびに `501 GET /doc/proposals?state=pending`（コンソールエラー） | ルート未配線 | `GET /ws/:ws/doc/proposals`（state / block フィルタ、不正な state は 400）を loop-routes に | `int07`（LIVE-03） |
| LIVE-04 | Review ヘッダーの「あなた「…」」に AI の返答が出る | `thread.preview`（最新メッセージ）を使っていた | 最初の human メッセージ（読み込み前は題名）。パネルが messages を読む | `live-ui` が `あなた「再試行回数を設定で変えられるようにして」` を検査 |
| LIVE-05 | gofmt gate を「承認」しても「検査なし（未承認 1 件）」のまま | daemon は trust 決定で gate を再実行しない（`cr-requests/loop-wiring.md` 5。同意なしにリポジトリのコマンドを走らせないため） | **Review パネルから**承認したときだけ、承認がクリックに当たる（diff とコマンドが画面にある）ので `untrusted` gate を実行する。Review パネル表示中は trust トーストを出さない（フッターの 却下 を覆っていた） | `live-ui`（承認 → gate `pass`・autofix → 採用） |
| LIVE-06 | 回答の `[[internal/meta/fetch.go:46-61]]` が生の文字で出る | メッセージ描画が `[[path:a-b]]` を知らない | server の配線で `[fetch.go:46-61](/w/<ws>/code/…#L46-L61)` に変換（不正パス・範囲はそのまま） | `wiring.test.ts` + `int07`（LIVE-06） |
| LIVE-07 | コード画面の各行の間に空行（行が 2 倍の高さ）、行番号なし | `<pre>` + `display:block` の行 + 行末の `\n` | `white-space: normal` を pre に、行に `pre` + `min-height:1lh` + 行番号（`::before`） | `live-ui`（行が連続した 1 行高さ） |
| LIVE-08 | Composer の chip: ブロックが `b_ygea9per` と id 表示、`@` メンションが 2 つの chip（見積り項目 + メンション）で出る | 表示のみ | `§4 動かしてみる`、メンションは見積り項目の ×（1 chip） | `live-ui` |
| LIVE-09 | レビュー待ちカードのフッターで「⌘⏎で採用」が 1 文字ずつ縦に折れる | 長い「検査なしで採用」ラベルで flex が潰れた | `flex-wrap` + `nowrap` | スクショ（12） |
| LIVE-10 | 低い位置のブロックから開いた Composer の chip・見積り・送信が画面の下にはみ出す | margin カードはブロックの位置に置かれる | カードが大きくなる（chip・見積り到着・行増）たびに `scrollIntoView({block:"nearest"})`（縮むときは動かない） | `fake-09-composer-fix-scrolled.png` |

## プロトタイプ（editorial/shots/03*.png）との見た目の差

直した: 上の LIVE-04/05/07/08/09/10。残っているもの（小さくないか、原因が配線の外）:

1. **Review ルートのヘッダー**: ハンバーガー + ジョブ chip で中央が狭まり、`go-small ae29abf` と 見取り図 タブが詰まる（`13-review-panel.png`）。プロトタイプは間隔あり・プロジェクト名にバージョン付き。
2. **引用（Composer の `…nfig/config.go:20 [選択] なし internal/confi…`）**: 表のセルを選ぶと前後文脈に隣の行の出典パス（`internal/config/config.go:20`）が入る。プロトタイプは散文のみ。表ブロックでは前後文脈を同じセルに閉じる／出典 `code` を除く、のが筋（`threads/anchor-text.ts`）。
3. **Review の左ペイン**: プロトタイプは該当ブロックを提案モード（del/ins）で見せる。ここでは Fix が設計書ブロックを変えない（docパッチなし）ので §4 の先頭のまま。回答済み／適用済みの 3 カード積み（Explain / Fix）はプロトタイプの密度より縦に長く、フォーカス外のカードも本文を全部出す。
4. **ゲート表示**: プロトタイプは `✓ gofmt -w 済 · 0 files` + go vet + go test。ここでは gofmt のみ（go-small の検出は fmt:gofmt だけ）。
5. **ヘッダーの frosted 背景**: スクロールした大見出し（「動かしてみる」）が薄く透ける（`11-fix-running.png`）。トークン上は仕様（`--hdr-bg` 92 % + blur 10px）だが、プロトタイプより目立つ。
6. **Composer が背が高い**: 実エンジンの束に「関連」chip が 5 つ自動で入る（`fetch.go:22/29/40/63`・`server.go:102`、合計 ≈ 0.2k tok）。
7. Explain カード: 回答が長いと本文がカードに全部出てページがカードまで追従しない（`07-explain-answered.png` は下端で切れる）。

## 残り（この run の時点。現在の状態は冒頭の「最終デモ」と `docs/HANDOFF.md` §0）

- ~~**Fix は `@` で指さないと書き込み範囲が空**~~（ux トラックで解消、最終デモで `@` なしを確認）（設計書のブロックの出典は Fix の書き込み範囲にならない）。Composer を開いた直後と空の本文で見積りが `412 E_PRECONDITION`（hint「`@` でコードを指して」）を返し、コンソールに赤い 412 が 2 つ残る。UI はヒントを出していない（プレースホルダーに `@` を促す一文を足すのが最小）。
- trust トースト（margin カードから）経由の承認はゲートを再実行しない（CR loop-wiring #5 のまま。Review パネルからのみ自動）。
- `GET /doc/proposals` は一覧のみ。`POST /doc/proposals/:pp/accept|reject`、`/integrations`、`/export`、MCP `submit_patch`、agent mode はまだ 501（`loop-wiring.md`）。
- 請求ベースの `loop.patch.in` が 3 k を超える件（上の表）。`budgets` の定義を確認するか、claude CLI の固定 overhead を見積りに載せる。
- 実エンジンで見ていないもの: repair ターン、agent mode、Linux、Codex、2 ジョブ以上の並列。
- fake モード / `live-ui` は `dist/.build/web`（`bun scripts/gen-assets.ts`）の web 資産を読む。テストは先に `gen-assets` を走らせる。

## ファイル

- `test/int/shots/live.ts`（台本。`--engine fake|real`、`--trace-sse`）、`test/int/live-ui.test.ts`、`test/int/int07.test.ts`
- 修正: `apps/web/src/{stores/sse.ts,composer/{session.svelte.ts,Composer.svelte},review/ReviewPanel.svelte,reader/CodePane.svelte,jobs/ReadyCard.svelte,threads/loop.svelte.ts}`、`packages/loop/src/jobs/runner.ts`、`packages/server/src/wiring/{loop-routes,views,workspace}.ts`
- スクショ `docs/progress/live/*.png`（run 2 の実エンジン。`fake-*.png` だけ修正後の fake 実行）、計測 `measurements.run{1,2}.json`
