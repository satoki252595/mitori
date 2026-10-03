# 部品描画とプロンプト生成 <!-- b_4bkz27d4 -->

- ファイル 13 · 8362 行 · 重要度 0.49
<!-- b_fm46tcq0 -->

> [!NOTE]
> **この章で分かること**
> - M3 部品を描く `M3Node` と、その周辺のインスペクタ群の役割
> - プロンプト生成 `lib/prompt.ts` と読み込み表示 `lib/shapes.ts` の位置づけ
> - 各テストが何を保証しているか <!-- b_bwstavy4 -->

## 責務 <!-- b_py4528ts -->

このモジュールはキャンバス上の部品の描画（`components/M3Node.tsx`）、選択した部品を編集するパネル群、ドキュメントからプロンプト文を組み立てる処理（`lib/prompt.ts`）、ローディング表示の形状補間（`lib/shapes.ts`）を持つ（[M3Node.tsx:1791-1798](../../../components/M3Node.tsx#L1791-L1798)）。 <!-- b_fdmdxsws -->

## 公開インターフェース <!-- b_my9hspaq -->

- `M3Node` は部品を操作可能な状態で描き、`M3Static` は静的に描く（[M3Node.tsx:1791-1798](../../../components/M3Node.tsx#L1791-L1798)、[M3Node.tsx:1939-1946](../../../components/M3Node.tsx#L1939-L1946)）。
- `buildPrompt` はドキュメントと幅からプロンプト文字列を返す（[prompt.ts:1745](../../../lib/prompt.ts#L1745)）。
- `effectivePrompt` は `doc.promptEdit` があればそれを、なければ `buildPrompt` の結果を返す（[prompt.ts:1864](../../../lib/prompt.ts#L1864)）。
- `promptMarks` はプロンプト文中のセクションと画面の位置を返す（[prompt.ts:1720-1721](../../../lib/prompt.ts#L1720-L1721)）。
- `getShapes` と `morphedShape` は形状の点列と補間結果を返す（[shapes.ts:154-164](../../../lib/shapes.ts#L154-L164)）。
- `Inspector` は部品種別ごとに `ButtonInspector` と `PartInspector` を使う（[Inspector.tsx:343-350](../../../components/Inspector.tsx#L343-L350)）。 <!-- b_xxqfpkx2 -->

## データ構造 <!-- b_rvt5bs2f -->

- `PromptOption` は deliverable、tests、darkMode、languages、offline の 5 種で、既定は `deliverable` のみである（[prompt.ts:1681-1683](../../../lib/prompt.ts#L1681-L1683)）。
- `PromptMark` は `kind`、`label`、`line`、任意の `frameId` を持つ（[prompt.ts:1720](../../../lib/prompt.ts#L1720)）。
- `Spring` は `pos`、`vel`、`target` を持つ（[shapes.ts:180-186](../../../lib/shapes.ts#L180-L186)）。
- `AiHooks` は `ready`、`busy`、`onRun`、`onCancel` を持つ（[Inspector.tsx:261](../../../components/Inspector.tsx#L261)）。 <!-- b_5xn0ks1x -->

## テスト <!-- b_71vfe87q -->

- `lib/shapes.test.ts` と `lib/shapes.extended.test.ts` は形状数 7 を検証する（[shapes.extended.test.ts:26](../../../lib/shapes.extended.test.ts#L26)）。
- `lib/prompt.test.ts` は `lang` 引数が環境の言語状態より優先されることを検証する（[prompt.test.ts:292](../../../lib/prompt.test.ts#L292)）。
- `lib/promptMarks.test.ts` は既定のオプションが deliverable 行であることを検証する（[promptMarks.test.ts:51](../../../lib/promptMarks.test.ts#L51)）。 <!-- b_efgfp4bj -->

## 深掘り <!-- b_mzqegs0d -->

> [!NOTE]
> **深掘り**
> `M3Node.tsx` のメニュー開閉アニメーションの時間配分。 <!-- b_xkag1j24 -->
