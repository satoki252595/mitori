# 指示文と多言語と AI <!-- b_cvk6pfjt -->

- ファイル 6 · 3782 行 · 重要度 0.60
<!-- b_pgy45na7 -->

**変更の手引き**
- 影響が及ぶ先（このモジュールを使う）: [編集画面外枠](app.md)・[検査器と汎用パネル](components-ui.md)・[部品描画と携帯面](components-m3node.md)・[寸法と色と整形基盤](lib-tokens.md)
- 使っているもの: [寸法と色と整形基盤](lib-tokens.md)・[部品描画と携帯面](components-m3node.md)・[検査器と汎用パネル](components-ui.md)・[編集画面外枠](app.md)
- テスト: `lib/ai.test.ts`（14 件）・`lib/i18n.parity.test.ts`（9 件）・`lib/i18n.test.ts`（2 件）・`lib/prompt.test.ts`（2 件） ほか 1 · 実行: `npm test`
- 入口から: `GET /`（`app/page.tsx:37`）
- よく使われる宣言（変えると波及する）: `t` `lib/i18n.ts:574`（25 ファイル）・`useLang` `lib/i18n.ts:23`（23 ファイル）・`Lang` `lib/i18n.ts:5`（11 ファイル）・`KIND_TEXT` `lib/i18n.ts:578`（7 ファイル）・`getLang` `lib/i18n.ts:17`（3 ファイル）
- 一緒に変わりやすいファイル（直近 79 commit）: `components/Inspector.tsx` 29 回・`lib/tokens.ts` 26 回・`components/M3Node.tsx` 22 回・`app/Editor.tsx` 15 回・`components/Preview.tsx` 14 回
- 注意: ハブ（多くから使われ、多くを使う）・大きいファイル `lib/prompt.ts`（1,864 行）・循環依存（[編集画面外枠](app.md)・[検査器と汎用パネル](components-ui.md)・[寸法と色と整形基盤](lib-tokens.md) ほか 1 と）
<!-- b_vtgk5b04 -->

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
<!-- b_0mvahkt8 -->

> [!NOTE]
> **この章で分かること**
> - 受け渡し文の組み立て方を学ぶ
> - 画面文言の多言語参照を学ぶ
> - AI 補助の入口と設定を学ぶ <!-- b_x6zrw35p -->

## 責務 <!-- b_d75bc4rx -->

スケッチから受け渡し用の指示文を作り、多言語表示と AI 補助を束ねるのが役目である（推測）。`buildPrompt` が色と配置と振る舞いを文章化し、`t` が文言を引き、`complete` が外部へ問い合わせる（[prompt.ts:1745-1746](../../../lib/prompt.ts#L1745-L1746)、[i18n.ts:572-574](../../../lib/i18n.ts#L572-L574)、[ai.ts:79](../../../lib/ai.ts#L79)）。部品の描画や色定義は持たない（推測）。 <!-- b_0a35g6h2 -->

## 公開インターフェース <!-- b_h3yd3dgt -->

- `buildPrompt` は受け渡し文を組む（[prompt.ts:1745-1746](../../../lib/prompt.ts#L1745-L1746)）。
- `effectivePrompt` は手直し優先で返す（[prompt.ts:1864](../../../lib/prompt.ts#L1864)）。
- `promptMarks` は見出し位置を抜く（[prompt.ts:1720-1721](../../../lib/prompt.ts#L1720-L1721)）。
- `promptOptionsOf` は追加行選択を正規化する（[prompt.ts:1682-1685](../../../lib/prompt.ts#L1682-L1685)）。
- `t` と `useLang` と `getLang` は文言と言語を担う（[i18n.ts:16-18](../../../lib/i18n.ts#L16-L18)、[i18n.ts:22-23](../../../lib/i18n.ts#L22-L23)、[i18n.ts:572-574](../../../lib/i18n.ts#L572-L574)）。
- `complete` と `proposeBehavior` と `proposeDescription` と `draftDesign` は AI 問い合わせだ（[ai.ts:79](../../../lib/ai.ts#L79)、[ai.ts:187](../../../lib/ai.ts#L187)、[ai.ts:207](../../../lib/ai.ts#L207)、[ai.ts:242](../../../lib/ai.ts#L242)）。
- `PromptPanel` と `AiPanel` と `LayersPanel` は関連画面だ（[PromptPanel.tsx:305-312](../../../components/PromptPanel.tsx#L305-L312)、[AiPanel.tsx:164](../../../components/AiPanel.tsx#L164)、[Layers.tsx:194-201](../../../components/Layers.tsx#L194-L201)）。 <!-- b_zpyxtxnm -->

## 依存関係 <!-- b_trfmv8e9 -->

- `lib` の `Preview` と `ColorPanel` と `HandleSide` と行き来する（推測）。
- `components` の `CardStage` と `LoadingIndicator` と `wavePath` と行き来する（推測）。
- `components` の `ButtonInspector` と `FrameInspector` と `IconPicker` と行き来する（推測）。
- `app` の `Editor` と `metadata` と `viewport` と行き来する（推測）。 <!-- b_dns4t94x -->

## データ構造 <!-- b_7wf5wzqt -->

- `AiSettings` は `provider` と `baseUrl` と `model` と `key` を持つ（[ai.ts:13-17](../../../lib/ai.ts#L13-L17)）。
- `PromptMark` は `kind` と `label` と `line` と任意の `frameId` を持つ（[prompt.ts:1720](../../../lib/prompt.ts#L1720)）。
- `PromptOption` は 5 択で、`DEFAULT_PROMPT_OPTIONS` が既定を与える（[prompt.ts:1681-1683](../../../lib/prompt.ts#L1681-L1683)）。
- `Lang` は 4 言語の直和で、`LANGS` が表示名を与える（[i18n.ts:5-6](../../../lib/i18n.ts#L5-L6)）。 <!-- b_5rew9f06 -->

## 処理の流れ <!-- b_v7za149e -->

1. `buildPrompt` は色と見た目を整え、対象を決める（[prompt.ts:1745-1754](../../../lib/prompt.ts#L1745-L1754)）。
2. グループを `explodeGroup` で展開し、画面付きと野良に分ける（[prompt.ts:1757-1770](../../../lib/prompt.ts#L1757-L1770)）。
3. 色と見た目を書き、画面ごとに `describeScreen` で配置を描く（[prompt.ts:1793-1810](../../../lib/prompt.ts#L1793-L1810)、[prompt.ts:1812-1824](../../../lib/prompt.ts#L1812-L1824)）。
4. 振る舞いと体裁注意を足し、`promptOptionsOf` で選んだ行を足す（[prompt.ts:1836-1860](../../../lib/prompt.ts#L1836-L1860)）。 <!-- b_2wn7k6z7 -->

## 設定 <!-- b_8g0gdfgz -->

- `loadAiSettings` と `saveAiSettings` は `STORE_KEY` で保存する（[ai.ts:31-49](../../../lib/ai.ts#L31-L49)）。
- `PROVIDERS` と `DEFAULT_AI` が接続先の既定を与える（[ai.ts:20-29](../../../lib/ai.ts#L20-L29)）。
- 設定画面は `NEXT_PUBLIC_BASE_PATH` を読む（[AiPanel.tsx:63](../../../components/AiPanel.tsx#L63)）。 <!-- b_gw7wmxk2 -->

## テスト <!-- b_bb1544mc -->

- Claude 互換経路の送信形式と応答結合、空応答の扱いを確かめる（[ai.test.ts:12](../../../lib/ai.test.ts#L12)、[ai.test.ts:30](../../../lib/ai.test.ts#L30)、[ai.test.ts:37](../../../lib/ai.test.ts#L37)）。
- 応答打ち切りと拒否、HTTP 誤差の例外内容を確かめる（[ai.test.ts:42](../../../lib/ai.test.ts#L42)、[ai.test.ts:47](../../../lib/ai.test.ts#L47)、[ai.test.ts:52](../../../lib/ai.test.ts#L52)）。
- 画面文言辞書の言語網羅と韓国語鍵一致、置換子の整合を確かめる（[i18n.parity.test.ts:34](../../../lib/i18n.parity.test.ts#L34)、[i18n.parity.test.ts:39](../../../lib/i18n.parity.test.ts#L39)、[i18n.parity.test.ts:44](../../../lib/i18n.parity.test.ts#L44)、[i18n.parity.test.ts:57](../../../lib/i18n.parity.test.ts#L57)）。
- 辞書の言語被覆と色名翻訳、言語判定の可否を確かめる（[i18n.parity.test.ts:68](../../../lib/i18n.parity.test.ts#L68)、[i18n.parity.test.ts:86](../../../lib/i18n.parity.test.ts#L86)、[i18n.test.ts:6](../../../lib/i18n.test.ts#L6)、[i18n.test.ts:10](../../../lib/i18n.test.ts#L10)）。
- 実行先既定と言語引数の優先、見出し抽出と追加行既定を確かめる（[prompt.test.ts:274](../../../lib/prompt.test.ts#L274)、[prompt.test.ts:292](../../../lib/prompt.test.ts#L292)、[promptMarks.test.ts:45](../../../lib/promptMarks.test.ts#L45)、[promptMarks.test.ts:51](../../../lib/promptMarks.test.ts#L51)）。 <!-- b_21r7jps7 -->

## 不変条件 <!-- b_4ez5hxx7 -->

- `promptOptionsOf` は未知値を落とし、欠落時は `DEFAULT_PROMPT_OPTIONS` に戻す（[prompt.ts:1682-1685](../../../lib/prompt.ts#L1682-L1685)）。
- `effectivePrompt` は手直しがあれば優先し、なければ `buildPrompt` する（[prompt.ts:1864](../../../lib/prompt.ts#L1864)）。
- `t` は韓国語のみ `KO` を引き、ほかは `UI` を引く（[i18n.ts:574](../../../lib/i18n.ts#L574)）。
- `hasKey` と `isSecureUrl` は局所 URL を安全とみなす（[ai.ts:55-61](../../../lib/ai.ts#L55-L61)）。 <!-- b_412trp9b -->

## エラー処理 <!-- b_1hqekywp -->

- `complete` は空応答を空文字で返し、打ち切りは長文例外にする（[ai.ts:79](../../../lib/ai.ts#L79)、[ai.test.ts:37](../../../lib/ai.test.ts#L37)、[ai.test.ts:42](../../../lib/ai.test.ts#L42)）。
- 拒否と HTTP 誤差も例外にし、`aiErrorText` が表示文に整える（[ai.test.ts:47](../../../lib/ai.test.ts#L47)、[ai.test.ts:52](../../../lib/ai.test.ts#L52)、[AiPanel.tsx:10](../../../components/AiPanel.tsx#L10)）。 <!-- b_39c1mtj3 -->

## 並行性 <!-- b_db82db6n -->

AI 問い合わせは非同期で、`AbortSignal` による取り消しを受ける（[ai.ts:79](../../../lib/ai.ts#L79)、[ai.ts:187](../../../lib/ai.ts#L187)）。表示言語は内部の `current` に保持され、`getLang` と `setGlobalLang` で読み書きする（[i18n.ts:16-18](../../../lib/i18n.ts#L16-L18)）。 <!-- b_ctsw57v9 -->

## 落とし穴 <!-- b_g2h65ree -->

> [!WARNING]
> **落とし穴**
> - `UI` と `KO` は鍵集合を一致させないと表示が欠ける（[i18n.ts:70](../../../lib/i18n.ts#L70)、[i18n.ts:487-490](../../../lib/i18n.ts#L487-L490)）。
> - `itemJa` と `itemEn` と `itemZh` と `itemKo` は同じ分岐を 4 言語で直す（[prompt.ts:294](../../../lib/prompt.ts#L294)、[prompt.ts:391](../../../lib/prompt.ts#L391)、[prompt.ts:488](../../../lib/prompt.ts#L488)、[prompt.ts:585](../../../lib/prompt.ts#L585)）。
> - `effectivePrompt` は手直しがあると `buildPrompt` を呼ばない（[prompt.ts:1864](../../../lib/prompt.ts#L1864)）。 <!-- b_phjvb74f -->

## 深掘り <!-- b_m5c5vkvr -->

> [!NOTE]
> **深掘り**
> - 画面配置を文章化する木組みと格子判定の詳細 <!-- b_47s1k63v -->

> [!TIP]
> **まとめ**
> 指示文生成と多言語と AI 補助を束ねる要であり、編集画面と描画部品の橋渡しをする。 <!-- b_t5kt8w0b -->
