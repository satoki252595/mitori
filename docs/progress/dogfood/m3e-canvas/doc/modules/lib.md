# 型・色・整列の基盤 <!-- b_84q9zwph -->

- ファイル 11 · 5175 行 · 重要度 1.00
<!-- b_f6jn6sq5 -->

> [!NOTE]
> **この章で分かること**
> - 部品・フレーム・文書を表すデータ型とトークン定義の置き場を知る。
> - 色の計算、整列、保存、共有、AI 呼び出しの各ファイルの役割を知る。
> - テストが何を固定しているかを知る。 <!-- b_rnn7zsec -->

## 責務 <!-- b_m3tra2gf -->

このモジュールは、キャンバス上の部品（`Item`）、画面（`Frame`）、文書（`Doc`）の型と寸法定数を `lib/tokens.ts` に集めている（[tokens.ts:2117](../../../lib/tokens.ts#L2117)、[tokens.ts:2317](../../../lib/tokens.ts#L2317)、[tokens.ts:2340-2358](../../../lib/tokens.ts#L2340-L2358)）。色の計算は `lib/color.ts` が、自動整列は `lib/tidy.ts` が、ファイル保存と読み込みは `lib/project.ts` が受け持つ（[color.ts:131](../../../lib/color.ts#L131)、[tidy.ts:388](../../../lib/tidy.ts#L388)、[project.ts:81-91](../../../lib/project.ts#L81-L91)）。AI 呼び出し、共有、レール、プレビューやパネルも同居するが、本体は示された範囲では確認できない（推測）。 <!-- b_by06na5p -->

## 公開インターフェース <!-- b_dm28q0hn -->

- `buttonMetrics` / `chipMetrics` / `splitMetrics`: 高さから寸法を求める（[tokens.ts:42](../../../lib/tokens.ts#L42)、[tokens.ts:61](../../../lib/tokens.ts#L61)、[tokens.ts:73](../../../lib/tokens.ts#L73)）。
- `makeItem` / `sizeOf`: 部品の生成と寸法計算（[tokens.ts:2383](../../../lib/tokens.ts#L2383)、[tokens.ts:2448](../../../lib/tokens.ts#L2448)）。
- `schemeFromSeed`: シード色から `Palette` を作る（[color.ts:131](../../../lib/color.ts#L131)）。
- `tidyFrame`: フレーム内の部品を整列し、`Group[]` か `null` を返す（[tidy.ts:388](../../../lib/tidy.ts#L388)）。
- `saveProject` / `readProject` / `isProject`: 文書の保存、読み込み、検証（[project.ts:67](../../../lib/project.ts#L67)、[project.ts:81](../../../lib/project.ts#L81)、[project.ts:91](../../../lib/project.ts#L91)）。 <!-- b_64ew7mg3 -->

## データ構造 <!-- b_8zptvfjv -->

- `Kind`: 部品種別の文字列和集合（[tokens.ts:581-583](../../../lib/tokens.ts#L581-L583)）。
- `Item`: 部品。`kind`、`label`、`variant` などを持つ（[tokens.ts:1626-1632](../../../lib/tokens.ts#L1626-L1632)）。
- `Group`: 軸 `axis` に沿って並ぶ `items` の集まり。`free` と `pos` で自由配置にもなる（[tokens.ts:2317-2327](../../../lib/tokens.ts#L2317-L2327)）。
- `Doc`: `groups`、`frames`、`paletteKey`、`theme` などを束ねる（[tokens.ts:2340-2358](../../../lib/tokens.ts#L2340-L2358)）。 <!-- b_tyq7t4m6 -->

## テスト <!-- b_7g2t3zc8 -->

`lib/button.test.ts` はボタンやチップの寸法目盛り、連結グループ、分割ボタンのメニューを検証する（[button.test.ts:46-53](../../../lib/button.test.ts#L46-L53)、[button.test.ts:201-207](../../../lib/button.test.ts#L201-L207)）。`lib/color.extended.test.ts` は 16 進変換と Lab・Lch 変換を検証する（[color.extended.test.ts:28](../../../lib/color.extended.test.ts#L28)、[color.extended.test.ts:71](../../../lib/color.extended.test.ts#L71)）。`lib/ai.test.ts` は `complete` のエラーと `isSecureUrl` を、`components/Preview.test.tsx` はモーダルの生存期間を検証する（[ai.test.ts:42-47](../../../lib/ai.test.ts#L42-L47)、[ai.test.ts:129](../../../lib/ai.test.ts#L129)）。 <!-- b_gpqbd8yx -->
