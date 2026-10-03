# mitori UI プロトタイプ — 方向性「Editorial Calm」

- 作成日: 2026-10-03 / 対象: P0〜P2 の UI（S1 見取り図・S2 設計書 Reader・Composer・Job・S5 Review・S4 Inbox・⌘K・ヘルプ・ライト / ダーク・ja / en）
- 成果物: `index.html`（単一ファイル、インライン CSS と vanilla JS、外部への通信なし、Web フォントなし）、`shots/*.png`（Playwright と手元の Google Chrome で撮影）、`tools/`（撮影・計測・出典抽出のスクリプトと、検証済みの修正パッチ）
- 位置づけ: 見た目と操作の**仕様を兼ねたプロトタイプ**。製品コードではない。Svelte 5 実装は本書の数値・状態・キー割り当てをそのまま受け入れ基準として使う（§9）。
- 入力: `docs/research/07-ux-principles.md`、`00-synthesis.md` §4〜§5・§6.2・Critic addendum、`01-crit-teardown.md`、`docs/design/contracts/{ui,core,api}.ts`。

---

## 0. 開き方と状態の切り替え

`index.html` をブラウザで直接開く（`file://` で動く）。状態は URL で選べる。

| URL | 状態 |
|---|---|
| `index.html#map` | S1 初回スキャン直後（0 tok、未生成）。Enter か［生成］で生成を 60 倍速で再現する |
| `index.html#doc` | S2 生成済みの設計書。margin にスレッド 4 件（回答済・未解決 2・実行中） |
| `index.html#s3-2` などの節 ID / `#b_s2rt8y3q` などの block ID | その位置へ移動（permalink） |
| `index.html#review` | 修正提案（th_17）の S5 Review。無ければ準備完了の状態を作ってから開く |
| `index.html#inbox` | S4 Inbox |
| `?theme=dark` / `?level=newcomer\|standard\|expert` / `?lang=en` / `?gen=done` | テーマ・読者レベル・UI 言語・生成状態の初期値。指定が無ければ cookie `mitori_ui` → localStorage → OS 設定の順 |

デモの通し手順（すべてキーボードで行える）: `#doc` を開く → §3.2 の「正確に1回だけ再試行する」を選択 → 浮遊ツールバー → `f` → 依頼文を入力 → `⌘⏎` → 実ステージの進行（約 13 秒）→ `r` → `n` で hunk 移動 → `⌘⏎` で採用 → block が 1 回だけ光る → `⌘Z` で取り消し（10 秒以内）→ `g` `i` で Inbox → `j` `k` → `⌘K` で `mochi` と打つ。

`window.mitoriDemo`（撮影用のフック。製品の API ではない）: `setLevel` `setTheme` `toggleLang` `openPal(q)` `selectFix()` `compose(intent, text)` `submit()` `ff()`（実行中の job を完了まで早送り）`review()` `accept()` `scrollTo(id, offset)` `gen()` `inboxSelect(i)` `focus(blockId)` `freeze(bool)`。

### 0.1 スクリーンショット（1440×900 @2x、タブレットは 820×1180 @2x）

| ファイル | 内容 |
|---|---|
| `01-first-run-map.png` | (1) 初回スキャン。見取り図・目次（静的 / 未生成）・規模・見積りカード「標準: 約0.4M tok · API換算 $1.3 · 約6分 · [生成]」 |
| `01b-map-hover.png` / `01c-generating.png` | 部屋への hover（関係のない部屋を薄くし、依存を点線で示し、L0 の 1 行要約を出す）/ 生成中（部屋ごとの進行・目次の「生成中」・実トークン数） |
| `02-reader-standard.png` | (2) 標準レベル。出典チップ・用語の下線（初出のみ）・推測バッジ・読書パス 3/7・margin スレッド |
| `02b-reader-peek.png` | 出典チップの hover で実コードを表示（daemon.go:178–193） |
| `02c-reader-newcomer.png` / `02d-reader-expert.png` | 初めて（段落末に「出典 1」、やさしく言い換え、下線多め）/ 詳しい（範囲付きチップ、確認済の印と Markdown の行番号をガターに表示、下線なし、Deep Dive 展開） |
| `03a`〜`03f` | (3) 選択 → ツールバー → Composer（意図チップ・context chips・見積り）→ 実ステージの job → 準備完了カードと本文の提案差分 → Review（コード diff・設計書 diff・ゲート・実績）→ 採用後の flash と Undo トースト |
| `04-inbox.png` / `05-palette-romaji.png` | (4) Inbox（状態・doc_edit の 2 択・まとめて送る）/ (5) ⌘K でローマ字 `mochi` → 持ち越し・§6.3・関連シンボル |
| `06-reader-dark.png` / `06b-map-dark.png` | (6) ダーク（用語カード表示中）/ ダークの見取り図（生成済み） |
| `07-tablet-reader.png` | 820×1180。目次は drawer、スレッドは段落右の吹き出し（タップで bottom sheet） |
| `08-en-chrome-explain-answered.png` / `09-help-overlay.png` | UI を英語にした状態で Explain の回答（本文は日本語のまま）/ `?` のキー一覧（英語） |

---

## 1. 内容が事実であることの担保

- 対象は crit HEAD `406875d`（v0.21.1、2026-10-02）。設計書の本文に出る挙動・数値・行番号は、すべてコードを読んで確かめた。出典チップの hover で出るコードは `tools/cites.mjs` で crit から**そのまま切り出した**もの（35 箇所、blob sha 付き）。
- 規模の数値は `git ls-files` と `wc -l` で数えた: 1,219 files、Go 本体 45.7k 行（186 files）、Go テスト 83.0k 行（259 files）、web/（vendor・テスト除く JS/CSS/HTML）34.6k 行、integrations/ 8.3k 行、HTTP ルート 61（`server.go:136-222` の `mux.HandleFunc`）、設定キー 38（`Config` の json tag）、除外 826 files（テスト 522・vendor/lock 267・画像）。部屋の広さはこの行数に比例させた（1k 行 ≈ 3,377 viewBox px²）。
- **デモの修正は本物**: `tools/crit-story-retries.patch` は crit `406875d` のコピーに適用し、`gofmt -w` 後に `gofmt -l` が 0 件、`go vet ./cmd/crit ./internal/config` が通り（0.7 s）、`go test ./cmd/crit -run TestStoryLLM` の 12 件がすべて PASS（6.2 s）することを確かめた（Go 1.27.1、この Mac）。Review 画面の diff はこのパッチをそのまま表示しており、+44 −33 の数も一致する。gofmt が `StoryMaxRetries` を足したことで後続 4 行の整列を変えた点も要約に書いてある。
- 推定値（実測ではないもの）: 生成の見積り（0.4M tok / $1.3 / 約 6 分 / 5h 枠 +9%）は synthesis §4.6・§8.1 の推定を表示しただけで [仮]。job のトークン実績（入力 2.48k / 出力 1.17k / $0.016）は 06 §10 の実測（2.47k / 1.2k / $0.022）に寄せた**作り値**で [仮]。モデル応答の 6.0 s も [仮]。ゲートの 0.7 s / 6.2 s は上の実測値。
- 人物「aoi」「ren」は架空のチームメイト。crit の作者を含む実在の人物には発言をさせていない。

---

## 2. デザイントークン

### 2.1 色（`:root` と `[data-theme=dark]` に同じキー集合で定義する。値は 8 桁 hex を使わない）

| トークン | ライト | ダーク | 用途 |
|---|---|---|---|
| `--paper` | `#FAF9F6` | `#141311` | 背景（純白・純黒にしない） |
| `--paper-2` | `#F4F2ED` | `#191816` | 一段沈んだ面（まとめ・やさしく・チップ） |
| `--sheet` | `#FFFFFF` | `#1C1B18` | カード・popover |
| `--hover` / `--press` | `#F1EEE8` / `#E8E4DC` | `#23211E` / `#2B2925` | 状態面 |
| `--ink` | `#1C1B19` | `#EEEAE2` | 見出し・主ボタン |
| `--text` | `#2E2C29` | `#D6D1C7` | 本文（ダークは 85% 程度の明るさ） |
| `--muted` / `--faint` | `#615D57` / `#75706A` | `#ADA79B` / `#8F897F` | 補助文字。`--faint` は `--paper` / `--sheet` の上でだけ使う（4.6:1 以上）。初版の `#A29D94`（2.56:1）は AA を満たさず、撮影後に直した |
| `--rule` / `--rule-2` / `--rule-soft` | `#E6E2DA` / `#D6D1C7` / `#EFECE6` | `#2A2825` / `#3A3732` / `#211F1C` | 罫線（1px のみ） |
| `--accent` | `#A3401F`（朱） | `#E2805D` | 現在位置の印・focus ring だけに使う |
| `--mark` | `#F6ECC4` | `#3B321B` | アンカーと選択範囲の蛍光ペン |
| `--c-ok(-bg)` | `#3B6A40` / `#E9F1E6` | `#9BC59D` / `#1C281D` | 確認済・適用済・ゲート |
| `--c-guess(-bg)` | `#865F14` / `#F8EED3` | `#E0C07A` / `#2C2416` | 推測 |
| `--c-run(-bg)` | `#2B5D85` / `#E4EDF5` | `#8DB7DC` / `#17222C` | 実行中 |
| `--c-prop(-bg)` | `#59468F` / `#EDE9F6` | `#B8A8E6` / `#231F37` | 提案・準備完了・人が確認 |
| `--c-bad(-bg)` | `#9A3227` / `#F9E9E5` | `#EC998B` / `#311E1A` | 失敗・落とし穴 |
| `--c-warn(-bg)` | `#8C5810` / `#F8ECD8` | `#E2B36F` / `#2E2418` | outdated・要選択 |
| `--add-bg` / `--del-bg` / `--add-fg` / `--del-fg` | `#EBF3E6` / `#FAEDE9` / `#2E6135` / `#8E2F24` | `#1A281C` / `#2D1A17` / `#A6D3A4` / `#EFA696` | diff。色に加えて `+` / `−` の記号と行番号の列で区別する |

影は 2 種類だけ: `--soft`（`0 1px 2px` α .035）と `--pop`（popover・パレット・トースト。`0 14px 36px -10px` α .13）。グラデーション・ガラス効果は使わない（ヘッダーの `backdrop-filter: blur(10px)` だけ例外）。

### 2.2 書体（Web フォント 0 byte。stack の先頭は OS 標準。contracts/ui.ts の `FONT_STACKS` に一致させる）

| 用途 | stack |
|---|---|
| 本文・UI | `-apple-system, BlinkMacSystemFont, "Hiragino Sans", "Hiragino Kaku Gothic ProN", "Segoe UI", "Yu Gothic UI", Meiryo, "Noto Sans JP", "Noto Sans CJK JP", sans-serif` |
| 見出し（明朝）| `ui-serif, "Iowan Old Style", "Hiragino Mincho ProN", "YuMincho", "Yu Mincho", "Noto Serif JP", "Noto Serif CJK JP", serif` |
| コード・数値 | `ui-monospace, "SF Mono", Menlo, Consolas, "Cascadia Mono", "BIZ UDGothic", "Noto Sans Mono CJK JP", monospace`（リガチャ off） |

明朝は「章見出し・節番号・図のタイトル・見積りカードの見出し・プロジェクト名」だけに使い、本文と UI は角ゴシックにする（画面での可読性を優先し、紙面の格を見出しで出す）。

### 2.3 文字組（JLREQ に合わせる）

| 要素 | 指定 |
|---|---|
| 本文 | 16px / `line-height: 1.9` / `letter-spacing: .012em` / `max-width: 37em`（= 592px、1 行 36〜37 字）/ `line-break: strict` / `overflow-wrap: anywhere` / `text-wrap: pretty` / `text-spacing-trim: trim-start` / `text-autospace: normal`（`html` に指定して継承させる） |
| リード（§0） | 18px / 1.85 / `--ink` |
| 章見出し h1 | 明朝 34px / 600 / 1.35 / `.02em`。上に節番号（明朝 15px、`oldstyle-nums`、`--faint`） |
| 節見出し h2 | 明朝 22.5px / 600 / 1.45。番号は `--faint` |
| h3・小見出し | 角ゴ 15px / 600 |
| メタ行 | 12px / `--muted`、区切りは `·`（`--rule-2`） |
| 見出し全般 | `word-break: auto-phrase; text-wrap: balance`（本文には `keep-all` も `auto-phrase` も使わない） |
| 太字 | 600（700 は使わない） |
| 和欧間 | 原稿に空白を入れない。`text-autospace` に任せる（生成プロンプトでも指示する） |
| 数値 | 表とメーターは `tabular-nums` |
| inline code | `.84em`、`--code-bg`、角丸 4px |

### 2.4 寸法とレイアウト

| 名前 | 値 | 備考 |
|---|---|---|
| `--hdr` | 52px | sticky。`scroll-padding-top: hdr + 28px` |
| `--rail` | 248px（≤1280: 228） | 読書パスカード・目次・生成メタ。Inbox ではフィルタに入れ替わる |
| 本文列 | 残り全部。prose は中央寄せ 37em | `.doc` の padding は 52 / 56 / 120 / 64px |
| `--aside`（margin 列） | 368px（≤1280: 332） | スレッド・Composer・job カードを段落の高さに合わせて置く |
| `--aside-rv`（Review） | 640px | Review 中は rail を幅 0 にし、grid の列幅を 320ms で遷移させる |
| pin（Split view） | 540px | `o` で出典を右に固定したとき |
| 見取り図（S1） | 本文列いっぱい（1440 幅で約 1080px）、viewBox 1160×432 | 上段は「題名・規模」と「見積りカード 452px」の 2 列 |
| 角丸 | カード 10〜12px、ボタン 6px、チップ 4〜5px、状態タグだけ 999px | |
| 当たり判定 | 出典チップは見た目 20px、`::after` で上下 3px 広げて 26px | WCAG 2.5.8 |

ブレークポイント: ≥1281 は 3 ペイン / 1024〜1280 は列を詰め、使用量表示を隠す / ≤1023 は rail を drawer（`b` か ☰）、margin を段落右の吹き出しマーカー（`.mk`）と bottom sheet（高さ 56vh）にする / ≤600 は読者レベルの切り替えを隠し、読むこととコメントに絞る。

**content-visibility の注意**: `.sec` に `content-visibility: auto` を付けると paint containment で節の外側が切れ、ガターの確認済マークや、図の負マージン、吹き出しマーカーが消える（初回の撮影で実際に起きた）。そこで `.sec` に `margin: 0 -64px; padding: 0 64px` を与えて paint 範囲を広げる。図を含む節には付けない（Safari の SVG text 問題、07 §5.2-4）。

### 2.5 動き（`prefers-reduced-motion: reduce` ではすべて 0.001ms にする）

| 対象 | 時間・曲線 |
|---|---|
| hover の色・背景 | 120〜150ms |
| popover（出典・用語） | 表示までの遅延 300ms（hover-intent）、表示 140ms、離れてから閉じるまで 160ms の猶予 |
| margin カードの位置合わせ | `transform: translateY` で 280ms `cubic-bezier(.16,1,.3,1)`。`top` は動かさない |
| カードの出現 | opacity だけの 220ms（transform は位置合わせ専用） |
| Review の開閉 | `grid-template-columns` を 320ms |
| AI 作業中の block | 左の 2px 帯の opacity を 1.6s で脈動 |
| 採用時の flash | 1 回だけ、1.6s（`::after` の opacity。背景色そのものは動かさない） |
| Undo トースト | 表示 180ms。下端の残り時間の線は 10s linear（偽の進捗ではなく、残り時間そのもの） |

---

## 3. 画面ごとの仕様

### 3.1 S1 見取り図（初回、0 tok）

- 上段左: kicker「スキャン完了 · 1,219 filesを0.27秒で索引 · 間取り図・目次・facts 表はここまで 0 tok」、題名（明朝 46px）、repo・言語・ライセンス・HEAD、README の 1 行目を**原文のまま**（「生成すると日本語の要約に置き換わる」と明記。0 tok の段階で LLM の要約を装わない）、規模 4 セル。
- 上段右: 見積りカード。effort の 3 タイル（概要 0.12M · $0.4 · 約2分 / **標準 0.4M · $1.3 · 約6分** / 完全 1.1M · $3.6 · 約17分。選択中は下端 2px の ink 線）、要約行「標準: 約0.4M tok · API換算 $1.3 · 約6分」と［生成 ⏎］、内訳 1 行、実行経路・5h 枠・送信先を 1 行、代替経路（`mitori gen --prep` をコピー / API キー）。生成中は内訳の位置に進行行（repo pack 固定 → 概要 → §3 → モジュール章 n/14・並列 3 → 実トークン数のメーター）が入れ替わる。**この領域の高さは初回表示時に 2 状態の大きい方に固定する**（固定しなかった版では CLS 0.0056、固定後は 0.0001 [実測]）。
- 間取り図（hero）: 部屋 = モジュール群。広さ ∝ 行数。部屋の中の「家具」= 主要ファイル（広さ ∝ 行数、ラベルは入る幅のときだけ）。扉 = 共有壁の上の結び付き（import / HTTP）、窓 = 外部サービス、外の矢印 = 入口（エージェント → CLI、ブラウザ → web UI）。hover: 300ms 後に L0 の 1 行要約、関係する部屋以外を opacity .38、依存を朱の点線。クリック / Enter: 対応する章へ。生成中は対象の部屋に青い枠の脈動 → 完了で ✓（高さ 60 未満の部屋には ✓ を出さない）。
- 部屋ラベルの詰め方: `幅(名前) + 幅(行数) + 18 > 部屋幅 − 28` のあいだ、名前のサイズを 0.5px ずつ下げる（下限 11px）。幅は和字 1em・欧字 0.56em で見積もる。
- 製品での描画: Diagram IR（`nodes[].ref` は block / symbol / path）→ サーバ側の配置 → SVG。**ELK の layered は面積比例の配置をしない**ので、間取り図は「グループ（列）→ 行数で縦に分割 → 列幅を合計行数で決める」スライス配置を自前で行い、扉の位置だけを辺から計算する（共有壁の重なり ≥ 2R+8 の中点、R=14、家具からの余白 18）。部屋が 12 を超える場合の扱いは §10 の未決事項。

### 3.2 S2 設計書 Reader

- 章の頭: 節番号・明朝見出し・メタ行（読了時間・確認済 n・推測 n・最終更新 commit・モデル）→「この章で分かること」（上下の罫線、番号は明朝）。章の終わり:「まとめ」（`--paper-2` の面）→ 次の章への pager。
- block: `data-b`（block ID）・`data-depth`・`data-ln`（Markdown の行）。hover で淡い面、`j`/`k` のフォーカスは左に朱の 2px 帯、スレッド付きは灰の帯、AI 作業中は青の帯の脈動、提案中は紫の面と左の内側 2px。
- 出典チップ: mono 11px・20px 高。標準は `daemon.go:178`、詳しいは `daemon.go:178–193`、初めては本文から消して段落末に「出典 n」（クリックで一覧）。hover 300ms で code peek（最大 14 行、引用範囲を `--mark` 62% の面と朱の行番号線で示す、header にフルパス・シンボル・blob sha、footer に検証状態と `o` 固定 / `⇧o` エディタ）。
- 確認の印: 確認済は既定で隠し、block の hover・`⌥` 長押し・詳しいレベルのときだけガターに ✓ を出す（全段落に緑の印を並べると、静かさが失われるため）。推測は常に本文中に黄のバッジと、主張部分の下 38% の淡い帯で示す。Why の中の推測には「✓ 私が確認した」があり、押すと「確認済 by あなた」（紫）になって次の再生成でも保持される。
- 用語: `dfn.term`。点線の下線（4px 周期・1px）。hover 300ms で用語カード（語・よみ・英語名・定義・使用箇所数・「用語集で開く」）。
- Why（`details.why`、左 2px の罫線）、落とし穴（`aside.pit`、常に表示、淡い赤の面と左 2px）、Deep Dive（`details.deep`、上下の罫線、L3）。
- 読書パス: rail 上部のカード。リング（stroke-dashoffset）と「n / 7」「残り約 n 分 · 追加 0 tok」「次: §x」。節の終わりの不可視マーカーが viewport の下 20% を越えたら既読にする。目次の既読には点を付ける。
- margin のスレッド（Google Docs 方式、§4.1 の配置規則）。アンカー部分は CSS Custom Highlight API（`::highlight(mitori-anchor)`）で塗り、DOM を分割しない。

### 3.3 選択 → 依頼 → 準備完了 → 採用

1. **選択**: 1 つの block の中で 2 文字以上を選ぶと、選択範囲の 46px 上に浮遊ツールバー（ink の面: コメント C / 説明して E / 修正して F / プロンプト P / permalink Y）。上に余地が無ければ下に出す。ツールバーの `mousedown` は `preventDefault` で選択を保つ。
2. **Composer**（margin の、その block の高さに出る。≤1023 は bottom sheet）: アンカーの引用（前後 18 字 + `<mark>`）、意図チップ（質問 ⌘1 / 修正 ⌘2 / 指摘 ⌘3 / メモ ⌘4。`c`=メモ、`e`=質問、`f`=修正で開く）、本文（`field-sizing: content`、Enter は改行）、context chips（節・出典ごと・関連シンボルの skeleton。× で外すと即座に再計算、外したものは打ち消し線で残し + で戻せる）、見積りチップ（hover で内訳）、実行経路（⚡ その場で実行 · claude-cli / 自分のセッションへ · mitori review / プロンプトをコピー を順に切り替え）、`⌘⏎` 送信。下書きは 500ms の debounce で保存し、Esc で閉じても残る。
3. **見積りの式**（client 側。製品では `JobEstimate.estimate` の items をそのまま chips にする）:
   - 入力 = 固定 1.0k（system・cache）+ 指示（和文 0.8 tok/字、下限 40）+ Σ chip。chip の tok = 引用行数 × 27 [仮: Go の 1 行 ≈ 62 字 ÷ 2.3 字/tok。計測は P0 の tokenizer 較正で置き換える]、節本文 0.2k、skeleton 0.6k。
   - 出力上限: 修正 1.2k / 質問 0.6k / 指摘 1.5k。
   - API 換算 $ = (入力 − 固定) × $2/M + 固定 × $0.2/M + 出力 × $10/M（claude-sonnet-5-5）。
   - 所要: 修正 約13秒（モデル 約6 秒 + Go のゲート 約7 秒）/ 質問 約5秒 [仮: 同じ意図の過去実績の p50 で置き換える]。
   - 色帯: 合計 < 10k は灰、10〜50k は琥珀（50k 以上は確認ダイアログの閾値側で扱う）。
4. **楽観的な job カード**（送信から 100ms 以内。実測 p50 8.6〜10.2ms、§6）。ステージは stream-json の実イベントから作る。偽の % バーは出さず、経過時間と「通常 10–16秒」（同意図の p25–p75）を出す。

| ステージ | 表示 | 元になる事実 |
|---|---|---|
| queued | 受付 · 楽観的に作成 | client が作成 |
| preparing | 準備 · snapshot → `refs/mitori/th_17/base` · bundle MBF/1 2.5k · ルート patch（2 files · 48 行 ≤ 120） | daemon（Git Safety・router） |
| running | claude-sonnet-5-5 を起動（実際の flag を 1 行で表示）→ 応答を受信中（ttft）+ tail に `patch/1` の ops を 1 行ずつ | `system/init`、最初の delta、受信した ops |
| gating | patch/1 を worktree に適用（範囲検査・gofmt -w）→ gofmt · go vet → 関連テスト | 各 gate の開始と終了 |
| ready | 準備完了 | 全 gate 終了 |

5. **準備完了**: カードに `+44 −33 · 2 files`・`設計書 2 ブロック`・`ゲート 4/4`・`$0.016 · 13.1秒`・［レビュー R］［却下］。同時に本文の該当 block を提案モード（削除は取り消し線と淡い赤、挿入は 1.5px の下線と淡い緑、紫の面にヘッダー「提案 · mitori AI（claude-sonnet-5-5）· R2」と ✓ / ✕）で表示する。表の行の追加は行全体を淡い緑にする。タブが非表示ならタイトルを `(1) ✓ mitori — crit` にする。
6. **Review**（`r`）: 右 640px のパネル。上から ゲートの 4 ピル → 実績 1 行（入力・cache・出力・$・秒〔モデル + ゲート〕・見積との差 %）→ AI の要約（`result` から 4 項目）→ コード diff（ファイルごとに ✓ / ✕、hunk ヘッダー、旧 / 新の行番号、`+`/`−`、長い行は折り返して字下げ）→ 設計書の提案 2 件（本文へのリンク）→ 下端に固定の［すべて採用 ⌘⏎］［却下 ⌘⌫］と説明。`n` / `⇧N` で hunk を移り、現在の hunk は紫の帯。
7. **採用**（`⌘⏎`）: パネルを閉じ、本文を新しい文に置き換え、block と表を 1 回だけ光らせ、左に「変更済み」の緑の細帯を残す。margin のカードは「R2 で解決 · 適用済み · checkpoint refs/mitori/cp/0007」に縮む。トースト「反映しました — 2 files を作業ツリーへ（未 commit）· checkpoint …［元に戻す ⌘Z］」を 10 秒表示する。`⌘Z`（入力欄の外）で checkpoint から戻し、提案状態に戻す。

### 3.4 S4 Inbox

- 一覧の行: 状態の形（色だけに頼らない）・題名・種類・アンカー（節 · file:line）・メタ・状態タグ・時刻。選択行は面と左の朱の 2px。
- 状態の対応表（`ThreadState` / `JobState` の UI 表現）:

| 状態 | 形 | 色 | ラベル |
|---|---|---|---|
| queued / draft | ○ / 点線の ○ | muted | 待機 / 下書き |
| running / preparing / gating | 半分塗りの ◐ | run | 実行中（gating は「ゲート」） |
| ready（proposed） | ◆ | prop | 準備完了 |
| applied / resolved | ✓ の丸 | ok | 適用済み |
| answered | 吹き出し | ok | 回答済 |
| failed | ✕ の丸 | bad | 失敗 |
| outdated | ▲ に ! | warn | outdated |
| needs_input（doc_edit の 2 択） | ? の丸 | warn | 要選択 |
| open | ● | ink | 未解決 |

- 右の詳細: 種類ごとに中身を変える。doc_edit は「1 設計書を直す（コードが正しい）· L1 の静的検証 → human-edited で固定 · 0 tok」「2 コードをこの設計に合わせる · patch · ≈3.2k tok · ≈$0.02」を `1` / `2` で選ぶ。失敗は原因の分類（budget）と stderr の末尾 3 行、「範囲を絞って再試行」「プロンプトをコピー」。outdated は元の位置のスナップショットと「新しい位置を指定」。
- まとめて送る: 一覧の下に sticky の帯「下書き 3件（すべて internal/story）をまとめて送ると ≈9.8k tok / 別々なら ≈14.2k · 31% 節約」と［まとめて送る ⇧F］。
- フィルタ（rail）: すべて / あなたの番（ready・needs・open）/ 作業中 / 失敗 / outdated / 下書き / 解決済み。件数とヘッダーの Inbox バッジ（= あなたの番）は状態変化のたびに数え直す。

### 3.5 ⌘K パレット

- 幅 640px、上から 13vh、入力 54px / 17px、行 44px 以上、表示は 8 行 + 次の行が半分見える高さ（398px）。scrim は α .14（ライト）、ぼかし無し。
- 索引: 節（目次から）・用語（語・よみ・英語名・ローマ字の異表記）・シンボル（path:line と「正確」。用語に結び付くものは用語の別名も持つ）・操作・スレッド。
- 照合: 部分一致は `100 − 位置 (+40 先頭一致) − 0.05 × 長さ`、部分列は `40 − 隙間 − 0.05 × 長さ`、別名経由は −5。カタカナはひらがなに正規化する。並びは 用語 → 節 → シンボル → 操作 → スレッドの順、各群 3 件まで。
- 一致の理由を右に出す: 別名で当たったら「mochikoshi に一致」、用語を経由して当たったシンボルは「「持ち越し」経由」。ラベル中の一致文字は朱の太字。
- 空入力は「最近」5 件。`↑↓`/`⌃N⌃P` 移動、`⏎` 開く、項目上で `⌘K` → その項目の操作（開く / 説明して / プロンプトとしてコピー / permalink）、入力が空の `⌫` で 1 階層戻る、`Esc` で閉じて**元のフォーカスに戻す**（戻さない版ではパレットを閉じた後の `e` が見えない入力欄に入り、ショートカットが効かなくなった。§6 の計測中に見つけて直した）。

---

## 4. 振る舞いの規則

### 4.1 margin カードの配置（Google Docs 方式）

1. 各カードの理想位置 `top = block.getBoundingClientRect().top − margin.top`。
2. 理想位置で昇順に並べる。active（Composer・選択中・実行中）があればそれを理想位置に固定し、上側のカードは `min(理想, 下のカードの y − 12 − 自分の高さ)`、下側は `max(理想, 上のカードの y + 高さ + 12)` に置く。active が無ければ上から順に押し下げる。
3. 最後に `y ≥ 0` と重なりなしを上から保証し、`transform: translateY(y)` で 280ms 動かす。
4. 再計算のきっかけ: prose の ResizeObserver、`details` の開閉（capture の `toggle`）、読者レベルの変更、生成による block の出現、カードの中身の変化、resize。すべて rAF 1 回にまとめる。
5. アンカーの block が見えない（初めてレベルで L3 が隠れた等）カードは `visibility: hidden`。≤1023 ではカードを置かず、block の右に吹き出しマーカー（件数）を描く。

### 4.2 読者レベル（`html[data-level]` の CSS だけで切り替え。ネットワークなし。p50 3.4ms [実測]）

| | 初めて `newcomer` | 標準 `standard` | 詳しい `expert` |
|---|---|---|---|
| L3 block・Deep Dive | 非表示 +「詳しく（n）」チップ | Deep Dive を閉じて表示 | 展開 |
| 出典 | 段落末の「出典 n」 | 文中の `file:line` | 文中の `file:line–line` + ガターに ✓ と Markdown 行番号 |
| 用語の下線 | 全部 | 節ごとの初出だけ（`data-first`） | なし（hover は有効） |
| Why | 開く | 閉じる | 閉じる |
| やさしく言い換え | 表示（「0.4k tok · キャッシュ済」と明記） | 非表示 | 非表示 |

`core.ts` の `READER_LEVEL_RULES` と一致させてある（`newcomer.hidden=["L3"]`、`standard.collapsed=["L3"]`、`expert.lineNumbers=true`）。

### 4.3 キーボード（contracts/ui.ts の `DEFAULT_KEYMAP` に準拠。追加分は §8）

- すべての keydown の 1 行目で `e.isComposing || e.keyCode === 229` なら return（Safari は compositionend が keydown より先に来る）。英字は `e.code`、記号（`/ ? - = [ ]`）は `e.key` で判定する。Enter 単独では決して送信しない。
- 入力欄の中では Composer の `⌘⏎` / `⌘1–4` / `Esc` 以外を無視する。`g` の後 1 秒以内の `h d i r` で画面移動。
- 実装したキー: `⌘K` `/` `?` `g h` `g d` `g i` `g r` `-` `=` `0` `b`/`t` `⇧C` `⌥`（長押し） `j` `k` `1–9` `[` `]` `o` `⇧O` `y` `p` `c` `e` `f` `r` `h` `⇧F` / Composer: `⌘⏎` `⌘1–4` `Esc` / Review: `n` `⇧N` `⌘⏎` `⌥⌘⏎` `⌘⌫` `Esc` / 全体: `⌘Z`（採用後 10 秒）/ Inbox: `j` `k` `⏎` `1` `2` `⇧F` / S1: `⏎`（生成）・部屋に focus して `⏎`。

### 4.4 アクセシビリティ

- 状態は形・色・文字の 3 つで示す（§3.4）。diff は色に加えて記号と行番号列。
- 状態が**変わったときだけ** `aria-live="polite"` で読み上げる（job の受付・準備完了・回答、採用、取り消し、読者レベル）。トークンの流入では読まない。
- hover card は WCAG 1.4.13: カードに hover でき、Esc で閉じ、160ms の猶予付きで勝手に消えない。focus でも開く（`:focus-visible` の出典チップ）。
- 見取り図は `role="img"` と aria-label、部屋は `tabindex=0 role=button`。「テキストで見る」で部屋・扉・窓の一覧を出す（プロトタイプでは件数のトーストのみ。§10）。

---

## 5. ja / en

- UI の文言は `I18N.ja` / `I18N.en` の同じキー集合（パリティを CI で検査する前提。プロトタイプでは手で揃えた）。本文（設計書）は生成言語のまま（`<article lang="ja">`）で、UI を英語にしても日本語の本文は変えない（D5: ブロック単位の翻訳はオンデマンド）。
- 切り替え対象: ヘッダーのタブ・検索・読者レベル・目次見出し・読書パス・Inbox のフィルタ・浮遊ツールバー・Composer の全文言・job の状態・Review の見出しとボタン・トースト・ヘルプ。`<html lang>` も切り替える。

---

## 6. 計測（このプロトタイプ。`tools/perf.mjs`、Chrome、1440×900、M 系 Mac）[実測]

| 指標 | 値 | 予算（synthesis §6.2） |
|---|---|---|
| CLS: S1 表示 | 0 | 0 |
| CLS: 生成の進行（60 倍速、ブロックは予約済みの箱に出る） | 0.0001（見積りカードの要約が 1→2 行になる分） | 0.01 上限 |
| DOM ノード（S2・スレッド 4 件） | 1,712 | ≤ 5k |
| 読者レベル切り替え（JS + style + layout） | p50 3.4ms / max 7.9ms | ≤ 50ms |
| ⌘K 1 打鍵（約 80 項目） | p50 0.8ms / max 2.2ms | ≤ 16ms |
| `e` → Composer 描画 | p50 8.6〜10.2ms / max 12.3ms | ≤ 100ms |
| JS heap | 10.0MB | ≤ 100MB |
| ファイル | 283KB / gzip 84KB（うち出典コード 35KB と diff） | 製品は初期 JS ≤ 60KB gz。コード片は API から遅延取得 |

---

## 7. 実装（Svelte 5）への対応

| プロトタイプ | 製品のコンポーネント / 契約 |
|---|---|
| `.hdr` / `.rail` / `.views` | `Shell`（head inline script で `mitori_ui` から theme・level・lang・ペイン幅を復元。CLS 0） |
| `buildPlan()` | `MapCanvas`（サーバが返す SVG を差し込むだけ。部屋の hover・click はイベント委譲） |
| `.prose .blk` + `decorate()` | `BlockHost`（サーバ生成の HTML を innerHTML、`data-b` 委譲。出典「出典 n」とガターはサーバ側で出力してよい） |
| `showPeek` / `showTerm` | `CitePeek` / `TermCard`（コード片は `GET /ws/:ws/cite/:id` を hover-intent 65ms で prefetch） |
| margin（§4.1） | `ThreadCard` / `Composer` / `JobCard`、`ReviewStore.forBlock()` |
| `renderReview` / `diffHTML` | `ReviewDiff`（CodeMirror 6 + merge を遅延読み込み。2,000 行未満は静的 HTML のまま） |
| `renderSuggestion` | `ProposalCard`（提案モードの del / ins） |
| `renderInbox` | `Inbox` |
| `palSearch` | `Palette` + `PaletteWorkerMsg`（照合は worker） |
| `toast` / `undo` | `Toast/Undo`（`UI_THRESHOLDS.undoToastMs = 10000`） |

---

## 8. 契約（core / api / ui）への変更要望

1. `DEFAULT_KEYMAP` に `review.open: ["r"]`（準備完了の提案を開く）と `inbox.choose: ["1","2"]`（doc_edit の 2 択）を足す。
2. `PaletteItem` に `al?: string[]`（ローマ字の異表記・英語名など複数の別名）と `via?: string`（用語 ID。シンボルを用語経由で引いたとき「「持ち越し」経由」と出すため）を足す。単数の `r` では「sesshonkii / sesshonki-」のような揺れを吸収できない。
3. job の結果に `diffStat: { add, del, files }`・`docProposals: number`・`timings: { modelMs, gates: { name, ms, ok }[] }` を足す。準備完了カードとゲートのピル、「13.1 s = モデル 6.0 s + ゲート 7.1 s」の表示に要る。
4. `JobEstimate.estimate` の各 item に `chipKey`・`tokens`・`removable` を持たせ、Composer がそのまま chips として描けるようにする（外したときの再計算は client だけで行い、送信時に `removed[]` を送る。`ComposerState.removed` は既にある）。
5. Block のメタに `mdLine`（`.mitori/` の Markdown での行。詳しいレベルのガター表示）と、「やさしく」版の有無 `variants?: { easy?: { tokens, cached: boolean } }` を足す。
6. patch mode の gate に「formatter による書き換え」を区別する結果（`fmt: { rewrote: number }`）を足す。gofmt が整列を変えたとき、要約に「空白だけの変更 n 行」と書けるようにする（§1 の実例）。

---

## 9. 受け入れ基準（Editorial 方向で実装したとき、E2E で確かめる）

- AC-E01: `#map` を開いて 3 秒以内に、見取り図・目次・規模 4 セル・見積りカードが 1440×900 の 1 画面に入る（見取り図は上 80% 以上が見える）。
- AC-E02: 見積りカードに「標準: 約0.4M tok · API換算 $1.3 · 約6分」と［生成］が 1 行で並び、effort を変えると 16ms 以内にこの行が変わる。
- AC-E03: 生成の進行中から完了まで、レイアウトシフトの合計が 0.01 未満（目標 0）。未生成の block は最終的な大きさの skeleton で予約されている。
- AC-E04: 読者レベル（`-` `=` `0` とヘッダー）の切り替えが 50ms 以内で、§4.2 の表のとおりに 5 項目が変わる。ネットワーク要求を出さない。
- AC-E05: 出典チップに hover して 300ms 後に、引用範囲を含むコード片・フルパス・シンボル・blob sha・検証状態が出る。カードに hover しても消えず、Esc で閉じる。`o` で右ペインに固定できる。
- AC-E06: 推測の主張は全レベルで本文中にバッジとして見える。確認済の印は hover・`⌥` 長押し・詳しいレベルでだけ出る。
- AC-E07: 文を選ぶと 100ms 以内に浮遊ツールバーが出て、`c` / `e` / `f` で該当 block の高さに Composer が開く（≤1023 は bottom sheet）。IME 変換中の Enter と Esc は無視され、Enter 単独で送信されない。
- AC-E08: Composer の context chip を外すと、見積りチップの tok と $ が同じフレームで変わる。
- AC-E09: `⌘⏎` から 100ms 以内に job カードが出る。進捗は実イベントのステージ名・時刻・tail だけで示し、% バーを出さない。
- AC-E10: 準備完了で、本文の提案（del / ins）、コード diff（ファイル・hunk 単位の ✓ / ✕）、ゲートの結果、実績（入力・cache・出力・API 換算 $・秒）が、Review を開いた 1 画面に入る。
- AC-E11: `⌘⏎` で採用すると block が 1 回だけ光り、10 秒の Undo トーストが出て、`⌘Z` で checkpoint から戻る。reduced-motion では光らない。
- AC-E12: margin のカードは対応する段落の上端に揃い、重ならない（間隔 12px）。読者レベルの変更・details の開閉・生成の後も揃い直す。
- AC-E13: Inbox は `j` / `k` で 50ms 以内に選択が移り、状態は形・色・文字の 3 つで区別できる。doc_edit の 2 択は `1` / `2` で選べる。
- AC-E14: ⌘K で `mochi`・`もちこし`・`carry` のどれでも「持ち越し」が先頭に出る。打鍵から描画まで 16ms 以内（5 万項目まで）。閉じるとフォーカスが元に戻り、直後の 1 文字ショートカットが効く。
- AC-E15: ライト / ダークの両方で、文字はすべて 4.5:1 以上（本文 13.2 / 12.2、`--muted` 6.2 / 7.8、`--faint` 4.7 / 5.4 on `--paper` [計算値]）。罫線とアイコンは 3:1 を下回ってよいのは装飾に限る。
- AC-E16: Web フォントを 1 つも読み込まない。`lang="en"` の UI でも本文の `lang` は生成言語のまま。
- AC-E17: 820×1180 で横スクロールが出ない。目次は drawer、スレッドは段落右のマーカーから bottom sheet で開く。

---

## 10. 未決事項・既知の制約

1. 見取り図の配置: プロトタイプは 10 部屋を手で列に割った。12 部屋を超える repo（hono・react）では「グループ数 ≤ 9 / 階層」の制約で LLM にグループ名だけ付けさせ、配置は決定的なスライスにする案 [仮]。fastapi・excalidraw・react の 3 repo で、部屋名が切れない最小幅（現状 180px で 13〜17px の名前が入る）を計測して決める。
2. 生成の見積り（0.4M / $1.3 / 6 分 / 5h +9%）は推定。P0 の Pass 1 実測（synthesis addendum C6）で置き換える。
3. chip の tok 係数（27 tok/行）と所要時間の p50 は [仮]。P0 の tokenizer 較正と、意図ごとの実績の指数移動平均で置き換える。
4. 明朝見出しの Windows 表示（Yu Mincho の欧字）を未確認。Windows 実機で確かめ、崩れるなら見出しを角ゴ 600 に切り替える設定を用意する。
5. `text-autospace` は Chrome 140 以降・Safari 18.4 以降でだけ効く（Firefox は 145 以降）。効かない環境では和欧間が詰まって見える。原稿に空白を入れない方針は変えない。
6. 「テキストで見る」（見取り図の代替テキスト一覧）は件数のトーストだけで、一覧の画面は未作成。
7. 本文の日本語はこのプロトタイプのために人手（Claude）で書いたもので、mitori の生成パイプラインの出力ではない。語調と密度の目標値として使い、生成プロンプトの評価に流用しない。
8. デモの生成は 60 倍速（画面に明記）。実際の速さでの体感（skeleton が長く残る時間）は P1 で確かめる。
