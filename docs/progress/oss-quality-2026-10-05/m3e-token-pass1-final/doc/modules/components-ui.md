# 部品編集パネル群（components） <!-- b_yx5ad1rp -->

- ファイル 8 · 5484 行 · 重要度 0.29
<!-- b_bngvy7md -->

**変更の手引き**
- 影響が及ぶ先（このモジュールを使う）: [編集画面と保存共有](app.md)・[部品描画とモバイル編集](components-m3node.md)・[部品定義と整形基盤](lib-tokens.md)・[プロンプトと多言語化](lib-prompt.md)
- 使っているもの: [プロンプトと多言語化](lib-prompt.md)・[部品描画とモバイル編集](components-m3node.md)・[部品定義と整形基盤](lib-tokens.md)
- テスト: 見つかりませんでした
- よく使われる宣言（変えると波及する）: `Segmented` `components/ui.tsx:334`（10 ファイル）・`IconBtn` `components/ui.tsx:255`（8 ファイル）・`Field` `components/ui.tsx:607`（8 ファイル）・`Section` `components/ui.tsx:1409`（7 ファイル）・`AiHooks` `components/Inspector.tsx:261`（4 ファイル）
- 一緒に変わりやすいファイル（直近 79 commit）: `lib/i18n.ts` 27 回・`lib/tokens.ts` 25 回・`components/M3Node.tsx` 22 回・`lib/prompt.ts` 22 回・`app/Editor.tsx` 16 回
- 注意: ハブ（多くから使われ、多くを使う）・大きいファイル `components/ui.tsx`（1,935 行）・テストが無い・循環依存（[プロンプトと多言語化](lib-prompt.md)・[編集画面と保存共有](app.md)・[部品定義と整形基盤](lib-tokens.md) ほか 1 と）
<!-- b_an6egaj6 -->

**大きなファイルの中身（1,500 行を超えるファイル）**
- `components/ui.tsx`（1,935 行）
  - `components/ui.tsx:10-20` 定数・変数（7）: `PANEL_TABS_H`・`PANEL_TABS_GAP`・`PANEL_FADE_H`・`VEIL_IN`
  - `components/ui.tsx:27-157` 関数（2）: `PanelShell`・`LockedCover`
  - `components/ui.tsx:161-164` 定数・変数（4）: `TRACK_W`・`TRACK_H`・`KNOB`・`KNOB_INSET`
  - `components/ui.tsx:167-312` 関数（2）: `LockSwitch`・`IconBtn`
  - `components/ui.tsx:314-329` 型: `SegOption`
  - `components/ui.tsx:334-437` 関数: `Segmented`
  - `components/ui.tsx:439-439` 型: `SelectOption`
  - `components/ui.tsx:443-600` 関数: `Select`
  - `components/ui.tsx:603-605` 定数・変数（2）: `RING`・`LEAD_W`
  - `components/ui.tsx:607-1150` 関数（3）: `Field`・`CornerIcon`・`Slider`
  - `components/ui.tsx:1153-1153` 定数・変数: `RUN_CELL`
  - `components/ui.tsx:1158-1242` 関数（2）: `NamedSizes`・`SizePresets`
  - `components/ui.tsx:1245-1245` 定数・変数: `MAX_IMAGE_PX`
  - `components/ui.tsx:1247-1664` 関数（9）: `readImage`・`UrlField`・`ImageRow`・`Toggle`
  - `components/ui.tsx:1666-1666` 型: `TidyState`
  - `components/ui.tsx:1670-1935` 関数（2）: `TidyButton`・`ConfirmDialog`
<!-- b_x8ncwwxa -->

> [!NOTE]
> **この章で分かること**
> - `Inspector` 群の分担と入口を学ぶ
> - 汎用入力部品の使い分けを学ぶ
> - アイコン選択と遷移確認の入口を学ぶ <!-- b_znqpbtpr -->

## 責務 <!-- b_59pw7vew -->

`Inspector` を入口に部品や画面の編集パネルを集めた UI 層である（[Inspector.tsx:343-350](../../../components/Inspector.tsx#L343-L350)）。汎用入力の `Field` と種類別の `StyleRun` でパネルを組み立てる（[ui.tsx:607-614](../../../components/ui.tsx#L607-L614)、[PartPanel.tsx:475](../../../components/PartPanel.tsx#L475)）。描画や prompt 生成や token 定義は持たず、他モジュールに任せる（推測）。 <!-- b_b23wbwqv -->

## 公開インターフェース <!-- b_vqwrtjh4 -->

- `Inspector` は選択中 `item` の編集パネルの入口である（[Inspector.tsx:343-350](../../../components/Inspector.tsx#L343-L350)）。
- `FrameInspector` は `frame` の編集と `onDelete` や `onDuplicate` や `onPreview` の入口である（[FramePanel.tsx:152-159](../../../components/FramePanel.tsx#L152-L159)）。
- `TriggerSection` は trigger 編集の行部品である（[PartPanel.tsx:391-398](../../../components/PartPanel.tsx#L391-L398)）。
- `IconPicker` は `value` のアイコン選択 UI で `extras` を受け付ける（[IconPicker.tsx:22-29](../../../components/IconPicker.tsx#L22-L29)）。
- `TapStage` は `action` の遷移 preview 付き編集である（[TapStage.tsx:152-159](../../../components/TapStage.tsx#L152-L159)）。
- `PanelShell` は `locked` と `tabs` 付きのパネル枠である（[ui.tsx:27-34](../../../components/ui.tsx#L27-L34)）。
- `Field` は `multiline` 対応の text 入力で `aiBusy` の表示を持つ（[ui.tsx:607-620](../../../components/ui.tsx#L607-L620)、[ui.tsx:638-640](../../../components/ui.tsx#L638-L640)）。
- `Segmented` は `options` から `value` を選ぶ切替行である（[ui.tsx:334-341](../../../components/ui.tsx#L334-L341)）。 <!-- b_37bvexw6 -->

## 依存関係 <!-- b_sd1rdxwn -->

- `lib` の prompt 系（`aiErrorText` など）に文言と AI 表示で依存する（推測）。
- `components` の描画系（`CardStage` など）と `lib` の tokens 系（`Preview` など）を使う（推測）。
- `app` の `Editor` から呼ばれ、描画系と tokens 系からも参照される（推測）。 <!-- b_sxqmzygr -->

## データ構造 <!-- b_ta1677qk -->

- `AiHooks` は `ready` と `reason` と `busy` の状態と `onRun` と `onCancel` を束ねる（[Inspector.tsx:261](../../../components/Inspector.tsx#L261)）。
- `Tab` は `design` と `behavior` の編集切替である（[PartPanel.tsx:50](../../../components/PartPanel.tsx#L50)）。
- `PlaceFn` は `COL_KIND` と `ROW_KIND` の 3×3 配置コールバックである（[PartPanel.tsx:53-55](../../../components/PartPanel.tsx#L53-L55)）。
- `TidyState` は `tidy` と `undo` と `done` の状態である（[ui.tsx:1666](../../../components/ui.tsx#L1666)）。
- `SegOption` は `key` を核に `icon` や `label` を持つ選択肢である（[ui.tsx:314-328](../../../components/ui.tsx#L314-L328)）。
- `SelectOption` は `key` と `label` と任意 `icon` の選択肢である（[ui.tsx:439](../../../components/ui.tsx#L439)）。 <!-- b_csaax45z -->

## 処理の流れ <!-- b_5zb0t35w -->

1. `Inspector` が選択中 `item` と `frame` を受けて編集パネルを開く（[Inspector.tsx:343-350](../../../components/Inspector.tsx#L343-L350)）。
2. 行部品が `value` と `onChange` で編集し `Partial<Item>` を返す（[ui.tsx:624-625](../../../components/ui.tsx#L624-L625)、[PartPanel.tsx:449](../../../components/PartPanel.tsx#L449)）。
3. `TriggerSection` が `allFrames` から遷移先を選び `TapStage` で確認する（[PartPanel.tsx:391-394](../../../components/PartPanel.tsx#L391-L394)、[TapStage.tsx:152-159](../../../components/TapStage.tsx#L152-L159)）。
4. `IconPicker` が `value` のアイコン選択を別層で受け付ける（[IconPicker.tsx:22-29](../../../components/IconPicker.tsx#L22-L29)）。 <!-- b_2tzq2teg -->

## 設定 <!-- b_skc1vknk -->

- `IconPicker` は `NEXT_PUBLIC_BASE_PATH` を既定解決に読む（[IconPicker.tsx:22-29](../../../components/IconPicker.tsx#L22-L29)、[IconPicker.tsx:67](../../../components/IconPicker.tsx#L67)）。 <!-- b_9r5fq4tx -->

## 落とし穴 <!-- b_nhtdjzp7 -->

> [!WARNING]
> **落とし穴**
> - 新種別は `Kind` 系と `KIND_TEXT` と描画と文言と専用 editor の 5 箇所を同時に変える（[CONTRIBUTING.md:43-49](../../../CONTRIBUTING.md#L43-L49)）。
> - 専用 editor は `components/Inspector.tsx` に足し、触れる部品は `components/Preview.tsx` の tap 対象にも足す（[CONTRIBUTING.md:49](../../../CONTRIBUTING.md#L49)）。
> - 文言は日英中韓の 4 言語に必ず足し、1 言語だけの追加はしない（[CONTRIBUTING.md:53-54](../../../CONTRIBUTING.md#L53-L54)）。
> - 部品は palette token からのみ描き、editor chrome と経路を分ける（[CONTRIBUTING.md:57-58](../../../CONTRIBUTING.md#L57-L58)）。
> - 提出前は `npm run typecheck` と `npm test` と `npm run build` を回し、CI も同じ 3 つを見る（[CONTRIBUTING.md:65](../../../CONTRIBUTING.md#L65)）。 <!-- b_1tcwrtqe -->

> [!TIP]
> **まとめ**
> 編集パネルと汎用入力を押さえれば、このモジュールの見通しは良い。 <!-- b_g96695t0 -->
