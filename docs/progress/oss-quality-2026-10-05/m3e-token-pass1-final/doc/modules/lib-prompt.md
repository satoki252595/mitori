# プロンプトと多言語化 <!-- b_0ybdwr0v -->

- ファイル 6 · 3782 行 · 重要度 0.60
<!-- b_9wqk8j7k -->

**変更の手引き**
- 影響が及ぶ先（このモジュールを使う）: [編集画面と保存共有](app.md)・[部品編集パネル群](components-ui.md)・[部品描画とモバイル編集](components-m3node.md)・[部品定義と整形基盤](lib-tokens.md)
- 使っているもの: [部品定義と整形基盤](lib-tokens.md)・[部品描画とモバイル編集](components-m3node.md)・[部品編集パネル群](components-ui.md)・[編集画面と保存共有](app.md)
- テスト: `lib/ai.test.ts`（14 件）・`lib/i18n.parity.test.ts`（9 件）・`lib/i18n.test.ts`（2 件）・`lib/prompt.test.ts`（2 件） ほか 1 · 実行: `npm test`
- 入口から: `GET / → lib/prompt.ts`（`app/page.tsx:37`）
- よく使われる宣言（変えると波及する）: `t` `lib/i18n.ts:574`（25 ファイル）・`useLang` `lib/i18n.ts:23`（23 ファイル）・`Lang` `lib/i18n.ts:5`（11 ファイル）・`KIND_TEXT` `lib/i18n.ts:578`（7 ファイル）・`getLang` `lib/i18n.ts:17`（3 ファイル）
- 一緒に変わりやすいファイル（直近 79 commit）: `components/Inspector.tsx` 29 回・`lib/tokens.ts` 26 回・`components/M3Node.tsx` 22 回・`app/Editor.tsx` 15 回・`components/Preview.tsx` 14 回
- 注意: ハブ（多くから使われ、多くを使う）・大きいファイル `lib/prompt.ts`（1,864 行）・循環依存（[編集画面と保存共有](app.md)・[部品編集パネル群](components-ui.md)・[部品定義と整形基盤](lib-tokens.md) ほか 1 と）
<!-- b_rs7tb65y -->

**大きなファイルの中身（1,500 行を超えるファイル）**
- `lib/prompt.ts`（1,864 行）
  - `lib/prompt.ts:59-64` 定数・変数: `VARIANT_TEXT`
  - `lib/prompt.ts:66-178` 関数（14）: `hasText`・`cardImage`・`cardText`・`cardLook`
  - `lib/prompt.ts:180-677` single parts — 関数 14・定数・変数 3: `buttonSize`・`iconButtonSize`・`topBarSizeText`・`carouselCardsText`
  - `lib/prompt.ts:678-733` connected runs — 関数 2: `groupText`・`groupName`
  - `lib/prompt.ts:734-860` behavior notes — 関数 4: `actionText`・`slotName`・`notes`・`swipeNotes`
  - `lib/prompt.ts:861-1098` layout: rows and layers — 関数 11・定数・変数 4・型 3: `Rect`・`LNode`・`area`・`contains`
  - `lib/prompt.ts:1099-1143` color palette — 関数 1: `paletteLines`
  - `lib/prompt.ts:1144-1352` per-component style notes — 定数・変数 1: `STYLE_NOTES`
  - `lib/prompt.ts:1353-1500` theme: shape, type, motion — 定数・変数 4・関数 1: `FONT_NOTE`・`THEME_NOTES`・`themeLines`・`GENERAL`
  - `lib/prompt.ts:1501-1865` fixed phrases — 関数 7・定数・変数 4・型 3: `Viewport`・`viewportOf`・`sizeLabel`・`PH`
<!-- b_0hvvwgvh -->

> [!NOTE]
> **この章で分かること**
> - この層が作るプロンプトの入力と出力の形が分かる。
> - 4 言語の文言を束ねる仕組みが分かる。
> - AI 補助の設定と呼び出しの流れが分かる。 <!-- b_p4b29v2s -->

## 責務 <!-- b_rj775rtx -->

`buildPrompt` が `Doc` から LLM 向けのプロンプトを組み立てる中核である（[prompt.ts:1745-1746](../../../lib/prompt.ts#L1745-L1746)）。`LANGS` と `t` が 4 言語の文言を束ね、`complete` が外部モデルへの問い合わせを受け持つ（[i18n.ts:6](../../../lib/i18n.ts#L6)、[i18n.ts:574](../../../lib/i18n.ts#L574)、[ai.ts:79](../../../lib/ai.ts#L79)）。部品の描画や寸法・色トークンの定義は担わず、他モジュールの `M3Node` や `Palette` に任せる（推測）。 <!-- b_m4zpfzq5 -->

## 公開インターフェース <!-- b_b4dzj2gq -->

- `buildPrompt` は `Doc` と幅と言語からプロンプト全文を作り、呼び出し元がコピーに使う（[prompt.ts:1745-1746](../../../lib/prompt.ts#L1745-L1746)）。
- `promptMarks` はプロンプトから見出し位置を抜き出し、アウトライン移動に使う（[prompt.ts:1721](../../../lib/prompt.ts#L1721)）。
- `effectivePrompt` は `promptEdit` があれば優先し、なければ `buildPrompt` に戻す（[prompt.ts:1864](../../../lib/prompt.ts#L1864)）。
- `t` は `UIKey` と言語から UI 文言を 1 件返す（[i18n.ts:574](../../../lib/i18n.ts#L574)）。
- `complete` は `AiSettings` と `system` と `user` でモデルに問う（[ai.ts:79](../../../lib/ai.ts#L79)）。
- `proposeBehavior` と `proposeDescription` と `draftDesign` は振る舞い文と説明文と設計案の下書きを作る（[ai.ts:187](../../../lib/ai.ts#L187)、[ai.ts:207](../../../lib/ai.ts#L207)、[ai.ts:242](../../../lib/ai.ts#L242)）。
- `PromptPanel` はプロンプトの表示と編集とコピーを受け持つ（[PromptPanel.tsx:305-312](../../../components/PromptPanel.tsx#L305-L312)）。
- `AiPanel` と `LayersPanel` は AI 設定と層一覧の UI である（[AiPanel.tsx:164](../../../components/AiPanel.tsx#L164)、[Layers.tsx:194-201](../../../components/Layers.tsx#L194-L201)）。 <!-- b_sgpycc9w -->

## 依存関係 <!-- b_yhsktcdm -->

寸法や色の土台は lib の `ColorPanel` と `Preview` と `HandleSide` に頼る（推測）。描画は components の `CardStage` と `LoadingIndicator` と `wavePath`、汎用部品は同じく components の `ButtonInspector` と `FrameInspector` と `IconPicker` を使う（推測）。app の `Editor` を筆頭に各モジュールが文言や生成を使う側に回る（推測）。 <!-- b_nk64d0jh -->

## データ構造 <!-- b_h9wq3cnr -->

- `Lang` は `ja` と `en` と `zh` と `ko` の 4 値である（[i18n.ts:5](../../../lib/i18n.ts#L5)）。
- `AiSettings` は `provider` と `baseUrl` と `model` と `key` を持つ（[ai.ts:13-16](../../../lib/ai.ts#L13-L16)、[ai.ts:58](../../../lib/ai.ts#L58)）。
- `Provider` は `claude` と `openai` と `gemini` と `deepseek` である（[ai.ts:11](../../../lib/ai.ts#L11)）。
- `PromptOption` は成果物や試験等の付加行の選択肢である（[prompt.ts:1681-1683](../../../lib/prompt.ts#L1681-L1683)）。
- `PromptMark` は `kind` と `label` と `line` と `frameId` で見出し位置を示す（[prompt.ts:1720](../../../lib/prompt.ts#L1720)）。
- `UI` と `KO` は文言辞書で、`KO` が韓国語を分担する（[i18n.ts:70](../../../lib/i18n.ts#L70)、[i18n.ts:490](../../../lib/i18n.ts#L490)）。 <!-- b_bkpstxk7 -->

## 処理の流れ <!-- b_w066ccdp -->

1. `constrainModalRails` と対象画面を整え、`explodeGroup` と `frameOfGroup` で振り分ける（[prompt.ts:1745-1770](../../../lib/prompt.ts#L1745-L1770)）。
2. 題名と `paletteLines` と `themeLines` の行を積む（[prompt.ts:1787-1810](../../../lib/prompt.ts#L1787-L1810)）。
3. `screenHead` と `describeScreen` で画面ごとに見出しと配置を書く（[prompt.ts:1818-1834](../../../lib/prompt.ts#L1818-L1834)）。
4. `notes` と `swipeNotes` と `promptOptionsOf` の行を足して返す（[prompt.ts:1836-1860](../../../lib/prompt.ts#L1836-L1860)）。 <!-- b_v3nzn4vs -->

## 設定 <!-- b_an6a47e0 -->

- `loadAiSettings` と `saveAiSettings` は `m3e:ai` 鍵で設定を永続化する（[ai.ts:31](../../../lib/ai.ts#L31)、[ai.ts:33](../../../lib/ai.ts#L33)、[ai.ts:49](../../../lib/ai.ts#L49)）。
- `NEXT_PUBLIC_BASE_PATH` は AI パネルの既定に使う（[AiPanel.tsx:63](../../../components/AiPanel.tsx#L63)）。
- 文書側の `promptOptions` と `promptEdit` が付加行と上書き文を決める（[prompt.ts:1685](../../../lib/prompt.ts#L1685)、[prompt.ts:1864](../../../lib/prompt.ts#L1864)）。 <!-- b_g41a69sw -->

## テスト <!-- b_na6zz0ne -->

- `complete` の claude 経路は宛先とヘッダーと結合と空応答を確かめる（[ai.test.ts:12](../../../lib/ai.test.ts#L12)、[ai.test.ts:30](../../../lib/ai.test.ts#L30)、[ai.test.ts:37](../../../lib/ai.test.ts#L37)）。
- `complete` の異常系は長文停止と拒否と HTTP エラーを確かめる（[ai.test.ts:42](../../../lib/ai.test.ts#L42)、[ai.test.ts:47](../../../lib/ai.test.ts#L47)、[ai.test.ts:52](../../../lib/ai.test.ts#L52)）。
- `UI` 辞書は言語一覧と `KO` の鍵一致と非韓言語と置換子の整合を確かめる（[i18n.parity.test.ts:34](../../../lib/i18n.parity.test.ts#L34)、[i18n.parity.test.ts:39](../../../lib/i18n.parity.test.ts#L39)、[i18n.parity.test.ts:44](../../../lib/i18n.parity.test.ts#L44)、[i18n.parity.test.ts:57](../../../lib/i18n.parity.test.ts#L57)）。
- 辞書被覆と `isLang` の可否を確かめる（[i18n.parity.test.ts:68](../../../lib/i18n.parity.test.ts#L68)、[i18n.parity.test.ts:86](../../../lib/i18n.parity.test.ts#L86)、[i18n.test.ts:6](../../../lib/i18n.test.ts#L6)、[i18n.test.ts:10](../../../lib/i18n.test.ts#L10)）。
- `buildPrompt` の platform と言語追従と `promptMarks` の検出と既定行を確かめる（[prompt.test.ts:274](../../../lib/prompt.test.ts#L274)、[prompt.test.ts:292](../../../lib/prompt.test.ts#L292)、[promptMarks.test.ts:45](../../../lib/promptMarks.test.ts#L45)、[promptMarks.test.ts:51](../../../lib/promptMarks.test.ts#L51)）。 <!-- b_s19hg3dv -->

## 不変条件 <!-- b_09wwzmyj -->

- `isLang` は 4 言語以外を決して受け付けない（[i18n.ts:12](../../../lib/i18n.ts#L12)）。
- `t` は韓国語だけ `KO` から引き、他は `UI` から引く（[i18n.ts:574](../../../lib/i18n.ts#L574)）。
- `promptOptionsOf` は未知値を落とし、未設定時は既定に戻す（[prompt.ts:1684-1685](../../../lib/prompt.ts#L1684-L1685)）。
- `effectivePrompt` は `promptEdit` がある時だけ上書きする（[prompt.ts:1864](../../../lib/prompt.ts#L1864)）。 <!-- b_28baka7j -->

## エラー処理 <!-- b_vekn9qgn -->

- `complete` は長文停止と拒否と HTTP エラーで例外を投げる（[ai.ts:79](../../../lib/ai.ts#L79)、[ai.test.ts:42](../../../lib/ai.test.ts#L42)、[ai.test.ts:47](../../../lib/ai.test.ts#L47)、[ai.test.ts:52](../../../lib/ai.test.ts#L52)）。
- `aiErrorText` が例外を言語別の文言に変えて示す（[AiPanel.tsx:10](../../../components/AiPanel.tsx#L10)）。 <!-- b_5a9hz3x3 -->

## 並行性 <!-- b_7kzfgsmm -->

`complete` と `proposeBehavior` と `proposeDescription` と `draftDesign` は非同期で中断信号を受ける（[ai.ts:79](../../../lib/ai.ts#L79)、[ai.ts:187](../../../lib/ai.ts#L187)、[ai.ts:207](../../../lib/ai.ts#L207)、[ai.ts:242](../../../lib/ai.ts#L242)）。現在の言語は `current` に置き、`getLang` と `setGlobalLang` が触る（[i18n.ts:16-18](../../../lib/i18n.ts#L16-L18)）。 <!-- b_khqjzsd7 -->

## 落とし穴 <!-- b_835w6e38 -->

> [!WARNING]
> **落とし穴**
> - `lib/i18n.ts` の `KIND_TEXT` を 4 言語で足す（[CONTRIBUTING.md:45-46](../../../CONTRIBUTING.md#L45-L46)）。
> - `lib/prompt.ts` の `itemJa` ら各言語文と `STYLE_NOTES` を同時に足す（[CONTRIBUTING.md:47-48](../../../CONTRIBUTING.md#L47-L48)）。
> - UI 文言とプロンプト文は 4 言語必須で、注釈は英語で書く（[CONTRIBUTING.md:53-54](../../../CONTRIBUTING.md#L53-L54)）。
> - プロンプト文言の変更は事前に issue で合意する（[CONTRIBUTING.md:9-12](../../../CONTRIBUTING.md#L9-L12)）。
> - 検証は `typecheck` と `test` と `build` の 3 点を通す（[CONTRIBUTING.md:65](../../../CONTRIBUTING.md#L65)）。
> - `promptEdit` があると `buildPrompt` の出力を置き換える（[prompt.ts:1864](../../../lib/prompt.ts#L1864)）。 <!-- b_h3qqfk3b -->

## 深掘り <!-- b_9bz55j96 -->

> [!NOTE]
> **深掘り**
> - 画面記述の格子まとめの扱いの詳細。 <!-- b_7ywd262y -->

> [!TIP]
> **まとめ**
> プロンプト生成と 4 言語文言と AI 補助が集まる層である。 <!-- b_9kzw4gnx -->
