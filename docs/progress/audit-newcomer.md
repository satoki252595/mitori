# 初見者監査（newcomer lens）— m3e-canvas を mitori の画面だけで読む（2026-10-04）

m3e-canvas を一度も見たことのない人として、統合後の main のバイナリを開き、画面だけを使って 5 分で次の 5 つに答えられるかを試した。
「これは何か」「誰のためか」「なぜあるか」「どう動かすか」「コードをどこから読むか」。
あわせて、どこで迷ったか・退屈したか・誤解したか、読書パス・読者レベル・用語集・地図が役に立つか、日本語の文言と見た目の仕上がりも見た。

- 対象: `dist/mitori-darwin-arm64` を使った（09:23 ビルド。最後のコード統合 `90f75b9` は 09:19 なので最新）。スクラッチにコピーして使い、他の監査の再ビルドの影響を受けないようにした
- リポジトリ: `refs/m3e-canvas`（`de2d97a`）をスクラッチに `git clone` し、生成済みの `.mitori/` を `scratchpad/gen2/repos/m3e-after/.mitori` からコピーした。この `doc/` は `docs/progress/dogfood2/m3e-canvas/doc/` と同一（`diff -rq` で差分なし）。標準生成で、API 換算 $0.86
- 起動: `MITORI_HOME=<tmp> mitori <repo> --no-open` で出たログイン URL を開いた。ブラウザは Playwright で接続した Google Chrome 154（`--headless=new`、1440×900、一部 1280×800）。CDP で接続した 1 つのブラウザを使い続け、場面ごとに台本を流した
- **この監査の LLM 消費は $0**: ジョブは 1 件も送っていない（Composer は開いただけ）。`claude` CLI はログアウト状態（`claude auth status` → `loggedIn: false`）
- スクショ: `docs/progress/audit/newcomer/*.png`（ファイル名を本文中で示す）

---

## 1. 結論: 5 分テスト

| 問い | 答えられたか | どこで | 到達（クリック後の読書時間の目安） |
|---|---|---|---|
| これは何か | **はい** | §0 ひとことで。ただし**最初の画面には無い**（ホームは行数と、ディレクトリ名の地図だけ）。「読む」を押して 1 クリック | ≈ 0:30 |
| 誰のためか | **はい** | §1「利用者」（Claude Code・Codex・Gemini CLI・Cursor で画面を作る開発者と、AI エージェント） | ≈ 1:30 |
| なぜあるか | **はい** | §1「解決する課題」（画面の配置を文章だけで AI に伝えるのは難しい） | ≈ 1:30 |
| どう動かすか | **一部・誤誘導あり** | 手順は §1 の**「利用者」の箇条書きの中**にある（`npm install` → `npm run dev` → localhost:3000）。§4「動かしてみる」には表が 3 つあるだけで、install 手順が無い。表は `npm run dev` ではなく `next dev` を出し、「入口」を `start: npx serve out` と書く。Node の版の条件（`^22.12 \|\| ^24 \|\| >=26`）はどこにも無い | ≈ 2:00 |
| コードをどこから読むか | **答えられない** | §2 に「入口は `app/page.tsx` → `Editor`」とあるだけ（`Editor.tsx` は 4,300 行）。§2 の図は描画されず、地図は `lib (tokens, tidy)` のようなディレクトリ名。「この順に読む」という案内も、コード画面の目次も無い | 5 分では不可 |

5 分コース（§0→1→2→3、本文 ≈ 2,350 字）で最初の 3 問は確実に答えられる。§0 と §1 の文章は、README より短く、出典付きで、初見者に合っている。
落ちるのは「動かす」と「どこから読むか」で、原因は文章よりも**画面と静的節**にある。最初の画面は profile のスタブのために README も版条件も出さない（NC-02）。本体の Reader は図を描かない（NC-03）。地図は生成済みのモジュール名を使わない（NC-04）。§4・§7・§8 の静的節は空か、誤誘導する（NC-06・NC-10）。
最初のコメントを書こうとすると、打った文字が消える（NC-01）。コンセプトの後半「文書の一点にコメントすると AI がそこを直す・答える」の入口で、最初の印象を壊す。

---

## 2. 指摘（重大度順）

各指摘に、画面・ファイル・計測、失敗シナリオ、修正案を書いた。

### NC-01 [high] Composer を開いても入力欄にフォーカスが入らず、打った文字が消える（英字なら 1 文字ショートカットが発火する）

- **どこ**: `apps/web/src/composer/Composer.svelte:96`（`tick().then(() => ta.focus())`）、`apps/web/src/threads/Margin.svelte:181`・`:209`（`class:hidden={!p || p.hidden}` → `.slot.hidden { visibility: hidden }`）
- **根拠**: 語を選んで `E` を押しても、選択ツールバーの「説明して」をクリックしても、50 / 300 / 1000 / 2000 ms 後の `document.activeElement` は `DIV.blk` のままだった。`HTMLElement.prototype.focus` を計装すると、呼ばれるのは TEXTAREA への 1 回だけで、その時点で祖先の `.slot` に `hidden` クラスが付いて `visibility:hidden` になっていた。見えない要素への `focus()` は何もしない。その後「これは何をしている？」と打っても `why` と打っても、textarea の値は `""` だった（`23-composer-focus.png`・`25-typed-ascii-after-e.png`）
- **テストが見逃した理由**: `test/int/shots/live.ts:330` が Composer を開いた直後に `await ta.click()` しており、この不具合を隠している
- **失敗シナリオ**: 初見者が文を選び、`E` を押して質問を打つ。何も入らない。英字なら `y`（リンクをコピー）、`h`（解決済みを隠す）、`t`（目次へ）、`f`（別の Fix を開く）がその場で発火する。IME で日本語を打った場合は、フォーカスの無い div 上で変換されて捨てられる
- **修正案**: Margin が slot を「未配置 → 配置済み」に切り替えた後でフォーカスする。新しく開いた Composer の slot に限り、`placed` が入った最初のフレームで `ta.focus({preventScroll:true})` を呼ぶ。別案として、Composer 側で `requestAnimationFrame` を `ta.checkVisibility()` が真になるまで最大 10 回くり返す。配置前の状態を `visibility:hidden` ではなく `opacity:0; pointer-events:none` にすれば、そもそもフォーカスできる
- **回帰テスト**: e2e で「語を選ぶ → `e` → クリックせずに `keyboard.type("abc")` → textarea が `abc`」と、ツールバーをクリックする版を書く。`live.ts` からは `ta.click()` を外す

### NC-02 [high] 最初の画面が「これは何か」に答えない（`Indexer.profile()` がスタブで、hero に README の抜粋・版条件・ライセンスが出ない。生成済みの §0 も出ない）

- **どこ**: `packages/indexer/src/update/facade.ts:229-230`（`profile: () => null`、「CR m1-26 … null until then」）。`GET /ws/:ws` の応答に `profile` が無い（キーは `info, state, counts, doc, snapshot, scan, gen, trustPending, notices, rev, connectedTabs, genEngine`）。UI 側は受け取る準備ができている（`apps/web/src/map/MapPage.svelte:37`・`:93-101`・`:373` に README 抜粋の figure、`hero.ts:57` に toolchain の表示）
- **根拠**: `01-first-screen.png`。ホームに出るのは「m3e-canvas / TSX · 23.6k LOC · 108ファイル · de2d97a」、LOC のタイル 2 枚、「設計書を生成する／生成済み・出力 0.48M tok・$0.86／読む」のカード、ディレクトリ名の間取り図、「1 エントリポイント・0 HTTPルート・… 0 TODO」「S0・列挙 57 ms …」の計測タイルだけ（`02-first-screen-full.png`）。**目的を述べる文が 1 つも無い**
- **失敗シナリオ**: 同僚に「mitori で見て」と言われて開いた人が、最初に見るのは数字と `lib (tokens, tidy)` という箱。何の repo か分からないまま地図を眺めるか、閉じる
- **修正案**:
  1. `Indexer.profile()` を実装し、`WorkspaceStatus.profile` に載せる（0 tok）。remote・toolchain・LICENSE・LOC タイルに加えて、README の最初の散文段落を載せる。段落は HTML の `<p align>`、バッジ、画像だけの行を飛ばして選ぶ。toolchain は `package.json` の `engines.node`・`.nvmrc`・`go.mod`・`requires-python` から取る
  2. §0 が生成済みなら、hero のリードには README ではなく §0 の最初の散文ブロックを出す（出典チップ付き）。主ボタンは「5 分コースで読む」にする
  3. 生成済みのカード見出しを「設計書を生成する」から「設計書（生成済み）」に変える
  4. 計測タイル（S0〜S4 の ms、0 件のタイル）は「詳しい」レベルに回すか、折りたたむ

### NC-03 [high] 本体の Reader が図を描かない（§2「見取り図」と §3 の流れが、名前の箇条書きになる）

- **どこ**: `packages/doc/src/render/body.ts:93-115`。`mermaidFallback` がノード名だけの `ul.mdiagram-text` を作る。`apps/web` には `figure.mdiagram` を図に置き換える処理が無い（`dg-box` は CSS にしか出てこない）。描画に必要な route `GET /ws/:ws/diagrams/:dg` はすでにある（`packages/server/src/wiring/routes.ts:188`）。export は SVG を差し込む（`packages/doc/src/export/payload.ts:305`）
- **根拠**: `07b-reader-s2-floorplan-full.png` では、§2 の図の位置に「lib (tokens, tidy) / lib (prompt, i18n) / …」の 5 行が並ぶだけ。`12-course5-step3.png` では §3.1 の流れが「ユーザー / Editor / トークン」の 3 行になる。3 秒待っても、標準レベルに切り替えても同じだった。同じ文書の HTML export では §2 が SVG で描かれる（`44-export-s2.png`）
- **失敗シナリオ**: 5 分コースの 3 駅目、製品名と同じ題の §2「見取り図」に図が無い。§3 の「主要な流れ」は矢印を失い、関係の無い名前の列になる。共有用の export の方が、本体アプリより情報が多い
- **修正案**: Reader で `figure.mdiagram[data-diagram]` を IntersectionObserver で遅延描画する。`GET diagrams/:dg` でレイアウトを取り、`packages/doc/src/export/svg.ts` の描画を共有する。`ul` は視覚的に隠した代替テキストとして残す。回帰テストでは、生成済み fixture の §2 に `figure.mdiagram svg` があることを e2e で確かめる

### NC-04 [high] 間取り図と §2 の部屋名がディレクトリ由来で、生成済みのモジュール名・要約と食い違う。結び付きは全結合で情報が無い

- **どこ**: `GET /ws/:ws/map` の `modules[].name` は S3 の名前（`lib (tokens, tidy)`）、`summary` は `6 files · Lang, UIKey, …`。一方、`.mitori/doc.index.json` の `modules[]` には生成済みの `name`（`文書モデルとトークン`）と `summary`（`部品型・寸法・配色・整列を定義する基盤層`）がある。`mapView`（`packages/server/src/wiring/views.ts:238`）はこれを使っていない。§2 の mermaid も S3 の名前
- **根拠**:
  - §5・§6 は「編集パネル UI／エディタ本体と共有／M3 パーツ描画層／プロンプト生成と多言語／文書モデルとトークン」と書くのに、地図と §2 は「components (ui, PartPanel)／app／components (M3Node, Mobile)／lib (prompt, i18n)／lib (tokens, tidy)」と書く
  - 部屋をクリックした popover は役割ではなく export 名を出す（「PromptOption · PROMPT_OPTIONS · DEFAULT_PROMPT_OPTIONS」）。同じ情報の hover tooltip と同時に重なって出る（`13c-map-click.png`）
  - 「文脈」ズームはラベルの無い空の矩形が 5 つ（`40-map-context.png`）
  - 結び付きは 5 部屋で 15 本、有向の組 20 通りのうち 15 通り。export では矢じりが 10 px の隙間に積み重なり、線が見えない（`44-export-s2.png`）
- **失敗シナリオ**: 地図で「プロンプト生成はどこ？」と探す初見者に、名前が手がかりにならない。`lib (tokens, tidy)` が `components/Preview.tsx` を、`app` が `lib/share.ts` を含むなど、ディレクトリ名と中身もずれる。§5・§6 と地図の対応も取れない
- **修正案**:
  - `mapView` は、生成済みなら `DocModuleEntry.name` と `summary` を上書きして返す（ディレクトリ名は副題に回す）。§2 の mermaid のラベルも生成名にする
  - popover は要約と「§6.x を読む」を出し、hover tooltip とは排他にする
  - 結び付きは import 数で重みを付け、上位（目安は部屋数 × 1.5 本）だけを既定で表示する。全部は「すべての結び付き」で出す
  - 「文脈」ズームには、§0 の一文で建物にラベルを付け、§1・§8 から分かる外部の登場人物（ブラウザの localStorage、利用者のキーで呼ぶ AI 各社、GitHub Pages）を置く。分からなければ「文脈」を隠す
  - 「区画0」のように 0 の数は出さない

### NC-05 [high] モジュール頁の「この章で分かること」で、inline code と用語が 1 文字ずつ縦に崩れる（アプリと export の両方）

- **どこ**: `apps/web/src/shell/styles/prose.css:530-537`。`.blk[data-kind="learn"] li { display: grid; grid-template-columns: 22px minmax(0, 1fr) }` のせいで、`li` の中の inline 子要素（文字列、`code`、`abbr`）が 1 つずつ grid item になる。`code` が 22 px の列に入ると、1 文字ずつ折り返す
- **根拠**: `37-module-standard.png`（アプリ）と `45-export-module.png`（export）。「Item」の `code` は `display:block`・幅 22 px・高さ 52 px だった。§6.4 では用語「共有リンク」が単独の行になる
- **失敗シナリオ**: 5 つのモジュール頁すべてで、最初に目に入る囲みが壊れて見える
- **修正案**: `li { display:block; position:relative; padding-left:22px }` に変え、`li::before { position:absolute; left:0 }` で番号を置く（またはレンダラが中身を 1 つの `span` で包む）。回帰テストでは、inline code と用語を含む learn ブロックで、各 `code` の高さが 1 行以下であることを確かめる

### NC-06 [high] 「どう動かすか」で誤誘導する（Node の版条件が無い／§4 に install 手順が無い／`next dev` と書く／「入口」が `npx serve out`）

- **どこ**: `06-reader-s4-quickstart.png`、`docs/progress/dogfood2/m3e-canvas/doc/04-quickstart.md`、§5 の「`package.json`（start）」。版条件の契約 `RepoProfile.toolchain`（`packages/core/src/domain.ts:653-657`、`engines.node` を含む）はあるが、NC-02 のスタブで使われていない。理解テストの q01（Node の版と PR 前のコマンド）は 0.5 点
- **根拠**: §4 は見出しの無い表が 3 つ（「用途・名前・コマンド・定義・状態」「名前・既定値・読む場所」「入口・種類・場所・状態」）だけ。「状態」列は全行「未実行」で、読者には意味が無い。「既定値 あり」は値を示さない。実行手順は §1「利用者」の 3 つめの箇条書きにある
- **失敗シナリオ**: 「動かしてみる」を開いた初見者が、表の `next dev` をそのまま打つ（グローバルの next が無ければ失敗する）。「入口」の `npx serve out` を起動方法と取り違える（ビルド前には `out/` が無い）。条件を満たさない Node（例: 20）で始めてしまう
- **修正案**: §4 の先頭に、0 tok で組み立てた「手順」ブロックを置く。
  1. 必要な版（`engines.node`、`.nvmrc` など）
  2. lockfile から決めた install コマンド（`package-lock.json` なら `npm install`）
  3. パッケージマネージャ付きの起動コマンド（`npm run dev`）
  4. README・CONTRIBUTING にある `localhost:\d+`

  その後に表を見出し付きで並べる（「スクリプト」「環境変数」「入口」）。「状態」列は実行記録がある時だけ出す。入口は Next.js の app router なら `app/page.tsx` とし、`start` スクリプトにしない。§1 の「5 分で試すには」は §4 へのリンクにする

### NC-07 [high] 「コードをどこから読むか」に答える場所が無い

- **どこ**: §2「入口は `app/page.tsx`…`Editor` を動的に読み込む」（後半は推測）。`app/Editor.tsx` は 4,300 行あるが、コード画面には目次もファイル要約も無い（`36b-code-editor.png`。右欄は「この範囲を説明している節」だけ）。§6 の表の「重要度 1.00 / 0.59 …」には説明が無く、「パス」列は `lib-tokens` などのスラッグでパスではない。理解テストは q02 が 0.5、q04 が 0.5、q05（新しい部品を足すときに触るファイル）が 0 点
- **失敗シナリオ**: 5 分コースを終えた初見者が「で、どのファイルを開けばいい？」と迷う。`Editor.tsx` を開くと、import が 60 行続く
- **修正案**:
  - §2 の末尾（または §5）に、0 tok の「読む順番」ブロックを置く。次の 4 つを、それぞれの主要シンボルと行範囲付きで並べる。材料は `/map` の `rank` と `topoOrder`、S2 の entrypoints、フレームワークの規約
    1. 入口: `app/page.tsx`
    2. 基盤モジュールの型定義: `lib/tokens.ts` の `Doc`・`Frame`・`Group`・`Item`
    3. ハブ: `Editor.tsx` の `Editor`（L453）
    4. 機能の芯: `lib/prompt.ts` の `buildPrompt`（L1745）
  - コード画面では、300 行を超えるファイルの右欄にシンボルの目次を出す（indexer にシンボルはある）
  - 横断的な「変更の手引き」を作る（HANDOFF §0.3-6 にある残りと同じもの）

### NC-08 [medium] 読者レベル「初めて」がほぼ見た目だけ（出典チップを畳むだけ）。初回の既定も「標準」と「30 分コース」

- **根拠**: 表示される文字数は「初めて／標準／詳しい」の順に、§0 で 354 / 391 / 394、§10 で 747 / 841 / 890、§6.1 で 1,058 / 1,522 / 1,698。「初めて」の §0 にも「読んだファイル 87 · 除外 21／除外の内訳: binary 16 · data_large 1 · deny_glob 2 · fixture 1 · lockfile 1」が出る（`04-reader-s0-beginner.png`）。§5 の除外理由の表も同じ英語の列挙値。初めて開いた workspace でも、既定は「標準」と「30 分コース」
- **修正案**: mitori 自身のメタ（網羅率と除外の内訳）を depth L3 にして「初めて」では隠し、付録に寄せる。除外理由は和名にする（バイナリ・大きなデータ・除外パターン・テスト用データ・ロックファイル）。workspace を初めて開いた時は「初めて」と「5 分コース」を既定にする（または一度だけ尋ねる）。「初めて」では、ブロックごとの「やさしく」（cache 済みでなければ見積り付き）を出す

### NC-09 [medium] 本文の全文検索が無い（「/ 本文を検索」は節の題名だけ）。⌘K は自然な質問に 0 件で、空のときは何も出さず、AI に聞く導線も無い

- **どこ**: `apps/web/src/palette/search.ts:182`（`scope === "doc"` なら `e.group === "section"` だけを残す）。`/` で打ってもネットワーク要求は 0 件。server の `GET /ws/:ws/search` には文書本文の種類が無い（`file,symbol,module,fact`）。それなのに、0 件のときの文言は「見つかりません — 本文を全文検索（/）」で、`/` のモードの中でも同じ文言が出る
- **根拠**: §0・§1 に書いてある「バックエンド」「npm」「localhost」を「/」で引くと 0 件（`46-fulltext-npm.png`）。⌘K の「どこから読む」「起動方法」も 0 件（`15-cmdk-where-to-start.png`）。⌘K で「npm」を引くと、`SNAP_MAIN`・`DURATION_PER_SHAPE_MS` が部分列一致で出る。⌘K を空で開くと「0件」としか出ない
- **修正案**:
  - ブロック本文を client で索引する（文書は数百 KB 以下）。または server の FTS に `doc` の種類を足す。ヒットは節の名前付きで出す
  - 連続して一致した文字が 3 文字未満なら、部分列一致のシンボルを出さない
  - 空のときは「§0 ひとことで／5 分コース／動かしてみる」を候補に出す
  - 0 件のときは「この質問を AI に聞く（≈1.2k tok · $0.007）」を出し、§0 に固定した Explain の Composer を開く（コンセプトの「AI がレビューに答える」への導線）

### NC-10 [medium] 「データモデル」と「外部インターフェース」が「検出されませんでした」で、内容と食い違う

- **根拠**: §7 は「スキーマ（テーブル・モデル）は検出されませんでした。」だけ（`31-reader-s7.png`）。§8 は見出しの無い「（検出されませんでした）」が 2 行と、環境変数の表（§4 と重複）だけ（`31-reader-s8.png`）。実際には次のものがある。用語集は `Doc`・`Frame`・`Group`・`Item`・`Palette` を説明しており、§1 は共有リンクや 4 社の AI プロバイダに触れている
  - 中核の型: `Doc` → `Frame` → `Group` → `Item`
  - 外部とのやり取り: 共有リンク（URL ハッシュの `doc`・`docz`）、プロジェクト JSON の入出力、エージェント向け仕様 `public/agent.md`、4 社の AI API の直接呼び出し

  §11 も、見出しの無い「（検出されませんでした）」で終わる
- **失敗シナリオ**: 初見者が「データモデルも外部とのやり取りも無いアプリ」と誤解する
- **修正案**:
  - S2 の静的事実を足す。TS なら、rank 1 のモジュールで fan-in の多い export 型を集めて、§7 に「主要な型」の表として出す。§8 には、外向き `fetch` のホスト、URL ハッシュのパラメータ、ファイルの入出力、`public/*.md` の仕様を出す
  - 空のときは、何を探したかを書く（「HTTP ルート: なし · CLI: なし」）か、ブロックごと隠す
  - gen.overview に、§7 と §8 をモジュール要約から埋めさせてもよい

### NC-11 [medium] 生成カードの「出力 0.48M tok」が誤り（実際の出力は 27k。0.48M は cache 込みの合計）

- **どこ**: `apps/web/i18n/map.ja.json` の `"map.generated": "生成済み · 出力{tok} tok · {usd}"`。`apps/web/src/map/MapPage.svelte:407` が `in + cacheRead + cacheWrite + out` を渡している。`mitori.json` の `usageTotals` は out 27,046、cacheRead 270,773、cacheWrite 182,326
- **失敗シナリオ**: トークンに敏感な利用者が「生成で 50 万トークンを書いた」と受け取る。正直なトークン会計というコンセプトの柱に反する
- **修正案**: 文言を「合計{tok} tok（出力 {out}）」にするか、`totals.out` を渡す。文字列の単体テストを足す

### NC-12 [medium] 用語がぶつかる（見取り図・間取り図・フロアプラン・区画・部屋・文脈）

- **根拠**:
  - 「見取り図」が 3 か所で別のものを指す: ヘッダーのロゴ、タブ（ホーム）、§2 の題
  - ホームの図の見出しは「間取り図」
  - 生成文は「フロアプランは 5 つのモジュールで構成される」と書く
  - 目次の「見取り図」をクリックするつもりで `nav a` を「見取り図」で探すと、ヘッダーのタブに当たってホームへ戻った（自動台本で再現）
  - 地図の「区画0 · 部屋5」は、0 の数が出るうえ、区画・部屋の説明も無い
- **修正案**: 1 つの概念には 1 つの語を使う。製品は「見取り図（mitori）」、図と §2 の題は「間取り図」にそろえる。gen.overview のプロンプトには「フロアプラン」ではなく「間取り図」を使わせる。0 の数は出さない。初回だけ「部屋 = まとまったコードの単位、区画 = 部屋の集まり」の 1 行を出す

### NC-13 [medium] 中核の使い方（文を選ぶ → 質問／修正 → AI が答える・直す）がどこにも説明されていない。エンジン未ログインでも Composer は警告しない

- **根拠**:
  - 「?」は約 70 項目のキーボードショートカット一覧だけ（`19-help.png`）
  - 質問や修正の入口は、ブロックに hover すると左に出る 3 つの小さなアイコンと、文を選んだ時のツールバーだけ（`20b-selection-toolbar.png`）
  - ステータスバーには「claude-cli · 未ログイン」が出ていた（再読込の直後に確認。後で「エンジン —」に変わるなど、表示は安定しない）。そのときでも Composer は「送信先: Anthropic（あなたの claude-cli 経由）… ⚡ その場で実行 · claude-cli ［送信］」と、送れる前提で表示した
  - 送信はしていない（$0 の制約）ので、送ったときの失敗表示は未確認
- **修正案**:
  - ヘルプの先頭に「この画面でできること」を 3 手順で書き、費用の目安（1 回 ≈ $0.01）とエンジンの状態を添える
  - 初めて開いた時だけ、§0 の下に「文を選ぶと AI に質問・修正を頼めます」の 1 行を出す
  - エンジンが未ログイン・未検出なら、Composer の送信ボタンの横に「claude にログインしてください（`claude /login`）」を出し、⌘⏎ を「下書きとして保存」に切り替える

### NC-14 [low] 英語表示の崩れと翻訳導線の欠如

- **根拠**: EN ではヘッダーの「de2d97a」と「Floor plan」が重なる（`28-en-s0.png`）。未翻訳のまま残るものがある: 読書パスの名前（「5 分コース」「レビュアー向け」）、地図の「8ファイル」、目次の節名。本文は「This section is shown in its original language」と出るだけで、翻訳の導線が無い
- **修正案**: プロジェクト名のチップに `min-width` と省略表示を入れる。既定の読書パス名と地図の件数を i18n キーにする。06b の翻訳を使えるなら「この節を英語にする（≈k tok）」を出す

### NC-15 [low] 読書パスの表示が噛み合わない

- **根拠**: 「30 分コース 0 / 8」で始めたのに「残り約 11 分」と出る。5 分コースは 1 / 4 まで進んでも「残り約 5 分」のまま。完了すると「4 / 4 · 残り約 1 分 · 次 —」と出る（`12-course5-step3.png`）。spec（`docs/design/specs/ux.md` §7.2）が求める完了の 1 行（「…を読み終えました · 次: レビュアー向け」）は出ない。停車駅の一覧も見えない
- **修正案**: 名前を所要時間の実測（`readingSec` の合計）に合わせる（「約 11 分コース」）か、30 分になるまで駅を足す。完了したら残り時間を消し、spec どおりの次の提案を出す。カードを開くと駅の一覧が見えるようにする

### NC-16 [low] 読み込み中のスケルトンが「未生成 · 0 tok」「生成すると使えます」と表示する（生成済みなのに）

- **根拠**: `31-reader-s13.png`（§12 を開いた時も同じ表示だった）。長く使ったタブで `page.goto` によって全体を読み直したとき、スケルトンが 1.8 / 4.1 / 10 秒以上続いた。新しいタブで直接開くと、最初のブロックまで 164〜185 ms で、再現しなかった（原因は特定していない。自動台本の側の可能性もある）
- **修正案**: `WorkspaceStatus` が届くまで、rail は中立の表示（「—」）にする。`rail.notGenerated` と `rail.pathAfterGen` は、`status.gen` が未生成を示す時だけ使う

### NC-17 [low] ポップオーバーが重なる

- **根拠**: 用語カードの上に出典の peek が重なり、Escape でも用語カードが閉じない（`14c-cite-click.png`）。推測ポップオーバーが Composer と同時に開く（`39-fix-no-cite.png`）。地図のクリック popover と hover tooltip が同じ内容で 2 枚出る（`13c-map-click.png`）
- **修正案**: popover を 1 層にする（`layers` store に登録し、新しいものを開いたら古いものを閉じる。Escape は一番上を閉じる）

### NC-18 [low] 和文と内部語の仕上げ

- ホームの統計タイルが語の途中で改行する: 「エントリポ／イント」「HTTPルー／ト」「CLIコマン／ド」「TODO・／FIXME」（`02-first-screen-full.png`）。タイル幅を広げるか、`word-break: keep-all` にする
- 桁区切りが無い（§0「tsx 17191行 · typescript 6066行」。ホームは「17.2k」で表記もそろっていない）。言語名は「TSX / TypeScript」と書く
- 内部語がそのまま出ている: 「C=3」「.mitori/ · commitはopt-in」「正確（シンボル索引）」「最新」「重要度 0.59」
- 用語カードに意味の無い情報が出る: ローマ字「puronputo」、英語の識別子のよみ（Item →「あいてむ」、KIND_SPEC →「きんどすぺっく」）。ローマ字は検索用なので表示はしない。英語の識別子には、よみの代わりに定義のある場所（`lib/tokens.ts:…`）を出す
- §10 で、5 件の決定の直後に「まだ決定はありません。…」が普通の箇条書きとして出る（`41b-s10-decisions-end.png`）。人の決定が 0 件で、AI の決定がある時は出さない
- daemon の初回起動で、`integration file(s) are missing` が英語で 5 行出る。読むだけの人には雑音なので、「ヒント: `mitori install` で Claude Code / Codex 連携を入れられます」の 1 行にする

### NC-19 [low] 静的と生成のラベルが矛盾する

- **根拠**: §4・§5・§7・§8（「□ 静的 · 0 tok」）の頁ヘッダーに `claude-opus-5-5` が出る。§6（モジュール詳細）と §12（用語集）は AI が書いた本文なのに、目次では「静的（0 tok）」になる。§6 の頁ヘッダーには「確認済15 · 推測7 · □ 静的 · 0 tok · claude-opus-5-5」が並ぶ
- **修正案**: モデルのチップは生成ブロックがある節にだけ出す。目次の状態は、ブロックの出自（静的か生成か）を集計して決める

### NC-20 [low] 「未解決の問い」に、mitori 自身への問いと、コードを読めば答えが出る問いが混ざる

- **根拠**: §13 に、mitori 自身のクラスタリングへの問い（「components 配下の一部ファイルがこのモジュールに含まれているのは意図的か」）がある。コードから答えが出る問い（「`NEXT_PUBLIC_BASE_PATH` が未設定のときの既定値は何か」— `Editor.tsx:140` を読めば分かる）もある。ほぼ同じ「循環 import は意図的か」が 2 問続く
- **修正案**: gen.questions のプロンプトで、モジュールの所属に関する問いを除き、引用行から答えられる問いを除き（安い grep で確かめる）、重複をまとめる

### NC-21 [low] 「設計判断」が細部に寄り、構造上の判断が抜けている

- **根拠**: §10 の 5 件は、ボタン寸法の補間、カルーセルのキーライン、FAB の実行時状態、日付ピッカー、Next.js の同梱ドキュメントを読む運用。この repo を形づくる判断が出てこない: 静的サイトでバックエンドを持たない、localStorage だけに保存する、利用者自身の API キーでブラウザからプロバイダを直接呼ぶ、URL ハッシュで共有する、4 言語をそろえる。一部は §1 の「制約」にあるが、判断として理由が書かれていない
- **修正案**: gen.decisions に、§1 の制約と SECURITY.md・CONTRIBUTING.md から構造上の判断を優先させ、細部の判断はモジュールごとに 1 件までにさせる

---

## 3. 良かった点（このまま守る）

- **§0 と §1 の文章**: 1 文目で「何をするツールか」が分かり、§1 は課題・利用者・範囲・制約を出典付きで短く書いている。README（英日中韓の 4 言語版、約 30 KB）より速く、初見者に合う
- **出典の peek**: クリックで該当の行がハイライトされた抜粋が出て、そこから「横に固定（o）」「エディタで開く（⇧O）」に進める。専門家が確かめる導線として良い
- **用語カード**: 説明・使用箇所の数・「用語集で開く →」がそろっている（`14b-term-click.png`）
- **`@` なしの Fix**: 出典の無い文で「修正」を選ぶと「どのコードを直しますか？選ぶまで AI には送りません」と候補 4 つ（名前一致・検索一致、⌥1–4）が出る。分かりやすく、誤送信も無い（`39-fix-no-cite.png`）
- **Composer の送信先の明示**: 「選んだ範囲と依頼文だけ · 秘密情報は伏せ字」と出る
- **速さ**: 最初の描画は 20 ms。shell 13 ms、facts・目次・地図 33〜34 ms、再読込から h1 まで 41 ms。アプリ内の節の移動は 14〜67 ms。⌘K は 0.1 ms
- **daemon の起動**: m3e-canvas の S0〜S4 と静的文書で 438 ms
- **HTML export**: `mitori export --html` が 0.20 s で 1,079 KB を出す（抜粋 140 箇所、37 ファイル）。開くと §0 から始まり、§2 の図も描かれる。初見者に渡す形としては、本体アプリより良い
- **ダークモード**: 色調が一貫している（`29b-home-1280-dark.png`）

## 4. 計測（この監査、Apple M5 Max、ロードアベレージ 9.5〜11）

| 項目 | 値 |
|---|---|
| daemon 起動（S0〜S4 + 静的文書、m3e-canvas 108 files） | 438 ms（stderr の表示） |
| 最初の画面 | `mitori:shell:painted` 13 ms、FCP 20 ms、`facts/toc/map:painted` 33〜34 ms |
| 新しいタブで節を直接開く → 最初のブロック | 164〜185 ms（§6・§9・§10・§12・§13） |
| アプリ内の目次クリック → h1 | 14〜67 ms |
| 同じタブで `page.goto` による全体の読み直し | 1.8 s〜10 s 超のスケルトンを観測（NC-16。新しいタブでは再現せず） |
| `GET /api/v1/engines` | 1.2 s（非同期。描画は待たない） |
| ⌘K / 本文検索 | 0〜0.1 ms（本文はヒット 0 件。NC-09） |
| HTML export | 0.20 s、1,079 KB |
| 読者レベルごとの表示文字数（§0 / §10 / §6.1） | 初めて 354 / 747 / 1,058 · 標準 391 / 841 / 1,522 · 詳しい 394 / 890 / 1,698 |
| 5 分コースの本文（§0〜§3） | ≈ 2,350 字（引用と図を除く） |

## 5. 再現手順

```bash
S=<scratchpad>; A=$S/audit-newcomer
cp dist/mitori-darwin-arm64 $A/mitori
git clone $S/refs/m3e-canvas $A/m3e-canvas && cp -R $S/gen2/repos/m3e-after/.mitori $A/m3e-canvas/.mitori
MITORI_HOME=$A/home $A/mitori $A/m3e-canvas --no-open          # stderr の login URL を開く
"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" --remote-debugging-port=9333 \
  --user-data-dir=$A/chrome-profile --headless=new --window-size=1440,900
# playwright-core の chromium.connectOverCDP("http://127.0.0.1:9333") で場面ごとに台本を流した
```

NC-01 の確認（クリックせずに打つ）:

```js
await page.locator(".mb code", { hasText: "paletteOf" }).first().dblclick();
await page.keyboard.press("e");
await page.waitForTimeout(800);
await page.keyboard.type("why");
// → textarea の値は ""、activeElement は DIV.blk
```

## 6. スクショ（`docs/progress/audit/newcomer/`）

| ファイル | 内容 |
|---|---|
| `01-first-screen.png`, `02-first-screen-full.png` | ホーム（目的の文が無い、統計タイルの改行、計測タイル） |
| `03-reader-s0.png`, `04-reader-s0-beginner.png` | §0（標準 / 初めて。除外の内訳が残る） |
| `05-reader-s1-beginner.png` | §1（良い例） |
| `06-reader-s4-quickstart.png` | §4（見出しの無い表、`next dev`、「入口 start」） |
| `07b-reader-s2-floorplan-full.png`, `09-reader-s3.png`, `12-course5-step3.png` | 図が箇条書きになる（§2・§3）、読書パス完了時の表示 |
| `09-reader-s5.png`, `10-reader-s12.png` | §5（「（ルート）」と除外理由の英語）、用語集 |
| `11-course-5min.png` | 5 分コースの選択 |
| `13c-map-click.png`, `40-map-context.png` | 地図の popover の重なりとディレクトリ名、「文脈」ズームが空 |
| `14b-term-click.png`, `14c-cite-click.png` | 用語カード、peek との重なり |
| `15-cmdk-where-to-start.png`, `46-fulltext-npm.png` | ⌘K と本文検索の 0 件 |
| `19-help.png`, `20b-selection-toolbar.png` | ヘルプ（ショートカットだけ）、選択ツールバー |
| `23-composer-focus.png`, `25-typed-ascii-after-e.png` | NC-01（打った文字が消える） |
| `28-en-s0.png`, `29b-home-1280-dark.png` | EN のヘッダーの重なり、ダーク |
| `31-reader-s7.png`, `31-reader-s8.png`, `31-reader-s13.png` | 「検出されませんでした」、スケルトンの「未生成」 |
| `36b-code-editor.png` | 4,300 行のファイルに目次が無い |
| `37-module-standard.png`, `45-export-module.png` | NC-05（縦書き崩れ。アプリと export） |
| `39-fix-no-cite.png` | `@` なしの Fix の候補（良い例）と popover の重なり |
| `41b-s10-decisions-end.png` | 「まだ決定はありません」の矛盾 |
| `44-export-s2.png` | export では §2 の図が描かれる（矢印は潰れている） |
