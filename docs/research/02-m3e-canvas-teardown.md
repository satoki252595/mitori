# 02 — m3e-canvas ティアダウン (mitori 向け学習メモ)

- 調査日: 2026-10-03 / 調査者: research track 02-m3e
- 対象: https://github.com/lnkiai/m3e-canvas (MIT, Next.js 16.3.4 static export)
- ローカル clone: `/private/tmp/claude-501/-Users-satoki252595-work-20261002-aiAgentTool/99463a6e-6928-41bd-851e-ed1a1028dc52/scratchpad/refs/m3e-canvas` (shallow, 1 commit `de2d97a` = 2026-09-27。リモートは 174 commits)
- 以降 `lib/…` `app/…` `components/…` は上記 clone 配下の相対パス。行番号は clone 時点。

---

## 0. TL;DR (mitori が持ち帰るべき 12 行)

1. **m3e-canvas は「ビジュアル設計 (JSON Doc) → 自然言語プロンプト」の純関数 `buildPrompt(doc, widths, onlyFrameId?, lang)` (`lib/prompt.ts:1745`) が核**。UI は 26.2K LOC あるが、価値の源泉は 1,864 行のこのプロンプト生成器と、エージェント向け仕様書 `public/agent.md` (3,965 tokens)。
2. **短く・完全にする技法は 5 つ**: (a) 既定値は書かない (delta-only)、(b) 使った kind の style note だけ出す (conditional boilerplate)、(c) 座標でなく「行・グリッド・重なり・位置語」に意味圧縮、(d) 色は 1 回定義して以降はロール名参照、(e) 人間の `note` を原文のまま「Behavior」節に差し込む。
3. **実測 (3 画面/15 部品, EN)**: プロンプト 2,319 tokens (o200k proxy)。うち **固定ボイラープレートが約 50%**、パレット 19%、設計固有は約 30%。1 部品あたり限界コスト **約 32.5 tokens**、固定費 **約 1,430 tokens**。JSON 直渡し (約 59 tokens/部品) と **約 60 部品で損益分岐**、150 部品でプロンプトは JSON の 0.74 倍。
4. **言語別トークン**: 同一設計で ja は en の **1.38 倍**、ko 1.17 倍、zh 1.10 倍 (o200k proxy)。m3e は **プロンプト言語が UI 言語に固定** (別設定なし)。mitori は分離すべき。
5. **agent.md フロー**: エージェントに「JSON を書いて `#docz=` + deflate-raw + base64url のリンクで返せ。検証・往復デコードはするな」と指示。リンクはサーバ不要 (fragment)。150 部品でも **3,108 文字**。同じ agent.md を BYO-key の `draftDesign()` にも渡し **「1 つの仕様、2 つの経路」** にしている。
6. **到着した AI 成果物の扱いが秀逸**: `arrive()` で旧ドキュメントを `m3e:doc:before` に退避 (リロードしても残る)、700ms の色イーズ + 600ms フェードで見せ、**Keep / Undo / Save** の 3 ボタンを出す。mitori の「AI が反映した変更を人が採否する」ゲートの手本。
7. **弱点**: 検証エラーが boolean (`isProject`) で「プロジェクトファイルを開けませんでした」としか言えない (agent.md の「アプリが何が悪いか教える」は事実と異なる)。スキーマ version 無し。`Editor.tsx` が 4,841 行の 1 コンポーネント (useState 65 / React.memo 0) で **編集 1 回が O(部品数)**。キャンバス部品が a11y ツリーでは StaticText のみ (Issue #454)。
8. **パフォーマンス実測 (build 版, localhost)**: LCP 408ms / CLS 0.00 (throttle 無し)、Fast 4G + CPU 4x で LCP 1,139ms、JS 合計 1.31MB raw / 405KB gzip / 341KB brotli。pan/zoom は 150 部品・2,006 DOM nodes でも **120fps (p95 10ms)**。ただし 6x CPU の nudge は 15 部品 p50 16.9ms → 150 部品 p50 46.6ms と線形悪化。
9. **開発ループが速い**: `next build` 5.5s、`tsc --noEmit` 1.2s (TypeScript 7)、vitest 750 tests / 22 files が 1.8s。mitori も「全チェック 15 秒以内」を目標にできる。
10. **「エージェントに優しい」の正体は AGENTS.md ではない**。`AGENTS.md` (678B) / `CLAUDE.md` (`@AGENTS.md` のみ) は **`next dev` が自動生成した Next.js のボイラープレート**で、m3e 固有の記述はゼロ。実際に効いているのは **CONTRIBUTING.md の「Where things live」表 + 「Adding a part」5 手順 + i18n parity テスト (fail-loud ガードレール) + PR テンプレのチェックリスト**。
11. **メンテナは「コード → 設計 (逆方向)」「エディタ埋め込み」「AI の途中再開/バックアップモデル」を明示的に却下** (Issue #439 / #55 / #413)。= **mitori の空白地帯そのもの** (コードを読んで設計書化、人が注釈、AI がコードへ反映する往復ループ)。
12. **市場シグナル**: 2026-09-02 作成 → 2026-10-03 時点で **8,566 stars / 903 forks / 174 commits / 10 contributors** (GitHub API)。Trendshift で 2026-09-04 に「#1 Repository Of The Day」。「プロンプトを作るためだけの小さなツール」でも需要は大きい。

---

## 1. 調査方法と信頼性

| 項目 | 内容 |
|---|---|
| コード読解 | `lib/prompt.ts` `lib/ai.ts` `lib/share.ts` `lib/project.ts` `public/agent.md` `app/Editor.tsx` (主要箇所) `app/page.tsx` `app/layout.tsx` `app/globals.css` `components/{ShareMenu,AiPanel,PromptPanel,Toolbar,Mobile,Skeleton}.tsx` CONTRIBUTING / AGENTS / CLAUDE / `.github/*` |
| 実行 | 実際の `buildPrompt` を bun 1.4.2 で実行 (サンプル Doc は agent.md の例を 3 画面に拡張: `scratchpad/m3e-measure/doc.json`)。4 言語で出力して section 別に token 計測 |
| token 計測 | `gpt-tokenizer@4.0.0` の **o200k_base (近似)**。Claude 実トークナイザではないので **絶対値でなく相対比較として読むこと** |
| ビルド/テスト | clone を scratchpad にコピーし `npm ci` (3.0s, 86 pkgs) → `vitest run` → `tsc --noEmit` → `next build` |
| ブラウザ実測 | Chrome (DevTools MCP) で `out/` を python http.server (**圧縮なし**) で配信。1440x900。Performance trace / Lighthouse(desktop) / 合成イベントでの frame 計測。CPU throttle 6x は中位モバイル相当の目安 |
| Web | GitHub API (`gh api`) / Issues / Trendshift。2025-2026 の現況のみ採用 |
| 限界 | (1) token は proxy。(2) frame 計測は Mac の 120Hz 画面での 2×rAF 間隔。(3) ドラッグ操作自体は合成せず nudge で代替。(4) 無効ドキュメント到着時の UI は**コード読解のみ** (実機未確認) |

計測生データ/スクリプト: `scratchpad/m3e-measure/{run,tok,scale,agenttok,gen}.ts`, `prompt.{ja,en,zh,ko}.txt`, `link.txt`。

---

## 2. 全体像

### 2.1 構成 (static export・サーバ無し)

```
Doc (JSON: title, brief, frames[], groups[], theme, paletteKey, platform, promptEdit?, promptOptions?)
  │                           ▲
  │ 人間: ドラッグ/Inspector     │ AI: agent.md に従い JSON を生成 → #docz= リンク
  ▼                           │      または BYO-key で draftDesign()
Editor.tsx (単一巨大コンポーネント) ── localStorage(m3e:doc / m3e:ui / m3e:doc:before / m3e:ai)
  │
  ├─ buildPrompt(doc) ──→ クリップボード (「プロンプトをコピー」) ──→ Claude Code / Codex / Cursor 等へ人間が貼る
  └─ shareLink(doc)   ──→ クリップボード (リンク)
```

- **エージェントとの接続は「人間がコピペする」だけ**。MCP も CLI もファイル監視も無い。往復 (エージェントの結果が設計へ戻る) も無い。= 一方通行 (Issue #439 でメンテナ自身が "m3e goes one way" と明言)。

### 2.2 規模 (実測)

| 項目 | 値 |
|---|---|
| 非テスト TS/TSX | 26,208 LOC |
| テスト | 4,472 LOC / 22 files / **750 tests (1.8s)** |
| 最大ファイル | `app/Editor.tsx` 4,841 / `lib/tokens.ts` 2,732 / `components/M3Node.tsx` 1,976 / `components/ui.tsx` 1,917 / `lib/prompt.ts` 1,864 |
| `Editor` コンポーネント | `:453`〜`:4841` ≒ 4,388 行の 1 関数。useState 65 / useRef 53 / useCallback 33 / useEffect 30 / useMemo 19 / **React.memo 0** |
| スタイル | inline `style={{` 705 箇所 vs `className=` 129 箇所 (Tailwind v4 は import のみ。実質 inline + 411 行の globals.css) |
| UI 文字列 | `UI` 340 キー × (ja/en/zh) + `KO` 340 キー (別オブジェクト) = 1,360 文字列。part の kind は 36 種 |
| 依存 | dependencies は 5 つのみ (`html-to-image` `motion` `next` `react` `react-dom`) |
| ホスティング | GitHub Pages (`deploy.yml`)。月額 0 円 |
| 時系列 | 2026-09-02 作成、174 commits/約 30 日、106 commits が作者、10 contributors (CQMHV 35, Cokedog320 13…) |

---

## 3. 設計 → AI コーディングツール向けプロンプト

### 3.1 生成器の構造 (`lib/prompt.ts`)

`buildPrompt` が固定順序で節を積む。節見出しは `PH[lang]` に 4 言語で保持 (`:1518`)、テストが順序を固定 (`prompt.test.ts` の `SECTIONS`)。

```
(intro 4 行)   Please implement {title} in the Material 3 Expressive design language. {brief}
               Target a portrait phone screen (412×892dp), supporting both light and dark…
               Build it for Android, as a native app.
               The layout below is a rough sketch that conveys intent, not a finished spec. Do not reproduce it as a static picture; build the complete, usable app…
## Colors                       light/dark スキームの全ロール hex (bothModes なら 2 本)
## Shape, type and motion       3 行 (角丸/書体/モーション)
## Layout                       画面ごと: 「The "Home" screen, from top to bottom:」+ 行/グリッド/重なり
## Behavior and navigation      note・action・toggle・swipe を 1 行 1 項目
## Component styles             **使った kind の分だけ** M3 数値ガイド
## General guidance             固定 11 行 + ユーザーが選んだオプション行 (tests/darkMode/languages/offline/deliverable)
```

実出力 (EN, 3 画面/15 部品) から、設計固有部分の抜粋 (全文は `scratchpad/m3e-measure/prompt.en.txt`):

```
## Layout
There are 3 screens: "Home", "Recipe", "Settings".
The "Home" screen, from top to bottom (overlapping parts are called out as such):
- Near the top: a top app bar titled "Recipes" with a menu icon button on the left and search on the right.
- In the middle: a list of 3 items, top to bottom: "Tomato soup" with supporting text "30 min", a leading restaurant icon; …
- Near the bottom, aligned right: a filled FAB with the add icon.
## Behavior and navigation
- The "Tomato soup" list item opens the "Recipe" screen with a slide in from the right when tapped.
- Tapping the "Settings" destination of the navigation bar opens the "Settings" screen with a fade.
```

### 3.2 「短いのに足りている」を作る 10 の仕組み

| # | 仕組み | 実装 (行) | mitori への示唆 |
|---|---|---|---|
| 1 | **既定値は黙る (delta-only)**: M3 medium 56dp のボタン高・32dp チップ・小サイズ top bar・既定の card 配置は何も書かない。コメントに "goes unsaid" と明記 | `buttonSize :184` `iconButtonSize :198` `topBarSizeText :210` `chipHeightText :261` `cardLook :130` `cardText :111` | 設計書ブロック → 文脈では「リポジトリの慣習と違う点だけ」を出す |
| 2 | **使った kind だけ style note を出す** (`kindsUsed` → `STYLE_NOTES[lang][kind]`、web は `STYLE_NOTES_WEB` で上書き) | `:1770-1785` | 言語/FW/層ごとのガイドは「スコープ内に存在するものだけ」注入 |
| 3 | **座標を意味に圧縮**: 縦位置語 (22%/80% 閾値の near the top / in the middle / near the bottom)、左右 (36%/64%)、「同じ行 → 1 つの Row」「ネスト → 内側に重ねて配置」「25% 以上重なり → 前面に描画」 | `layoutTree :873` `rowsOf :889` `zone :912` `describeNodes :1024` | 設計書の位置は「章・節・段落 ID」で意味的に指す |
| 4 | **グリッド検出**: 同種カード/画像が 2 行以上×2 列以上で列端・幅が 6dp 以内なら「N 列のグリッド」1 文に畳む (列間/行間 dp つき) | `gridAt :979` `gridText :1008` (`GRID_SNAP = 6`) | 繰り返し構造は「数 + 規則 + 例外」で書く |
| 5 | **連結グループの畳み込み**: 「3 項目のリスト」「2 つの連結ボタングループ」 | `groupText :680` | 同種の複数要素は 1 文 |
| 6 | **色はロール名で参照**: 冒頭で 1 回 hex を宣言、以降は `primary` 等。「ハードコードするな」を General に 1 行 | `paletteLines :1101`, General 6 行目 | 共通語彙はプリアンブルで 1 回 |
| 7 | **人間の `note` を原文のまま差し込み** (`trimEnd` のみ) | `notes :781` (`hasText(it.note)` → parts.push) | **アンカー付きコメントの文面は加工せず運ぶ** |
| 8 | **意図 > ピクセル の免責**: 「寸法・余白は内容に合わせて調整してよい」「実機で崩れるならスケッチより動くことを優先」 | General 4 行目 | 設計書は仕様でなく意図と明記し、エージェントの裁量範囲を宣言 |
| 9 | **ルールベース整形で入力を正規化**: `Tidy` (bar を端へ、FAB を隅へ、近接する同種を連結、残りを 16dp マージンで積む)。冒頭コメント "Nothing here is guessed by a model" | `lib/tidy.ts:1-30` | 決定的処理で済む部分に LLM を使わない |
| 10 | **オプション行 (opt-in)**: `deliverable` (既定 ON: 「エミュレータ検証不要、署名済み APK を成果物に」) / tests / darkMode / languages / offline | `PROMPT_OPTION_TEXT :1686` `promptOptionsOf :1685` | 検証省略など「トークン/時間を左右する指示」をトグル化 |

### 3.3 実測: プロンプトの token 内訳 (3 画面/15 部品, o200k proxy)

| 節 | EN tokens | 比率 | 性質 |
|---|---:|---:|---|
| intro | 95 | 4% | 固有 + 固定 |
| Colors | 450 | 19% | テーマから**導出可能**(hex 2 スキーム) |
| Shape/type/motion | 66 | 3% | 固定寄り |
| **Layout** | 475 | 20% | **設計固有** |
| **Behavior and navigation** | 128 | 6% | **設計固有 (人間の note 含む)** |
| Component styles | 631 | 27% | 固定 (kind 依存) |
| General guidance | 474 | 20% | 固定 |
| **合計** | **2,319** | | 設計固有は約 30%、固定ボイラープレート約 50% |

### 3.4 実測: スケーリング (EN, 同一パターンを複製)

| 画面 | 部品 | プロンプト tokens | JSON tokens | JSON bytes | deflate-raw 後リンク長(chars) |
|---:|---:|---:|---:|---:|---:|
| 1 | 6 | 1,630 | 397 | 1,294 | 691 |
| 3 | 15 | 2,217 | 942 | 3,021 | 1,147 |
| 6 | 30 | 2,704 | 1,828 | 5,790 | 1,387 |
| 12 | 60 | 3,678 | 3,600 | 11,348 | 1,834 |
| 30 | 150 | 6,600 | 8,916 | 28,196 | 3,108 |

- 回帰: プロンプトは **約 1,430 tokens 固定 + 32.5 tokens/部品**、JSON は **約 59 tokens/部品**。**60 部品付近で同値**、150 部品でプロンプトは JSON の 0.74 倍。
- 1 画面だけ (`onlyFrameId`) を出しても 1,679 tokens (全体 2,217 に対し 76%) = **スコープを絞っても固定費は消えない**。
- 反復 (1 回の修正依頼ごとに貼る) 場合、固定 1.4K tokens が毎回乗る。**固定部は Claude Code の CLAUDE.md/skill 側へ 1 回置き、毎回のペイロードは差分だけ**にするのが mitori では合理的。また m3e は固定部が**末尾**にあり prompt cache のプレフィックスとしては不利 (1 発貼り付け用途なので本人達には問題なし)。

### 3.5 実測: 言語別 (同一設計, 15 部品)

| lang | tokens (o200k) | bytes | chars |
|---|---:|---:|---:|
| en | 2,319 (1.00x) | 9,476 | 9,466 |
| zh | 2,543 (1.10x) | 9,186 | 5,065 |
| ko | 2,715 (1.17x) | 10,158 | 5,982 |
| ja | 3,190 (**1.38x**) | 11,719 | 5,926 |

- 4 言語は**実行時翻訳でなく手書きテンプレート 4 本**: `itemJa :294` / `itemEn :391` / `itemZh :488` / `itemKo :585` (ほぼ同形のロジック × 4)、`STYLE_NOTES :1148` `GENERAL :1426` `PH :1518` も 4 本。`prompt.ts` の**約半分が言語別テーブル**。CONTRIBUTING は「文字列は 4 言語すべてに追加」を規約化し、parity テスト (後述) で強制。
- **プロンプト言語 = UI 言語** (`buildPrompt(doc, widths, undefined, lang)` に UI の `lang` を渡す。`promptLang` 設定は存在しない: grep 0 件)。日本語 UI の人はエージェントに +38% の token を毎回払う。

### 3.6 プロンプト UI (`components/PromptPanel.tsx`, 602 行)

- 右パネルの「プロンプト」タブ: Android/Web 切替、読み取り専用ビュー、**コピー**と全画面編集。コピーボタンは幅固定 (200px) でラベル↔チェックを `visibility` 切替 (幅が動かない)。テーマ色のゆっくりしたグラデーション (`m3e-drift 4s`)。
- **アウトライン**: `promptMarks(text, frames)` (`prompt.ts:1721`) は**生成物でなくテキスト自体から** `## ` 見出しと画面名で始まる行を拾う。手編集後も目次が壊れない。ハイライトは textarea の背後に透明な複製テキストを置き、そこに `<span>` を背景描画して実現 (編集は自由のまま)。
- 手編集は `doc.promptEdit` に**文字列で保存** (`effectivePrompt :1864`)。→ 一度編集すると以後のデザイン変更が反映されなくなる (リセット前提)。**真実の二重化**で、mitori では避ける。
- トークン数・文字数メーター: **無い** (grep 0 件)。テストも**サイズ上限/ゴールデン**を持たない (`toBeGreaterThan(100)` 程度)。

### 3.7 気づいた出力の品質ぶれ (EN 実出力より)

1. 人間の note をそのまま差し込むため文頭が小文字/大文字不統一: 「The FAB Opens the new recipe form.」
2. アイコン名を文中に生で入れる: 「with a arrow_back icon button」(冠詞ミス)。
3. 画面の `note` が見出し行の**前**に独立文として出る (画面に紐付かない見え方): 「Lists the saved recipes. / The "Home" screen, …」
4. 位置語は粗い: y=112〜328 のリストが 'In the middle'。
→ **LLM に渡す文面は golden file でレビューする**必要がある (m3e は構造アサーションのみ)。

---

## 4. `public/agent.md` と「AI に下書きさせてリンクで返させる」フロー

### 4.1 人間側の導線 (`components/ShareMenu.tsx`)

1. ツールバー左下の「AI に頼む BETA」→ ダイアログ (spring 520/34/0.7、scrim 0.32、Esc は capture 相で `stopPropagation`)。
2. 作りたいものを書く → **「指示をコピー」** (エージェント用) か **「AI で作る」** (BYO-key 直叩き)。キー未設定なら右ボタンが「AI の設定」に変わる。
3. コピーされる指示文 (`askAiText`, 4 言語) は**1 文の定型**:
   > Make an M3E Canvas sketch. First read {url} and follow it: build the design as JSON and reply with a share link. If you cannot run code, reply with the JSON in a code block (it will be saved to a file and opened). No verification is needed.  What to build: {idea}
   `{url}` は `window.location.origin + BASE + "/agent.md"` (自己ホストでも正しい URL)。
4. コピー後は左に「AI エージェントに貼り付けてください」(強調色)、4 秒後に戻る。リンクコピーは 1.4 秒。

### 4.2 agent.md の設計 (13,654 B / 3,965 tokens)

| 節 | tokens | 役割 |
|---|---:|---|
| 導入 + What to deliver (リンク生成コード Node/Python 2 本) | 約 600 | 返答形式: **リンク**。実行不可なら JSON コードブロック。「検証・デコード・往復はするな、アプリが開くとき確認する」 |
| The document / Screens | 約 580 | トップレベル JSON、frame 仕様 (412×892 / 1280×800、80 間隔) |
| Parts (groups) + 例 | 約 700 | group = 単体 or 連結 run。座標は canvas 座標 |
| **Kinds and their fields** (36 行の表) | **1,553 (39%)** | kind ごとの field と既定サイズ |
| Keep it simple / A good sketch / Checklist | 約 530 | **「部品で埋めるな」「1 画面 1 アイデア」「3〜5 画面で十分」「自分の言語で実ラベル」** |

- **Tidy 前提で座標の精度を要求しない**: 「Rough placement is fine. … Spend your effort on the right parts, sensible labels, and navigation」。エージェントのトークンを座標でなく内容に使わせる。
- **サイズ制約を明示**: 「under about 100 KB」「image は https URL、データ埋め込み禁止」。
- 「このフォーマットは beta。フィールドは追加され得るが既存の意味は保つ」と宣言 (version フィールド自体は無い)。

### 4.3 リンクの符号化 (`lib/share.ts`)

```
https://<host>/<base>/#docz=<base64url(deflate-raw(JSON))>     // 通常 (CompressionStream 対応時)
https://<host>/<base>/#doc=<encodeURIComponent(JSON)>           // 非圧縮フォールバック
```

- **fragment なのでサーバに届かない** (静的ホスティング/プライバシー)。`CompressionStream("deflate-raw")` / `DecompressionStream` はブラウザ標準で依存ゼロ。
- `shareable(doc)` が**共有に載せないもの**を落とす: AI 書き換え履歴 (`noteHistory`)、ローカル画像 (`data:`/`blob:`、https のみ残す)。
- 読み取り側は `hashchange` を監視 (`Editor.tsx:~2560-2585`)。同一タブへの貼り付け・既存タブでの遷移も受ける。取り込み後は `history.replaceState` で hash を消す (`clearShareHash :2644`)。
- **実験**: agent.md の Node スニペットで 3 画面/15 部品の JSON (3,142 B) → deflate 893 B → リンク 1,303 文字。localhost の build に開くと正しく 3 画面+遷移矢印が復元され、`location.hash` は空に、`m3e:doc:before` (1,562 B) に旧文書が退避、下部ピルに **元に戻す / ✓採用 / 保存** が出た (スクリーンショット確認済み)。
- ブラウザ上限: fragment は仕様上無制限だが実用は **約 50〜65K 文字** (Chrome/Firefox 〜80K、Safari 〜65K の報告)。チャットアプリはもっと早く切る。m3e の 150 部品が 3.1K 文字なので余裕。100KB JSON でも deflate 後は概ね 10〜25K 文字の見込み (生成データは 12x 圧縮、実データはもっと悪い)。

### 4.4 「1 つの仕様、2 つの経路」(`lib/ai.ts:draftDesign`)

- BYO-key 経路は `public/agent.md` を**そのまま system prompt に連結**して呼ぶ (`fetch(BASE/agent.md)` を 1 回キャッシュ)。system に "Reply with the JSON document only: no share link, no prose, no markdown fence" を追加。`draftDesign` は `max_tokens` 12,000 を要求するが、`complete()` 内で `Math.min(maxTokens, 8192)` に**クランプ** (`ai.ts:94,115`、OpenAI 以外)。= 大きい設計は 8,192 出力 token で打ち切られる構造で、PR #413 が「途中で切れる」問題の解消を試みて "single-shot on purpose" と却下された背景はここ。
- 応答は `parseJsonObject` (最初の `{` と最後の `}` の間を抜く、コードフェンス除去) → `isProject` で形検証 → `arrive()`。**1 リクエスト 1 完成ドキュメント or 明確な失敗**。メンテナは再開/バックアップモデルを Issue #413 で「意図的に single-shot」と却下。
- 部品単位の AI: `proposeBehavior` / `proposeDescription` は `buildPrompt(...)` の出力を**そのままコンテキストに使い** (=設計→プロンプト生成器を文脈シリアライザと兼用)、`{"notes":{"<id>":"<sentence>"}}` という厳密 JSON を返させ、**id が一致するものだけ採用** (`pickStrings`)。座標は絶対に触らせない。
- 書き換え前の値を `noteHistory` に保持し、同じボタンで**往復トグル** (`popHistory`)。

### 4.5 到着ゲート (`Editor.tsx: arrive :2589, importDoc :2532, keepDraft :2626, undoDraft :2633`)

```
外部 Doc 到着 → snapshot(withMeta=true) (全文書置換も Ctrl+Z 1 回)
             → before = 現文書 を localStorage('m3e:doc:before') と state(draftBefore) に退避
             → setRevealing(true) 900ms: .m3e-reveal で色 700ms イーズ + 各 screen 600ms フェードイン
             → UI: 「元に戻す / この設計を採用 / プロジェクトを保存」
             → Keep: before 破棄、quickUndo を出す / Undo: before を復元 (これも reveal)
```

- モバイルは Keep/Undo UI を持たず、リンクは通常 import (Ctrl+Z 相当で戻せる)。
- AI 作業中は `ThinkingRing` (`:406`): 対象 screen の bezel に **テーマ色の conic-gradient を blur(22px) で 3.2s 周回**。「どこを AI が触っているか」を領域で示す。`useReducedMotion` で停止。
- AI ボタン (`AiWriteBtn`) は処理中に**同じ幅のまま**「Cancel」に変わる (両ラベルを grid 重ね、`visibility` 切替)。

### 4.6 agent.md フローの弱点

1. **検証がエージェント側から不可能**: "do not verify" と書く一方、アプリ側の失敗は `showToast(t("invalidProject"))` = 「プロジェクトファイルを開けませんでした。」のみ (`Editor.tsx:~2572`, `i18n.ts:145`)。`isProject` は `boolean` を返すだけで**どのフィールドが悪いか分からない** (agent.md の "tells the person what is wrong" と不一致)。厳格さ (`icon: null` を明示必須、`label: ""` 必須) がそのまま失敗要因になる。
2. **JSON Schema 無し**: 36 kinds の表はプロース。スキーマ変更はドキュメントと validator の 2 箇所同期。`version` フィールドも無く、移行は `migrateGroups` (`Editor.tsx:283`) の形推測。
3. **帰りの道が無い**: 人間の編集をエージェントに返すには、プロンプト全文を再コピーするしかない。
4. 長大リンクの手運び: 150 部品で 3.1K 文字。エージェントが base64url の padding 等を誤ると人間側で失敗するが、診断が無い。
5. 共有 JSON 内の https 画像 `src` は開いた瞬間に第三者へリクエストが飛ぶ。

---

## 5. UI/UX craft (観察と数値)

### 5.1 画面構成 (1440×900 実機スクリーンショット確認)

- 左: **52px アイコンレール** (部品/レイヤー/カラー/シェイプ/タイポ/モーション/AI/言語/GitHub) + 296〜480px パネル。中央: スマホ bezel のキャンバス + **浮遊ピル型ツールバー** (選択/手のひら | 画面追加/プレビュー | undo/redo/全消去/プロジェクト)。右: 「編集 / プロンプト」の 2 タブ (幅 280〜480)。左下: 「AI に頼む BETA」、右下: ズームピル (− 79% + fit)。
- **エディタの chrome 自体が編集中の M3 スキームで描画される** (ダークスキームにするとエディタ全体が暗転) = dogfooding。共有ダイアログの「連結ボタン対」も外側 20/内側 8 の M3 connected button group。CONTRIBUTING は "editor chrome と parts は別経路" と規約化。
- 初回起動でも**空でない**: 日本語/英語に合わせたシード画面 (リスト+お気に入り/共有ボタン+FAB+ナビ) が入る。言語切替時は `translateDefaultText` が既定文言だけ再翻訳 (`i18n.ts:32` に "ponytail" コメントで暫定ハックと自白)。

### 5.2 キーボード (`Editor.tsx:3203-3290` + README)

| キー | 動作 |
|---|---|
| `V` / `H` / 押している間 `Space` | 選択 / 手のひら / 一時パン |
| `Wheel` / `Ctrl(⌘)+Wheel` | パン / カーソル中心ズーム (`exp(-deltaY*0.0022)`, 0.25〜3x) |
| `+` `-` `0` | ズーム ×1.2 / ÷1.2 / fit |
| `Ctrl+Z` / `Ctrl+Shift+Z` / `Ctrl+Y` | undo / redo / redo |
| `Ctrl+D` | 複製 (選択なし+画面選択なら画面複製) |
| `Ctrl+C` / `Ctrl+V` | アプリ内クリップボード (テキスト選択中・未選択時はブラウザ標準に委譲) |
| `Ctrl+G` / `Ctrl+Shift+G` | グループ化 / 解除 |
| 矢印 (`Shift`=8dp、素=1dp) | nudge (同一選択の連続 nudge は 1 undo に併合) |
| `Ctrl` + ドラッグ | スナップ無効 (ガイド/4dp グリッド) |
| `Delete` / `Backspace` / `Esc` | 削除 / 選択解除 |
| `P` | プレビュー |

- 入力欄/textarea/contentEditable にフォーカス中は全ショートカット無効。ダイアログ・プレビュー・全画面プロンプト表示中も無効。`e.isComposing` ガードは**無い** (IME は typing ガードで実質回避)。
- 単一文字キー + 修飾キー前提。**キーボードでの部品操作 (Tab 移動で部品選択) は不可** (§5.9)。

### 5.3 Undo/Redo と履歴 (`Editor.tsx:171, 619-680`)

- スナップショットは `{groups, frames, meta?}` の**参照** (イミュータブル更新なので構造共有。deep clone 無し)。`HISTORY_MAX = 100` で古い順に捨てる。
- `snapshotFor(key)`: **同じキーで 800ms 以内の連続編集は 1 ステップに併合** (nudge・スライダー・テキスト入力)。ドラッグは**最初の変化で 1 回だけ**スナップ (押しただけでは undo を積まない)。
- 全文書置換 (開く・AI 到着) は `meta` 付きスナップ → 1 回の Ctrl+Z で丸ごと戻る。確認ダイアログにも「Ctrl+Z で戻せます」と明記。
- **Tidy ボタンが自分自身の Undo になる** (`tidyState :2817`): 直前 tidy の `after` が現 `groups` と**参照同一**の間だけ「元に戻す」表示 (青→tertiaryContainer)、何も整えるものが無ければ disabled の「整頓済み」。
- ドラッグ中キャンセルされた部品は「瞬時に消えず縮んで消える」(commit "Shrink a cancelled drag away…")。

### 5.4 永続化とマルチタブ

- キー: `m3e:doc` (文書)、`m3e:ui` (view/パネル幅/開閉/お気に入り/言語/ブート色)、`m3e:doc:before` (AI 到着前の文書)、`m3e:ai` (BYO-key 設定 — **平文**)。**全て try/catch**、失敗しても動く。
- **Web Locks で多重編集を防止** (`navigator.locks.request("m3e:doc:editor", {ifAvailable:true})`, `Editor.tsx:~686`): 2 つ目以降のタブは `inert` + 「別のタブで編集中です / 再読み込み」モーダル。ロック API 無し環境は従来動作。
- 保存は `useEffect` 依存 (`groups, frames, …`) で**変化のたびに `JSON.stringify(全体)` → `localStorage.setItem` を同期実行**。デバウンス無し。ポインタ移動中のドラッグも `setGroups` 経由で毎フレーム書く (`:1955-2050` の pointermove)。

### 5.5 モーション定数 (M3 Expressive)

| 用途 | 値 |
|---|---|
| 標準イージング | `cubic-bezier(0.2, 0, 0, 1)` (M3 emphasized) |
| 部品の settle | `SETTLE_MS = 340` (`lib/tokens.ts:127`)、CSS 変数 `--m3-settle/--m3-ease` |
| 画面遷移 (標準) | tween 420ms (`SLIDE_MS = 0.42`)、fade 300ms |
| 画面遷移 (expressive) | spring `{stiffness:360, damping:26, mass:1}` (オーバーシュートあり) |
| ダイアログ | spring `{520, 34, 0.7}` scale .92→1 |
| BottomSheet | spring `{420, 38, 0.8}`、閉じ条件 `offset.y>90 || velocity.y>600`、`dragElastic top:0 bottom:1` |
| 押下 | `.m3-press:active` scale(.94) 120ms、palette tile hover `translateY(-1px)` |
| ブート overlay | 420ms フェード、AI 到着 reveal 700ms/600ms (900ms 後に class 除去) |
| 全画面プロンプト | `COVER_MS = 320` |
| rail 展開 | 240ms `cubic-bezier(0.32, 0.72, 0, 1)` |
| reduced-motion | `@media (prefers-reduced-motion)` で transition/animation 全停止 + `useReducedMotion()` |

- 戻る遷移は**入ったときの遷移を逆再生** (Entry スタック)。スワイプは指に追従。
- 部品の幅は「隠し測定コピー」を `useLayoutEffect` で `getBoundingClientRect().width` 計測 → `widths` に保持 (`Editor.tsx:935`)。`document.fonts` の `loadingdone` で全再計測。測定コピーは `transition:none` (レイアウトは即時、見た目だけ補間)。
- ソース: 部品は実 DOM で描画、PNG 書き出しは別レイヤー `M3Static` を **オフスクリーンに 1:1 で再描画**して `html-to-image` (`pixelRatio:2`) — 拡大率/選択枠/アニメが混入しない。

### 5.6 モバイル

- 判定: `matchMedia("(max-width: 840px), (pointer: coarse) and (max-width: 1024px)")` (`:849`)。モバイルは **1 画面固定・選択ツールのみ・ボタン専用エディタ** (`components/Mobile.tsx`)。BottomSheet で text/icon/style/note を編集。`MobileInspector` は 1 行 note まで。
- `--app-h` = `window.innerHeight` (in-app ブラウザの dvh 非対応対策)、`--bottom-ui: 64px` を iOS/Android WebView・X/Instagram/FB/LINE UA で付与、`env(safe-area-inset-bottom)`、`viewportFit: cover`、`overscroll-behavior: none`、キャンバス `touch-action:none`、2 本指ピンチ+パン (`onTouchCapture`、1 本指のジェスチャを取り消し)。
- 実機エミュ (390×844) で 3 画面文書を開くと、**画面 3 枚が縮小サムネで上部に並び下半分が空白**、上部に「フル機能は PC のブラウザで使えます」。読む/コメントする体験は無い。

### 5.7 テーマ・i18n

- パレット: 7 プリセット + シード色 1 つ (`lib/color.ts` 208 行、CIE L\* のトーン配置+gamut clip。CAM16 は使わず「モックアップ用には十分」とコメント) + ライト/ダーク/3 段階コントラスト/ダイナミックカラー。エディタ chrome は `p` (Palette) オブジェクトを props で渡し inline style で適用 (CSS 変数ではない)。ブート時のみ CSS 変数 `--skel-*`。
- i18n: `t(key, lang = current)` で module-level の `current` と React Context を併用 (非 React ヘルパから参照するため)。起動時言語: `localStorage m3e:ui.lang` → `navigator.language` (zh/ko/ja 以外は en)。Noto Sans JP/SC/KR を言語選択時に Google Fonts から**遅延ロード** (`ensureLangFontLoaded`) し、完了後に幅再計測。
- **parity テスト** (`lib/i18n.parity.test.ts`, 13 件の it/it.each 定義。it.each 展開でさらに増える): 全キーが全言語に存在・非空、`{placeholder}` の一致、KIND_TEXT/SEED_TEXT/TAB_LABELS/NAV_TABS 等の入れ子キー一致、アイコン添字整合、LANG_FONT 網羅。→ **規約を CI の fail-loud に変えている**。(KO が別オブジェクトな点は後付けの痕跡。)

### 5.8 パフォーマンス (実測)

**ロード**

| 条件 | LCP | CLS | 備考 |
|---|---:|---:|---|
| throttle 無し | **408 ms** | 0.00 | LCP は render delay 406ms (= ブート skeleton が先に描画される) |
| Fast 4G + CPU 4x | **1,139 ms** | 0.00 | render-blocking: head の Google Fonts CSS 2 本 (Roboto / Material Symbols。推定 FCP/LCP −147ms) |
| Lighthouse desktop | A11y 100 / Best Practices 100 / SEO 100 / Agentic 100 | | ただし §5.9 参照 |

**バンドル** (`out/`, 合計 3.8MB)

| 項目 | raw | gzip | brotli |
|---|---:|---:|---:|
| JS 合計 (9 chunks) | 1,307,956 | 404,831 | 341,101 |
| 最大 chunk (Editor 本体想定) | 678,044 | 207,568 | 171,119 |
| index.html が即時 `<script>` で参照する 8 本 | 629,517 | — | — |
| CSS | 18,327 | — | — |
| index.html | 22,955 | 5,369 | — |
| `material-symbols.json` (アイコン名一覧, **IconPicker を開いたときだけ fetch**) | 1,285,355 | — | — |

**ブート戦略 (全部 inline で効く)**

1. `app/page.tsx`: モジュール評価時点で `import("./Editor")` を発火 → ハイドレーションと並行してチャンク取得。`dynamic(..., {ssr:false})`。
2. `app/layout.tsx` の `<head>` inline script が `m3e:ui` を読み、**前回のパネル幅と配色を CSS 変数 `--skel-*` に書いてから初回ペイント** (16 進数の正規表現検証あり)。
3. 静的 HTML に **editor の骨格 Skeleton** (`components/Skeleton.tsx`) を含み、`m3e-bone` が breathing。Editor が文書を読んで 1 フレーム後に 420ms でフェードアウト。dark 設定の初回は `prefers-color-scheme` で暗色の骨格 (白フラッシュ回避)。
4. アイコンフォントは `.msr` に `width:1em;height:1em` を**ロード前から確保** (ligature 文字幅で崩れない)。CLS 0 の主因。
5. 言語自動判定をクライアント専用にしてロケールのちらつきを排除 (PR #429 / #416 の修正)。
   - 副作用: 日本語 UI の初回は CJK フォントのスライス (Noto Sans JP の woff2) が約 31 リクエスト続く。フォント同梱+サブセット化の余地。

**インタラクション** (build 版、合成イベント。2×rAF 間隔、`—` は未計測)

| 操作 | 条件 | 部品数/DOM | p50 | p95 |
|---|---|---|---:|---:|
| pan (wheel) フレーム間隔 | 1x CPU | 150 / 2,006 nodes | 8.3 ms (=120fps) | 10.0 ms |
| zoom (ctrl+wheel) | 1x CPU | 150 | 8.3 ms | 9.4 ms |
| pan (2 frame) | 6x CPU | 150 | 16.5 ms | 19.8 ms |
| zoom (2 frame) | 6x CPU | 150 | 16.6 ms | 19.2 ms |
| 矢印 nudge → 再描画+全文保存 | 6x CPU | 15 | 16.9 ms | 24.6 ms |
| 矢印 nudge → 再描画+全文保存 | 6x CPU | **150** | **46.6 ms** | **53.3 ms** |

- pan/zoom は transform のみで部品を再描画しないため部品数に鈍感。**状態変更は部品数に線形** (memo 無し + 全文 stringify)。150 部品で中位モバイル相当なら 3 フレーム相当。数百〜数千ブロックを扱う mitori では致命的になり得る。

**開発ループ**: `npm ci` 3.0s → `tsc --noEmit` **1.2s** (TS 7) → `vitest run` **1.8s** (750 tests) → `next build` **5.5s** (Turbopack)。

### 5.9 アクセシビリティ (自動スコアと実態の乖離)

- Lighthouse は 100 だが、a11y ツリー上でキャンバスの部品は `StaticText` のみ (操作可能要素として公開されていない)。パレットのタイルも同様 (Issue **#454 "Parts palette tiles are not exposed as keyboard-operable controls"**, PR #455 が open)。画面ラベルの `radio`、ズームなどのボタンは適切。`aria-live` の `status` と `alert` 領域は存在。
- 色コントラストは M3 スキームに依存。reduced-motion は対応済み。

---

## 6. CONTRIBUTING / AGENTS.md / CLAUDE.md が作る「agent-friendly」

### 6.1 事実関係

| ファイル | 内容 | 評価 |
|---|---|---|
| `AGENTS.md` (678B) | `<!-- BEGIN:nextjs-agent-rules -->` 〜 `END` の **Next.js 自動ブロックのみ**: 「This is NOT the Next.js you know … `node_modules/next/dist/docs/` を読め」。"このブロックは `next dev` が書く/再追加する" と明記 | **m3e 固有の指示ゼロ** |
| `CLAUDE.md` | `@AGENTS.md` の 1 行 | 同上 |
| 生成元 | `node_modules/next/dist/server/lib/generate-agent-files.js`: AI エージェントを検知した `next dev` が、**マーカー付きの管理ブロックを冪等に upsert** (旧マーカーも掃除)。ドキュメントは **`node_modules/next/dist/docs/` に 452 ファイル/4.1MB が同梱**されバージョン一致 | **mitori が真似るべき手法** (§8 R3) |
| `CONTRIBUTING.md` (4.9KB, 日中韓の要約付き) | **"Where things live" の表** (領域→ファイル)、**"Adding a part" の 5 手順** (tokens.ts → i18n.ts 4 言語 → M3Node → prompt.ts 4 言語+STYLE_NOTES → Inspector/Preview)、規約 (コメントは英語/文字列は 4 言語/commit は "describe the change, not the file"/PR は小さく) | 実質これが AGENTS.md の役割。**横断変更の手順書** |
| `.github/PULL_REQUEST_TEMPLATE.md` | チェックリスト: typecheck/test/build、4 言語、実際に触ったか (スマホも) | CI と同じ 3 コマンドを人/AI 双方に要求 |
| Issue forms | bug / feature / **part_request** (部品名+M3 URL、用途、Expressive かの checkbox) + `blank_issues_enabled: false` | 要求の構造化 (「何をしたいか / 何が助けになるか / 領域」) |
| `ci.yml` | `typecheck` → `test` → `build` を 1 job、`permissions: contents read`、fork PR 対応、concurrency cancel | 速い・小さい |
| `dependabot.yml` | npm/actions を月次グループ更新 | |

### 6.2 効いているガードレール

1. **parity テスト** (言語の取りこぼしが即 fail)。
2. **プロンプト構造テスト** (節見出し順、引用符規則、`ja` は 「」、`zh` は “”、必須ロールの存在)。
3. **プロンプト生成器が純関数** → Issue #55 の投稿者が "`lib/` is not the problem" と評した通り再利用しやすい。(エディタ側が密結合なので埋め込みは却下された。)
4. メンテナの**スコープ管理が AI 時代の PR 洪水に効いている**: PR #413 (17 files/7 features) を「1 issue = 1 idea、小さな PR」で却下し、却下理由を箇条書きで明示。AI が量産する PR を断る**運用ドキュメント化**の好例。

### 6.3 機会損失

- AGENTS.md に「`npm run typecheck && npm test && npm run build` を通す」「4 言語を同時に追加」「`lib/` は純関数、`app/Editor.tsx` に集約」等の **3〜5 行を書けば**エージェントの手戻りは大きく減る。CONTRIBUTING にあるが AGENTS.md に反映されていない。
- コミットメッセージに "Fix review findings in …" (2026-09-13, 09-16) があり、**AI レビュー→修正の工程を開発フローに組み込んでいる**と推測できる (推測。明記はされていない)。

---

## 7. 弱点 / 真似しないこと

| # | 内容 | 根拠 | mitori の回避策 |
|---|---|---|---|
| W1 | **巨大単一コンポーネント** (4,388 行, memo 0) → 編集コスト O(n)、埋め込み不可 (#55 却下) | §2.2 §5.8 | ブロック単位 store + `React.memo`/signals、`lib` 純関数 + 薄い UI |
| W2 | **全文書を同期 `JSON.stringify` → localStorage をドラッグ中も毎フレーム** | `Editor.tsx:880-889`, `:1955-2050` | 差分/debounce(idle) 保存、IndexedDB or ファイル |
| W3 | **スキーマ version 無し + 暗黙マイグレーション** (`migrateGroups` が形から推測) | grep `version` 0 件 | `schemaVersion` + 明示的 migration レジストリ |
| W4 | **検証が boolean**、利用者にもエージェントにも理由が出ない | `project.ts isProject` | 構造化エラー (path/期待/実際)、`mitori check` を提供 |
| W5 | **プロンプト言語が UI 言語に固定**、4 言語を手書き 4 重化 (prompt.ts の約半分) | §3.5 | agent 向けは英語正本 + メッセージカタログ。UI 言語と分離 |
| W6 | **プロンプトの手編集が文字列で分岐** (`promptEdit`) し以後の変更が反映されない | `prompt.ts:1864` | 手編集は「差分/追記指示」として別レイヤーに |
| W7 | **token メーター/サイズ回帰テストが無い** | grep, tests | 予算つき golden テスト + UI に token 表示 |
| W8 | **平文 API キーを localStorage** (`m3e:ai`)、`anthropic-dangerous-direct-browser-access` で直叩き | `ai.ts:31,51,92` | mitori はローカル CLI (Claude Code/Codex) を使い**キーを持たない** |
| W9 | **a11y の実質欠落** (キャンバス/パレット部品が操作要素でない)、自動スコアは 100 | #454 | 文書 (テキスト) 中心なので全ブロックをフォーカス可能にする |
| W10 | **モバイルは縮退** (1 画面/ボタン専用、複数画面だと空白だらけ) | 390×844 実測 | 設計書は**スマホで読む/コメントする**前提で最初から作る |
| W11 | 外部 Google Fonts 依存: head の `<link rel=stylesheet>` 2 本が render-blocking (trace 推定 FCP/LCP −147ms)。日本語 UI の初回は **Noto Sans JP の unicode-range 分割 woff2 を約 31 本** fetch (総リクエスト 46、うち同一オリジン 10 弱)。オフライン不可 | trace + network list | local-first ならフォント同梱 |
| W12 | 共有 JSON の https 画像が開封時に外部リクエスト | `share.ts shareable` | 共有時は画像をプロキシ/同梱、または許可リスト |
| W13 | `translateDefaultText` が文字列一致で既定文言を再翻訳する暫定ハック ("ponytail") | `i18n.ts:32` | 由来 (provenance) を持たせる |
| W14 | README が 4 言語を 1 ファイル 29.8KB に同居、先頭の GIF が 5.4MB | `docs/story.gif` | 言語別ファイル、動画/軽量 GIF |
| W15 | プロンプト文面の小さな文法ぶれ (§3.7) | 実出力 | golden review |

---

## 8. mitori への提言 (優先度つき)

### P0 — 設計の核

**R1. 「アンカー付きコメント」を一次市民にし、スコープ付き Context Pack を純関数で作る**
m3e の `note` (部品/画面単位の自由記述) は、プロンプトの "Behavior and navigation" にそのまま入る。Issue #440 (「アイコンに注釈を足したい」)・#419 (「現在の設計に指示を適用」) が需要を示し、メンテナは後者を single-shot 方針で却下。mitori では:
```
buildPack({ doc, anchors: [commentId…], budgetTokens, lang }) → { text, tokens, refs[] }
```
- `refs` は設計書ブロック ID ↔ コードの `file:line-range`。エージェントの返答に ID を含めさせ、**ID で設計書へ書き戻す** (m3e の `pickStrings` 「id が一致するものだけ採用」と同じ防御)。
- m3e は `onlyFrameId` でスコープを絞ったが固定費は残った (§3.4)。**スコープ縮小で固定費も同時に縮める**設計にする (R3)。

**R2. 既定値は書かず、スコープ内に存在する要素の分だけガイドを出す**
`buttonSize` の「既定なら黙る」、`kindsUsed` で style note を絞る方式を、設計書では「言語/FW/層/規約」に適用。1 つ目は「リポジトリの慣習 (測定済みのコードスタイル・ディレクトリ規約) と一致する点は書かない」。

**R3. 固定ガイダンスは 1 回だけ永続コンテキストへ。毎回のペイロードは差分のみ**
m3e の固定費は約 1.4K tokens/回 (50% がボイラープレート)。Next.js が `AGENTS.md` に **BEGIN/END マーカー付きの管理ブロックを冪等 upsert** し、バージョン一致ドキュメントを `node_modules` に同梱する手法 (`generate-agent-files.js`) をそのまま採用:
- `mitori init` が `AGENTS.md` / `CLAUDE.md` に `<!-- BEGIN:mitori -->…<!-- END:mitori -->` を書く (レビューファイルの場所、コメントの読み方、返答フォーマット、検証コマンド)。
- 固定部は prompt cache の先頭に置ける形で生成 (m3e は固定部が末尾で不利)。
- **token 予算テスト** (golden + 上限) を CI に入れ、UI にもコンテキスト token を常時表示 (m3e は両方無い)。

**R4. 受け渡しは「ファイル主、リンク副」**
- 主: リポジトリ内レビューファイル (`.mitori/review.json` 等) + 1 行の指示 (m3e の `askAiText` 流: 「まず {path} を読み、その手順どおりに…」)。エージェントが読み書きでき、往復する。
- 副 (ホスト共有): `#z=` + `CompressionStream("deflate-raw")` + base64url の fragment 方式。150 部品で 3.1K 文字、サーバ/ストレージ費用ゼロ (Cloudflare Pages で `mitori-` 接頭辞の静的ホスト)。**実用上限は 50〜65K 文字**なので超過時は R2 ストレージ/ファイルへフォールバック。
- 検証: m3e は "do not verify" と書いたが、そのしわ寄せが人間に来る。mitori は **`mitori check <file>` が構造化エラーを短く返す** (path/期待/実際、20 行以内)。エージェントが 1 回で直せる長さに制限。

**R5. 「AI の変更を採否するゲート」を標準 UX にする (Arrive → Keep / Undo / Save)**
- 適用前状態を永続 (`before`)、リロード後も Undo 可能。適用は 700ms 前後の色イーズ + フェードで「何が変わったか」を見せる。
- 作業中は **対象ブロックの縁に ThinkingRing 相当**の領域表示 (グローバルスピナーでなく、どこを触っているか)。reduced-motion で停止。
- 部品単位の AI 書き換えは直前値を保持し同じボタンで往復トグル、処理中ボタンは**幅を変えず**「Cancel」に反転。
- コード適用の場合は `before` = git の working tree 差分/コミット (commit 単位 undo) に対応付ける。

### P1 — 体験と非機能

**R6. Undo/履歴**: 参照共有スナップショット (cap 100)、同一キー 800ms 併合、ドラッグは最初の変化で 1 回、全置換は 1 ステップ、**「整える」系ボタンが自分自身の Undo になる**。マルチタブは Web Locks (`ifAvailable`) で 2 つ目を read-only 化。localStorage は全て try/catch。

**R7. ブート体験を最初から設計**: モジュール評価時にチャンク先読み、head の inline script で前回の UI 寸法/配色を CSS 変数へ→**骨格を静的 HTML に含める**、アイコン等は寸法をロード前に確保 (CLS 0)、重いデータ (1.29MB のアイコン一覧) は開いた時だけ fetch。目標値 (m3e 実測を基準に): **LCP < 0.5s (local) / < 1.2s (Fast 4G + 4x CPU)、CLS 0**、初期 JS gzip ≤ 400KB (m3e は 405KB)。**フォントは同梱** (m3e の render-blocking を回避)。

**R8. 編集コストは部品数に線形にしない**: m3e は 150 部品・6x CPU で nudge p50 46.6ms (15 部品は 16.9ms)。mitori は数百〜数千ブロックを想定し、目標を「**1,000 ブロックで入力→描画 ≤ 1 フレーム (16.7ms, 4x CPU でも ≤ 50ms)**」に置く。ブロック単位 memo、保存は idle/debounce+差分、ドラッグ中は保存しない。pan/zoom は m3e 同様 transform のみ。

**R9. i18n**: agent 向けテキストは**英語を正本** (o200k 近似で ja は +38%、Claude で再測定すること)、人間向け文書は ja/en。メッセージカタログ + parity/placeholder テスト (m3e の `i18n.parity.test.ts` は良い手本)。**プロンプト言語を UI 言語から分離**。4 言語手書きテンプレートの重複 (prompt.ts の約半分) は避ける。Noto Sans の遅延ロード+言語切替後の再計測パターンは有用。

**R10. キーボード/a11y を差別化軸に**: 設計書は文書 (セマンティック HTML) なのでブロックを全てフォーカス可能にでき、m3e が失敗している領域 (#454) で勝てる。m3e の単一文字キー運用 (V/H/P/+/-/0、Ctrl+Z/Y/D/C/V/G、Shift+矢印=粗い刻み) を踏襲しつつ、`c`=コメント、`j/k`=ブロック移動、`Enter`=スレッド展開を追加。入力中・モーダル表示中は無効化する方式とキャプチャ相での Esc 処理も踏襲。

**R11. モバイルは「読む・コメントする」を主役に**: m3e は編集縮退で、複数画面だと空白だらけになる。設計書はスマホで読まれる前提でレイアウトし、BottomSheet (spring 420/38/0.8、閉じ条件 offset>90 or velocity>600)、`--app-h`/safe-area/in-app WebView 補正を流用。

### P2 — 運用

**R12. 規約をテストで強制し、横断変更の手順書を AGENTS.md に**: CONTRIBUTING 型の「領域→ファイル表」「N 手順チェックリスト」を **AGENTS.md に載せる** (m3e は載せていない)。PR テンプレ=CI と同じコマンド列。Issue/PR を「1 issue = 1 idea」「小さな PR」で捌く方針をドキュメント化 (AI の大量 PR 対策)。

**R13. 空白地帯の確認**: m3e のメンテナは「コード→設計」「埋め込み」「AI 継続・バックアップ」を明確に却下 (#439/#55/#413)。mitori の `repo → 設計書 → 注釈 → AI がコード反映` はちょうどその空白。差別化として「読み込みは 1 回 + 差分更新」「ID で往復」「token 予算を UI に出す」を前面に。

---

## 9. 未解決の問い

1. **Claude 実トークナイザでの再測定**: 日本語プロンプトの +38% は o200k 近似。`count_tokens` API か Claude Code の実利用で、en/ja/zh/ko の比率を確認したい (mitori の「エージェント向けは英語正本」判断に直結)。
2. **固定ガイダンスの置き場の最適解**: AGENTS.md 管理ブロック (常時ロード) vs skill (必要時ロード) vs 毎回貼る。Claude Code/Codex 双方で「毎ターンのコスト」と「無視されにくさ」を実測する必要。
3. **fragment リンクの実用上限**: Slack/Discord/LINE/メールで何文字で切れるか。100KB の実設計書 JSON の deflate 後サイズ (m3e の生成データは 12x 圧縮だが実データは低い)。
4. **ドラッグ操作の実フレーム計測**: 今回は nudge と wheel で代替。ポインタ移動中の localStorage 全文書き込みコストの直接測定は未実施。
5. **無効ドキュメント到着時の実 UI**: コード上は汎用 toast のみ。実機での表示/ログは未確認。
6. **「設計書」の粒度**: m3e は部品単位でアンカーが自然に決まる。コードベースの設計書で「安定アンカー ID」を何にするか (見出し slug / シンボル / file:range のハッシュ) と、コード変更時の再アンカー戦略。
7. **IME 配慮**: m3e の単一文字ショートカットは `isComposing` を見ない (typing ガードのみ)。日本語 IME での意図しない発火が起きない設計の確認が必要。
8. **m3e の発展を継続ウォッチするか**: 作成から 31 日で 8.6K stars。Issue #443 (右パネル再設計)・#450 (プレビューのスクロール)・#447 (SVG export) の動向が、mitori の UX 方針に影響し得る。

---

## 付録 A. 出典・再現コマンド

- リポジトリ: https://github.com/lnkiai/m3e-canvas / 公開版: https://lnkiai.github.io/m3e-canvas/ / agent.md: https://lnkiai.github.io/m3e-canvas/agent.md
- GitHub API (2026-10-03): `gh api repos/lnkiai/m3e-canvas` → stars 8,566, forks 903, open issues 10, created 2026-09-02T04:36:34Z, pushed 2026-10-01T11:00:49Z, 174 commits (Link rel=last), contributors 10。
- Trendshift: https://trendshift.io/repositories/208608 (2026-09-04 #1 Repository Of The Day / #1 TypeScript、Week 36 #21)。
- 参照した Issues: #439 (code→UI 却下)、#440 (注釈要望)、#419/#413 (Edit this design / 継続・バックアップ却下、"single-shot on purpose")、#55 (埋め込み却下)、#454 (a11y)、#450 (プレビューのスクロール)、#443、#447。
- 主要ファイル行: `lib/prompt.ts` — buildPrompt 1745 / promptMarks 1721 / PROMPT_OPTION_TEXT 1686 / GENERAL 1426 / STYLE_NOTES 1148 / PH 1518 / layoutTree 873 / gridAt 979 / notes 781。`lib/share.ts` — shareable 12 / shareLink 46 / readShareHash 56。`lib/ai.ts` — complete 79 / context 163 / draftDesign 末尾。`app/Editor.tsx` — HISTORY_MAX 171 / snapshot 619 / locks ~686 / persistence ~880 / wheel 1130 / arrive 2589 / tidy 2824 / keyboard 3203。`public/agent.md` 169 行。
- 再現 (nix devShell): `cd /Users/satoki252595/work/20261002_aiAgentTool && nix develop --command bash -c "cd <scratchpad>/m3e-measure && bun run run.ts"` (プロンプト生成), `bun run tok.ts` (節別 token), `bun run scale.ts` (スケーリング), `bun run agenttok.ts`。ビルド: `<scratchpad>/m3e-build` で `npm ci && npx vitest run && npx tsc --noEmit -p . && npx next build`。

## 付録 B. mitori 向けチェックリスト (m3e から借りる UI ディテール)

- [ ] コピー/確定ボタンは幅固定でラベル↔チェックを `visibility` で切替 (幅が揺れない)
- [ ] AI 実行ボタンは処理中に同幅で Cancel に反転、領域に ThinkingRing
- [ ] 到着/適用は `before` 永続 + reveal アニメ + Keep/Undo/Save
- [ ] 「整える」ボタンは直後だけ自分の Undo になる (参照同一性で判定)
- [ ] 同一フィールド連続編集は 800ms で 1 undo に併合
- [ ] 2 つ目のタブは Web Locks で read-only + 再読み込みダイアログ
- [ ] 静的骨格 + 前回寸法/配色の inline script + チャンク先読み
- [ ] reduced-motion で全アニメ停止、Esc はダイアログが capture 相で先取り
- [ ] クリップボード/Storage は常に try/catch
- [ ] 目次 (outline) は**生成物でなくテキスト自体**から導出して手編集に強くする
- [ ] LLM に渡す文面は golden file でレビューし、token 上限テストを置く
