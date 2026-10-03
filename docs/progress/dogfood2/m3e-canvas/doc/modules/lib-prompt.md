# プロンプト生成と多言語 <!-- b_h7p4bt2q -->

- ファイル 6 · 3782 行 · 重要度 0.59
<!-- b_x3sz8v5q -->

## 責務 <!-- b_17fx7djp -->

このモジュールは、キャンバス上のデザイン（`Doc`）を AI エージェント向けの自然言語プロンプトに変換する（[prompt.ts:1745-1761](../../../lib/prompt.ts#L1745-L1761)）。あわせて UI 文言の多言語辞書を持ち、`ja`・`en`・`zh`・`ko` の 4 言語を扱う（[i18n.ts:5-6](../../../lib/i18n.ts#L5-L6)、[i18n.ts:574](../../../lib/i18n.ts#L574)）。また、LLM プロバイダへの問い合わせ（`lib/ai.ts`）と、プロンプトや AI 設定を編集するパネル群も含む（[ai.ts:79](../../../lib/ai.ts#L79)、[ai.ts:187](../../../lib/ai.ts#L187)）。 <!-- b_kjcbg0t0 -->

## 公開インターフェース <!-- b_37xc5pqq -->

- `buildPrompt` は `Doc` から全体、または `onlyFrameId` で指定した 1 画面分のプロンプト文字列を作る（[prompt.ts:1745](../../../lib/prompt.ts#L1745)）。
- `effectivePrompt` は `doc.promptEdit` があればそれを、なければ `buildPrompt` の結果を返す（[prompt.ts:1864](../../../lib/prompt.ts#L1864)）。
- `promptMarks` はプロンプト本文から見出しや画面の位置を抜き出し、アウトライン表示に使う（[prompt.ts:1720-1721](../../../lib/prompt.ts#L1720-L1721)）。
- `t` と `useLang` は UI 文言の取得と現在言語の参照に使う（[i18n.ts:23](../../../lib/i18n.ts#L23)、[i18n.ts:574](../../../lib/i18n.ts#L574)）。
- `complete` は設定したプロバイダへ問い合わせて応答テキストを返し、`proposeBehavior` と `proposeDescription` がその上に載る（[ai.ts:79](../../../lib/ai.ts#L79)、[ai.ts:187](../../../lib/ai.ts#L187)、[ai.ts:207](../../../lib/ai.ts#L207)）。
- `hasKey` と `isSecureUrl` は AI 設定の利用可否と URL の安全性を判定する（[ai.ts:55-61](../../../lib/ai.ts#L55-L61)）。 <!-- b_bvjjxxsk -->

## 処理の流れ <!-- b_9e0byr8q -->

1. `constrainModalRails` で groups を整え、テーマとパレットを決める（[prompt.ts:1746-1750](../../../lib/prompt.ts#L1746-L1750)）。
2. 画面ごとに group を振り分け、手作りの group は `explodeGroup` で部品単位に展開する（[prompt.ts:1757-1770](../../../lib/prompt.ts#L1757-L1770)）。
3. 導入、色、テーマ、レイアウトの順に行を積み、`describeScreen` で各画面を記述する（[prompt.ts:1787-1834](../../../lib/prompt.ts#L1787-L1834)）。
4. 挙動、スタイル、一般注意を足し、最後に `promptOptionsOf` で選ばれた追加行を並べる（[prompt.ts:1836-1860](../../../lib/prompt.ts#L1836-L1860)）。 <!-- b_a8hj78k4 -->

## 設定 <!-- b_zr02ppa9 -->

- AI 設定は `m3e:ai` キーで保存・読込される（`loadAiSettings`、`saveAiSettings`）（[ai.ts:31-33](../../../lib/ai.ts#L31-L33)、[ai.ts:49](../../../lib/ai.ts#L49)）。
- 追加行は `PromptOption` で選び、既定は `deliverable` のみである（[prompt.ts:1681-1685](../../../lib/prompt.ts#L1681-L1685)）。 <!-- b_tzytdzfd -->

## テスト <!-- b_995e9nt2 -->

- `lib/i18n.parity.test.ts` は Korean の辞書キーが主辞書と一致することを検証する（[i18n.parity.test.ts:39](../../../lib/i18n.parity.test.ts#L39)）。
- `buildPrompt` は `lang` 引数に従うことがテストされている（[prompt.test.ts:294](../../../lib/prompt.test.ts#L294)）。 <!-- b_d2qxnb9q -->

## 落とし穴 <!-- b_tf2qvpym -->

> [!WARNING]
> **落とし穴**
> - 言語を足すときは `itemJa`・`itemEn`・`itemZh`・`itemKo` の分岐と `UI` と `KO` を揃える必要がある（[prompt.ts:676](../../../lib/prompt.ts#L676)、[i18n.ts:487-490](../../../lib/i18n.ts#L487-L490)）。 <!-- b_gz5950wr -->
