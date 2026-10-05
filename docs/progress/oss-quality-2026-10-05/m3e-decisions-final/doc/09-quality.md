# 9. 非機能 <!-- b_dmfg944y -->

## ホットパス <!-- b_k8afrkf5 -->

実行時間は lib/ の形状系の初期生成と毎フレーム更新に偏る（[shapes.ts:156-160](../../lib/shapes.ts#L156-L160)、[shapes.ts:170-177](../../lib/shapes.ts#L170-L177)、[shapes.ts:223-240](../../lib/shapes.ts#L223-L240)）。
`morphedShape` は点列を線形走査して 2 形状間を補間する（[shapes.ts:164](../../lib/shapes.ts#L164)、[shapes.ts:170-177](../../lib/shapes.ts#L170-L177)）。
毎フレームの更新は周期を進め `spring` の位置と `rotation` を求める（[shapes.ts:223-240](../../lib/shapes.ts#L223-L240)）。
`Spring` の安定化は微分の細分割による例である（[shapes.ts:180-183](../../lib/shapes.ts#L180-L183)、[shapes.ts:190-197](../../lib/shapes.ts#L190-L197)）。 <!-- b_gkxxfaq7 -->

## キャッシュ <!-- b_t78maagr -->

- 高コストな初期生成は単一の常駐 `cache` に保持され再利用される、lib/ から components/ に至る一例が `getShapes` である（[shapes.ts:154-162](../../lib/shapes.ts#L154-L162)）。
- 描画前の可否判定は結果を `glyphOk` に覚えて繰り返しを避ける（[IconPicker.tsx:9](../../components/IconPicker.tsx#L9)、[IconPicker.tsx:13](../../components/IconPicker.tsx#L13)）。
- `getShapes` は引数を持たず単一の `cache` を返すため鍵分岐を持たない（[shapes.ts:154-155](../../lib/shapes.ts#L154-L155)）。 <!-- b_2hjgd5sk -->

## 上限値 <!-- b_2x04f56j -->

- 数値と走査は上限と範囲に収められる、lib/ と components/ にまたがる性質である（[shapes.ts:220](../../lib/shapes.ts#L220)、[IconPicker.tsx:19-20](../../components/IconPicker.tsx#L19-L20)、[ui.tsx:1245](../../components/ui.tsx#L1245)、[ui.tsx:1247](../../components/ui.tsx#L1247)）。
- `dt` は 0.1 秒を上限とする（[shapes.ts:220](../../lib/shapes.ts#L220)）。
- 形状間の重み `t` は下限 0 と上限 1 で挟まれる（[shapes.ts:169](../../lib/shapes.ts#L169)）。
- チップ高さは `CHIP_H_MIN` を下限とし `CHIP_H_MAX` を上限とする、その算出が `chipHeightOf` である（[tokens.ts:1759](../../lib/tokens.ts#L1759)）。
- 一覧の走査と表示は `BATCH` と `SHOWN` で抑えられ読み込み画像の辺は `MAX_IMAGE_PX` で抑えられる（[IconPicker.tsx:19-20](../../components/IconPicker.tsx#L19-L20)、[ui.tsx:1245](../../components/ui.tsx#L1245)、[ui.tsx:1247](../../components/ui.tsx#L1247)）。
- 枠寸法の欠落は `PHONE_W` と `PHONE_H` で補われる、その算出が `frameSizeOf` である（[tokens.ts:2147](../../lib/tokens.ts#L2147)）。 <!-- b_nkvy4hdd -->

## セキュリティ境界 <!-- b_bqxmfr5a -->

- 外部入力は許容表と `null` 戻しで検証される、lib/ と app/ にまたがる性質である（[color.ts:16](../../lib/color.ts#L16)、[tokens.ts:1711-1719](../../lib/tokens.ts#L1711-L1719)、[tokens.ts:456-464](../../lib/tokens.ts#L456-L464)、[prompt.ts:1682-1685](../../lib/prompt.ts#L1682-L1685)）。
- 色と連結先の解釈は失敗時に `null` を返す、対象が `hexToRgb` と `linkUrlOf` である（[color.ts:16](../../lib/color.ts#L16)、[tokens.ts:1711-1719](../../lib/tokens.ts#L1711-L1719)）。
- 外観設定は許容表にない `contrast` と `shape` と `font` を既定値で置き換える、処理が `normalizeTheme` である（[tokens.ts:456-464](../../lib/tokens.ts#L456-L464)）。
- 生成指示の選択は未知値を落とし欠落時は `DEFAULT_PROMPT_OPTIONS` で補う、処理が `promptOptionsOf` である（[prompt.ts:1682-1685](../../lib/prompt.ts#L1682-L1685)）。
- 接続先の安全性は局所接続を安全側に寄せて判断する、対象が `hasKey` と `isSecureUrl` である（[ai.ts:55-61](../../lib/ai.ts#L55-L61)）。
- `projectFileName` は題名から禁止文字を除き空白を整える（[project.ts:71-78](../../lib/project.ts#L71-L78)）。
- 公開の基準経路と公開元は `NEXT_PUBLIC_BASE_PATH` と `NEXT_PUBLIC_SITE_ORIGIN` で与えられ欠落時は既定値で補われる（[Editor.tsx:141](../../app/Editor.tsx#L141)、[layout.tsx:4](../../app/layout.tsx#L4)、[layout.tsx:7](../../app/layout.tsx#L7)、[ShareMenu.tsx:10](../../components/ShareMenu.tsx#L10)）。 <!-- b_ftqh93tj -->

## 信頼性 <!-- b_rr3dye53 -->

- 復元と生成は失敗時に `null` を返すか既定生成に切り替える、lib/ と app/ にまたがる性質である（[project.ts:91-96](../../lib/project.ts#L91-L96)、[share.ts:55-56](../../lib/share.ts#L55-L56)、[tidy.ts:388](../../lib/tidy.ts#L388)、[prompt.ts:1864](../../lib/prompt.ts#L1864)）。
- 書類と共有符号の復元は文書性や完全性を欠くと `null` を返す、処理が `readProject` と `readShareHash` である（[project.ts:91-98](../../lib/project.ts#L91-L98)、[share.ts:56-73](../../lib/share.ts#L56-L73)）。
- `shareLink` は `CompressionStream` がないとき非圧縮の `DOC_PARAM` で継続する（[share.ts:46-53](../../lib/share.ts#L46-L53)）。
- 生成指示は手直しを優先し欠落時は既定生成で組み立てる、選択が `effectivePrompt` である（[prompt.ts:1864](../../lib/prompt.ts#L1864)）。
- 空応答は空文字として受け止められ打ち切りだけが長文例外に変えられる、処理が `complete` である（[ai.ts:79](../../lib/ai.ts#L79)、[ai.test.ts:37](../../lib/ai.test.ts#L37)、[ai.test.ts:42](../../lib/ai.test.ts#L42)）。
- 失敗の例外は表示層で `aiErrorText` により文面に整えられる（[ai.test.ts:47](../../lib/ai.test.ts#L47)、[ai.test.ts:52](../../lib/ai.test.ts#L52)、[AiPanel.tsx:10](../../components/AiPanel.tsx#L10)）。
- 整列は成功時に `Group[]` を返し適用不能時に `null` を返す、処理が `tidyFrame` である（[tidy.ts:388](../../lib/tidy.ts#L388)）。
- 既定文の翻訳は一致しないときに元の文を返す、処理が `translateDefaultText` と `translateDefaultFrameName` である（[i18n.ts:33-48](../../lib/i18n.ts#L33-L48)、[i18n.ts:52-61](../../lib/i18n.ts#L52-L61)）。 <!-- b_t74kt0xd -->
