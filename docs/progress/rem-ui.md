# rem-ui — 残課題パス（track ui、branch `rem/ui`、2026-10-04）

`docs/progress/audit-resolution.md` で「見送り / 一部」になった UI の残課題を片付けた。所有範囲は `apps/web/**`・
`packages/doc/src/render/`・`packages/server/src/wiring/{settings,export}*.ts`（後ろ 2 つは変更なし）。契約・core の変更は
`packages/core/CR-LEDGER.md` §8 と `docs/design/cr-requests/ui.md` に記録した（CR ui-1〜ui-4）。
**LLM の実費はゼロ**（実エンジン禁止。UI の確認は mock daemon、`test/int/shots/ui2.ts` は in-process daemon + スクリプト版
claude、文書は dogfood2 の生成済み m3e-canvas）。

## 結果一覧

| # | 項目 | 結果 | 証拠（回帰テスト） |
|---|---|---|---|
| NC-08 | 初回は「初めて」+ 5 分コース | **直した**: cookie にレベルが無く初回印も無いブラウザは「初めて」で開き、即座に保存（debounce 中の再読込で「標準」に戻らない）。§0 に歓迎カード（実時間つきのコース・今のレベル・この文書の使い方 1 行、× で ws ごとに閉じる） | `firstrun.test.ts`、`e2e/web/first-run.pw.ts`、`ui2-06` |
| NC-09 | ⌘K で本文の全文検索 → ブロックへ移動 → 「AI に聞く」 | **直した**: 初回に遅延で作る本文索引（Reader が持つ節 + 残りを目次順に 4 並列、HTML は保持しない、block の upsert で差分更新）。完全一致 → 自然文の近似（漢字 / カタカナ bigram・英単語を idf で重み付け、疑問語を除く、複合語の境界 bigram を捨てる）。ヒットは該当ブロックを開いて語を CSS highlight。常に最後に「AI に聞く」= 一番のヒットのブロック（無ければ §0）で Composer を Explain で開き、質問を入れて**送信はしない** | `fulltext.test.ts`、`doctext.test.ts`、`anchor.test.ts`（質問の置き場所）、`ui2-01〜05`（m3e: 初回の検索 10〜13 ms、ジャンプ 10〜32 ms） |
| NC-13 | ヘルプ「この画面でできること」 | **直した**: `?` が今の画面の 3 手順（Reader: 読む → 選んで聞く → 確かめて採用 / 地図 / Review / Inbox / コード）＋典型コスト＋エンジンが今受けられるか、その下にキー表。文字列は help カタログ chunk | `help-guide.test.ts`、`ui2-08` |
| NC-14 | EN のヘッダー重なり・翻訳の入口 | **直した**: タブが入らないときは情報の薄い順に落とす（1: HEAD/tag と使用量、2: ブランドの英字と検索ラベル）。レベルは 1 回で決める（落とす量の最小、DOM を flush しながら測る）。タブ自体の幅変化（件数・別言語のカタログ）でも測り直す。英語 UI × 和文 doc には「AI に英語で説明させる」（Explain の下書き、送らない）。設定の変更は再読込をまたいで残る（保留中の PATCH を localStorage に置き、版を知ってから送る） | `prefs.test.ts`、`e2e/web/i18n.pw.ts`（英語で全タブが欠けない・再読込後も）、`ui2-10/11`（重なり 0） |
| NC-15 | 読書パスの残り時間と完了 | **直した**: 節の**終わり**が画面に入ったら既読（仮想窓の mount に追従する end marker）、止まる全コースに効く。残り時間はストップごとに減る。名目と実時間が大きくずれたコースは実時間で呼ぶ（約 8 分コース）。完了したら「完了」と次のコース。ストップ一覧はカードから開く（1 層の popover） | `reading.test.ts`、`ui2-07` |
| NC-17 | popover を 1 層に | **直した**: cite peek・用語カード・claim 確認・ブロック履歴は互いに閉じ、どれも layer（Escape で今のものを閉じる）。Composer が開くと全部閉じる | `e2e/web/popovers.pw.ts` |
| NC-04 | 地図の「文脈」ズーム | **直した**: 文脈段で建物にキャプション（名前・何であるか 1 文 = 生成済み §0 の lede、無ければ README の最初の段落・外部アクター）。部屋名は残す（大きさ・パス・チップは近い段だけ） | `map.test.ts`（キャプションの 1 文）、`e2e/web/map.pw.ts` AC-J06（全ズーム段でラベル ≥ 11 px・部屋で clip）、`ui2-12` |
| EX-08 | Undo の後のコード列 | **直した**: 採用 / Undo（SSE `index.changed`）で開いているファイルを即読み直し、変わったファイルの窓キャッシュと静的 fact の peek を捨てる。claim の cite から開いた pin は引用時の blob を持ち、版が違えば「今の版の行」と言う（CR ui-2） | `e2e/web/code-column.pw.ts` |
| EX-09 | Review の左本文をアンカーへ | **直した**: Review route は左の本文をジョブのアンカー（無ければ最初の doc 提案）のブロックで開き、中央に寄せて印を付ける。キーボードは Review パネルのまま | `reader.test.ts`（`reviewAnchor`: doc に錨のあるスレッド → 提案のブロック → なし） |
| EX-10 | 履歴 UI・全主張への ✓✓ | **直した**: 「詳しい」の gutter と ⌘K「この段落の履歴」で段落の版を新しい順に（何が・誰が・いつ・どのレビュー回）。段落全体の人の確認（`POST /verify` は段落の全 claim に付く）を履歴と**どの** claim の peek からも（推測だけでなく）。✓✓ は取り消せる | `e2e/web/popovers.pw.ts`（POST verify 1 回） |
| EX-11 | trust toast がフッターに重ならない | **直した**: toast はコンテキスト列 / 地図のカード列の横に置く（送信・採用・却下を覆わない）。一時停止した実行は未生成の頁でそう言い「再開する」を出す | `width.test.ts`（AC-U-W01 の全幅）、`page.test.ts`（`genNoteOf`: 一時停止 / 未生成 / 書かれた頁） |
| — | CitePeek の行番号 | **直した**: export にあった行番号の gutter を app にも（コンポーネントへ移動、1 行 1 行） | `e2e/web/popovers.pw.ts` |
| — | TermCard のローマ字・英語の重複 | **直した**: 読みは漢字のときだけ、英語名は用語と違うときだけ、識別子には定義ファイル、ローマ字は出さない | `term.test.ts` |
| — | アプリ内の HTML 書き出し | **直した**: ⌘K（`action.exportHtml`）と設定「書き出し」からダイアログ: 開くレベル・言語・決定事項・コードの抜粋（なし = コード無し）。選択が変わるたびに既存の `POST /ws/:ws/export`（0 tok）を再実行し、**できるファイル**の大きさ・抜粋の数・伏せた秘密の数を言う。ダウンロードはその結果そのもの | `export.test.ts`、`e2e/web/export-dialog.pw.ts`（⌘K と設定から・要約が選択に追従・最後の状態を書き出す・2 回目の要求なしでダウンロード・Escape でフォーカスが戻る）、`ui2-09`（m3e: 1.08 MB / 抜粋 134 箇所 37 ファイル、コード無し 561 KB） |
| F5 | 初期 JS 117.7 KB → ≤ 60（警告）、> 150 にしない | **一部**: route ごとの初回描画までの JS は S1 118.8 → **86.3 KB**、S2 112.2 → **90.1 KB**（上限 150 は満たす、目標 60 は未達 → 残り 1） | `e2e/web/size.pw.ts`、下の表 |
| F6 | 大きな節の分割配信 | **一部**: クライアント側は 1 万 block の節でも DOM ≤ 2,440（仮想窓）・初回描画 121〜134 ms（mock）。範囲取得と JSON 圧縮は server の仕事 → CR ui-3（deferred） | `e2e/web/big-section.pw.ts` |
| F7 | 1 万 block のメモリ | **測った**: JS heap（GC 後）§0 5.0 MB → 1 万 block の節 27.3 MB → ⌘K 本文索引込み 32.7 MB。daemon RSS は所有外（残り 3） | `e2e/web/big-section.pw.ts` |

このパスで見つけて直したもの（＊ = この branch の途中で入れてしまい、同じ branch で直したもの。他は main でも起きていた）:

| 不具合 | 直し方 | 回帰テスト |
|---|---|---|
| AC-U03 地図の初回描画が動く（1440: 0.0287、1280: 0.0019） | README / lede の枠とタイル列を予約（profile が「無い」と言うまで skeleton、その後は空き）、meta 2 行・抜粋 3 行、未生成 repo の見積りカードの高さを予約（464 / 484 / 445 px） | `reader.pw.ts` AC-U03（両幅 0） |
| AC-U03 Reader の初回描画が動く（0.0126〜0.0142、spec の閾値 < 0.01 も AC の ≤ 0.001 も未達） | rail の minimap の箱を最初から持つ（地図 view を待っていた: パスカードと目次が 142 px 落ちた）、使用量の枠、余白のヒントを統計の上へ | `reader.pw.ts`（≤ 0.001 に締めた、実測 0） |
| ヘッダーのプロジェクト名が後から来てタブが動く | 最後に出したチップ（名前・HEAD・tag）を ws ごとに覚えて即描画。初めての ws は 11em を保持（入らないときは文字を落とす前に手放す） | `reader.pw.ts`（再訪の 2 回目の起動で予約なし・CLS 0）、`i18n.pw.ts` |
| 「この節について」が loop UI の到着で消える | loop の余白が空（スレッドも Composer も無い頁）なら空余白をそのまま出す（`display: contents` の host + `:empty`） | `reader.pw.ts`（loop の install 後も表示） |
| cite peek が wheel の後にチップを覆う（12 回中 2 回） | 高さの上限付きで置いた peek を、上限を外して測る（`naturalHeight`）。上限付きの高さで測ると「入る」と判断して上限を外し、伸びて覆い、observer がまた上限を付ける振動だった。term card・claim・履歴も同じ測り方に | `reader.test.ts`（2 回置いて同じ箱）、`reader.pw.ts`（再配置 3 回でも隙間 ≤ 8 px、12/12） |
| ＊ ヘッダーの縮退が 0 ↔ 1 を往復する（タブも監視したため） | 上の「1 回で決める」へ（ヒステリシス 120 px より使用量の枠の方が広かった） | `i18n.pw.ts` ja → en の shift 0.0084（≤ 0.01） |
| AC-J06 の spec が部屋の大きさラベルを「clip されない」と誤判定 | `.corner`（overflow visible の 0 サイズの錨）ではなく部屋自身の `<svg>` を clip として見る | `map.pw.ts` AC-J06 |
| ＊ export viewer が予算超過（60.19 KB） | 近似 tier を注入式にして viewer では渡さない（viewer の検索は main と同じく完全一致）、peek の ✓✓ を app だけの `PeekVerify` に | `fulltext.test.ts`（tier 無しは完全一致だけ）、`@export` e2e 29 本 |

## 計測（before = main `a427f36` の build、after = この branch の最終）

route ごとの初回描画（`mitori:map:painted` / `mitori:section:rendered`）までに読んだ JS、gzip（`e2e/web/size.pw.ts`、KB = 1,024 B）:

| route | before | after | 内訳（after） |
|---|---|---|---|
| S1 地図 | 118.8 | **86.3** | entry 59.4 · i18n-ja 9.7 · map 16.3 · boot 0.6 · engine 0.3 |
| S2 Reader | 112.2 | **90.1** | entry 59.4 · i18n-ja 9.7 · reader 18.4 · decorate 1.6 · levels 0.4 · boot 0.6 |

before は loop UI（19 KB）と全文字列のカタログ（18.7 KB）を初回に読んでいた。after は loop を描画後の idle（Inbox / Review route・選択・c / e / f では即時）、カタログを base + 遅延 4 群（loop・help・palette・gen）に分けた。

`bun run size`（served gzip、KB = 1,000 B。before は main の同じ設定の build を gzip -9 で測った値）:

| budget | before | after | target / limit |
|---|---|---|---|
| asset.js.initial.gz（shell が静的に要求する 2 ファイル = entry + boot） | 58.1 | 61.5 | 60 / 150 |
| asset.chunk.entry | 57.6 | 60.9 | 30 / 34.5 |
| asset.chunk.i18n-ja | 18.7 | **9.9** | 9 / 10.35 |
| asset.chunk.i18n-en | 16.8 | **8.6** | 8 / 9.2 |
| asset.chunk.loop | 18.9 | 19.4 | 12 / 13.8（初回描画には載らなくなった） |
| asset.chunk.reader（本体 + pop） | 18.7 | 23.1 | 12 / 13.8 |
| asset.chunk.palette | 3.4 | 7.7 | 4 / 4.6（本文索引・近似 tier・「AI に聞く」） |
| asset.chunk.gen | 9.0 | 9.2 | 6 / 6.9 |
| asset.chunk.map | 16.3 | 16.6 | 9 / 10.35 |
| asset.viewer.js | 58.4 | **59.4** | 60 / 70（ok） |
| asset.css.gz | — | 13.1 | 15 / 25（ok） |

entry が 3.3 KB 増えたのは NC-15 の rail（+5.1 KB raw）・カタログの loader（+1.5 KB raw）・ヘッダーの縮退と chip の記憶。
Rail を entry から出すと静的な値は 58.1 に戻るが、route の実際の初期 JS は 1 KB 増える（chunk 境界で圧縮が効かない）ので
やらなかった（実測の route 値を優先）。

操作の速さ（mock、他エージェント稼働中の Apple M-series。上限は spec のまま、緩めていない）:

| 計測 | 値 | 上限 |
|---|---|---|
| レベル切替（AC-J20） | 1.6〜14.5 ms | 50 ms |
| 節の遷移（目次クリック、p95） | 24〜55 ms | 100 ms |
| ⌘K worker（50k 項目、p95） | 3.1 ms | 16 ms |
| ⌘K 本文: 初回のヒット（1 万 block） | 218〜227 ms（索引の作成込み） | — |
| ⌘K 本文: m3e（実文書）の初回検索 / ジャンプ | 10〜13 ms / 10〜32 ms | — |
| 1 万 block の節: 初回描画 / DOM（描画時・最大） | 121〜134 ms / 1,389・2,440 | DOM 15,000 |
| CLS 地図の起動 1440 / 1280、Reader の起動 | 0 / 0 / 0（before 0.0287 / 0.0019 / 0.0142） | 0.001 |
| ja → en 切替の shift（クリック直後も数える） | 0.0084 | 0.01 |

## 残り・動かないもの

1. **F5 の目標 60 KB は未達**（route で 86.3 / 90.1 KB、上限 150 は満たす）。entry だけで 60.9 KB あり、そのうち Svelte の
   runtime が約 25 KB、core の route 表（`ROUTE_META` 11 KB raw）と error / pricing 表、`contract.ts` の定数（11 KB raw）、
   shell（Rail 22 KB・Shell 19.5 KB・Header 15.5 KB raw）と stores（54 KB raw）。次の手: route 表を client 用の
   `{kind, mutates}` だけに生成する（core / client の変更、所有外）、Rail と Header の縮退ロジックを route chunk へ、
   stores の初期化を route ごとに。chunk ごとの予算（entry・loop・map・merge・palette・reader・gen）は main と同じく
   「M3 までは警告」の超過のまま。
2. **F6 の範囲取得・圧縮は server 側**（CR ui-3、deferred）: `GET …/doc/sections/:section` は節全体を 1 本の非圧縮 JSON で
   返す（圧縮は static asset だけ、`packages/server/src/http/static.ts`）。1 万 block の実 daemon での転送・parse は測っていない
   （corpus にその規模の文書が無い。mock の 1 万 block で上の値）。
3. **F7 の daemon 側**（RSS）は所有外（`packages/server/src/http/rss.int.test.ts` の範囲）。測ったのはクライアントの heap。
4. **配線されていない route**（501）: ブロックの revert・節 / ブロックの translate・simplify（CR ui-4）。UI はどれも出さない:
   履歴は読むだけ（「この版に戻す」なし）、英語 UI の和文 doc は「AI に英語で説明させる」（訳の表示ではない）。
5. **export viewer の ⌘K 本文検索は完全一致だけ**（main と同じ）。近似 tier は app だけ（viewer の 60 KB 予算）。
6. **AC-J01（`map.pw.ts:8`）は spec が古い**: 地図の作り直し（visual トラック）で `.strip`・`.toc`・`.est .sum` が無くなり、
   main でも同じく失敗する（`.strip` は main の MapPage にも無い）。新しい配置で「見積りと 0 tok の一覧がスクロール無しで
   見える」を満たすかは配置の判断なので、spec の書き直しは visual / 地図の持ち主に残す。web e2e は 94 本中これ 1 本だけ失敗。
7. 1440 px の英語で、長いタブ（件数の枠込み）とプロジェクト名の組み合わせによっては縮退 1（HEAD と使用量を隠す）になる。
   どちらもステータスバー / 地図にある。重なりと欠けは無い（`ui2-10`）。
8. `bin.startup` は 35〜50 ms（目標 20、上限 50）。この track の変更ではない（負荷の高い機械での値）。

## 検証

- `scripts/nd bun run check` — ok（tsc・biome・boundaries・cr-ledger・budgets・contract-index・svelte-check）
- `scripts/nd bun test apps/web` — 358 pass、`packages/core` 60 pass、`e2e/export bench/budgets` 20 pass
- `MITORI_E2E_SKIP_BUILD=1 scripts/nd bunx playwright test -c e2e/web/playwright.config.ts` — 93 / 94（AC-J01 だけ、上の 6）
- `MITORI_E2E_CHANNEL=chrome scripts/nd bun run e2e --grep @export` — 29 pass
- `scripts/nd bun run build:bin && scripts/nd bun run size` — `size: web assets ok`（上の表）
- `scripts/nd bun scripts/gen-assets.ts && scripts/nd bun test/int/shots/ui2.ts --out docs/progress/ui2` — 12 枚、
  `ui2-run.json`（コンソールエラー 0・4xx/5xx 0）

スクリーンショット（Chrome、1440×900、m3e-canvas の生成済み文書）: `docs/progress/ui2/ui2-01〜12`。
