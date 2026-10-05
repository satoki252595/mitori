# 11. リスクと負債 <!-- b_p9p7g8we -->

## テストの穴 <!-- b_t0yg4fms -->

テストの裏付けを確認したい領域として components 配下の検査器と汎用パネルがある（推測）。 <!-- b_p6n0sf1h -->

## ホットスポット <!-- b_tg62c260 -->

- lib/tokens.ts では `KIND_SPEC` への追加時に `makeItem` と `sizeOf` と `baseRadii` の分岐を合わせる必要があり、漏れが起きやすい（[tokens.ts:924](../../lib/tokens.ts#L924)、[tokens.ts:2383-2384](../../lib/tokens.ts#L2383-L2384)、[tokens.ts:2448-2449](../../lib/tokens.ts#L2448-L2449)、[tokens.ts:2530-2531](../../lib/tokens.ts#L2530-L2531)）。
- app/Editor.tsx では `setGroups` が `constrainModalRails` を通り、`translateSnapshot` が履歴と差分まで扱うため、状態更新の見落としが波及しやすい（[Editor.tsx:461-464](../../app/Editor.tsx#L461-L464)、[Editor.tsx:472-488](../../app/Editor.tsx#L472-L488)）。
- lib/prompt.ts では `itemJa` と `itemEn` と `itemZh` と `itemKo` が同じ分岐を言語別に持ち、文言修正の漏れが起きやすい（[prompt.ts:294](../../lib/prompt.ts#L294)、[prompt.ts:391](../../lib/prompt.ts#L391)、[prompt.ts:488](../../lib/prompt.ts#L488)、[prompt.ts:585](../../lib/prompt.ts#L585)）。
- components/PartPanel.tsx では `PartTabs` の `idPrefix` と `hasTrigger` の `TAPPABLE` 依存が暗黙で、複製や拡張時に衝突しやすい（[PartPanel.tsx:74](../../components/PartPanel.tsx#L74)、[PartPanel.tsx:1225](../../components/PartPanel.tsx#L1225)）。
- lib/i18n.ts では `UI` と `KO` の鍵集合の一致が前提で、追加時の欠落が表示に直結しやすい（[i18n.ts:70](../../lib/i18n.ts#L70)、[i18n.ts:487-490](../../lib/i18n.ts#L487-L490)）。 <!-- b_55ggv92v -->

## 壊れやすい箇所 <!-- b_ma4ywd84 -->

> [!WARNING]
> **落とし穴**
> - AI 応答の空文字と打ち切り例外を `complete` の呼び出し側で分け損ねると、無言の失敗になりやすい（[ai.ts:79](../../lib/ai.ts#L79)、[ai.test.ts:37](../../lib/ai.test.ts#L37)、[ai.test.ts:42](../../lib/ai.test.ts#L42)）。
> - 拒否や HTTP 誤差の例外を `aiErrorText` で表示文に整え損ねると、利用者への説明が不足しやすい（[ai.test.ts:47](../../lib/ai.test.ts#L47)、[ai.test.ts:52](../../lib/ai.test.ts#L52)、[AiPanel.tsx:10](../../components/AiPanel.tsx#L10)）。
> - `readProject` と `readShareHash` の `null` を読み込み失敗として扱い損ねると、作業内容を失いやすい（[project.ts:91-96](../../lib/project.ts#L91-L96)、[share.ts:55-56](../../lib/share.ts#L55-L56)）。
> - `getShapes` の返す `cache` 実体を書き換えると、他の呼び出しに波及しやすい（[shapes.ts:154-162](../../lib/shapes.ts#L154-L162)）。
> - `Symbol` 付帯の `railExpansionSide` と `fabOpen` と `menuUp` を複製時に落とすと、状態を失いやすい（[tokens.ts:157](../../lib/tokens.ts#L157)、[tokens.ts:1852](../../lib/tokens.ts#L1852)、[tokens.ts:1854](../../lib/tokens.ts#L1854)）。
> - 手直し後に `effectivePrompt` が `buildPrompt` を呼ばないままになると、生成結果と表示の食い違いが残りやすい（[prompt.ts:1864](../../lib/prompt.ts#L1864)）。 <!-- b_njmxf4hk -->

- （検出されませんでした）
<!-- b_2v3fnwrk -->

- （検出されませんでした）
<!-- b_gwpzcary -->
