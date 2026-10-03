# M3パーツ描画層 <!-- b_hbna045a -->

- ファイル 9 · 3715 行 · 重要度 0.40
<!-- b_xzjr568t -->

> [!NOTE]
> **この章で分かること**
> - M3Node がパーツを描く仕組み
> - ローディング表示の形状モーフィング
> - モバイル用 UI とテーマパネルの位置づけ <!-- b_2d4g0p9z -->

## 責務 <!-- b_8vzsf7ns -->

このモジュールは、キャンバス上の Material 3 Expressive パーツ（`Item`）を描画する部品群である。ボタンやスイッチなどの本体は `M3Node` と `Body` が担い、ローディングやピッカー、モバイル向けシートもここにある（[M3Node.tsx:1791-1798](../../../components/M3Node.tsx#L1791-L1798)、[M3Node.tsx:1939-1948](../../../components/M3Node.tsx#L1939-L1948)）。ドキュメントの編集状態そのものは持たず、`item` と `palette` を受け取って描くだけである（[M3Node.tsx:1939-1976](../../../components/M3Node.tsx#L1939-L1976)）。 <!-- b_3hg8kmvp -->

## 公開インターフェース <!-- b_0v0qq52p -->

- `Icon`: アイコン名のリガチャを描く。スクリーンリーダーには読ませない（[M3Node.tsx:81-111](../../../components/M3Node.tsx#L81-L111)）。
- `M3Static`: 操作なしの静的なパーツ描画。`radii` 未指定なら `baseRadii` を使う（[M3Node.tsx:1939-1950](../../../components/M3Node.tsx#L1939-L1950)）。
- `getShapes` / `morphedShape`: 7 形状の点列と、その間の補間（[shapes.ts:154-177](../../../lib/shapes.ts#L154-L177)）。
- `LoadingAnimator`: 時刻から `rotation` と `morph` を更新する（[shapes.ts:218-240](../../../lib/shapes.ts#L218-L240)）。
- `LoadingIndicator`、`LinearProgress`、`CircularProgress`: 進捗表示部品（[Loading.tsx:54-61](../../../components/Loading.tsx#L54-L61)、[Loading.tsx:122-129](../../../components/Loading.tsx#L122-L129)、[Loading.tsx:243-250](../../../components/Loading.tsx#L243-L250)）。
- `BottomSheet`、`MobileInspector`: モバイル用 UI（[Mobile.tsx:15](../../../components/Mobile.tsx#L15)、[Mobile.tsx:97-104](../../../components/Mobile.tsx#L97-L104)）。 <!-- b_4v8q78bv -->

## 処理の流れ <!-- b_ja3rp3w7 -->

1. `LoadingAnimator.update` が前回との差分時間を 0.1 秒で頭打ちにする（[shapes.ts:219-222](../../../lib/shapes.ts#L219-L222)）。
2. 650ms ごとに周期が進むと、モーフ目標を 1 つ進める（[shapes.ts:223-229](../../../lib/shapes.ts#L223-L229)）。
3. `Spring.step` が 12 分割でバネを積分する（[shapes.ts:190-197](../../../lib/shapes.ts#L190-L197)）。
4. バネ位置から `rotation` と `morph` を決める（[shapes.ts:230-239](../../../lib/shapes.ts#L230-L239)）。 <!-- b_ef3eq7pw -->

## テスト <!-- b_166sq5da -->

形状は 7 個で、同じ配列がキャッシュされて返ることを検証している（[shapes.extended.test.ts:26](../../../lib/shapes.extended.test.ts#L26)）（[shapes.test.ts:27](../../../lib/shapes.test.ts#L27)）。`morphedShape` は整数でそのまま形状を返し、端を越えても循環する（[shapes.test.ts:33](../../../lib/shapes.test.ts#L33)）（[shapes.test.ts:44](../../../lib/shapes.test.ts#L44)）。 <!-- b_ks75j98q -->

## 落とし穴 <!-- b_rrskgess -->

> [!WARNING]
> **落とし穴**
> - `getShapes` はモジュール内にキャッシュを持つため、返る配列を書き換えると全利用側に影響する（[shapes.ts:154-162](../../../lib/shapes.ts#L154-L162)）。
> - `morphedShape` は 7 形状の点数が同一である前提で補間する（[shapes.ts:164-177](../../../lib/shapes.ts#L164-L177)）。 <!-- b_y7v0pjsc -->

> [!TIP]
> **まとめ**
> パーツ描画、ローディング表現、モバイル UI を担う表示層である。状態は持たない。 <!-- b_5rgyf31w -->
