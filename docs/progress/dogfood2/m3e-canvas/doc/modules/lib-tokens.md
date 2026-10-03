# 文書モデルとトークン <!-- b_knf070cj -->

- ファイル 8 · 4799 行 · 重要度 1.00
<!-- b_swktrckt -->

> [!NOTE]
> **この章で分かること**
> - 部品と画面を表す型 `Item`・`Frame`・`Group`・`Doc` の構造
> - 寸法・角丸・パレットを決める関数の役割
> - 整列処理 `tidyFrame` と周辺の位置づけ <!-- b_7975h10w -->

## 責務 <!-- b_tdhxp2z9 -->

このモジュールは、キャンバスの文書モデルとデザイントークン（寸法、色、角丸、テーマ）を定義し、部品の大きさや配置を計算する層である（[tokens.ts:2340-2358](../../../lib/tokens.ts#L2340-L2358)）。`lib/tidy.ts` は画面内の部品を整列し、`lib/color.ts` はシード色から配色を生成する（[tidy.ts:388](../../../lib/tidy.ts#L388)、[color.ts:131](../../../lib/color.ts#L131)）。描画そのものは持たず、描画は `components` 側の `M3Node` などが担う（推測）。 <!-- b_28zrtvd5 -->

## 公開インターフェース <!-- b_fcmvb5em -->

- `KIND_SPEC` は部品種別ごとの既定寸法・可否フラグを持つ（[tokens.ts:924](../../../lib/tokens.ts#L924)）。
- `makeItem` は種別から初期値入りの `Item` を作る（[tokens.ts:2383-2392](../../../lib/tokens.ts#L2383-L2392)）。
- `sizeOf` は部品の幅と高さを返す（[tokens.ts:2448-2451](../../../lib/tokens.ts#L2448-L2451)）。
- `baseRadii` は部品の角丸を返す（[tokens.ts:2530-2535](../../../lib/tokens.ts#L2530-L2535)）。
- `paletteOf` はキーとテーマから `Palette` を解決する（[tokens.ts:538-539](../../../lib/tokens.ts#L538-L539)）。
- `schemeFromSeed` はシード色から配色を生成する（[color.ts:131](../../../lib/color.ts#L131)）。
- `tidyFrame` は画面内の部品を整列し、変更がなければ `null` を返す型を持つ（[tidy.ts:388](../../../lib/tidy.ts#L388)）。
- `updateRail` はナビレールの変更を反映する（[rail.ts:22](../../../lib/rail.ts#L22)）。 <!-- b_jqtd1nq5 -->

## 依存関係 <!-- b_4qk1wwm3 -->

依存先は `lib` の `i18n`（`Lang`）と `color` で、`tokens.ts` が両者を import する（推測）。逆に `app` の `Editor`、`components` の `ui`・`PartPanel`、`M3Node`、`lib` の `prompt` がこのモジュールの型と関数を利用する。 <!-- b_85w52nr2 -->

## データ構造 <!-- b_avnsxws2 -->

- `Item` は部品で、`kind`・`label`・`icon`・`variant` を必須に持つ（[tokens.ts:1626-1632](../../../lib/tokens.ts#L1626-L1632)）。
- `Group` は座標・`axis`・`items` を持ち、`free` なら `pos` で個別配置する（[tokens.ts:2317-2327](../../../lib/tokens.ts#L2317-L2327)）。
- `Frame` は画面で、`w`・`h` を省くと phone 寸法になる（[tokens.ts:2117-2124](../../../lib/tokens.ts#L2117-L2124)、[tokens.ts:2147](../../../lib/tokens.ts#L2147)）。
- `Doc` は `groups`・`frames`・`paletteKey` などを束ねる文書全体である（[tokens.ts:2340-2348](../../../lib/tokens.ts#L2340-L2348)）。 <!-- b_hzzp47pq -->

## テスト <!-- b_x1a37p7g -->

ボタンの寸法スケールは `lib/button.test.ts` が検証し、リンクを開くタップの URL 解釈もここで確認される（[button.test.ts:46](../../../lib/button.test.ts#L46)、[button.test.ts:80-86](../../../lib/button.test.ts#L80-L86)）。 <!-- b_nek9hxfj -->

## 不変条件 <!-- b_5p7e3cyh -->

- `normalizeTheme` は不正な値を `DEFAULT_THEME` の値に戻す（[tokens.ts:456-467](../../../lib/tokens.ts#L456-L467)）。
- `linkUrlOf` は http と https 以外のアドレスに `null` を返す（[tokens.ts:1711-1719](../../../lib/tokens.ts#L1711-L1719)）。
- ボタンは高さに関わらず完全な丸角を保つ（[tokens.ts:2533-2535](../../../lib/tokens.ts#L2533-L2535)）。 <!-- b_yf6y7zxk -->

## 落とし穴 <!-- b_qwqjj4j5 -->

> [!WARNING]
> **落とし穴**
> - 新しい `Kind` を足すときは `KIND_SPEC`、`sizeOf`、`baseRadii` の分岐も合わせて直す必要がある（[tokens.ts:2448-2451](../../../lib/tokens.ts#L2448-L2451)、[tokens.ts:2530-2532](../../../lib/tokens.ts#L2530-L2532)）。
> - `Item` の `railExpansionSide`・`fabOpen`・`menuUp` は Symbol キーで、JSON には残らない（[tokens.ts:1666](../../../lib/tokens.ts#L1666)、[tokens.ts:1694-1696](../../../lib/tokens.ts#L1694-L1696)）。 <!-- b_4wq14e9j -->

> [!TIP]
> **まとめ**
> 文書モデルと寸法・配色の計算を一箇所に集め、描画側はその結果を使う構成である。 <!-- b_pv1j6fge -->
