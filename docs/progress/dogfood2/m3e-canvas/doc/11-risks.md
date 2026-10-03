# 11. リスクと負債 <!-- b_h2514544 -->

## テストの穴 <!-- b_4y9rjbb5 -->

編集パネルを構成する `components` 配下の `ui.tsx`、`Inspector.tsx`、`PartPanel.tsx`、`IconPicker.tsx`、`TapStage.tsx` のモジュールにはテストが見当たらない（推測）。`npm test` の `vitest run` で守られるのは別の部分であり、パネルの操作や表示を変える変更は手動確認に頼ることになる。 <!-- b_qgxvb43f -->

## ホットスポット <!-- b_rm4959ph -->

> [!WARNING]
> **落とし穴**
> `lib/prompt.ts` と `lib/i18n.ts` は言語ごとの分岐を持つため、言語を足すときに両方を揃えて直す必要がある（[prompt.ts:676](../../lib/prompt.ts#L676)、[i18n.ts:487-490](../../lib/i18n.ts#L487-L490)）。`itemJa`・`itemEn`・`itemZh`・`itemKo` の分岐と UI・KO の対応表のどれかが欠けると、その言語のプロンプトや表示だけが崩れる。 <!-- b_jbxk44pf -->

## 壊れやすい箇所 <!-- b_kf6xre09 -->

> [!WARNING]
> **落とし穴**
> `getShapes` が返す配列はモジュール内のキャッシュそのものである（[shapes.ts:154-162](../../lib/shapes.ts#L154-L162)）。呼び出し側がこれを書き換えると、`lib/shapes.ts` を使う全ての描画に影響が及ぶ。読み込んだ形は必ず複製してから加工する必要がある。 <!-- b_7g3qw0d4 -->

- （検出されませんでした）
<!-- b_qabjf98y -->

- （検出されませんでした）
<!-- b_rnawh6by -->
