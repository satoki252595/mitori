# mitori UI プロトタイプ — direction: PRO COCKPIT

- 作成日: 2026-10-03 / 対象: `docs/design/prototypes/pro/index.html`（単一ファイル。CSS と JS はインライン、外部通信なし、Web フォントなし）
- 入力: `docs/research/07-ux-principles.md`、`00-synthesis.md` §4〜§6.2 と Critic addendum E、`01-crit-teardown.md`、`docs/design/contracts/ui.ts`・`core.ts`
- サンプルの題材: `tomasz-tomczyk/crit` @ `406875d`（v0.21.1, MIT）。文書の主張と出典の行範囲は、すべて実際のコードを読んで確認した（§3）。
- 方針: キーボード中心で情報密度が高い。Linear / Raycast / GitHub PR review を参照し、Doc ↔ Code の Split view を既定にする。スレッドはインライン。token と費用のチップ、ジョブキューを目立つ位置に置く。ダークモードを第一級に扱う。

---

## 0. 要約

1. 画面は 3 列で構成する。左に目次と読書パス（248px）、中央に本文（最大 40 字前後）、右に文脈ペイン（コード・変更・スレッド・ジョブ、500px）。上はトップバー（44px）、下はステータスバー（26px）。1023px 以下では、左列を drawer に、右列を bottom sheet に切り替える。
2. 主な流れは次のとおり。
   - 0 token のスキャン結果を見る。
   - 見積りカード「標準: 約0.4M tok · API換算 $1.3 · 約6分 · [生成]」から 1 クリックで生成する。
   - 文を選び `f` を押して Composer を開く。意図チップ、context chips、見積りが即時に再計算されることを確認する。
   - `⌘↵` で送ると、楽観的なカードが出て実際のステージを進む。
   - ready になると、コード diff、文書の提案差分、gate ✓、実費が出る。
   - `⌘↵` で採用すると、ブロックが 1 回だけ光り、Undo トーストが出る。
3. デモの修正（`story_retries`）は作り話ではない。差分は `fixtures/th_17-story-retries.diff` に保存してあり、crit@406875d のコピーに適用して次を確認した（Go 1.27.1）。
   - `gofmt -l` で差分なし
   - `go vet ./cmd/crit ./internal/config` が通る
   - `go test -run TestStoryLLM ./cmd/crit` で 12 件 passed
   - `go test ./internal/config` が ok
   
   画面の gate 時間（0.02 s / 1.3 s / 7.5 s）は、この実行で測った値である。
4. キーボード操作 37 項目を Playwright で自動検証し、すべて通った（§10）。対象は IME ガード、Enter で送信しないこと、下書きの復元、hunk 移動、採用、Undo、パレットのかな検索を含む。

---

## 1. 開き方と状態 URL

ブラウザで `index.html` を開く。状態は URL の hash で指定でき、レビューとスクリーンショットを再現するのに使う。

| パラメータ | 値 | 意味 |
|---|---|---|
| `state` | `scan` / `map` / `doc`（既定）/ `composer` / `running` / `ready` / `accepted` / `inbox` / `palette` / `help` | 初期状態。`composer`〜`accepted` は §3.3 の対象文を選んで `f` を押した状態から始める |
| `theme` | `light` / `dark` | 指定しなければ `prefers-color-scheme` に従う。手動の切替は localStorage `mitori_ui` に保存する（本番は cookie `mitori_ui`） |
| `level` | `newcomer` / `standard` / `expert` | 読者レベル |
| `lang` | `ja` / `en` | UI 文言の言語。文書本体は ja（主言語、D5）のまま。en のときは「Translate section ≈1.1k tok」を出す |
| `chap` | `0`〜`13` | 開く章 |
| `speed` | 数値（既定 1） | タイマーの倍速（テスト用） |
| `q` | 文字列 | `state=palette` のときの初期クエリ |

**デモの台本（受け入れ試験の手順）**

1. `#state=scan` で開く。0 token の見取り図・目次・facts 表と、見積りカードが表示される。
2. `↵`（または [生成]）で生成を始める。目次の ◐ / ○ が進む。待機中の章をクリックすると、その章を先に生成する。
3. `g d` で文書に移る。`-` / `=` で読者レベルを変える。出典チップに 300 ms hover すると Code peek が出る。用語に hover すると用語カードが出る。
4. §3.3 の「正確に 1 回だけ」を選択し、`f` を押す。本文を入力して `⌘↵` で送る。約 14 秒で ready になる。
5. 右ペインの「変更」タブで `n` / `⇧N` を使って hunk を移動する。`⌘↵` で採用し、10 秒以内なら `⌘Z` で取り消す。
6. `g i` で Inbox を開き、`j` / `k` で移動する。`⌘K` でパレットを開き、`mochi`・`もちこし`・`daaku` などを入力する。

---

## 2. スクリーンショット（`shots/`、deviceScaleFactor 2）

| ファイル | 状態 | 確認すること |
|---|---|---|
| `01-scan-1440.png` | (1) 初回スキャン | 0 tok のバッジ、見取り図（Container・依存数・LOC バー・変更頻度）、facts 6 枚、見積りカードの主行と [生成] がスクロールせずに見えること |
| `01b-generating-1440.png` | (1') 生成中 | 実際のステージ（overview → modules 5/14 → 検証）、入力・出力・$・経過のカウンタ、目次の ◐ / ≈k、最初の節が届いたトースト |
| `02-doc-standard-1440.png` | (2) 標準 | 用語の下線（初出のみ）、確認済と推測のバッジ、折りたたんだ Why、文中の出典チップ + hover の Code peek、読書パスのリング 3/7、Split view |
| `02b-doc-newcomer-1440.png` / `02d-…-glossary` | (2) 初めて | 出典は段落末の「出典 N」、下線はすべて、Why は展開、用語カード（よみ・romaji・英語・定義・使用数） |
| `02c-doc-expert-1440.png` | (2) 詳しい | L3 を展開、出典はディレクトリ付き、ガターに block ID と md の行番号 |
| `03a-select-toolbar-1440.png` | (3) 選択 | 浮遊ツールバー（コメント c / 説明 e / 修正 f / p / y / ≈1.9k） |
| `03b-composer-1440.png` / `03b2-…-estimate` | (3) Composer | 意図チップ ⌘1–4、直す対象の 2 択（doc_edit）、context chips（× で外す、点線は候補）、見積りチップ、router（`patch 46 行 · 2 ファイル`）、内訳の hover |
| `03c-running-1440.png` | (3) 実行中 | 楽観的カード、ステージ（完了したものに時刻、現在のものにスピナー、予定は淡色）、tail 行、経過時間と通常の範囲、ブロックの脈動 |
| `03d-ready-1440.png` | (3) ready | 文書の提案差分（取消線 + 下線）、AI の要約 3 項目、gate ✓、+47 −29、実費と見積誤差、右ペインのコード diff（hunk ごとの ✓ / ✕） |
| `03e-accepted-1440.png` | (3) 採用直後 | ブロックが 1 回だけ光る、反映済みカード（checkpoint）、Undo トースト（10 秒のバー）、右ペインは作業ツリー（未 commit）の新しい行 |
| `04-inbox-1440.png` | (4) Inbox | 要対応・実行中・下書き・完了・解決済みのグループ、まとめて送るバー（−39%）、失敗の詳細（原因分類・stderr 末尾 3 行・ここまでの費用・昇格の提案） |
| `05-palette-1440.png` | (5) ⌘K | `mochi` から 用語「持ち越し」、シンボル `carryForward*`、節 §3.2 を引く。一致した別名を（mochikoshi）と強調表示し、0.6 ms で返す |
| `06-doc-dark-1440.png` / `06b-ready-dark-1440.png` | (6) ダーク | (2) と (3-ready) のダーク版 |
| `07-doc-tablet-820.png` / `07b-…-sheet-820` | タブレット | 1 ペイン、目次は drawer、文脈ペインは bottom sheet（52px → 50vh → 88vh） |

撮影手順は scratchpad の `design-tmp/shots-pro/shoot.mjs` にある。Playwright を `channel:'chrome'` で使い、選択 → `f` → 入力 → `⌘↵` → `waitForSelector(.state.ready)` → `⌘↵` という実際の操作を流して撮った。

---

## 3. データの出所（真と例示を分ける）

**crit@406875d で確認した事実**（文書の本文と、出典チップの行範囲すべて）

- 規模: 1,219 files。Go の非テストは 186 files・45,672 行、テストは 259 files・83,046 行。web の自前 JS は 63 files・24,196 行、e2e の TS は 138 files。
- CLI コマンドは 27 個（`cmd/crit/cli_dispatch.go`）。`/api/*` のルートは 40 本（`server.go:136-224`）。`CRIT_*` の環境変数は 6 個。Config のキーは 38 個で、そのうち global-only は 10 個（`config.go:355-372`）。
- 振る舞いと出典:

  | 振る舞い | 出典 |
  |---|---|
  | session key は `sha256(cwd\0branch)[:12]` | `daemon.go:174-193` |
  | `/api/session` を 500 ms 間隔で poll、上限 5 分 | `client.go:124-154` |
  | HTTP client の timeout は 24 h | `client.go:26` |
  | `withReady` は準備前に 503 を返す | `server.go:359-368` |
  | Subscribe を round-complete より先に行う | `server.go:2668-2676` |
  | shutdown 時は 503 と `approved:false` | `server.go:2714-2723` |
  | Safari 向けに 1 byte を先に送る | `server.go:2774-2776` |
  | heartbeat は 30 s | `server.go:40` |
  | 持ち越しの判定（8 文字・中央 1 か所の削除・Levenshtein 0.7） | `watch.go:970-1027` |
  | polling は 1 s | `watch.go:323-324` |
  | 書き込みの debounce は 200 ms | `session_write.go:19` |
  | Hirschberg による行 diff | `diff.go:33-46` |
  | 配置率の下限 `placedFloor = 0.5` | `ingest.go:28` |
  | story の生成は「正確に 1 回」再試行 | `cli_handlers_story.go:629-659` |
  | `agent_cmd` の 1 回あたり 5 分の期限 | `cli_handlers_story.go:690` |
  | `strings.Fields` による分割 | `cli_handlers_story.go:685`, `server.go:3228` |
  | 失敗するとログに書くだけ | `server.go:3254-3258` |
  | 14 種のエージェントの検出 | `integrations.go:555-572` |

- コードの抜粋は crit（MIT License, © Tomasz Tomczyk）から引用した。ファイルに帰属表示を入れてある。
- **修正の差分 th_17**: 実際に適用し、gate を通した（§0-3）。

**例示（実装時に実測で置き換える）** — 各値の測り方も併記する。

| 項目 | プロトタイプの値 | 置き換えに使う実測 |
|---|---|---|
| 生成の見積り（標準 0.40M / $1.3 / 6 分、内訳 4 stage） | 00 §4.6 と addendum A4 による C=3 の推定 | P0 の Pass 1 実測（addendum C6）、`GenEstimate`（core.ts） |
| 生成の実績（0.38M・$1.21・5分48秒） | 例示 | usage 台帳 |
| Fix の token と $（入力 2.5k・cache 0.7k・出力 1.4k・$0.018） | 06 §10 の実測（2.47k / 1.2k / $0.022）に近い値として置いた | `result.usage` |
| LLM 区間 5.1 s | 06 §10 の API 6.8 s から仮に置いた | stream-json の `result.duration_ms` |
| 5h 枠の +11pp・23%→33% | [仮] | addendum C3 の測定 |
| スレッドの本文、th_15 の失敗内容（`postAgentFailure` など）、commit `9a1c2e3`、一部の blob hash（`hash7` で生成した疑似値）、index の内訳時間 | 例示 | — |

index の合計 0.27 s だけは 05 の実測の範囲内である。

---

## 4. レイアウト仕様

| 幅 | grid（`.main`） | 左列 | 右列 | 備考 |
|---|---|---|---|---|
| ≥ 1440 | `248px minmax(0,1fr) 5px 500px`。見取り図の画面だけ右列を 420px にする（`#app.v-map`） | 目次 + 読書パス + 網羅率 | 文脈ペイン（tab: コード / 変更◆ / スレッド n / ジョブ n） | 本文 `.doc` は max-width 810px、padding `22 30 160 84`（左 84 はガター） |
| 1280–1439 | `232px … 440px`（map は 380px） | 同 | 同 | `⌘K` の検索ボタンは 170px |
| 1024–1279 | 同 | 同 | 同 | パンくずと費用チップのラベルを隠す |
| ≤ 1023 | `minmax(0,1fr)` | `position:fixed` の drawer（300px、`b`・`t`・☰ で開閉） | bottom sheet（52px / 50vh / 88vh。grip をタップで切替） | ガターと split の区切りを隠す。ブロック操作は右上の横並び |
| < 600 | 同 | 同 | 同 | facts は 1 列 |

- ペイン幅は区切りをドラッグ（pointer capture）するか、区切りにフォーカスして `←` / `→`（24px ずつ）で変える。範囲は 320〜900px。保存し、`<head>` のインラインスクリプトで最初の描画より前に `--side-w` を復元する（CLS 0）。
- sticky の段: 右ペインのファイルヘッダー（34px、`top:0`）、diff の hunk ヘッダー（`top:34px`）。
- z-index: 区切り 2 < ブロック操作 3 < 選択ツールバー 30 < bottom sheet 34 < drawer 35 < peek 40 < 用語・見積りカード 41 < ジョブパネル 45 < パレット・ヘルプ 50 < トースト 60。

---

## 5. デザイントークン

- フォント（addendum A9 に合わせ、OS 標準を先頭に置く）
  - sans: `-apple-system, BlinkMacSystemFont, "Hiragino Sans", "Hiragino Kaku Gothic ProN", "Segoe UI", "Yu Gothic UI", Meiryo, "Noto Sans JP", …`
  - mono: `ui-monospace, "SF Mono", Menlo, Consolas, "Cascadia Mono", "BIZ UDGothic", …`
  - `contracts/ui.ts FONT_STACKS` と同じ並びにしてある。
- 文字サイズ: chrome は 12〜13px。本文は 15px / 1.85（ja）、1.7（en）。見出しは 24 / 18.5 / 15.5px で weight 650。和文の太字は 600。コードは 12px / 19px。数値には `tabular-nums` を付ける。
- 和文組版: `line-break:strict`、`overflow-wrap:anywhere`、`text-wrap:pretty`、`text-autospace:normal`、`text-spacing-trim:trim-start`。見出しだけ `word-break:auto-phrase` と `text-wrap:balance`。
- 色（主要トークン。ライト / ダーク）

  | token | light | dark | 用途 |
  |---|---|---|---|
  | `--bg` / `--panel` | `#fbfbfc` / `#fff` | `#0e1013` / `#15181d` | 背景（ダークは純黒にしない） |
  | `--fg` / `--muted` / `--faint` | `#15171c` / `#646b77` / `#959ba6` | `#e8eaee` / `#8c939d` / `#5f6670` | 文字 |
  | `--accent` | `#4f5bd5` | `#8d95ff` | 出典チップ、選択、主ボタン |
  | `--ai` | `#8a4fd8` | `#c49dff` | 提案、AI 作業中 |
  | `--ok` / `--warn` / `--err` / `--info` | `#17845a` / `#a86a00` / `#c93c3c` / `#1e6fd6` | `#4fc58d` / `#e6b65a` / `#f17070` / `#62acff` | 確認済・推測・失敗・実行中 |
  | `--add` / `--del` | 緑・赤 9% | 緑 11%・赤 10% | diff（色だけに頼らず、`+` / `−` の記号も付ける） |

- 角丸は 5 / 8 / 12px。影は `--shadow`（浮遊物）と `--shadow-s`（カード）の 2 段。
- 動き

  | 演出 | 仕様 |
  |---|---|
  | hover-intent | 300 ms。peek を閉じるまでの猶予は 260 ms |
  | パレット | 表示 150 ms |
  | スレッドの出現 | 140 ms |
  | 脈動（running） | 1.8 s の無限ループ |
  | 採用時の光り | 1.15 s を 1 回 |
  | トースト | 10 s（バー付き） |
  | `prefers-reduced-motion` | すべて 0.001 ms にする。脈動は静的な 1px の枠、光りは静的な左の帯に置き換える |

---

## 6. コンポーネント仕様（書式は正確に）

### 6.1 トップバー（44px）

左から順に次を並べる。

- ロゴ
- workspace `crit @406875d`
- 画面タブ: 見取り図 / 文書 / Inbox [要対応数] / レビュー [◆数]
- パンくず
- 読者レベル（初めて / 標準 / 詳しい）
- `検索・コマンド ⌘K`
- **ジョブチップ** `[◐]{実行中数} [🔒]{ロック待ち数} ◆{ready 数} ジョブ`。ロック待ちと ready は 0 のとき隠す。クリックでジョブパネル（440px）を開く。
- **費用チップ** `今日 $1.33 · 450.4k`
- **5h チップ** `5h [メーター] 33%`
- テーマ切替、言語切替（JA / EN）

### 6.2 左列

- **読書パスのカード**: リング `{読了}/{全体}`、`30分コース ▾`、`残り約 {分} 分 · 次: §{id}`、章ごとの細い帯（済 = ok、次 = accent）。
- **目次**: 各行は `{番号} {題} {スレッド数バッジ} {分 or ≈k} {状態}`。
  - 状態の記号: ✓ 生成済 / ◐ 生成中 / ○ 待機 / □ 静的（0 tok）/ ⚠ 古い可能性
  - 生成中は待機中の章に `≈{k}` を出す。
- **網羅率**: `86% · 251/291`、`R1 · 406875d`、モデル、`0.38M tok · $1.21`。

### 6.3 文書ブロック（`.blk`）

- 属性は `data-b`、`data-depth`、`data-kind`、`data-conf`（`v` / `i` / `h` / `s`）、`data-src`（主たる出典 `path:a-b`）、`data-ml`（md の行番号）。
- **左ガター**（62px、ブロックの左外側）: 信頼度の記号（v = 緑の丸に ✓、i = 琥珀の点線丸に ?、h = 青の二重 ✓、s = ⚠）。詳しいレベルでは block ID と `L{n}` も出す。
- **ブロック操作**: hover かフォーカスのとき、ガターに縦 3 ボタン（コメント・説明・修正）を出す。ボタンは icon のみで、title にキーを書く。本文には重ねない。
- **出典チップ** `{basename}:{a}–{b}`（11.5px mono、高さ 20px、accent-bg）。
  - 詳しい: `{dir/}{basename}:{a}–{b}`
  - 初めて: 文中のチップを隠し、段落末に `出典 N` を 1 個置く
  - `⌥` を押している間は全チップを表示する
- **推測バッジ** `○ 推測 | ✓ 確認する`。✓ で `確認済 by @satoki` に置き換え、再生成しても保持する。
- **Why**: 標準と詳しいでは見出し 1 行に畳む（`開く ▸`。推測バッジは畳んでも見出しに残す）。初めてでは展開する。
- **Deep Dive（L3）**: `<details>`。初めてでは隠して `詳しく · Deep Dive 1` のチップにし、詳しいでは開く。
- **Pitfall** は常に表示する。**まとめ**、章頭の「この章で分かること」、pager（`次へ · 30分コース 5/7 →`）を置く。
- **静的事実のみの節**: 「{module} はまだ生成していません」+ `[生成する ≈6.1k tok]` + facts チップ。空欄にはしない。

### 6.4 Code peek（hover 300 ms / フォーカスで即時）

- 幅 540px、本体の最大高 260px。
- ヘッダー: `{path} :{a}–{b} | 正確（symbol index）or 推定（文字列検索） | {blob7}`
- 本体: 範囲 ±6 行（最大 26 行）を強調し、範囲の先頭が上から 40px に来るようにスクロールする。
- フッター: `o 分割に固定 · ⇧O エディタで開く · esc`
- WCAG 1.4.13: peek 自体に hover でき、Esc で閉じ、勝手に消えない。

### 6.5 用語カード（hover 300 ms）

`{語} {よみ}` / `{英語} · {romaji}` / 定義 / `使用 {n} 箇所 · {出典チップ}` / `用語集で開く`。

### 6.6 Split view（右ペイン「コード」タブ）

- ファイルヘッダー（sticky）: `{dir}{base} [正確|固定中|未 commit] … {blob7|worktree} · L{a}–{b}`
- 引用範囲の背景に `--hl`、行番号の列に 2px の左帯を付ける。
- 埋め込んでいない区間は `⋯ {n} 行を省略（{from}–{to}）` で畳む。
- backlink: 文書が引用している行のうち強調範囲の外にあるものに、ガター 2px の淡い帯を付ける。範囲の先頭行には `§{節}` の pill を付け、クリックで該当ブロックへ移る。
- **scrollspy**: `IntersectionObserver`（root は中央列、`rootMargin -18% 0px -62% 0px`）で最初に可視になったブロックの `data-src` を追う。同じファイルなら class の付け替えとスクロールだけで済ませ、DOM を作り直さない。
- 固定（`o`）するか Composer を開いている間は、scrollspy を止める。

### 6.7 選択ツールバー

- テキストを選ぶと、選択範囲の上 8px（タッチ端末では下 10px）に出す。
- 中身: `コメント c · 説明して e · 修正して f | p | y | ≈1.9k`
- 保存するアンカーは TextQuote（`prefix 32 + exact + suffix 32`）と block ID。
- 選択範囲は CSS Custom Highlight（`::highlight(mitori-quote)`）で表示し続ける。

### 6.8 Composer（ブロック直後のインラインスレッド）

- ヘッダー: `○ 下書き @satoki §3.3 · b_q7m2xk4d … 自動保存`
- 引用: `「{exact}」` と `TextQuote（prefix 32 + exact + suffix 32）· {block} · {主出典}`
- 意図チップ: `質問 ⌘1 / 修正 ⌘2 / 指摘 ⌘3 / メモ ⌘4`。`e` は質問、`f` は修正、`c` はメモで開く。
- 修正のときだけ「直す対象」の 2 択を出す: `コードを文書に合わせる | 文書だけ直す（コードが正しい）`（00 §5.1 doc_edit）。
- 本文: Enter は改行、`⌘↵` で送信。IME で変換中のキーはすべて無視する。Esc で閉じても下書きは保持する。
- **context chips** `{label} {k}k ×`
  - 固定チップ `固定: system + 規約 0.7k cache` は外せない。
  - 候補チップは点線で `+ 関連: {file} +{k}k`。クリックで追加する。
  - `@ 追加` もある。
- **見積りチップ** `≈{in}k in | ≈{out}k out | ${usd:3 桁} | 約 {p25}–{p75} 秒`。chips や本文が変わるたびに再計算し、0.35 s だけ枠を光らせる。hover で内訳を出す（各チップ・指示・出力・合計・単価の注記）。
- **router 表示** `patch 46 行 · 2 ファイル · sonnet-5-5`。ファイル数が 2 を超えると即座に `agent 3 ファイル > 2 → Read+Edit` に変わる。
- 見積りの式（プロトタイプ）

  | 項目 | 式 / 値 |
  |---|---|
  | 入力 | `0.1k + Σchip + 本文文字数 × 0.0008k` |
  | チップ（コード） | `min(1.6, 行数 × 0.03)` k |
  | 出力の事前値 | 質問 0.5k / 修正 1.5k（思考込み）/ 指摘 1.2k |
  | $ | `(入力_fresh × 2 + 入力_cache × 0.2 + 出力 × 10) / 1M`（claude-sonnet-5-5） |
  | 時間の事前値 | 修正 patch 11–17 s / agent 25–40 s / 質問 4–8 s |

  本番では次に置き換える。chip の token は Claude tokenizer の係数（code ≈ chars / 2.3、和文 0.8 tok/字、00 §2.2）で数える。補正係数は意図 × モード別の `実績 / 見積` の EMA（α = 0.2 [仮]）とする。時間は同じ意図 × モードの過去実績の p25–p75 を使う。
- 見積りの色帯: 10k 未満は灰、10〜50k は標準、50〜200k は琥珀、200k 超は赤。確認ダイアログは 100k 超か「repo 全体」のときだけ出す（00 §5.3）。プロトタイプでは色帯を実装していない。

### 6.9 ジョブカード（楽観的。送信から 100 ms 以内に出す）

- ヘッダー: `{state チップ} @satoki {修正|質問} · {patch|answer} · claude-sonnet-5-5 … th_17 · R2`
- ステージの行は `[✓|◐|·] {名前} {詳細} {完了時刻 s}`。router が決めた計画を最初から淡色で並べ、偽の % バーは出さない。

  | 修正（patch）の行 | 対応する JobPhase |
  |---|---|
  | 受付 | queued |
  | bundle（MBF/1 2.4k tok · router → patch） | prepare |
  | snapshot（`refs/mitori/th_17/base`） | snapshot |
  | 起動（`claude -p --model claude-sonnet-5-5 --setting-sources "" --strict-mcp-config --tools "" --no-session-persistence`） | spawn |
  | 生成 | think |
  | patch | edit |
  | 適用（scope ✓） | apply + scope |
  | gofmt / go vet / go test | gate |
  | 提案 | ready |

  質問（answer）は bundle → 起動 → 回答（stream で本文を描く）→ 検証（引用の L0 / L1）→ 完了、と進む。
- tail 行: `◐ {最新イベント} … {経過} 秒 · 通常 {p25}–{p75} 秒`
- 状態の色と形: 待機 ○ 灰 / 実行中 ◐ 青 / ゲート ◐ 青 / 提案あり ◆ 紫 / 反映済み ✓ 緑 / 失敗 ⊗ 赤 / ずれ ⚠ 琥珀 / ロック待ち 🔒 琥珀 / 取り消し ↺ 灰。色だけで区別しない。
- 対象ブロックは脈動させる。`aria-live` で読み上げるのは状態が遷移したときだけにする。

### 6.10 提案（ready）

- **文書側**（中央列のその場）
  - 帯: `✎ 提案 · 文書 1/2 mitori AI（claude-sonnet-5-5）· R2 · コード変更に連動 [✓][✕]`
  - 削除は `<del class="sg">`（取消線、赤）、挿入は `<ins class="sg">`（下線、緑）。
  - 同じ提案で §8.3 の設定表に `story_retries | global のみ | 1（上限 3）` の行が加わる。
- **カード**
  - AI の要約 3 項目
  - gate チップ: `✓ gofmt 0.02s` `✓ go vet 1.3s` `✓ go test · 12 passed 7.5s`
  - 規模: `コード +47 −29 · 2 ファイル · 5 hunk` `文書 2 ブロック`
  - 実費の行: `入力 2.5k（キャッシュ 0.7k）出力 1.4k $0.018 14.2 秒（LLM 5.1 + gate 9.0）` / `見積 ≈4.0k / $0.019（実績 3.9k · −2%）5h +0.1%`
  - 操作: `[採用 ⌘↵] [却下 ⌘⌫] 変更を見る r … 続けて依頼…`
- **右ペインの「変更」タブ**
  - 要約: `th_17 · 修正 · patch R1 → R2`、ファイルごとの +/−、`文書 §3.3 … · §8.3 … 提案 2`、gate、`scope ✓ 2/2`
  - その下にファイルヘッダー（sticky）と hunk（`@@ -572,7 +572,8 @@ func runStoryLLM` + ✓ / ✕）を並べる。
  - 行番号は 1 列で、削除行は旧番号、それ以外は新番号を出す。
  - diff は Myers の最小 diff（git と同じ）。プロトタイプのデータは `git diff` の出力からそのまま生成した。

### 6.11 採用と Undo

1. `⌘↵` で accepting（160 ms）を経て accepted にする。
2. ブロックの本文を新しい文と新しい出典（`cli_handlers_story.go:630–658`、`config.go:62–65`）に置き換え、`.flash` を 1 回だけ付ける。
3. カードは 1 行に縮める: `✓ 反映済み 作業ツリーに反映（未 commit）· checkpoint refs/mitori/cp/th_17 · R2 で解決 [取り消す ⌘Z]` と `履歴: R1 生成 → R2 AI 修正（承認: あなた）`。
4. 右ペインを作業ツリーの新しい内容に切り替え、追加行を + で示す。
5. トースト `✓ 反映しました 2 ファイル（未 commit）· 文書 2 ブロック · checkpoint … [取り消す ⌘Z]` を、10 s のバー付きで出す。
6. `⌘Z` で reverted にする。文書は R1 の文に戻り、トーストは `取り消しました（checkpoint から復元 · 文書も R1 に戻しました）` になる。
7. 却下 `⌘⌫` は確認ダイアログを出さず、トースト `[元に戻す ⌘Z]` を出す。

### 6.12 Inbox

- フィルタ: すべて / 要対応 / 実行中 / 下書き / 完了（件数付き）。
- グループ: 要対応（ready・failed・mention・outdated）、実行中・待機、下書き、完了、解決済み。
- 行（40px）: `{状態記号} {th_id} {題} {§ · file:line} {意図} {費用} {経過}`。
- まとめて送るバー: `下書き N 件を 1 回で送る ≈3.0k · $0.012（別々 ≈4.9k · −39%）[まとめて送る ⇧F]`。
- 右ペインには選んだスレッドの詳細を出す。
  - 失敗: 原因分類、stderr 末尾 3 行、ここまでの費用、`[Opus high で提案のみ ≈$0.09]`、範囲を絞る、プロンプトをコピー。
  - ずれ: 元のスナップショット、`[新しい位置を指定]`。
  - 確認依頼: `[✓ 正しい][✕ 違う → 直す][分からない]`。

### 6.13 ⌘K パレット

- 幅 660px、上から 11vh に置く。入力欄は 54px、行は 42px、本体の最大高は 430px（60vh まで）。
- 入力が空のときは、最近使ったもの 4 件と提案 4 件を出す。
- 照合: 正規化（小文字・空白除去・カタカナをひらがなへ）したうえで、label と別名（romaji・かな・英語・シンボルに紐づけた用語の romaji）を、前方一致 100 / 語頭 80 / 部分一致 60 / 部分列 ≤ 34 で採点する。
- 表示順: グループは「そのグループの最高点」の順、グループ内は点数の順。別名で一致したときは `{label}（{別名の一致部分を強調}）` と出す。
- 項目の上で `⌘K` を押すと Action panel（開く / 説明して / 再生成 ≈5k / プロンプトとしてコピー / permalink）。入力が空の Backspace で 1 段戻る。
- フッターに `{件数} 件 · {ms} ms` を出す。

### 6.14 ステータスバー（26px、mono 11.5px）

`● daemon 127.0.0.1:4317 | index ✓ 1,219 files · warm 9 ms | ジョブ {n} 実行中 · {n} 待機 · C=3 | 今日 {tok} tok · ${usd} API換算 | 5h {p}% · 7d {p}% | claude-cli · subscription | g …（g のあとの入力待ち） R1 · {commit} | ? ショートカット`

### 6.15 生成の見積りカード（右ペイン「生成」タブ。D3 の 1 クリック）

1. 主行（ボタン込みで 1 行）: `標準: 約0.4M tok · API換算 $1.3 · 約6分 · [生成 ↵]`
2. 補足行: `C=3 · claude-cli（あなたのサブスク）· 5h 枠 23% → 推定 34% [仮] · …`
3. effort の選択（概要 / 標準 既定 / 完全）。各行に `≈{M} · ${usd} · 約{分}` と範囲の説明。
4. stage の内訳表: `stage · model | in / out | $ | 時間`。overview にはクリティカルパスの注記を付ける。
5. engine の選択: claude-cli（C=3 · 約6分）/ session（`mitori gen --prep` · C=1 · 約17分）/ anthropic-api（未設定 · $0.71）。session を選ぶと、手順のトーストを出す。
6. データの扱いの 1 行（addendum C2）と、譲り合いの規則（80%）。
7. 読む範囲 `291 files · 1.21M chars` と除外 928 件の内訳。
8. S0〜S4 の時間。

生成中は同じカードを進捗に置き換える。

- 4 列のカウンタ: 入力 / 出力 / API換算 / 経過（それぞれ `/ ≈見積`）
- stage の行（モデル名と進み具合のバー）
- `中止`、`読み始める g d`
- 最初の節が届いたらトーストで知らせる。完了時は `入力 0.38M（キャッシュ 0.19M）· 出力 52k · $1.21 · 5分48秒 · 見積 ≈0.40M / $1.3（−5%）` を出す。

### 6.16 見取り図

- Diagram IR を ELK layered（左から右）で配置したものと同じ形の静的 SVG。
- 区画は 外部 / 入口 / 常駐プロセス / 中核 / 基盤・外部連携。ノードは 140×58〜96、LOC のバーは log スケール、変更頻度の点を付ける。
- 生成前に出す値: `{n} files · {LOC}` と、高さ 70 以上のノードでは `依存 入{n} · 出{n}`。生成後は日本語のラベル（overview が付ける）とコメント数のバッジを足す。
- hover で接続する辺を accent にする。Enter かクリックで §6.x へ移る（生成前はトーストで知らせる）。
- 深さのタブは Context / Container / Component（Component は §6 の生成後）。オーバーレイは 変更頻度 / コメント / AI 作業中。

---

## 7. 読者レベルの適用（`contracts/core.ts READER_LEVEL_RULES` と一致させた）

| | 初めて（`.lvl-newcomer`） | 標準 | 詳しい（`.lvl-expert`） |
|---|---|---|---|
| L3 | `display:none`、直前に `詳しく` チップ | `<details>` を閉じる | `<details open>` |
| 出典 | 文中は隠し、段落末に `出典 N` | 文中に `base:a–b` | `dir/base:a–b` |
| 用語の下線 | `.term` すべて | 初出（`.term.u`）だけ | なし（hover は有効） |
| Why | 展開 | 1 行に畳む | 1 行に畳む |
| ガター | 信頼度 | 信頼度 | 信頼度、block ID、`L{md 行}` |

- 切り替えは CSS の class を付け替え、該当章だけ描き直す。ネットワークは使わない。
- 切り替えの前に、画面上端より下で最初に見えているブロックの位置を覚え、描き直したあとに同じ位置へ戻す（scroll anchoring）。
- 実測（§10）: p50 4.8 ms、p95 11.6 ms。

---

## 8. キーボード（`contracts/ui.ts DEFAULT_KEYMAP` に準拠。差分は太字）

- 全体: `⌘K` パレット / `/` 文書内を検索（パレットを範囲付きで開く）/ `?` 一覧 / `g h`・`g d`・`g i`・`g r`・`g c`・`g s` / `-`・`=`・`0` 読者レベル / `b`・`t` 左ナビ / `⇧C` 文脈ペイン / `Esc` で段階的に閉じる
- 読む: `j`・`k` / `1`–`9` 章 / `[`・`]` スレッド / `o` peek を分割に固定（もう一度で解除）/ `⇧O` エディタで開く / `y` permalink / `p` プロンプトとしてコピー / `⌥` 長押しで全出典を表示
- 依頼: `c`・`e`・`f`（選択範囲があればそれを、なければフォーカス中のブロックを対象にする）/ `⇧V` ブロックを選択 / `⇧F` 下書きをまとめて送る / `h` 解決済みを隠す
- Composer: `⌘↵` 送信 / `⌘1–4` 意図 / `Esc` 閉じる（下書きは保持）/ Enter は改行
- レビュー: `n`・`⇧N` / `⌘↵` 採用 / `⌘⌫` 却下 / `⌥⌘↵` すべて採用 / `⌘Z` 取り消し / **`r` 変更タブを開く（契約に `review.open` として追加を提案）**
- Inbox: `j`・`k` / `↵` 文書で開く / **`x` 選択（追加を提案）**
- パレット: `↑`・`↓`（`⌘N`・`⌘P` も可）/ `↵` / `⌘K` Action panel / 入力が空の Backspace で戻る
- **`t` は `b` と同じく左ナビ（目次）の開閉にした**。契約の `pane.toc` は左ナビとは別の目次の開閉だが、この direction では目次が左ナビに入っているため。
- **IME ガード**: すべての keydown は capture 段の 1 つのハンドラで受け、`e.isComposing || e.keyCode === 229` なら何もしない。英字と数字は `e.code`（`KeyF`・`Digit2`）で判定し、記号（`? / - = [ ]`）だけ `e.key` を使う。

---

## 9. 数値の書式

| 対象 | 書式 |
|---|---|
| token | 1,000 未満はそのまま。1k 以上は小数 1 桁の `k`（`2.5k`）。1M 以上は小数 2 桁の `M`（`0.38M`）。見積りには `≈`、推定値の主行には `約` を付ける |
| $（API 換算） | 1 件の依頼は小数 3 桁（`$0.018`）。日計と生成は 2 桁（`$1.33`）。見積りカードの主行は 1 桁（`$1.3`） |
| 時間 | 1 分未満は小数 1 桁の `秒`。生成は `約{n}分` か `m:ss` |
| 誤差 | `（実績 3.9k · −2%）` |
| 規模 | 日本語の文脈では `45.7k LOC`、表の中では `45,672` |

---

## 10. 計測（このプロトタイプ。Chrome stable、1440×900、M 系 Mac）

| 指標 | 値 | 方法 |
|---|---|---|
| 章の再描画 `renderDoc` | p50 1.0 ms / p95 2.4 ms | `performance.now()` で 20 回 |
| 読者レベルの切替（再描画とスクロール復元） | p50 4.8 ms / p95 11.6 ms | 同上 |
| パレットの 1 打鍵（約 100 項目） | p50 0.3 ms / p95 0.9 ms | 35 回 |
| コードペインの描画 | p50 1.3 ms / p95 2.8 ms | 20 回 |
| DOM ノード（文書を表示中） | 1,777 | `querySelectorAll('*')` |
| LCP / CLS | 80 ms / 0 | PerformanceObserver |
| 楽観的カード（キーから DOM まで） | 3 ms（Playwright の RPC 込み） | `keys.mjs` |
| ファイルサイズ | 305 KB（gzip 93 KB） | 抜粋 42 KB を含む。**本番の初期 JS 予算（60 KB gz）の検証ではない** |

自動検証（`design-tmp/shots-pro/keys.mjs`）では 37 項目すべてが PASS し、page error は 0 件だった。

---

## 11. 受け入れ基準（本番 UI をこのプロトタイプに合わせて実装するときの判定。番号で参照する）

1. **AC-1**: 1440×900 の `S1`（スキャン）で、見取り図・目次・facts 6 枚・見積りカードの主行と [生成] が、スクロールせずに見える。LLM は呼ばない（usage 台帳に 0 件）。
2. **AC-2**: 見積りカードの主行は `{effort}: 約{M}M tok · API換算 ${usd} · 約{分}分` と [生成] の 1 行で、[生成] は 1 回のクリックか `↵` で始まる。生成では見積りカードそのものが確認の役目を果たすので、別の確認ダイアログは出さない（D3）。100k tok 超の確認ダイアログは、Push の依頼（Explain / Fix / Review）にだけ適用する。
3. **AC-3**: 生成中は、目次のどの章をクリックしても、その章が次の空き枠で生成される（優先度 1）。トースト `§{id} … を先に生成します` を 100 ms 以内に出す。
4. **AC-4**: 読者レベルの切替はネットワークを使わず p95 50 ms 以下。切替の前後で、画面内で最初に見えているブロックの位置のずれが 4px 以下。
5. **AC-5**: 3 つのレベルで、§7 の表の 5 行（L3・出典・下線・Why・ガター）がすべて表どおりに切り替わる。DOM の snapshot テストで確認する。
6. **AC-6**: 出典チップに 300 ms ±30 ms hover すると Code peek が出る。peek に pointer を移しても閉じず、Esc で閉じる。キーボードでチップにフォーカスしたときは即時に出る。
7. **AC-7**: peek の行範囲・ファイル・blob は `Cite`（core.ts）と一致する。範囲の外には最大 6 行の文脈を付け、合計 26 行を超えない。
8. **AC-8**: Split view の scrollspy は、スクロールが止まってから 100 ms 以内にハイライトを付け替える。同じファイル内の移動では、`.code` の DOM を作り直さない（MutationObserver で子ノードの追加が 0）。
9. **AC-9**: 文を選ぶと、選択ツールバーが選択範囲の上 8px（タッチでは下 10px）に出て、`c`・`e`・`f` で Composer が開く。保存したアンカーの TextQuote は `prefix 32 / suffix 32` 文字である。
10. **AC-10**: Composer で context chip を外すか足すと、見積りチップは同じフレーム内で更新される。ファイル数が 2 を超えると、router の表示が `patch` から `agent` に変わる。
11. **AC-11**: IME で変換中（`isComposing` または `keyCode 229`）の Enter・Esc・英字キーでは、何も起きない。Enter で送信することはなく、送信は `⌘↵` / `Ctrl+↵` だけで行う。
12. **AC-12**: Composer を Esc で閉じると、本文は下書きとして保存される。同じブロックで `c`・`e`・`f` を押すと復元する（ブラウザを再読み込みしても、本番では server 側の draft thread として残る）。
13. **AC-13**: `⌘↵` から 100 ms 以内にジョブカードが出て `queued` を表示する。以降は JobEvent の phase が届くたびに行が ✓ になり、完了時刻が付く。% 表示のバーは無い。
14. **AC-14**: 実行中のカードに `経過 {s} 秒 · 通常 {p25}–{p75} 秒` を出す。p25 と p75 は、同じ意図 × モードの直近 20 件から計算する（20 件に満たないときは事前値）。
15. **AC-15**: ready のカードに、gate ごとの結果と所要時間、`コード +a −d · n ファイル · h hunk`、`文書 n ブロック`、実費の行（入力・cache・出力・$・秒（LLM + gate））、見積りとの誤差を出す。値は `result.usage` と gate runner の実測から取る。
16. **AC-16**: 文書側の提案は、該当ブロックのその場に del / ins で出す。ブロック単位の ✓ / ✕ は、コードの hunk の採否とは独立に決められる。
17. **AC-17**: 変更タブでは `n` / `⇧N` で hunk を移動し、移動先の hunk ヘッダーを sticky の位置に出す。hunk ごとの ✓ / ✕ は `decided` に記録する（一部だけ採用すると partially_accepted）。
18. **AC-18**: `⌘↵` による採用では、checkpoint を作ってから作業ツリーに書く。ブロックは 1 回だけ光り（reduced-motion のときは静的な帯）、10 s の Undo トーストが出る。`⌘Z` で checkpoint から復元し、文書も R1 に戻る。
19. **AC-19**: 却下（`⌘⌫`）と取り消しのどちらでも、確認ダイアログを出さない。どちらの操作も、トーストから 1 回で元に戻せる。
20. **AC-20**: 失敗したスレッドには、原因分類・stderr 末尾 3 行・ここまでの費用・次の手を出す。依頼文・アンカー・chips は失われない。
21. **AC-21**: Inbox は `j` / `k` で 50 ms 以内に選択が動き、右ペインの詳細が切り替わる。下書きが 2 件以上あるときは、まとめて送るバーに見積りと節約率を出す。
22. **AC-22**: パレットは 1 打鍵 16 ms 以下（候補 5 万件まで。Worker で処理する）。romaji（`mochikoshi`）・かな（`もちこし`）・英語（`carry`）のどれでも用語・シンボル・節を引ける。
23. **AC-23**: ライトとダークの両方で、本文のコントラストは 4.5:1 以上、UI の部品は 3:1 以上。状態を色だけで区別しない（記号とラベルを併記する）。
24. **AC-24**: 820×1180 では 1 ペインになり、目次は drawer、文脈ペインは 3 段の bottom sheet になる。どの幅でも横スクロールが出ない（コードブロックを除く）。
25. **AC-25**: どの状態でも DOM は 5k ノード以下（上限 15k）、CLS は 0。
26. **AC-26**: ja / en で文言のキーの集合が一致する（parity テスト）。en でも文書は ja のまま表示し、翻訳はブロック単位でキャッシュする。

---

## 12. この direction で決めたこと

| # | 決定 | 理由 |
|---|---|---|
| P-1 | 1024px 以上では Split view（右 500px）を既定にする。見取り図の画面だけ 420px | 専門家の検証の速さを優先する。地図の可読性（文字が 0.92 倍で 11px 以上）も確保する |
| P-2 | ジョブキューは、トップバーのチップ・ステータスバー・右ペインの「ジョブ」タブの 3 か所に出す | 「ジョブキューを目立たせる」という要件。チップは件数だけにして、うるさくしない |
| P-3 | 提案は、文書側を中央列のインライン提案モード、コード側を右ペインの「変更」タブに分ける | 文書の文脈を保ったまま diff を見られる。GitHub PR と Google Docs の提案モードの組み合わせ |
| P-4 | ブロック操作は左ガターの縦ツールバー（c / e / f）にする | 右上に浮かせると本文の 1 行目を隠すことを、スクリーンショットで確認した |
| P-5 | Why は、標準と詳しいでは見出し 1 行に畳む。推測バッジは畳んでも見出しに残す | 信頼のシグナルを隠さない（07 原則 3） |
| P-6 | 生成の主行と [生成] を同じ行に置き、`↵` でも始める | D3 の「必ず見積りを出し、1 クリック」 |
| P-7 | パレットはグループごとの最高点の順に並べ、別名の一致を強調する。シンボルに用語の romaji を別名として付ける | `mochi` で概念から実装まで 1 回で届く |
| P-8 | 時間は LLM と gate に分けて出す（`14.2 秒（LLM 5.1 + gate 9.0）`） | 実測では gate（go test 7.5 s）が支配的。待ち時間の理由を正直に見せる |
| P-9 | 費用の主単位は API 換算 $ と token にし、5h % は副表示にする | addendum E3 |
| P-10 | 失敗カードの次の手は「Opus high で提案のみ」にし、金額を明示して確認を取る | 00 §5.1 の router（agent も失敗したら Opus high を提案のみで） |

---

## 13. 未解決の問い（[仮] と測り方）

1. **gate の時間が支配的である**（go test 7.5 s ≫ LLM 5 s）。「関連 test」を選ぶ規則が無い。今回は人が `-run TestStoryLLM` を選んだ。変更したファイルを import しているテストの集合を index から引く規則を P1 で実装し、fixture repo 5 個で gate の時間と見逃し率を測る。
2. **5h 枠の +11pp・推定 34%** は [仮]。並行する job が無い状態で、標準生成 1 回分の utilization の差を測る（addendum C3）。
3. **IME の実機検証**をしていない。Playwright で合成した `keyCode 229` しか確かめていない。ことえり / Google 日本語入力 / MS-IME で、§8 のガードとショートカットの効き方を手で検査する（07 §8-1）。
4. **タブレットで hover の peek が無い**。タップで peek を開いて固定し、2 回目のタップで分割に固定する案を、iPad の Safari で試す。
5. **ジョブを 3 か所に出すのが冗長か**。初見のユーザー 5 人に「いま何が動いているか」を答えてもらい、発見までの時間を比べる。
6. `text-autospace` / `text-spacing-trim` / `word-break:auto-phrase` は Chrome でしか確認していない。Safari 26 と Firefox 145 で表示を比べる。
7. Composer の見積り係数（0.03k/行、0.0008k/字、出力の事前値）は [仮]。06 §10 の fixture 20 件で誤差の分布を取り、±25% を初期の目標にする。
8. 文書の提案は 2 ブロックだが、§8.3 は画面の外にある。カードの `文書 2 ブロック` チップから順に飛べるようにするか（`n` を文書側にも効かせるか）を決める。
9. 単一 HTML（305 KB）は、本番の初期 JS（60 KB gz）の根拠にならない。本番では Svelte 5 で分割し、`contracts/ui.ts` の TODO（bundle split plan）に沿って実際に配信されるバイト数を CI で測る。

---

## 14. 契約との対応

| プロトタイプ | 契約 |
|---|---|
| 読者レベルの適用 | `core.ts READER_LEVEL_RULES` |
| ジョブの状態と遷移 | `core.ts JobState` / `JOB_TRANSITIONS`（queued → preparing → running → gating → ready → accepting → accepted / reverted） |
| ステージの行 | `core.ts JobPhase`（prepare / snapshot / spawn / think / edit / apply / scope / gate / ready） |
| ショートカット | `ui.ts DEFAULT_KEYMAP`。差分は §8 の太字 |
| 閾値 | `ui.ts UI_THRESHOLDS`（hoverCardMs 300 / undoToastMs 10000 / draftDebounceMs 500 / prefetchHoverMs 65） |
| フォント | `ui.ts FONT_STACKS` |
| permalink | `ui.ts APP_ROUTES`（`/w/:ws/doc/:section#b_…`） |
| Composer の状態 | `ui.ts ComposerState`（anchor / intent / body / estimate / removed） |
| パレット | `ui.ts PaletteWorkerMsg`（Worker で照合し、可視 5 件 + 1 件をのぞかせる） |

## ファイル

- `index.html`: プロトタイプ本体（単一ファイル）
- `shots/*.png`: スクリーンショット 18 枚
- `fixtures/th_17-story-retries.diff`: 検証済みの修正差分。`git apply --check` が crit@406875d で通る
- scratchpad 内の作業ファイル（成果物ではない）: `design-tmp/pro-src/{style.css,body.html,data.js,app.js}` から `design-tmp/pro-build.py` で組み立てる。`design-tmp/shots-pro/{shoot,keys,perf}.mjs` で撮影・検証・計測する
