# UI プロトタイプ審査 — 判定書（JUDGEMENT）

- 作成日: 2026-10-03 / 審査委員長（design judge panel chair）
- 対象: `docs/design/prototypes/{editorial,pro,map}/`（各 `index.html` + `README.md` + `shots/*.png`）
- 入力: `docs/research/00-synthesis.md`（Critic addendum E を含む）、`07-ux-principles.md`、`docs/design/contracts/{ui,core,api}.ts`、`docs/design/MILESTONES.md`（WP-10a / WP-10b / WP-13）
- 位置づけ: この文書が **WP-10a（shell・見取り図・Reader）と WP-10b（review ループ）の UI 正本**になる。3 案の README のうち、本書で「採用」と書いた節だけが仕様として生き残る。本書と各 README が食い違う場合は本書が優先する。
- 表記: **[実測]** = 本審査で測った値 / **[README]** = 各案の README の自己計測 / **[仮]** = 推定値。測り方を必ず併記する。

---

## 0. 結論（TL;DR）

1. **基盤は Editorial Calm**（重み付き合計 75 / 100。Pro 71.5、Map 66）。主役である設計書の組版・信頼表示・余白スレッド・Review パネルの完成度が最も高く、欠点は「足りない」型で、後から足せる。Pro は AA コントラスト違反 75 件と初見者への過負荷、Map は読む面の窮屈さとレイアウト算法の未検証という、**構造的な欠点**を抱える。
2. **Pro からは「計器」を移植する**: 右列の「コード」モード（scrollspy・backlink）、ステータスバー、ヘッダーのジョブチップ、Composer の router 表示と見積り内訳、計画ステージを先に並べるジョブカード、生成見積りカードの stage 表・engine 選択・データ開示、失敗詳細、Inbox のグループ化、数値書式、キーボード実装。
3. **Map からは「間取り」を移植する**: S1 のレイアウト構成（地図を主役にした 3 列）、Z0〜Z2（＋限定的な Z3）の意味的ズーム、外部アクター枠とラベル付きの関係、§3 の流れを地図に番号付き矢印で重ねる表示、スレッドのピンと AI 作業枠、Reader レールの縮図、「0 tok で今できること」、焦点単位の採用（K7）、ローマ字正規化表。
4. **捨てるもの**: Pro の「1024px 以上で Split view を常時表示」、ジョブ表示の 3 重化、Composer に TextQuote の内部表現を出すこと、`--faint #959ba6`。Map の「地図の上に重ねたシートで本文を読む」構成、ポインタ位置で意味が変わる深さキー（K1）、地図左上に固定した peek、全出典への常時 ✓。3 案共通の欠陥として、和欧間の手入力スペース（Pro・Map）、11px 未満の文字（Pro・Map）、EN 表示時の和文の漏れ（Editorial）、トーストと下端固定バーの重なり（Editorial）を禁止する。
5. 右列は **1 本の「文脈列」に統一**し、`margin`（スレッド・Composer・ジョブを段落の高さに置く。Editorial）/ `code`（Split view。Pro）/ `review`（640px。Editorial + Pro）の 3 モードを決定的な規則で切り替える（§6.2）。読者レベル「詳しい」のときだけ、既定を `code` にする。
6. 受け入れ基準は §10 の AC-J01〜AC-J62。契約の変更要望は §9 にまとめた（`ui.ts` の keymap / scope、`api.ts` の `PaletteItem`・`BlockView`・`MapView`、`core.ts` の `DiagramKind`・`DiagramLayout`・`DiagramAnchor`・`Job`・`GateResult`）。

---

## 1. 審査の方法

### 1.1 見たもの

| 案 | スクリーンショット（全数を閲覧） | HTML | README |
|---|---|---|---|
| Editorial Calm | 20 枚（`01-first-run-map` 〜 `09-help-overlay`、1440×900 @2x、タブレット 820×1180） | 283KB（gz 83KB） | 334 行 |
| Pro Cockpit | 18 枚（`01-scan-1440` 〜 `07b-doc-tablet-sheet-820`） | 305KB（gz 93KB） | 513 行 |
| Map-first Spatial | 16 枚（`01-first-run` 〜 `12-z0-dark`） | 281KB（gz 90KB） | 253 行 |

合計 54 枚をすべて閲覧した。HTML は静的に解析した（IME ガード、`aria-*`、組版 CSS、和欧間スペース、CSS / JS / HTML の内訳）。

### 1.2 独自計測（同じ条件で 3 案を測った）[実測]

- スクリプト: `docs/design/prototypes/judge-tools/judge-probe.mjs`。結果: `judge-tools/probe-results.json`。
- 条件: Playwright + 手元の Google Chrome（`channel:'chrome'`）、1440×900、deviceScaleFactor 1。1 案につき 5 状態（文書・ライト / 文書・ダーク / 見取り図 / Review / Inbox）。
- 測った項目: DOM ノード数。可視テキスト要素の最小 px と 11px・12px 未満の数。**WCAG コントラスト**（祖先の背景をアルファ合成して計算。18.66px 太字・24px 以上は 3:1、それ以外は 4.5:1）。可視な操作要素のうち 24×24px 未満の数。本文の段落の font-size / line-height / 幅 / 1 行の字数 / `text-autospace` / `line-break` の computed 値。Tab を 20 回押したときに focus 表示が出た数。

| 指標（文書・ライト） | Editorial | Pro | Map |
|---|---:|---:|---:|
| DOM ノード | 1,792 | 1,702 | 1,759 |
| DOM ノード（Review 状態） | 2,653 | 1,948 | 2,174 |
| 最小テキスト px | 10.5 | 10.0 | **9.5** |
| 11px 未満のテキスト要素 | 6 | 10 | **46** |
| **AA コントラスト不合格**（不合格数 / 検査数） | **5 / 177**（うち 4 件は装飾の `·`） | **75 / 308** | **64 / 195** |
| 同・ダーク | 4 / 177 | 63 / 308 | 46 / 195 |
| 24px 未満の操作要素（可視） | 3（出典チップ 20px。`::after` で 26px に拡張済みとの記述あり） | **25** | 17 |
| 本文 font-size / line-height | 16px / 1.9 | 15px / 1.85 | 15px / 1.85 |
| 本文の幅 / 1 行の和字数 | 592px / 37 字 | 573px / 38 字 | 535px / 36 字 |
| 本文の `text-autospace`（computed。和欧混在の要素ごと） | すべて normal（p 51 / li 19 / dd 9 / td 12 / .blk 28） | **p だけ normal**。li 21 件・.blk 17 件・summary 3 件が no-autospace（`.prose p` にしか指定がない） | p・.blk は normal。**li 10 / 17 件が no-autospace** |
| 本文の `line-break`（computed） | auto（`p, li, dd` にのみ strict） | auto（`p, li` のみ） | strict |
| Tab 20 回で focus 表示あり | 20 / 20 | 20 / 20 | 20 / 20 |
| `aria-live` 領域 | 3 | 1 | 3 |

- Pro の不合格の主因は `--faint #959ba6` on `#fbfbfc` の **2.70:1**（目次の「設計書 .mitori/」・各章の分数・検索欄の「検索・コマンド」2.79:1 など）。Map の主因は `--ink-4 #9ba0a9` on `#f4f3ef` の **2.37:1** と、`--ink-3 #6f7581` on `#f4f3ef` の **4.17:1**（13.5px のタブ「文書」「Inbox」、`main · 406875d` など）。Editorial の `--faint #75706A` は `--paper` 上で 4.66:1、`--paper-2` 上では 4.38:1 で、README の「`--faint` は paper / sheet の上でだけ使う」という規則が守られている限り合格する。
- **和欧間の手入力スペース**（設計書本文の原稿に、和字と英数字のあいだの半角空白が入っている）: HTML 全体で「和字＋空白＋英数」が Editorial 139 / Pro 310 / Map 398、「英数＋空白＋和字」が 237 / 477 / 663。空白なしで隣接している箇所は 368 / 69 / 71。Editorial の本文は 07 §4.1 の「原稿に空白を入れず `text-autospace` に任せる」を守っている（空白は主に UI 文言）。Pro と Map は本文でも空白を手で入れている（例: Pro「client は daemon の準備ができるまで … 500 ms ごと」、Map「git mode では 1 秒ごとの ticker で」）。
- JS の規模（参考）: 和字を含む文字列リテラルと 60 字を超える文字列リテラルを除いた「ロジックだけ」の JS は、gz で Editorial 約 25KB / Pro 約 34KB / Map 約 36KB [仮: 正規表現による粗い除去。本番の Svelte の出力サイズとは比べられない]。CSS は gz で 13.2KB / 12.1KB / 12.8KB で、3 案とも CSS 予算（15KB）に近い。

### 1.3 採点の基準

8 観点を 1〜10 で採点する。重みは、製品の主戦場（閉ループ D-1 と信頼 D-2）と、初見者から専門家まで（D-3）を反映して決めた。

| 観点 | 重み | 10 点の条件 |
|---|---:|---|
| ① 初見者の分かりやすさ（P1 / P3 が 5 分で repo を掴む） | 1.5 | 何もしなくても全体像・入口・次にやることが見え、専門用語が説明されている |
| ② 専門家の密度と精度（P2） | 1.5 | 主張・出典・コード・状態を、モード切替なしで突き合わせられる |
| ③ Review → AI ループの明快さと信頼（費用の可視化・diff の review） | 2.0 | 事前見積 → 実イベント → 実績と差分の証拠が 1 画面に揃い、全部取り消せる |
| ④ 和文組版の質 | 1.0 | JLREQ に沿い、どの部品でも崩れない |
| ⑤ 視覚的な完成度と喜び | 1.0 | 一貫したトーン、記憶に残る「見取り図」らしさ、騒がしくない |
| ⑥ キーボード中心の操作性 | 1.0 | 全操作が 2 打鍵以内、モードの曖昧さがない、IME で壊れない |
| ⑦ 予算内での性能の実現性（初期 JS 60KB、DOM 5k 以下） | 1.0 | 既知の技術で予算内に収まり、未検証の算法に依存しない |
| ⑧ アクセシビリティ | 1.0 | WCAG 2.2 AA の測れる項目がすべて合格する |

---

## 2. 採点

| 観点（重み） | Editorial | Pro | Map |
|---|:---:|:---:|:---:|
| ① 初見者（1.5） | 7 | 4 | **8** |
| ② 専門家（1.5） | 5 | **9** | 6 |
| ③ ループと信頼（2.0） | 8 | **9** | 8 |
| ④ 和文組版（1.0） | **9** | 6 | 6 |
| ⑤ 完成度と喜び（1.0） | **9** | 7 | 8 |
| ⑥ キーボード（1.0） | 8 | **9** | 6 |
| ⑦ 性能の実現性（1.0） | **8** | 7 | 5 |
| ⑧ アクセシビリティ（1.0） | **7** | 5 | 4 |
| 素点の合計（80 点満点） | **61** | 56 | 51 |
| **重み付き合計（100 点満点）** | **75.0** | 71.5 | 66.0 |

### 2.1 採点の根拠（要素を名指しする）

**① 初見者**
- Editorial **7**: `01-first-run-map` で、0 tok の段階では README の 1 行目を「原文のまま（生成すると日本語の要約に置き換わる）」と明記して出している（LLM の要約を装わない誠実さ）。規模 4 セル（Go 本体 45.7k 行 · web/ 34.6k · Go テスト 83.0k · 15 種のエージェント統合）、30 分コースのリング、`01b-map-hover` の部屋 hover（関係のない部屋を薄くし、朱の点線で依存を示し、L0 の 1 行要約カード「セッションとコメント — レビュー状態の持ち主…」を出す）。`02c-reader-newcomer` の「やさしく · 初めての人向けの言い換え · 0.4k tok · キャッシュ済」と段落末の「出典 1」。減点: 地図はズームできず、外部アクターは矢印の注記だけで、地図は 1440×900 で画面の下半分しか見えない。ヘッダー右上の「今日 $0.14 · 21.4k tok / 5h 23%」は P3 には意味が通じない。
- Pro **4**: `01-scan-1440` は計器盤そのもの。トップバーに 11 個の部品、ステータスバーに 9 区画（`index ✓ 1,219 files · warm 9 ms`、`C=3`、`R1 · 406875d` など）、Container 図のノード名は `internal/session` のようなパス（「ラベルは生成後に付きます」）。`03b-composer-1440` には `TextQuote (prefix 32 + exact + suffix 32) · b_q7m2xk4d` という内部表現まで出る。救いは facts カードの「ここから読む: main → RunReviewClient → handleReviewCycle」と、初めてレベルの Why 展開。
- Map **8**: `11-z3`・`10-z1`・`12-z0-dark` の C4 ズーム（Z0「crit · Go 単一バイナリ · 20.8MB · 17 部屋 / 4 区画」と関係ラベル `skill / hook`・`gh / glab`・`atomic write`、Z1 の区画「daemon（crit _serve）常駐 · 127.0.0.1 · HTTP / SSE · 状態」、Z3 の家具「watch.go 1,220 行 carryForwardComments · verifyAndCorrectPosition」）。`09-flow` は §3.1 の手順番号 1〜6 を地図に重ねる（どこで何が起きるかが一目で分かる）。`01-first-run` 左レールの「0 tok で今できること」。減点: HUD のチップ 5 個 + ズーム HUD + 凡例 + ピン + 辺のラベル + 部屋の状態行（「確認済 3/3 · 変更 7」）で画面が騒がしい。10〜10.5px のラベルが多い（11px 未満が 46 要素）。

**② 専門家**
- Editorial **5**: 本文は 37em の 1 列だけ。コードは hover の peek か `o` で固定するまで見えない。`02-reader-standard` では、右の margin 列（368px）の上半分が最初のスレッドまで空いている。詳しいレベル（`02d`）の Markdown 行番号（L34 / L38）と範囲付きチップは良い。
- Pro **9**: `02-doc-standard-1440` の右ペインは scrollspy でハイライトし、「172 行を省略（1–172）」で畳み、`§3 backlink 1` と blob `65a27dd` を出す。`02c-doc-expert` はガターに block ID（`b_r8t2w5zd`）と `L12`、チップは `internal/daemon/client.go:124–154`。`03d-ready` は文書の提案とコード diff を同時に並べる。減点: diff は幅 500px の unified だけ。
- Map **6**: `08-doc` の文書ビューは Code peek を固定でき、詳しいレベルで L27 などの行番号を出す。Z3 の家具でシンボルが分かる。ただ主たる読む面は 600px のシートで、地図は後ろで切れる（`02-reader` では右端の部屋が欠ける）。

**③ ループと信頼**
- Editorial **8**: `03c-job-running` のジョブカードは実ステージ（受付 38ms → 準備 snapshot → claude-sonnet-5-5 を起動 → 応答を受信中 ttft 2.2s）に加え、`ops[0] cli_handlers_story.go 629–659 replace` のように、patch/1 の構造化出力を 1 行ずつ流す。% バーは無い。`03e-review-ready` は 1 画面に、ゲート 4 種、実績「入力 2.5k cache 620 出力 1.2k $0.016 API換算 13.1s（モデル 6s + ゲート 7.1s）見積 ≈3.9k → −6%」、`result` 由来の要約 4 項目（「gofmt の整列で直後の AuthToken〜AuthUserID の 4 行も空白だけ変わった（意味の変化なし）」）、ファイル単位の ✓ / ✕、下端固定の［すべて採用 ⌘⏎］［却下 ⌘⌫］を収める。`04-inbox` の doc_edit 2 択は、選択肢ごとの費用（0 tok / ≈3.2k tok · ≈$0.02）を出す。減点: Composer（`03b`）に router（patch / agent）の表示がない。見積りの内訳はスクリーンショットで確認できない。ジョブカードが画面外に出ると全体の状態を示すものがない（ジョブチップもステータスバーもない）。`04-inbox` ではトースト「反映しました…」が「まとめて送る」バーの上に重なっている（下端固定要素どうしの衝突）。
- Pro **9**: `03c-running` は router が決めた計画を最初から淡色で並べる（受付 / bundle / snapshot / 起動 / 生成 / patch / 適用 / gofmt / go vet / go test）。`03b-composer` の router 表示「patch 46 行 · 2 ファイル · sonnet-5-5」、doc_edit の 2 択「コードを文書に合わせる / 文書だけ直す」、点線の候補チップ「+ 関連: cli_handlers_story_llm_test.go +1.4k」、固定チップ「固定: system + 規約 0.7k cache」。`03b2` の内訳（各チップの tok、単価の注記、「係数を指数移動平均で補正（現在の誤差 ±9%）」）。`03d-ready` の「14.2 秒（LLM 5.1 + gate 9.0）」「見積 ≈4.0k / $0.019（実績 3.9k · −2%）5h +0.1%」。`04-inbox` の失敗詳細（原因の連鎖「patch → gate 失敗 ×2 → agent mode に昇格（--resume）→ go test 失敗」、stderr 末尾 3 行、ここまでの費用 $0.043 · 3 回の実行、［Opus high で提案のみ ≈$0.09］）。`01-scan` の生成見積り（stage 表、engine の radio に session C=1 約 17 分を明示、5h 枠 80% での譲り合い、「見積りは 10 分有効」）。減点: ジョブを 3 か所（チップ・ステータスバー・ジョブタブ）に出していて冗長。
- Map **8**: `03a-composer` の 2 択と、提案チップ「+ ingest.go:146-172 0.7k」、見積り行「≈3.6k tok · API換算 $0.021 · 約 8 秒 · claude-sonnet-5-5 · patch」。`03b-running` の「範囲検査 2 files ⊂ WRITE · deny glob 0」と「通常 6–11 秒（同じ意図の過去 12 件 · p25–p75）· 読み続けて大丈夫です」。`03-ready` の Unified / Split 切替、影響を受ける部屋の縮図（「影響: CLI 入口 · 設定」）、焦点単位の採用。減点: **diff は実際に適用・検証していない**（README §0「妥当な提案」）。Editorial と Pro は crit@406875d に当てて gofmt / vet / test を通している。Review overlay が地図を覆うので、最も重要な場面で map-first を自ら捨てている。

**④ 和文組版**
- Editorial **9**: 16px / 1.9 / 37 字、明朝の見出し（34px / 600 / oldstyle-nums の節番号）、`html` に `text-autospace: normal`、本文の原稿に和欧間スペースなし、太字 600、tabular-nums。減点: Windows の Yu Mincho は未確認。メタ情報は 11px。
- Pro **6**: 本文 15 / 1.85 は可。和欧間の手入力スペース、`li` で autospace が効かない（§1.2）、見出しの weight 650（Hiragino で W6 と W7 のどちらになるかが環境で揺れる）、chrome の主力が 12px（219 要素）。
- Map **6**: `.prose` に strict と autospace を指定しているが、和欧混在の `li` の 10 / 17 件で autospace が効いていない（§1.2）。Pro と同じく原稿に手入力スペースがあり、9.5〜10.5px のラベルが多い。

**⑤ 完成度と喜び**
- Editorial **9**: 紙（`#FAF9F6`）・墨・朱だけの抑制された配色と明朝で、「設計書」の格がある（`06-reader-dark` は暗くても温かい `#141311`）。確認済みの ✓ は既定で隠して静けさを保ち、推測だけを常に見せる。採用時の 1 回だけの flash と、10 秒の残り時間を示す線。
- Pro **7**: Linear 風で破綻はないが、どこにでもある開発ツールの顔で、チップが多くうるさい。
- Map **8**: 扉の開き弧、ピン、区画の太線は製品名（見取り図）そのもので、最も記憶に残る。重ね表示が多すぎて減点。

**⑥ キーボード**
- Editorial **8**: keymap をほぼ全部実装し（`09-help-overlay`）、パレットを閉じると元のフォーカスに戻し、`r` で Review、`1` / `2` で doc_edit を選べる。Inbox の複数選択キーがない。
- Pro **9**: capture 段の単一ハンドラ、`e.code` で判定、37 項目の自動検証が全部 PASS [README]、ペイン幅を矢印キーで変えられる、hunk ヘッダーが sticky、パレットの Action panel、Esc で段階的に閉じる。
- Map **6**: `-` / `=` / `0` が「ポインタかフォーカスのある領域」で地図のズームと読者レベルに分かれる（K1）。状態が見えにくく、モードの取り違えが起きる。ホイール・ピンチ・矢印の 3 系統で地図を操作する。

**⑦ 性能の実現性**
- Editorial **8**: DOM 1.7〜2.7k [実測]。地図は静的 SVG（サーバ側でスライス配置）。margin カードの配置は rAF 1 回で済む。CSS は gz 13.2KB で予算の端。
- Pro **7**: DOM 0.5〜1.9k [実測]。常時表示のコードペインは、ハイライト済み HTML の配信と IntersectionObserver が要るが、マウントするコード行は 400 行以下に収まる。
- Map **5**: カメラ・LOD のクラス付け替え・ラベルの逆スケーリングを毎フレーム行う。床面のレイアウト（squarified treemap + Fiedler ベクトル順）は**手配置で代用していて未検証**。部屋が 40 を超え、Z3 の家具（部屋あたり最大 5 ファイル × 2 行）まで出すと、SVG のテキストが数百ノード増える。

**⑧ アクセシビリティ**
- Editorial **7**: 不合格は装飾の `·` 4 件と 11px の数字 1 件（4.24:1）だけ。`aria-live` 3、dialog に `aria-modal`、focus 表示 20 / 20。地図の「テキストで見る」は件数のトーストだけで未実装（README §10-6）。
- Pro **5**: AA 不合格 75 件（§1.2）、24px 未満の操作要素 25 個（ブロック操作ボタンが 24×22、目次のコース選択が高さ 19px）。キーボードと focus は良い。
- Map **4**: AA 不合格 64 件、最小 9.5px、11px 未満が 46 要素、ページャの点が 22px 幅、dialog に `aria-modal` がない。

---

## 3. 各案の講評（厳しめに）

### 3.1 Editorial Calm — 基盤に採用

- **最良の点**: 設計書を「読む」体験。章頭の「この章で分かること」（明朝の番号）、本文の出典チップ、margin のスレッド（CSS Custom Highlight API でアンカーを塗り、DOM を割らない）、段落内の提案モード（`03d`。取り消し線と淡い赤 / 1.5px 下線と淡い緑、紫の面のヘッダー「提案 · mitori AI（claude-sonnet-5-5）· R2 · 本文」）、Review パネルの証拠の密度（`03e`）、peek のフッターに出る検証の内訳「確認済 範囲は実在 · 識別子一致 · hash 一致」（`02b`）。D-2（検証可能な設計書）を最もよく体現している。
- **欠陥（本書で直す）**:
  1. 専門家の密度不足（コード列が無い）→ 右列の `code` モードを Pro から移植する（§6.2）。
  2. 全体のジョブ状態が見えない → ヘッダーのジョブチップとステータスバー（Pro）。
  3. EN 表示で和文が漏れる（`08-en-chrome-explain-answered`: カードの「あなた → mitori AI」「入力 1.6k（キャッシュ 1.0k）· 出力 410」「見積 ≈2.7k」「文書に追記」「返信」、ページャ「次 · 約2分」、レール下端の「生成 6分12秒」）。README §5 の「切り替え対象」に、カードのメタ行が入っていない → AC-J12 で CI に検出させる。
  4. トーストと「まとめて送る」バーが重なる（`04-inbox`）→ 下端固定要素の積み上げ規則（§6.8）。
  5. 地図が静的で、外部アクターが矢印の注記にとどまる → Map の S1 構成とズームを移植する（§6.3）。
  6. ジョブカードの flags 行が 316px で切れる（`03c`:「claude -p --setting-sources "" --str…」）→ 折りたたみと展開（§6.6）。

### 3.2 Pro Cockpit — 計器を移植する

- **最良の点**: 費用と状態の誠実さ。生成見積りの stage 表と engine の比較（claude-cli C=3 約 6 分 / session C=1 約 17 分 / anthropic-api 未設定 $0.71）、見積りの有効期限（index digest に紐づけて 10 分）、ジョブの計画ステージ、LLM と gate の時間の分離、失敗時の昇格の費用と確認。Addendum A1 / A4 / C2 / C8 を UI として最も正確に実装している。
- **欠陥（移植するときに直す）**:
  1. `--faint #959ba6` を本文の近くで多用しており、AA 不合格が 75 件ある → 移植するのは部品の構造だけで、色は Editorial のトークンを使う。
  2. 1024px 以上で Split view を常時表示する（P-1）のは、P1 / P3 にとってコードの壁になる → 「詳しい」レベルの既定と `o` に限定する。
  3. Composer の TextQuote 表記 → 削除する（詳しいレベルで block ID だけ出す）。
  4. ジョブ表示の 3 重化（P-2）→ ヘッダーのチップとステータスバーの 2 か所にする。ジョブの一覧は Inbox の「作業中」フィルタで足りる。
  5. ブロック操作ボタンが 24×22px → 28×28px にする。

### 3.3 Map-first Spatial — 間取りを移植する

- **最良の点**: 「見取り図」という製品名に最も忠実で、C4 のズームを本物の操作として成立させた。§3 の流れを地図に重ねる（K6）のは、どの競合にもない説明の仕方で、P1 / P3 の 5 分理解に最も効く。
- **欠陥（移植するときに捨てる・直す）**:
  1. 600px のシートで本文を読ませる（K2）。地図は後ろで切れ、本文は 535px に窮屈に収まる。1280×800 では成り立たないと README 自身が認めている（§11-3）→ 読むのは Reader（S2）に任せ、S1 では部屋カードだけを右列に出す。
  2. 深さキー K1 → route（画面）単位の scope にする（§6.14）。
  3. 地図左上に固定した peek（チップから約 600px 離れる）→ Editorial の、チップに接して出る peek に戻す。
  4. 全チップへの常時 ✓（`02-reader`・`06-reader-dark`）→ Editorial の規則（✓ は hover・⌥・詳しいレベルでだけ出す）。
  5. レイアウト算法が未検証 → 品質ゲートを設け、通らなければ ELK の Container 図（Pro の `01-scan` 形式）に退避する（§6.3.4）。
  6. 文字が小さく、コントラストが低い（§1.2）→ 地図のラベルは画面上で 11px 以上、トークンは Editorial のものを使う。

---

## 4. 判定

**基盤: Editorial Calm。** 理由は 3 つある。

1. mitori の成果物は設計書である。組版・信頼表示・提案モードという**読む面の品質**は後から足しにくく、Editorial だけがそれを満たしている（④ 9、⑧ 7）。
2. Editorial の欠陥は「部品が足りない」型で、Pro と Map の部品を足せば直る。Pro の欠陥（色のトークン体系と、常時 3 列という情報量の前提）と Map の欠陥（シートで読む構成と、未検証の算法への依存）は構造に根差しており、土台にすると全面的な作り直しになる。
3. 性能の予算に対する余裕が最も大きい（ロジックだけの JS 約 25KB gz [仮]、DOM 1.7〜2.7k [実測]）。移植する部品（コード列・ステータスバー・地図のカメラ）の分の余地が残る。

---

## 5. 統合後の画面構成（概観）

```
S1 見取り図（≥1281px）
┌ header 52 ─ 見取り図 MITORI │ crit 406875d │ 見取り図 設計書 Inbox(3) レビュー(◆1) │ ⌘K 検索 │ 初めて|標準|詳しい │ ◐1 ◆1 │ ◑ │ EN │ ? ┐
├ rail 248 ──────┬ strip 96: スキャン完了 · 1,219 files · 0.27 秒 · 0 tok ／ crit（明朝 34）Go · MIT · 406875d ┬ right 400 ─────────────┤
│ 30分コース 0/7   │ stage（間取り図 floorplan Z0–Z3、ピン、AI 枠、流れ）                            │ 設計書を生成する（見積り）  │
│ 目次（状態・≈k）   │  HUD: コメント ✓ / AI 作業中 ✓ / 表示 ▾ ……………… ズーム [文脈|区画|部屋|コード] − + ⤢ │ 0 tok で今できること        │
│ 生成メタ・網羅率   │                                                                                │ 静的に分かったこと（6 枚）  │
└────────────────┴────────────────────────────────────────────────────────────────┴ S0–S4 の所要時間 ─────┘
└ status 24 ─ ● daemon │ index ✓ 1,219 files · warm 9 ms │ ジョブ 1 実行中 · 0 待機 · C=3 │ 今日 450.4k tok · $1.33 API換算 │ 5h 33% · 7d 44% │ claude-cli · subscription │ ? ┘

S2 設計書（≥1281px、標準レベル）
┌ header ───────────────────────────────────────────────────────────────────────────────────────────┐
├ rail 248 ──────┬ prose 列（本文 37em 中央寄せ・左ガター 28px のブロック操作）──────────┬ 文脈列 368（margin モード）┤
│ 縮図 200×120     │ §3 主要な流れ（明朝 34）約9分 · 確認済 12 · 推測 2 · 406875d · sonnet   │ スレッド / Composer / ジョブ │
│ 30分コース 3/7   │ この章で分かること … 本文 … [daemon.go:178] … 推測 …               │（段落の高さに揃える）       │
│ 目次            │ ▸ なぜ … 推測（畳んでもバッジは残す） ▸ Deep Dive …                  │                            │
└────────────────┴────────────────────────────────────────────────────────────────────┴────────────────────────────┘
```

---

## 6. 統合仕様（実装の正本）

### 6.1 グリッドとブレークポイント

| 幅 | S1 見取り図 | S2 設計書 | 共通 |
|---|---|---|---|
| ≥ 1281 | `248px minmax(0,1fr) 400px` | `248px minmax(672px,1fr) var(--ctx-w)`。`--ctx-w` は §6.2 | header 52px、status 24px、`scroll-padding-top: 80px` |
| 1024–1280 | `228px minmax(0,1fr) 360px` | `228px minmax(672px,1fr) var(--ctx-w)`。margin は 332px | header のパンくずを隠す |
| 600–1023 | rail は drawer（300px、`b`）。stage は上 42%、右列の内容は bottom sheet（高さ 52px / 50vh / 88vh の 3 段。Map の `07-reader-tablet` + Pro の 3 段） | rail は drawer。margin カードは置かず、段落の右に件数マーカー（Editorial `07`）。Composer・ジョブ・peek は bottom sheet | タッチの浮遊ツールバーは選択範囲の下 10px |
| < 600 | 地図は Z0 / Z1 だけ、ピン表示なし | 読む + コメント + 説明（`e`）だけ。読者レベルの切替は ⌘K から | — |

- prose 列: `max-width: 37em`（16px なら 592px）を中央に置く。左右の padding は 40px 以上。ブロック操作のガターは左 28px（§6.4.5）。
- 前回のペイン幅・テーマ・読者レベル・言語は、`<head>` のインラインスクリプトが cookie `mitori_ui` から最初の描画より前に CSS 変数へ復元する（CSP は hash で許可。CLS 0）。

### 6.2 文脈列（右列）のモード — 状態機械

右列は 1 本の要素 `ContextColumn` とし、モードは `margin | code | review` の 3 つにする（S2 / S5 のみ。S1 は固定で §6.3 の内容）。

| 遷移のきっかけ | 結果のモード |
|---|---|
| S2 を開く（読者レベルが 初めて / 標準） | `margin` |
| S2 を開く（読者レベルが 詳しい） | `code`（scrollspy で同期） |
| 出典チップの上で `o`、または peek の「横に固定」 | `code`（そのチップの範囲に固定。scrollspy は止める） |
| `code` で `o` をもう一度押す / `Esc` | 1 つ前のモードに戻る |
| `r`（準備完了のジョブ）/ ジョブカードの［レビュー］ | `review`（幅 640px。rail は幅 0 に畳む） |
| `review` で `Esc` / 採用 / 却下 | 1 つ前のモード（rail を戻す） |
| 読者レベルを変える | `review` 中は変えない。それ以外は上の既定に従う |

- `--ctx-w`: `margin` = 368px（1024–1280 は 332px）。`code` = `clamp(420px, 100vw − rail − 672px, 900px)`。計算結果が 420px 未満なら rail を drawer に畳み、もう一度計算する。利用者は区切り（`role="separator"`、`aria-valuenow`）をドラッグするか、フォーカスして ← / → で 24px ずつ変えられる。値は保存する。`review` = 640px。
- `code` モードでは margin カードを置かない。スレッドは段落右の件数マーカーにし、Composer とジョブカードは**対象ブロックの直下にインラインで**出す（Pro P-3 の形。1024px 未満のときと同じ部品を使う）。
- **scrollspy**（Pro §6.6 を採用）: `IntersectionObserver`（root は prose 列、`rootMargin: "-18% 0px -62% 0px"`）で、最初に可視になったブロックの主出典 `data-src` を追う。同じファイルの中での移動は class の付け替えとスクロールだけで行い、DOM を作り直さない。固定中（`o`）と Composer を開いている間は止める。
- `code` モードの中身: ファイルヘッダー（sticky、34px）`{dir}{base} [正確|推定|固定中|未 commit] … {blob7} · L{a}–{b}`。引用範囲の背景は `--mark`、行番号の列に 2px の帯。範囲外の区間は `⋯ {n} 行を省略（{from}–{to}）` で畳む。引用範囲の外で文書が引用している行には、ガターに淡い帯と `§{節}` の pill（backlink）を付ける。マウントする行は `UI_THRESHOLDS.maxMountedCodeLines`（400）以下。

### 6.3 S1 見取り図（Map の構成 + Editorial の画面）

#### 6.3.1 構成

- **strip**（高さ 96px 以下）: 1 行目 kicker「スキャン完了 · {files} files を {s} 秒で索引 · ここまで 0 tok」。2 行目に題名（明朝 34px）+ メタ（言語 · LOC · ライセンス · HEAD · 日付）。
- **stage**（残り全部。1440×900 で高さ 728px 以上）: 床面図（§6.3.3）。左上の HUD は［コメント ✓］［AI 作業中 ✓］［表示 ▾］の 3 つだけにする。「表示 ▾」の中に 変更頻度 / 鮮度 / 依存線（すべて）/ 凡例 / テキストで見る を入れる（Map の HUD チップ 5 個と常時表示の凡例をやめる）。下端中央にズーム段［文脈 Z0｜区画 Z1｜部屋 Z2｜コード Z3］と − + ⤢。
- **右列 400px**（上から。スクロール可）:
  1. 生成見積りカード（§6.11）。生成後は「生成済み 0.39M tok · $1.27 · 6分12秒 · {n} files 変更で {m} 章が古い可能性［読む ⏎］」に置き換える（Editorial `06b-map-dark`）。
  2. 「0 tok で今できること」（Map `01-first-run`）: 見取り図を歩く / 静的な節（§2 §4 §5 §8 §11）を読む / 見積りを見る。生成後は表示しない。
  3. 「静的に分かったこと（0 tok）」2 列 × 3 枚: エントリポイント · HTTP ルート · 環境変数（値は出さない）· CLI · テスト関数 · TODO（Map / Pro）。各カードは該当する節へのリンク。
  4. S0〜S4 の所要時間（`S0 列挙 1,219 files · blob sha 13ms` の形。Map）。
  5. README の 1 行目（原文のまま。Editorial）。

#### 6.3.2 部屋の選択（K2 の代わり）

- 1 回クリック / Enter（roving tabindex でフォーカス中）→ **部屋を選択**する。関係のない部屋の床を 50%（ダークは 72%）に落とし、その部屋に出入りする依存だけを描く（Map §3.3-3.4）。右列の先頭に**部屋カード**を出す（見積りカードは 1 行に畳む）。
- 部屋カードの中身: 区画 › 部屋名（生成前は静的なパス）、L0 の 1 行要約（生成前は「files · LOC · test · 主なシンボル 3 個」）、鮮度、スレッド数、「§6.4 を読む ⏎」、この部屋を通る流れ「§3.1 ⑤⑥」へのリンク、未生成なら「先に生成 ≈{k} tok」。
- 2 回目の Enter / ダブルクリック → S2 の該当節へ移る（p95 100ms 以下）。`Esc` → 選択を解除する（2 回目の `Esc` で 1 段ズームアウト）。

#### 6.3.3 床面図の描き方（Map §3.1〜3.5 を採用し、数値を本書で固定）

| 要素 | 仕様 |
|---|---|
| 建物 | repo 全体。外壁は `--wall` の 2.5px（`vector-effect: non-scaling-stroke`） |
| 区画（zone） | C4 の Container。最大 5 個（入口 / 常駐プロセス / 中核 / 基盤・外部連携 / UI）。床は `--zone-1..5`（§6.13） |
| 部屋（room） | `ModuleInfo` の leaf の集約（目標 9〜24 部屋。上限 40） |
| 扉 | 共有する壁が 34 単位以上、かつ import がある組。扉を横切る 68 単位の短い矢印とラベル（代表シンボル名。静的に決まる） |
| 外部アクター | 建物の外のカード。`MapView` の facts（HTTP client、exec、書き込み先、README）から作る |
| ピン | スレッド（`Anchor.diagram`）。しずく形に番号。色と形で状態を示す（未解決 = `--accent`、AI 作業中・提案 = `--c-prop`、outdated = `--c-warn`、解決 = `--c-ok`） |
| AI 作業枠 | `job.phase` が届いている部屋に、紫の点線枠（reduced-motion では静的な枠） |
| 流れ | §3 の節、または右列の流れリンクを選ぶと、手順と同じ番号の角丸の番号札で矢印を重ね、ピンと AI 枠を 30% に薄める（Map K6）。往復の組は反対側へ膨らませ、70 単位以上離す |
| ラベル | 画面上の px で一定にする。部屋名 13px / パス 11px / 規模 11px（Map の 10.5px は 11px に上げる）。表示する情報は部屋の画面上の大きさで決める（Map §3.2 のクラス `xxs / xs / sm / md / lg`、境界値はそのまま） |

**ズーム段**（Map §3.3。`k = s / s_fit`）: Z0 文脈 `k < 0.62` / Z1 区画 `k < 0.9` / Z2 部屋（既定）/ Z3 コード = 見えている部屋のどれかが `lg`（画面上で 330×225 以上）。段の切替は opacity の 200ms だけで行い、DOM は作り直さない（class の付け替え）。

**性能の規則**（Map の毎フレーム処理を予算内に収めるため、本書で追加）:
1. カメラは、ルート `<g>` の `transform` 1 つと、CSS 変数 `--inv-s`（= 1/s）だけを更新する。ラベルは `transform: scale(var(--inv-s))`（`transform-box: fill-box`）で逆スケーリングする。要素ごとに JS で transform を書かない。
2. LOD クラスの再計算は、アニメーションの終了時と、ホイールやピンチの最中は 100ms ごとにだけ行う [仮]。
3. Z3 の家具は、選択中の部屋と、画面上で `lg` の部屋だけに描く（遅延生成し、1 度作ったら保持する）。床面図の SVG 要素は 40 部屋で 1,500 ノード以下 [仮。fixture 7 repo で計測する]。

#### 6.3.4 レイアウト算法と品質ゲート（server・Bun Worker。決定的）

1. 建物 = 16:10 の長方形。
2. 区画を squarified treemap で分割する。並び順は決まった規則で決める（入口を含む区画を左上、UI を左下、外部 IO を右端）。
3. 各区画の中を部屋の squarified treemap で分割する。面積は `clamp(a0·√LOC, Amin, Amax)`（√ で大きな directory の面積を抑え、小さな部屋の名前が入るようにする。Editorial の「面積 ∝ LOC」は採らない）。`a0` は建物の面積 × 0.85 / Σ√LOC、`Amin` = 建物の面積の 1.2%、`Amax` = 22% [仮]。
4. 区画内の部屋の並び順は、部屋の隣接行列（import の重み）の Fiedler ベクトルの順にする。同点は module id でソートする（安定）。
5. 扉 = 共有する壁が 34 単位以上、かつ import がある組の、共有区間の中点。
6. 前回のレイアウトがあり、LOC の変化が全部屋で 20% 未満なら、並び順を保つ [仮]。
7. **品質ゲート**（どれか 1 つでも満たせなければ、S1 は Pro の `01-scan` 形式の **ELK layered Container 図**（レーン付き。`DiagramKind: "container"`）を表示し、strip に「間取り図にできない構成のため依存図で表示」と出す）:
   - fit ズームで `md` 以上で表示できる部屋の割合 ≥ 70% [仮]
   - import の辺のうち、扉になった割合 ≥ 45% [仮]
   - 部屋数 ≤ 40（上限を超える場合、まず静的な階層（directory の深さ）でまとめ直し、それでも超えたら退避する）
   - レイアウトの計算時間 ≤ 30ms（40 部屋。Bun Worker）
8. 出力は `DiagramLayout`（kind `floorplan`）の `nodes` / `doors` / `groups`（§9）。同じ入力からは byte 単位で同じ JSON を出す。

### 6.4 S2 設計書 Reader（Editorial を基盤にする）

#### 6.4.1 そのまま採用する Editorial の仕様
README §2.3（文字組）、§3.2（章頭・章末・block の属性・出典チップ・peek・確認の印・用語・Why / 落とし穴 / Deep Dive・読書パス・margin スレッド）、§4.1（margin カードの配置規則）、§4.2（読者レベルの適用。`READER_LEVEL_RULES` と一致）、§2.5（動き）。以下はそこへの追加・変更である。

#### 6.4.2 rail（Map + Pro から追加）
1. **縮図**（Map `08-doc`）: 200×120 の床面図サムネイル。現在の節のモジュールの部屋を `--accent-tint` で塗る。クリック / Enter で、その部屋を選択した状態の S1 へ移る。床面図が品質ゲートで退避した repo では表示しない。
2. 読書パスのカード（Editorial）。
3. 目次の各行（Pro §6.2）: `{番号} {題} {スレッド数バッジ} {分 or ≈k} {状態}`。状態の記号: ✓ 生成済 / ◐ 生成中 / ○ 待機 / □ 静的（0 tok）/ ⚠ 古い可能性。生成中、待機中の章には `≈{k}` を出し、クリックするとその章を先に生成する。
4. 下端に生成メタ（Editorial）: `生成 6分12秒 · 0.39M tok · $1.27 / 網羅 393 / 1,219 files / .mitori/ · commit は opt-in`。

#### 6.4.3 信頼の表示（3 案の規則を 1 つにする）
- 確認済（verified / human-verified）の ✓ は既定では隠す。block の hover・`⌥` 長押し・詳しいレベルのときだけ左ガターに出す（Editorial）。Map のような全チップへの常時 ✓ はやめる。
- 推測（inferred）は全レベルで本文中に黄のバッジを出す（Editorial）。**畳んだ Why / Deep Dive の見出しにも残す**（Pro P-5）。
- 推測バッジ → `確認する`（Pro）→ 選択肢「確認済にする（human-verified、再生成しても保持）/ AI に確かめさせる ≈2k / 専門家に聞く」（Map §4）。

#### 6.4.4 出典チップと peek
- チップの書式: 初めて = 段落末に `出典 {n}`（クリックで文中に展開）。標準 = `{base}:{line}`。詳しい = `{dir/}{base}:{a}–{b}`（Pro）+ ガターに Markdown の行番号（Editorial `02d`）。
- peek は**チップに接して**出す（Editorial）。範囲の前後 3 行、合計 26 行以下（Pro AC-7）。範囲の先頭が上から 40px に来るようにスクロールする。ヘッダー `{path} :{a}–{b} · {symbol} · 正確（symbol index）| 推定（文字列検索）· {blob7}`。フッター `確認済 範囲は実在 · 識別子一致 · hash 一致`（L0 / L1 / L2 の結果）と `o 横に固定 · ⇧O エディタで開く · Esc`。
- 当たり判定: チップの見た目は 20px 高だが、`::after` で上下 3px 広げて 26px にする。

#### 6.4.5 ブロック操作（Pro P-4 を採用し、寸法を直す）
- hover かフォーカス（`j` / `k`）のブロックに、左ガターの縦 3 ボタン（コメント `c` / 説明 `e` / 修正 `f`）を出す。各ボタンは **28×28px**（Pro の 24×22 は 2.5.8 を満たさない）。アイコンだけにし、`aria-label` と `title` にキー名を書く。本文の上には重ねない（Map のように右上に浮かせると 1 行目を隠す）。
- テキストを選んだときの浮遊ツールバー（Editorial `03a`）: `コメント C · 説明して E · 修正して F | P | Y | ≈{k}`（末尾の見積りは Pro）。選択範囲の 46px 上に出す（上に余地がなければ下）。

### 6.5 Composer（各案から 1 つの部品にまとめる）

置き場所: `margin` モードでは対象ブロックの高さの margin カード（Editorial）。`code` モードと 1024px 未満では、対象ブロックの直下にインラインで出す（Pro）。上から次の順に並べる。

1. ヘッダー: `○ 下書き · {§id} · {file:line}` と右端の `自動保存`。詳しいレベルだけ `· {blockId}` を足す。**TextQuote の内部表現（prefix 32 など）は出さない**（Pro から削除）。
2. 引用: 前後 18 字 + `<mark>`（Editorial）。
3. 意図チップ: 質問 ⌘1 / 修正 ⌘2 / 指摘 ⌘3 / メモ ⌘4。`c` = メモ、`e` = 質問、`f` = 修正で開く（D19）。
4. **直す対象の 2 択**（意図が修正で、アンカーの primary が doc のときだけ出す。Map の文言を採用）: 「コードをこの依頼に合わせる」（既定）/「設計書を直す（コードが正しい）」。後者を選ぶと job ではなく `DocEditReq{apply:"doc"}` の経路になり、見積りは `0 tok` になる。
5. 本文: `field-sizing: content`。Enter は改行し、送信は ⌘Enter / Ctrl+Enter だけ。IME の変換中のキーはすべて無視する。下書きは 500ms の debounce で保存し、Esc で閉じても残る。
6. context chips: 先頭に外せない固定チップ `固定: system + 規約 {k} cache`（Pro）。各チップは `{label} {k}k ×`。外したチップは打ち消し線で残し、`+` で戻せる（Editorial）。候補チップは点線の `+ 関連: {label} +{k}k`（Pro / Map）。末尾に `@ 追加`。
7. フッター 1 行: 見積りチップ `≈{in}k in · ≈{out}k out · ${usd} · 約{p25}–{p75}秒`（色帯の点: 10k 未満は灰 / 10〜50k 標準 / 50〜200k 琥珀 / 200k 超は赤）、router チップ `patch · {行} 行 · {n} ファイル · {model}`、実行経路の切替（⚡ その場で実行 · claude-cli / 自分のセッションへ · mitori review / プロンプトをコピー。Editorial）、［送信 ⌘⏎］。
- 見積りチップに hover するかフォーカスすると内訳の popover を出す（Pro `03b2`）: チップごとの tok、固定部分（cache）、指示（本文）、出力（思考込み）、合計の tok と $、単価の注記（`claude-sonnet-5-5: 入力 $2/M · cache read $0.2/M · 出力 $10/M`）、`見積り精度 ±{p}%（n={件数}）`。
- router チップは、アンカー合計が 120 行を超えるか、ファイル数が 2 を超えた時点で `agent · {n} ファイル > 2 → Read + Edit` に切り替える（同じフレーム内）。
- チップを足したり外したりすると、見積りと router は**同じフレーム内で**再計算する（`EstimateItem.removable` / `tokens` を使う client 側の計算。送信時に `removed[]` を送る）。

### 6.6 ジョブカードと全体のジョブ表示

**ジョブカード**（送信から 100ms 以内に楽観的に出す）:
- ヘッダー: `{状態チップ} あなた → mitori AI · {修正|質問|指摘} · {patch|answer|agent} · {model} … {th_id} · R{n}`（th_id は詳しいレベルだけ）。
- **計画ステージ**（Pro）: `RouteDecision` から、予定のステージを最初から淡色で並べる。届いた `JobEvent.phase` の順に ✓ と所要時間を付ける。名前の対応は次のとおり。

| JobPhase | 表示名 | 詳細欄（例） |
|---|---|---|
| queued | 受付 | 楽観的に作成 · 38ms |
| prepare / snapshot | 準備 | `snapshot → refs/mitori/j/j_17/base · dirty 0`（R1: GIT_REFS が正、CONS-34） |
| bundle | コンテキスト束 | `MBF/1 · 2.4k tok · 4 範囲 · router → patch（small_change）` |
| spawn | 起動 | `claude -p …（flags 7）▸` — クリックで argv 全体を展開してコピーできる（Editorial の切れを直す） |
| read | 読み取り | `Read internal/config/config.go` |
| think | 生成 | `ttft 2.2s · patch/1 を stream で受信` |
| edit / apply | 適用 | `patch/1 · 2 files · 5 hunks を worktree に適用` |
| scope | 範囲検査 | `2 files ⊂ WRITE · deny glob 0`（Map） |
| gate | 検査（gate ごとに 1 行） | `gofmt -l` / `go vet ./cmd/crit ./internal/config` / `go test … -run …` |
| repair | 修復 | `--resume · 失敗の抜粋 0.6k` |
| ready | レビュー待ち | — |

- tail 行: 最新のイベントを 1 行（`Read …`、または patch/1 の `ops[n] {path} {a}–{b} {replace|insert}`。Editorial）。
- フッター: `{経過}秒 · 通常 {p25}–{p75} 秒（同じ意図 × モードの過去 {n} 件）· 読み続けて大丈夫です［中止］`。p25 / p75 は直近 20 件から計算し、20 件に満たないうちは事前値を使う（Pro AC-14）。% バーと根拠のない残り時間は出さない。

**全体の表示は 2 か所だけにする**（Pro P-2 を減らす）:
1. ヘッダーのジョブチップ `◐{実行中} 🔒{ロック待ち} ◆{レビュー待ち}`。どれも 0 なら隠す。クリック / Enter で 440px の popover にジョブ一覧を出し、項目の Enter でそのカードへスクロールする（カードが閉じた節にあれば、その節を開く）。
2. ステータスバーの `ジョブ {n} 実行中 · {m} 待機 · C={並列度}`。
- Pro の右ペインの「ジョブ」タブは作らない。一覧は Inbox の「作業中」フィルタで足りる。

### 6.7 準備完了と Review

**準備完了カード**（margin、または inline。Editorial `03d` を基にする）: `◆ レビュー待ち` · `+{add} −{del} · {files} files · {hunks} hunk` · `設計書 {n} ブロック` · `✓ ゲート {pass}/{total}`（失敗があれば `✕`）· `${usd} · {s}秒` ·［レビュー R］［採用 ⌘⏎］［却下 ⌘⌫］。同時に、本文の該当 block を提案モード（Editorial の del / ins の見た目）で表示し、block ごとに ✓ / ✕ を付ける。

**Review パネル**（`review` モード、640px。上から）:
1. ヘッダー: `{th} · R{n} · {mode} mode · tools なし`、題名、`§{id}「{引用}」 {block} · あなた「{依頼}」`、［閉じる Esc］。
2. ゲートのピル（gate ごとに名前・所要時間・結果。hover / focus で実行したコマンド全体を出す）と `書き込み範囲 {n} files`（scope 検査）。
3. 実績 1 行（Editorial + Pro）: `入力 {in}（cache {c}）出力 {out} ${usd} API換算 {s}s（モデル {m}s + ゲート {g}s）見積 ≈{k} → {±}% · 5h +{pp}%`（5h は取得できたときだけ）。
4. AI の要約（`result` から。4 項目以下）。formatter が書き換えた行があれば「空白だけの変更 {n} 行」を必ず含める（Editorial §8-6）。
5. 影響を受ける部屋の縮図 120×72（Map `03-ready`。床面図が退避した repo では出さない）。
6. コード diff: ファイルごとに sticky のファイルヘッダー（`{path} +{a} −{d}` と ✓ / ✕）、hunk ごとに sticky の hunk ヘッダー（`@@ … @@ {symbol}` と ✓ / ✕）。旧 / 新の 2 列の行番号、`+` / `−` の記号と左端の帯（色だけに頼らない）。Unified が既定。`⇧R` でパネルを全幅の overlay（rail と prose の上）に広げたときだけ Split を選べる（Map の Unified / Split 切替を幅で制限する）。2,000 行未満の diff はサーバ生成の静的 HTML で出す。それ以上は CodeMirror 6 + `@codemirror/merge` を遅延読み込みする。
7. 設計書の提案の一覧（本文へのリンク）。
8. 下端固定のフッター: `n / ⇧N hunk · ⌘⏎ フォーカス中を採用 · ⌘⌫ 却下 · ⌥⌘⏎ すべて採用` と `base refs/mitori/j/{job}/base`（R1: GIT_REFS）、［すべて却下］［すべて採用 ⌥⌘⏎］。
- **焦点単位の採用**（Map K7）: パネルを開いた直後のフォーカスは「提案全体」で、`⌘⏎` は全部を採用する。`n` / `⇧N` で hunk にフォーカスが移ると、`⌘⏎` / `⌘⌫` はその hunk だけに効く。全 hunk と全 block が決まった時点で適用する（一部だけ採用なら `partially_accepted`）。

### 6.8 採用・取り消しと、下端の積み上げ規則

- 採用（Editorial §3.3-7 + Pro §6.11）: checkpoint を作ってから working tree に書く。block を新しい文と新しい出典に置き換え、`::after` の opacity で 1 回だけ 1.6s 光らせる（reduced-motion では静的な左の帯）。block の下に履歴 `R1 AI 生成 → R2 AI 修正（{th} · 採用: あなた）` を出す（Pro / Map）。カードは 1 行に縮める（`✓ R2 で解決 · 適用済み · 取り消し点 refs/mitori/ck/{ck}（R1: GIT_REFS、語彙は UXP-25） · ${usd} · {s}秒 ［元に戻す ⌘Z］`）。`code` モードなら、右列を worktree の内容（`未 commit`）に切り替える（Pro `03e`）。床面図の該当の部屋も 1 回光らせる（Map）。
- トースト: `反映しました — {n} files を作業ツリーへ（未 commit）· 設計書 {m} ブロック · checkpoint {ref}［元に戻す ⌘Z］` を 10 秒表示し、下端の線で残り時間を示す。却下（`⌘⌫`）も確認ダイアログを出さず、`［元に戻す ⌘Z］` のトーストにする。
- **下端の積み上げ規則**（Editorial `04-inbox` の重なりを直す）: 画面下端に固定する要素は、`BottomStack` に登録したものだけにする（ステータスバー 24px → Inbox の batch バー → トースト群の順）。各要素の `bottom` は、下にある登録要素の高さの合計 + 12px で決める。トーストは最大 3 件まで出し、新しいものを下に置き、4 件目が来たら最も古いものを閉じる。Inbox の batch バーは一覧の**上端に sticky で置く**（Pro `04-inbox`）。

### 6.9 S4 Inbox

- レイアウトは Editorial（左にフィルタと件数、中央に一覧、右に詳細）。フィルタ: すべて / あなたの番 / 作業中 / 失敗 / outdated / 下書き / 解決済み。
- 「すべて」のときは、Pro のグループ見出しで並べる: 要対応（レビュー待ち・失敗・あなた宛て・outdated・要選択）→ 実行中・待機 → 下書き → 完了 → 解決済み。
- 行（40px 以上）: `{状態の形} {題名} {意図} · {§id} · {file:line} · {費用 or ≈k} · {時刻}`。詳しいレベルだけ先頭に `{th_id}`。状態は形・色・ラベルの 3 つで示す（Editorial §3.4 の対応表。ただし ready のラベルは「準備完了」ではなく**「レビュー待ち」**にする。P3 にとって次の行動が分かる語にするため）。
- 上端 sticky の batch バー: `下書き {n} 件（{共通の範囲}）を 1 回の実行にまとめる ≈{k} tok · ${usd}（別々なら ≈{k2} · {p}% 節約）［まとめて送る ⇧F］`。下書きが 2 件以上あるときだけ出す。
- 右の詳細（種類ごと）:
  - doc_edit: Editorial `04` の 2 択（1 設計書を直す · L1 の静的検証 → human-edited で固定 · 0 tok / 2 コードをこの設計に合わせる · patch · ≈{k} tok · ≈${usd}）。キーは `1` / `2`。
  - 失敗: Pro `04` の原因の連鎖、stderr 末尾 3 行、ここまでの費用と実行回数、次の手（［Opus high で提案のみ ≈${usd}］は `RouteDecision.requiresConfirm` に従って確認を取る / 範囲を絞る / プロンプトをコピー）、「依頼文・アンカー・context chips は失われません」。
  - ロック待ち: `{path} を {th} が編集中のため待機 — 同じファイルに触るタスクは自動で直列にします`（Map）。
  - outdated: 元の位置のスナップショットと［新しい位置を指定］。
  - 回答済み: 回答と［文書に追記］（Deep Dive / FAQ の block に昇格。Editorial `08`）。
  - すべての詳細に［地図で見る］を置く（Map `04-inbox`。アンカーの部屋を選択した S1 へ移る）。
- キー: `j` / `k`（50ms 以内）、`↵` 文書で開く、`x` 選択、`1` / `2`、`⇧F`、`h` 解決済みを隠す。

### 6.10 ⌘K パレット

- Editorial §3.5 の寸法・照合・表示を基にする（幅 640px、行 44px 以上、8 行 + 次の行が半分見える高さ、一致の理由のバッジ「mochikoshi に一致」「「持ち越し」経由」）。
- グループは 用語 → 節 → 部屋 → シンボル → スレッド → 操作 の順にし、各 3 件まで出す（Map の「部屋」を追加）。
- ローマ字は、入力と索引の両方を `shi→si, chi→ti, tsu→tu, fu→hu, ji→zi, sha→sya, cha→tya, ja→zya, nn→n, ou→o` で正規化する（Map §6.3）。カタカナはひらがなにする。これで `mochikoshi` / `motikosi` / `もちこし` / `carry` のどれでも「持ち越し」が先頭に来る。
- フッター: `{件数} 件 · {ms} ms · ローカル索引 · 0 tok`（Pro / Map）。項目の上で `⌘K` → Action panel（開く / 説明して / 再生成 ≈{k} / プロンプトとしてコピー / permalink）。入力が空の Backspace で 1 階層戻る。Esc で閉じて元のフォーカスに戻す。
- 照合は Worker で行う（`PaletteWorkerMsg`）。

### 6.11 生成の見積りカードと進捗

**カード**（S1 右列の先頭）:
1. 題「設計書を生成する」（明朝。Editorial）。
2. effort の 3 タイル: `概要 ≈0.12M tok · $0.4 · 約2分` / `標準 推奨 ≈0.4M · $1.3 · 約6分` / `完全 ≈1.1M · $3.6 · 約17分`（前回の選択を既定にする）。
3. **主行**（ボタン込みで 1 行）: `標準: 約0.4M tok · API換算 $1.3 · 約6分`［生成 ⏎］。
4. 補足 1 行: `claude-cli（あなたのサブスク）· C=3 · 5h 枠 23% → 推定 34% [仮] · 80% を超えたら自動で一時停止`。
5. 「内訳と経路 ▾」（初めて・標準レベルでは閉じ、詳しいレベルでは開く）:
   - stage 表（Pro）: `stage · model | in / out | $ | 時間`。overview の行に「* クリティカルパス（並列度を上げても短くならない）」。
   - engine の radio（Pro）: `claude-cli（C=3 · 約6分）` / `session（自分の Claude Code で mitori gen --prep · C=1 · 約17分）[--prep をコピー]` / `anthropic-api（API key · Batch −50% · $0.71 · 未設定）`。
   - データの扱い（Map / Pro）: `送信先: Anthropic（あなたの claude CLI 経由 · credential は読まない）· 対象 {n} files（除外 {m}）· 秘密情報 {k} 件 · 学習の扱いは plan の設定に従う［詳細］`。
   - `見積りは index digest {8 桁} で 10 分有効`（Pro）。
- **生成では別の確認ダイアログを出さない**。カードそのものが確認の役目を果たし、［生成］の 1 クリックで始める（D3 / Pro AC-2）。100k tok 超の確認ダイアログは、Push の依頼（Explain / Fix / Review）にだけ適用する。

**進捗**（同じカードを置き換える）:
- 4 列のカウンタ（Pro `01b`）: `入力 {in} / ≈{est}`、`出力 {out}`、`API換算 ${usd} / ≈${est}`、`経過 {m:ss} / 約{分}`。
- stage の行（モデル名、`modules · claude-sonnet-5-5 ×3 並列 5/14` と進み具合）。tail に `Read internal/session/watch.go · §5`。
- 床面図では、対象の部屋に青い枠を脈動させ（reduced-motion では静的）、完了で ✓ を付ける（Editorial `01c`）。目次の状態記号が ○ → ◐ → ✓ に変わる。
- 最初の block が届いたら、トースト `§0 ひとことで が届きました · 最初の文まで {s} 秒［読む g d］` を出す（Pro）。
- 完了: `入力 0.38M（キャッシュ 0.19M）· 出力 52k · $1.21 · 5分48秒 · 見積 ≈0.40M / $1.3（−5%）`。続けて「5 分コース →」を提案する。
- ［中止］はいつでも押せる。中止しても、それまでに確定した block は残る。

### 6.12 ヘッダーとステータスバー

- ヘッダー 52px（Editorial）: `見取り図 MITORI`（明朝）│ `{ws} {HEAD7}` │ タブ（見取り図 / 設計書 / Inbox {あなたの番} / レビュー ◆{n}）│ 検索 ⌘K（240px）│ 読者レベル（初めて｜標準｜詳しい）│ ジョブチップ │ テーマ │ 言語 │ `?`。**使用量の表示はヘッダーから外し**、ステータスバーに移す。
- ステータスバー 24px（Pro §6.14 を減らす）: `● daemon {host}:{port}` │ `index ✓ {files} files · warm {ms} ms` │ `ジョブ {n} 実行中 · {m} 待機 · C={c}` │ `今日 {tok} tok · ${usd} API換算` │ `5h {p}% · 7d {q}%`（取得できたときだけ）│ `{engine} · {subscription|api}` │ `? ショートカット`。文字は mono 12px で、`--muted` を使う（4.5:1 以上）。従量側に回ったとき（`rate_limit_event` の `isUsingOverage`）は、5h 区画を `--c-warn` にして「従量」と明記する（addendum A1）。

### 6.13 デザイントークン（Editorial §2 を正本にし、次の 5 点だけ追加・変更する）

1. **区画の床**（地図の新規トークン。値は [仮] で、本文 `--text` と `--muted` のコントラストを計算して確認済み）:

| トークン | ライト | ダーク | `--muted` とのコントラスト（ライト / ダーク） |
|---|---|---|---|
| `--zone-1`（入口） | `#E9EEF6` | `#1B2129` | 5.61 / 6.77 |
| `--zone-2`（常駐・中核） | `#F3EEE3` | `#221F19` | 5.65 / 6.87 |
| `--zone-3`（外部連携） | `#F5E9EC` | `#261D20` | 5.53 / 6.86 |
| `--zone-4`（UI） | `#E7F1EC` | `#19231F` | 5.66 / 6.74 |
| `--zone-5`（基盤・ノイズ以外） | `#EEEDEA` | `#1F1E1C` | 5.59 / 6.96 |

ノイズ箱は `--paper-2` に斜線の pattern（色だけに頼らない）。

2. `--faint` は `--paper` と `--sheet` の上でだけ使う（`--paper-2` 上では 4.38:1 で不合格になる）。CI で検査する（AC-J10）。
3. 文字の大きさの下限: **画面上のテキストは 11px 以上**（SVG のラベルを含む）。**操作要素のラベルは 12px 以上**。11px を使ってよいのは mono のメタ情報とバッジの数字だけで、4.5:1 以上が条件。
4. weight は 400 と 600 だけにする（Pro の 650 と 700 は使わない）。
5. 和欧間の空白: **設計書の原稿にも UI の文言カタログにも、和字と英数字のあいだに半角空白を入れない**。間隔は `text-autospace: normal` に任せる。`html` に指定して継承させる（`.prose p` だけに付けた Pro の方式では `li` に効かない）。`line-break: strict` は `.prose` 全体（`p, li, dd, td, th, blockquote, figcaption`）に付ける。生成した Markdown には、コードスパンとリンクの外側で `[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}]` と `[A-Za-z0-9]` のあいだにある半角空白 1 個を除く正規化を、決定的にかける。GitHub 上で読むときの見え方は §11-2 で検証する。

明朝は「章見出し・節番号・図の題・見積りカードの題・プロジェクト名・ロゴ」だけに使う（Editorial §2.2）。

### 6.14 キーボード（`ui.ts DEFAULT_KEYMAP` に次の差分を加える）

| id | キー | scope | 由来・理由 |
|---|---|---|---|
| `review.open` | `r` | read | Editorial / Pro。準備完了の提案を開く |
| `review.widen` | `Shift+R` | review | 本書。Review を全幅の overlay にし、Split を選べるようにする |
| `inbox.choose` | `1`, `2` | inbox | Editorial。doc_edit の 2 択 |
| `inbox.select` | `x` | inbox | Pro。複数選択（まとめて送る・解決） |
| `map.zoomIn` / `map.zoomOut` / `map.fit` | `=` / `-` / `0` | map | Map。**route が S1 のときだけ有効**（K1 を置き換える） |
| `map.pan` | `ArrowUp/Down/Left/Right` | map | stage にフォーカスがあるとき。部屋にフォーカスがあるときは roving で隣の部屋へ移る |
| `map.flow` | `Shift+1`〜`Shift+5` | map | §3.1〜3.5 の流れを重ねる（もう一度押すと消す） |

- **scope は route で決める**（ポインタの位置では決めない）: S1 では `map` と `global`、S2 では `read` と `global`、Review パネルでは `review` と `global`、Inbox では `inbox` と `global`。同じキーが 2 つの scope に割り当てられていても、同時に有効になることはない。`level.*`（`-` / `=` / `0`）は S1 では無効になり、S1 で読者レベルを変えるのはヘッダーの切替と ⌘K からだけにする。
- `t` は rail の目次の先頭にフォーカスを移す（`b` は rail の開閉）。Pro のように `t` を `b` の別名にはしない。
- 判定の規則は Pro §8 / Editorial §4.3 を採用する: すべての keydown は capture 段の 1 つのハンドラで受ける。1 行目で `e.isComposing || e.keyCode === 229` なら何もしない。英字と数字は `e.code`、記号（`/ ? - = [ ]`）は `e.key` で判定する。入力欄の中では Composer の `⌘⏎` / `⌘1–4` / `Esc` 以外を無視する。`g` の後 1 秒以内の `h d i c r s` で画面を移る。
- 単一キーのショートカットは、設定 1 つで全部オフにできる（WCAG 2.1.4。`ShortcutDef.singleKey`）。

### 6.15 アクセシビリティ（本書で新たに必須にするもの）

1. 床面図の代替: 「表示 ▾ → テキストで見る」（と ⌘K の操作）で、区画 → 部屋 → 主要ファイル（LOC）の木、扉の一覧 `{A} → {B}（import {n} 本）`、外部アクターの一覧 `{actor}: {関係ラベル}` を、`<dialog aria-modal="true">` の中の表として出す。SVG は `role="img"` + `aria-describedby`。部屋は roving tabindex にして（Tab で入るのは 1 つだけ）、Fiedler 順に矢印キーで移る。
2. 状態の変化だけを `aria-live="polite"` で読み上げる: ジョブの受付・レビュー待ち・回答・失敗、採用、取り消し、読者レベル、生成の開始・最初の block・完了。トークンの流入では読み上げない。
3. 装飾の区切り（`·` など）は `aria-hidden="true"` の span にし、コントラスト検査の対象から外す。
4. すべての dialog（パレット・ヘルプ・テキストで見る・確認）は `aria-modal="true"` を付け、閉じたら元のフォーカスに戻す（Map のパレット以外の dialog は未対応だった）。

### 6.16 初期 JS の配分 [仮]

| chunk | 内容 | gz の目標 | 読み込み |
|---|---|---:|---|
| entry | Svelte 5 runtime、router、stores、SSE client、i18n（表示中の言語の catalog）、Shell（header・status・BottomStack） | 30KB | 初期 |
| map | MapCanvas（SVG の描画・カメラ・LOD・ピン・流れ） | 9KB | 初期（S1 が既定の route） |
| reader | BlockHost（innerHTML + 委譲）、CitePeek、TermCard、読者レベル、ContextColumn（margin・code） | 12KB | 初期 |
| **初期の合計** | | **51KB**（目標 60KB、上限 150KB） | |
| loop | Composer、ContextChips、EstimateChip、ThreadCard、JobCard | 12KB | 初回の描画のあと `requestIdleCallback` で先読み |
| review | ReviewPanel（静的 diff HTML）、ProposalCard | 8KB | `r` か、準備完了のジョブが届いたとき |
| inbox | Inbox | 6KB | `g i` |
| palette | パレットの UI 4KB + Worker 6KB | 10KB | ⌘K か idle |
| cm6 | CodeMirror 6 + merge | 135KB | diff が 2,000 行以上か、Split のとき |

測り方: WP-10a の CI で、ビルドした `dist/` の各 chunk を gzip -9 して合計し、初期 chunk（`modulepreload` されるもの）の合計が 60KB を超えたら警告、150KB を超えたら fail にする。

### 6.17 数値の書式（G17。Pro §9 をそのまま正本にする）

| 対象 | 書式 |
|---|---|
| token | 1,000 未満はそのまま。1k 以上は小数 1 桁の `k`（`2.5k`）。1M 以上は小数 2 桁の `M`（`0.38M`）。見積りには `≈`、主行の推定値には `約` を付ける |
| $（API 換算） | 1 件の依頼は小数 3 桁（`$0.018`）、日計と生成は 2 桁（`$1.33`）、見積りカードの主行は 1 桁（`$1.3`） |
| 時間 | 1 分未満は小数 1 桁の `秒`。生成は `約{n}分` か `m:ss` |
| 誤差 | `（実績 3.9k · −2%）` |
| 規模 | 文中は `45.7k LOC`、表の中は `45,672` |

### 6.18 状態のラベル（3 案で揺れていた語を統一する）

| 状態（`JobState` / `ThreadState`） | 形 | 色 | ラベル |
|---|---|---|---|
| draft / queued | 点線の ○ / ○ | `--muted` | 下書き / 待機 |
| waiting_lock | 🔒 | `--c-warn` | ロック待ち |
| preparing / running / gating / repairing | ◐ | `--c-run` | 実行中（gating は「検査中」、repairing は「修復中」） |
| ready（proposed） | ◆ | `--c-prop` | **レビュー待ち** |
| accepted / applied / resolved | ✓ の丸 | `--c-ok` | 適用済み / 解決済み |
| partially_accepted | ◑ | `--c-ok` | 一部適用 |
| answered | 吹き出し | `--c-ok` | 回答済 |
| failed | ✕ の丸 | `--c-bad` | 失敗 |
| outdated | ▲ に ! | `--c-warn` | outdated |
| doc_edit の未選択 | ? の丸 | `--c-warn` | 要選択 |
| open | ● | `--ink` | 未解決 |
| reverted / rejected / cancelled | ↺ / ✕ / ― | `--muted` | 取り消し / 却下 / 中止 |

操作の語は 採用 / 却下 / 元に戻す に統一する（Pro の「反映済み」「取り消す」、Map の「採用しました」は使わない。トーストは「反映しました」を残す）。

---

## 7. 移植の一覧（graft list）

| # | 要素 | 出典（スクリーンショット / README 節） | 移植先 | 変更点 |
|---|---|---|---|---|
| G1 | 右列の `code` モード（scrollspy、省略の畳み、backlink、blob、正確 / 推定） | Pro `02-doc-standard`・§6.6 | §6.2 | 常時表示はやめ、詳しいレベルと `o` に限る。幅は clamp で決める |
| G2 | ステータスバー | Pro §6.14 | §6.12 | 9 区画を 7 区画に減らし、mono 12px と `--muted` にする |
| G3 | ジョブチップ | Pro §6.1 | §6.6 | ジョブタブは廃止。popover にする |
| G4 | 計画ステージを最初から並べるジョブカード | Pro `03c`・§6.9 | §6.6 | Editorial の ops tail と Map の範囲検査行を合わせる |
| G5 | Composer の router チップと自動切替 | Pro `03b`・AC-10 | §6.5 | — |
| G6 | 見積りの内訳 popover（単価、EMA の精度） | Pro `03b2` | §6.5 | — |
| G7 | 固定チップ・候補チップ | Pro `03b`・Map `03a` | §6.5 | — |
| G8 | 直す対象の 2 択（Composer） | Pro `03b`・Map `03a` | §6.5-4 | 文言は Map。doc アンカー + 修正のときだけ出す |
| G9 | 準備完了の実績行（LLM / gate の分離、見積との差、5h の増分） | Pro `03d`・AC-15 | §6.7 | Editorial の Review パネルの 3 行目に入れる |
| G10 | 生成見積りの stage 表・engine の radio・データ開示・有効期限 | Pro `01-scan`・§6.15、Map `01-first-run` | §6.11 | 「内訳と経路 ▾」に畳む |
| G11 | 生成の 4 列カウンタと、最初の block のトースト | Pro `01b` | §6.11 | — |
| G12 | 失敗詳細（原因の連鎖・stderr・費用・昇格） | Pro `04-inbox`・§6.12 | §6.9 | — |
| G13 | Inbox のグループ見出しと上端 sticky の batch バー | Pro `04-inbox` | §6.9 | トーストとの衝突を避けるため上端に置く |
| G14 | 目次の行の状態記号と ≈k | Pro §6.2 | §6.4.2 | — |
| G15 | 左ガターのブロック操作 | Pro P-4 | §6.4.5 | 28×28px |
| G16 | 推測バッジを畳んだ見出しに残す | Pro P-5 | §6.4.3 | — |
| G17 | 数値の書式表 | Pro §9 | §6.17 | — |
| G18 | キーボードの判定方式（capture 単一ハンドラ、`e.code`）とペイン幅のキー操作 | Pro §8・§4 | §6.14・§6.2 | — |
| G19 | S1 の 3 列構成（rail / stage / 右列） | Map §2・`01-first-run` | §6.3.1 | 右列は overlay ではなく grid の列 |
| G20 | 意味的ズーム Z0〜Z3 とラベルの一定化 | Map §3.2-3.3・`10-z1`・`11-z3`・`12-z0-dark` | §6.3.3 | 性能の規則 3 つを追加。ラベルの下限は 11px |
| G21 | 外部アクター枠とラベル付きの関係 | Map `01`・`12-z0-dark` | §6.3.3 | — |
| G22 | 流れの番号付き矢印 | Map K6・`09-flow` | §6.3.3 | `Shift+1〜5` と右列のリンクから |
| G23 | ピンと AI 作業枠 | Map §3.1・`03b-running` | §6.3.3 | 表示は HUD の 2 チップで切り替える |
| G24 | 扉の規則と、選択した部屋の依存だけを描く | Map §3.4・K4 | §6.3.2 | — |
| G25 | 床面図のレイアウト算法 | Map §3.6 | §6.3.4 | √LOC の面積と、品質ゲートと ELK への退避を追加 |
| G26 | Reader rail の縮図 | Map `08-doc` | §6.4.2 | — |
| G27 | 「0 tok で今できること」 | Map `01-first-run` | §6.3.1 | 生成後は出さない |
| G28 | 焦点単位の採用 | Map K7 | §6.7 | — |
| G29 | 影響を受ける部屋の縮図（Review） | Map `03-ready` | §6.7-5 | — |
| G30 | ローマ字の正規化表と「部屋」グループ | Map §6.3 | §6.10 | — |
| G31 | 「地図で見る」とロック待ちの文言 | Map `04-inbox` | §6.9 | — |
| G32 | 推測から 3 択（確認済にする / AI に確かめさせる / 専門家に聞く） | Map §4 | §6.4.3 | — |
| G33 | 採用後の履歴行 | Pro §6.11・Map §5-7 | §6.8 | — |

---

## 8. 捨てるもの（drop list）

| # | 要素 | 出典 | 理由 |
|---|---|---|---|
| X1 | 1024px 以上で Split view を常時表示する（P-1） | Pro | P1 / P3 にコードの壁を見せる。① の主因。詳しいレベルの既定と `o` に限る |
| X2 | ジョブを 3 か所に表示（P-2） | Pro | 冗長。チップとステータスバーで足りる |
| X3 | Composer の TextQuote 表記 | Pro `03b` | 内部表現で、利用者の判断に使えない |
| X4 | `--faint #959ba6` と 12px 中心の chrome、weight 650 | Pro | AA 不合格 75 件の主因。Editorial のトークンに置き換える |
| X5 | 地図の上に重ねたシートで本文を読む（K2） | Map | 本文が 535px に窮屈で、地図は後ろで切れる。1280×800 で破綻する |
| X6 | ポインタの位置で深さキーの意味が変わる（K1） | Map | モードの取り違え。route 単位の scope にする |
| X7 | 地図左上に固定した peek（K5） | Map `02-reader` | チップから約 600px 離れ、地図の HUD を覆う |
| X8 | 全チップへの常時 ✓ | Map `02-reader`・`06` | 静けさを壊し、推測の目立ち方を弱める |
| X9 | HUD のチップ 5 個と常時表示の凡例 | Map `01` | 騒がしい。3 チップ + 「表示 ▾」にする |
| X10 | 部屋の状態行（「確認済 3/3 · 変更 7」）を常に出す | Map | 変更頻度のオーバーレイを ON にしたときだけ「変更 n」を出す |
| X11 | 面積 ∝ LOC の手配置スライス | Editorial §3.1 | 小さな部屋の名前が入らない。√LOC の treemap と品質ゲートにする |
| X12 | 原稿の和欧間スペース | Pro・Map | 07 §4.1 の規則違反。§6.13-5 |
| X13 | 11px 未満の文字（9.5〜10.5px） | Pro・Map（Editorial も一部） | §6.13-3 |
| X14 | margin カードの無制限の積み上げ | Editorial §4.1 | スレッドが多いとアンカーから遠く離れる。上限の規則を加える（下記） |
| X15 | 下端の要素の独立した配置 | Editorial `04-inbox` | 重なる。BottomStack に統一する（§6.8） |
| X16 | 検証していない diff をデモに使うこと | Map | デモの台本（受け入れ試験）では、実際に当てて gate を通したパッチだけを使う |

**margin カードの上限の規則**（X14 の置き換え）: 1 つの節の中で、カードが 8 枚を超えるか、どれかのカードがアンカーから 480px 以上押し下げられる場合 [仮]、active ではない resolved / answered のカードを 1 行（32px、`✓ 回答済 · {引用の先頭 16 字}`）に畳む。それでも条件を満たさなければ、open のカードも古い順に畳む。畳んだカードはクリックか `]` で展開する。

---

## 9. 契約の変更要望（`docs/design/contracts`）

各案の README §8 / §14 / §10 の要望を突き合わせ、既に契約にあるもの（`Job.diffStat`、`EstimateItem.key / tokens / removable`）は除いた。

1. **`ui.ts`**
   ```ts
   export type ShortcutScope = "global" | "read" | "composer" | "review" | "palette" | "map" | "inbox";
   // DEFAULT_KEYMAP に追加
   { id: "review.open",  keys: ["r"],       scope: "read",   singleKey: true },
   { id: "review.widen", keys: ["Shift+R"], scope: "review", singleKey: true },
   { id: "inbox.choose", keys: ["1", "2"],  scope: "inbox",  singleKey: true },
   { id: "inbox.select", keys: ["x"],       scope: "inbox",  singleKey: true },
   { id: "map.zoomIn",   keys: ["="],       scope: "map",    singleKey: true },
   { id: "map.zoomOut",  keys: ["-"],       scope: "map",    singleKey: true },
   { id: "map.fit",      keys: ["0"],       scope: "map",    singleKey: true },
   { id: "map.flow",     keys: ["Shift+1","Shift+2","Shift+3","Shift+4","Shift+5"], scope: "map", singleKey: true },
   /** Scopes active per route (route-scoped, never pointer-scoped). */
   export const ROUTE_SCOPES = { map: ["global","map"], doc: ["global","read"], review: ["global","review"], inbox: ["global","inbox"] } as const;
   // UI_THRESHOLDS に追加
   marginCardsMax: 8, marginMaxDisplacePx: 480, toastMax: 3, ctxCodeMinPx: 420, ctxCodeMaxPx: 900, minTextPx: 11, minControlTextPx: 12,
   ```
2. **`api.ts`**
   - `PaletteItem` に `al?: string[]`（別名: ローマ字の異表記・英語名）と `via?: string`（用語 id。シンボルを用語経由で引いたとき「「持ち越し」経由」と出すため）を足す。Editorial §8-2 と Map §10-6 を統合した。
   - `BlockView` に `mdLine: number`（`.mitori/` の Markdown での行。詳しいレベルのガター）と `variants?: { easy?: { tokens: number; cached: boolean } }`（Editorial §8-5）を足す。
   - `MapView.modules[]` に `topFiles?: { path: RepoPath; loc: number; symbols: string[] }[]`（最大 5。Z3 の家具。0 tok）を足す。`MapView` に `fallback?: "container"` と `quality: { labelFit: number; doorRatio: number; rooms: number; layoutMs: number }`（§6.3.4 の品質ゲートの結果）を足す。
   - `SectionView` に `mapFlow?: { from: string; to: string; step: number }[]`（`from` / `to` は `MapView.diagram` のノード id。Map §10-3）を足す。
3. **`core.ts`**
   - `DiagramKind` に `"floorplan"` を足す。
   - `DiagramLayout` に `doors?: { a: string; b: string | null; orient: "v" | "h"; x: number; y: number; len: number }[]` と `groups?: { id: string; kind: "zone"; polygon: [number, number][] }[]` を足す（Map §10-1）。
   - `DiagramAnchor` に `pos?: { x: number; y: number }`（ノード矩形の中の 0〜1 の相対位置。ピンの位置を、レイアウトが変わっても部屋の中の同じ場所に保つため。Map §10-2）を足す。
   - `Job` に `timings?: { modelMs: number; wallMs: number }`（`result.duration_ms` と、job の開始から ready まで）と、`diffStat` に `hunks: number` を足す（Editorial §8-3、Pro AC-15）。
   - `GateResult` に `autofixedLines?: number`（formatter が書き換えた行数。要約の「空白だけの変更 n 行」に使う。Editorial §8-6）を足す。

---

## 10. 受け入れ基準（統合版。WP-10a / WP-10b の E2E で確かめる）

番号は以後の参照に使う。各案の README の AC のうち、ここに書かれていないものは**廃止**する。

**S1 見取り図**
- **AC-J01**: 1440×900 で S1 を開くと、strip（96px 以下）・床面図の stage（高さ 700px 以上）・目次・右列の見積りカードの主行と［生成］・「0 tok で今できること」が、スクロールせずに見える。usage 台帳に LLM の呼び出しが 0 件。
- **AC-J02**: `mitori` の起動から S1 の描画完了まで、100k LOC 以下で 3 秒以内（crit fixture で測る）。
- **AC-J03**: 床面図のレイアウトは決定的である（同じ入力で 10 回計算して JSON が byte 単位で一致）。40 部屋で計算時間 30ms 以下（Bun Worker）。
- **AC-J04**: 品質ゲート（§6.3.4-7）を満たさない repo では、ELK の Container 図に退避し、strip に退避の理由を出す。fixture（flask, ripgrep, hono, excalidraw, fastapi, react, crit, m3e）の 8 repo について、ゲートの 4 指標と退避の有無を CI のレポートに記録する。
- **AC-J05**: ズーム段は §6.3.3 の `k` の条件で決まり、HUD・`=` / `-` / `0`・ホイール・ピンチのどれでも同じ段に着く。段の切替とカメラの移動の間、床面図の子ノードの追加は 0（MutationObserver で数える）。
- **AC-J06**: 地図のラベルは、どのズームでも画面上 11px 以上で、部屋の外にはみ出さない（clip）。
- **AC-J07**: 部屋をクリックしてから部屋カードが出るまで 100ms 以内、Enter で Reader の該当節が出るまで p95 100ms 以内。カメラの移動は 300ms 以内に終わり、reduced-motion では即時。
- **AC-J08**: 選択した部屋に出入りする依存だけを描き、扉のある依存は扉を横切る短い矢印になる。部屋の中心に 3 本以上の線が集まらない。
- **AC-J09**: §3 の流れを選ぶと、文書の手順番号と同じ番号の札で矢印が出て、ピンと AI 枠は 30% に薄くなる。

**組版・a11y・i18n**
- **AC-J10**: 12 状態（S1・S2 の 3 レベル・Composer・ジョブ実行中・準備完了・Review・採用後・Inbox・パレット・ヘルプ）× ライト / ダークのすべてで、`aria-hidden` ではない可視テキストの AA コントラスト不合格が **0 件**（`judge-tools/judge-probe.mjs` と同じ算法を CI に入れる）。
- **AC-J11**: 可視テキストは 11px 以上、操作要素のラベルは 12px 以上。操作要素の当たり判定は 24×24px 以上（要素の矩形を 4px 格子で `elementFromPoint` して確かめる）。
- **AC-J12**: UI を EN にした状態で、`[data-chrome]` の範囲（文書の本文と利用者名を除く）に和字が 0 文字。`ja.json` と `en.json` のキー集合が一致する。`apps/web/src/**/*.{svelte,ts}` に和字のリテラルが 0 件（lint。i18n catalog と test fixture は除く）。
- **AC-J13**: Reader の本文は computed で 16px / line-height 1.9（en 1.6）、1 行 36〜38 字、`p, li, dd, td, th, blockquote, figcaption` のすべてで `text-autospace: normal` かつ `line-break: strict`。
- **AC-J14**: 生成した Markdown（`.mitori/doc/**/*.md`）に、コードスパンとリンクの外側で「和字＋半角空白＋英数字」と「英数字＋半角空白＋和字」が 0 件（正規化の単体テスト + fixture の生成物で検査）。
- **AC-J15**: Web フォントを 1 つも読み込まない。`lang="en"` の UI でも本文の `lang` は生成言語のまま。
- **AC-J16**: 床面図の「テキストで見る」が、キーボードだけで開けて閉じられ、区画・部屋・扉・外部アクターの全件を表として出す。部屋のフォーカスは roving tabindex（Tab で入るのは 1 か所）。

**Reader と文脈列**
- **AC-J20**: 読者レベルの切替はネットワークを使わず p95 50ms 以下。前後で、画面内の最初の block の位置のずれが 4px 以下。`READER_LEVEL_RULES` の 5 項目（L3・出典・下線・Why・行番号）が表どおりに変わる（DOM snapshot）。
- **AC-J21**: 文脈列のモードは §6.2 の表どおりに遷移する（遷移ごとの E2E）。`code` モードの幅は clamp の規則に従い、420px を下回る場合は rail が drawer になる。
- **AC-J22**: scrollspy は、スクロールが止まってから 100ms 以内にハイライトを付け替え、同じファイル内の移動ではコード列の子ノードの追加が 0。
- **AC-J23**: 出典チップに 300ms ±30ms hover すると、チップに接して peek が出る。peek に pointer を移しても閉じず、Esc で閉じる。キーボードのフォーカスでは即時に出る。表示する範囲は `Cite` と一致し、合計 26 行以下。
- **AC-J24**: 確認済の ✓ は、hover・⌥ 長押し・詳しいレベルのときだけ出る。推測バッジは全レベルで本文中に見え、畳んだ Why / Deep Dive の見出しにも出る。
- **AC-J25**: margin カードは対応する段落の上端に揃い、12px の間隔で重ならない。§8 の上限の規則で、30 件のスレッドがある節でも、アンカーから 480px 以上離れたカードは 0。

**依頼・ジョブ・Review**
- **AC-J30**: 文を選ぶと 100ms 以内に浮遊ツールバーが出て、`c` / `e` / `f` で Composer が開く。IME の変換中の Enter・Esc・英字キーでは何も起きない。Enter 単独では送信しない。
- **AC-J31**: Composer の部品は §6.5 の順に並ぶ。直す対象の 2 択は、意図が修正でアンカーが doc のときだけ出る。
- **AC-J32**: context chip を外すか足すと、見積りチップと router チップが同じフレーム内で変わる。アンカーが 120 行を超えるかファイルが 2 を超えると、router が `patch` から `agent` に変わる。
- **AC-J33**: `⌘⏎` から 100ms 以内にジョブカードが出て、`RouteDecision` から作った計画ステージが淡色で並ぶ。以後は `JobEvent.phase` が届くたびに行が ✓ になり、所要時間が付く。% バーは無い。
- **AC-J34**: ヘッダーのジョブチップとステータスバーの件数は、`JobState` の変化から SSE 1 イベント以内に一致する。チップの popover の項目で Enter を押すと、そのカードへスクロールする。
- **AC-J35**: 準備完了カードに diffStat（hunk 数を含む）・設計書のブロック数・ゲートの結果・実費（$・秒）が出る。Review パネルは、1440×900 の 1 画面に §6.7 の 1〜4 と 8 が入る（diff だけがスクロールする）。値は `result.usage`、gate runner の実測、`Job.timings` から取る。
- **AC-J36**: 焦点単位の採用: 開いた直後の `⌘⏎` は全部を採用する。`n` で hunk にフォーカスすると、`⌘⏎` / `⌘⌫` はその hunk だけに効く。一部だけ採用すると `partially_accepted` になる。
- **AC-J37**: 採用では checkpoint を作ってから working tree に書く。block は 1 回だけ光り（reduced-motion では静的な帯）、10 秒の Undo トーストが出て、`⌘Z` で checkpoint から戻る。却下と取り消しは確認ダイアログを出さない。
- **AC-J38**: どの状態でも、下端に固定した要素どうしの矩形の交差が 0（BottomStack。トースト 3 件 + batch バー + ステータスバーの組み合わせで E2E）。
- **AC-J39**: 失敗したスレッドには、原因の連鎖・stderr 末尾 3 行・ここまでの費用と実行回数・次の手が出る。依頼文・アンカー・chips は失われない。Opus high の提案は、金額を明示して確認を取るまで実行しない。
- **AC-J40**: doc_edit の 2 択は、Composer（§6.5-4）と Inbox（`1` / `2`）の両方で選べて、選択肢ごとに費用（0 tok / ≈{k} tok · ≈${usd}）を出す。

**Inbox・パレット・生成**
- **AC-J45**: Inbox は `j` / `k` で 50ms 以内に選択が動き、右の詳細が切り替わる。「すべて」ではグループ見出しで並ぶ。下書きが 2 件以上あるとき、上端の batch バーに見積りと節約率を出す。
- **AC-J46**: パレットで `mochi`・`mochikoshi`・`motikosi`・`もちこし`・`carry` のどれを打っても「持ち越し」が先頭に来て、一致の理由のバッジが出る。1 打鍵 16ms 以下（5 万件、Worker）。閉じるとフォーカスが元に戻り、直後の単一キーのショートカットが効く。
- **AC-J47**: 生成の見積りカードの主行は `{effort}: 約{M}M tok · API換算 ${usd} · 約{分}分` と［生成］の 1 行で、effort を変えると 16ms 以内に変わる。［生成］の 1 クリックか `⏎` で始まり、別の確認ダイアログは出ない。「内訳と経路」に stage 表・engine 3 種・データ開示・有効期限がある。
- **AC-J48**: 生成中、目次で待機中の章をクリックすると、その章が次の空き枠で生成され、100ms 以内にトーストが出る。最初の block の到着でトーストが出る。生成の進行中から完了まで CLS の合計が 0.01 未満（目標 0）。

**キーボード**
- **AC-J55**: keymap は `DEFAULT_KEYMAP` + §6.14 の差分と一致する（registry の snapshot テスト）。S1 では `-` / `=` / `0` が地図のズームにだけ効き、S2 では読者レベルにだけ効く。
- **AC-J56**: 設定で単一キーのショートカットをオフにすると、`singleKey: true` の操作は 1 つも発火しない（全キーを順に送る E2E）。

**性能**
- **AC-J60**: 初期 JS は gz 60KB 以下（上限 150KB）、CSS は gz 15KB 以下。chunk の配分は §6.16 を目安にし、ビルドごとに実配信のバイト数を記録する。
- **AC-J61**: AC-J10 の 12 状態のすべてで DOM 5k 以下（上限 15k）。床面図は 40 部屋の fixture で 1,500 ノード以下 [仮]。
- **AC-J62**: INP p75 100ms 以下、節の遷移 p95 100ms 以下、ショートカットの反応 50ms 以下（synthesis §6.2）。

---

## 11. 未決事項（[仮] の値と測り方）

1. **床面図の品質ゲートの閾値**（label-fit 70%、扉 45%、40 部屋、30ms、面積の係数）[仮]。P0 で fixture 8 repo（§10 AC-J04）について 4 指標を記録し、退避した repo の割合が 25% を超えたら、√LOC の指数か区画の決め方を見直す。特に m3e（modularity が負の層状の構成）で扉の割合を確かめる。
2. **和欧間の空白を Markdown に入れない方針と、GitHub での読みやすさ**。GitHub は `text-autospace` を指定しないので、`.mitori/` を GitHub で読むと詰まって見える。日本語話者の開発者 5 人に、同じ節の「空白なし（mitori で表示）/ 空白なし（GitHub）/ 空白あり（GitHub）」を見せて読みやすさを 5 段階で評価してもらう。空白ありを 4 人以上が選んだら、原稿を「空白あり」に切り替え、mitori の renderer で `text-autospace: no-autospace` にする（どちらでも mitori の表示は崩れない）。
3. **明朝見出しの Windows 表示**（Yu Mincho の欧字）。Windows 11 の実機で §3 と §6 の見出しを撮影し、崩れていたら、見出しを角ゴ 600 に切り替える設定を出す。
4. **詳しいレベルで `code` モードを既定にすること**の妥当性。専門家 5 人に「§3.1 の主張 3 つを出典で検証する」タスクをしてもらい、既定 `margin`（`o` で固定）と既定 `code` で完了時間を比べる。`code` が 20% 以上速くなければ、既定を `margin` に戻す。
5. **margin カードの上限**（8 枚・480px）[仮]。30 スレッドの fixture で、畳んだカードを探す時間を観察する。
6. **IME の実機検証**（ことえり / Google 日本語入力 / MS-IME）。§6.14 のガードと `e.code` の判定、`Shift+1〜5` と IME オンの組み合わせを手で検査する（07 §8-1。3 案とも未実施）。
7. **タブレットでの peek**。タップで peek を開いて固定し、2 回目のタップで `code` モード（bottom sheet）に移す案を、iPad の Safari で試す（Pro §13-4）。
8. **5h 枠の推定値**（+9% / +11% / 34% など）[仮]。addendum C3 の測定（並行する job が無い状態で、標準生成 1 回の utilization の差を取る）で置き換えるまで、UI では `[仮]` を付ける。
9. **1280×800 のノート PC**: S1 の右列 360px で stage の幅が約 690px になる。17 部屋の crit で `md` 以上のラベルの割合を測り、70% を下回るなら、右列を 320px にするか、見積りカードを 1 行に畳んだ状態で始める。
10. **`text-autospace` と `text-spacing-trim` の対応ブラウザ**: Chrome でしか確認していない。Safari 26 と Firefox 145 で AC-J13 を確かめる。効かない環境では和欧間が詰まって見えるが、原稿に空白を入れない方針は §11-2 の結果が出るまで変えない。
11. **Z3 の家具の DOM 量**: 40 部屋のうち `lg` になった部屋だけに描く規則で、ズームを繰り返したときの DOM の上限を、AC-J61 の fixture で測る。
12. **流れのキー `Shift+1〜5`**: US 配列では `!`〜`%` になるので、`e.code`（`Digit1`〜`Digit5`）+ `shiftKey` で判定する。JIS 配列でも同じに動くかを実機で確かめる。

---

## 付録 A. 計測の再実行

```sh
cd <playwright を入れたディレクトリ>          # 例: bun add playwright（手元の Chrome を channel:'chrome' で使う）
node /Users/satoki252595/work/20261002_aiAgentTool/docs/design/prototypes/judge-tools/judge-probe.mjs \
  > /Users/satoki252595/work/20261002_aiAgentTool/docs/design/prototypes/judge-tools/probe-results.json
```

出力は案 × 状態ごとに、`dom`・`minFontPx`・`under11px`・`contrastFail` / `contrastChecked`（不合格の例 12 件まで）・`under24px`（例 8 件まで）・`prose`（font-size / line-height / 幅 / 字数 / autospace / line-break / font-family）・`head`・`tabFocus`・`liveRegions`・`errors`（page error の数）を持つ JSON である。AC-J10 / AC-J11 / AC-J13 の CI 実装は、この算法（祖先の背景をアルファ合成してコントラストを計算する、可視性を判定する）をそのまま使う。
