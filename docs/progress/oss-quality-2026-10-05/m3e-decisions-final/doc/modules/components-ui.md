# 検査器と汎用パネル（components） <!-- b_tdqkt13y -->

- ファイル 8 · 5484 行 · 重要度 0.29
<!-- b_2kk78x1r -->

**変更の手引き**
- 影響が及ぶ先（このモジュールを使う）: [編集画面外枠](app.md)・[部品描画と携帯面](components-m3node.md)・[寸法と色と整形基盤](lib-tokens.md)・[指示文と多言語と AI](lib-prompt.md)
- 使っているもの: [指示文と多言語と AI](lib-prompt.md)・[部品描画と携帯面](components-m3node.md)・[寸法と色と整形基盤](lib-tokens.md)
- テスト: 見つかりませんでした
- よく使われる宣言（変えると波及する）: `Segmented` `components/ui.tsx:334`（10 ファイル）・`IconBtn` `components/ui.tsx:255`（8 ファイル）・`Field` `components/ui.tsx:607`（8 ファイル）・`Section` `components/ui.tsx:1409`（7 ファイル）・`AiHooks` `components/Inspector.tsx:261`（4 ファイル）
- 一緒に変わりやすいファイル（直近 79 commit）: `lib/i18n.ts` 27 回・`lib/tokens.ts` 25 回・`components/M3Node.tsx` 22 回・`lib/prompt.ts` 22 回・`app/Editor.tsx` 16 回
- 注意: ハブ（多くから使われ、多くを使う）・大きいファイル `components/ui.tsx`（1,935 行）・テストが無い・循環依存（[指示文と多言語と AI](lib-prompt.md)・[編集画面外枠](app.md)・[寸法と色と整形基盤](lib-tokens.md) ほか 1 と）
<!-- b_t4m0nn7q -->

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
<!-- b_fehtxzta -->

> [!NOTE]
> **この章で分かること**
> - 検査器群と汎用部品の分担を学ぶ
> - 主要な編集入口と表示部品の使い分けを学ぶ
> - 外部取得と表示上限の扱いを学ぶ <!-- b_tyymppqf -->

## 責務 <!-- b_vkfww9w6 -->

右ペインに集まる検査器と汎用部品を束ねる編集支援層である（[Inspector.tsx:343-350](../../../components/Inspector.tsx#L343-L350)、[ui.tsx:27-34](../../../components/ui.tsx#L27-L34)）。選択対象に応じた属性編集と画面編集と遷移編集の入口を担う（[ButtonInspector.tsx:133-140](../../../components/ButtonInspector.tsx#L133-L140)、[PartInspector.tsx:365-372](../../../components/PartInspector.tsx#L365-L372)、[FramePanel.tsx:152-159](../../../components/FramePanel.tsx#L152-L159)、[TapStage.tsx:152-159](../../../components/TapStage.tsx#L152-L159)）。文書の保存や共有やプロンプト生成自体は担わない（推測）。 <!-- b_zg2y0scn -->

## 公開インターフェース <!-- b_ad8dnf4q -->

- `Inspector` は対象と枠と候補画面を受けて編集パネルを開く入口である（[Inspector.tsx:343-350](../../../components/Inspector.tsx#L343-L350)）。
- `ButtonInspector` はボタン系部品の属性変更と複製と削除を受け持つ（[ButtonInspector.tsx:133-140](../../../components/ButtonInspector.tsx#L133-L140)）。
- `PartInspector` は汎用部品の属性変更と複製と削除を受け持つ（[PartInspector.tsx:365-372](../../../components/PartInspector.tsx#L365-L372)）。
- `FrameInspector` は画面の属性変更と複製と削除とプレビューを受け持つ（[FramePanel.tsx:152-159](../../../components/FramePanel.tsx#L152-L159)）。
- `PanelShell` は施錠表示とヘッダーを持つパネル枠を提供する（[ui.tsx:27-34](../../../components/ui.tsx#L27-L34)）。
- `Field` は単行と複数行と伸長する入力欄を提供する（[ui.tsx:607-616](../../../components/ui.tsx#L607-L616)）。
- `IconPicker` は現在値と追加候補を受けてアイコン選択を提供する（[IconPicker.tsx:22-29](../../../components/IconPicker.tsx#L22-L29)）。
- `TapStage` は自画面と動作を受けて遷移先の小舞台を示す（[TapStage.tsx:152-159](../../../components/TapStage.tsx#L152-L159)）。 <!-- b_fmphw9c8 -->

## 依存関係 <!-- b_5vx5bzah -->

lib の `Palette` を受けて色調に沿う（[ui.tsx:611](../../../components/ui.tsx#L611)、[ui.tsx:627](../../../components/ui.tsx#L627)）。lib の `useLang` で表示言語を拾い文言に沿う（[ui.tsx:649](../../../components/ui.tsx#L649)）。components の `Icon` でボタン面の画像を描く（[ui.tsx:309](../../../components/ui.tsx#L309)）。app の `Editor` から右ペインとして利用される（推測）。 <!-- b_5xv9h1qh -->

## データ構造 <!-- b_dypa8n9s -->

- `SegOption` は `key` を核に `icon` と `label` を添える選択肢である（[ui.tsx:314-318](../../../components/ui.tsx#L314-L318)）。
- `SelectOption` は `key` と `label` に任意の `icon` を添えるプルダウンの項目である（[ui.tsx:439](../../../components/ui.tsx#L439)）。
- `AiHooks` は `ready` と `busy` に `onRun` と `onCancel` を束ねる書き出し操作の束である（[Inspector.tsx:261](../../../components/Inspector.tsx#L261)）。
- `Tab` は `design` と `behavior` の二択でデザインと振る舞いを切り替える（[PartPanel.tsx:50](../../../components/PartPanel.tsx#L50)）。
- `PlaceFn` は 3 行 3 列のマスを受けて配置する関数である（[PartPanel.tsx:53-55](../../../components/PartPanel.tsx#L53-L55)）。
- `TidyState` は `tidy` と `undo` と `done` の三態で整頓ボタンの状態を示す（[ui.tsx:1666](../../../components/ui.tsx#L1666)、[ui.tsx:1670-1677](../../../components/ui.tsx#L1670-L1677)）。 <!-- b_dcj7m8k6 -->

## 設定 <!-- b_9v6btw8v -->

- `NEXT_PUBLIC_BASE_PATH` を基点にアイコン元の一覧を取得する（[IconPicker.tsx:67](../../../components/IconPicker.tsx#L67)）。 <!-- b_tgbtfye2 -->

## 性能 <!-- b_wstse6yy -->

- `glyphOk` で字形の可否を覚えて再判定を省く（[IconPicker.tsx:9](../../../components/IconPicker.tsx#L9)、[IconPicker.tsx:13](../../../components/IconPicker.tsx#L13)）。
- `BATCH` と `SHOWN` でアイコンの走査と表示を抑える（[IconPicker.tsx:19-20](../../../components/IconPicker.tsx#L19-L20)）。
- `MAX_IMAGE_PX` で読み込み画像の辺の大きさを抑える（[ui.tsx:1245](../../../components/ui.tsx#L1245)、[ui.tsx:1247](../../../components/ui.tsx#L1247)）。 <!-- b_zf28r9mq -->

## 落とし穴 <!-- b_ybnj2g6x -->

> [!WARNING]
> **落とし穴**
> - `PartTabs` は `idPrefix` を分けずに二重に置くとタブとパネルの識別子が衝突する（[PartPanel.tsx:74](../../../components/PartPanel.tsx#L74)）。
> - `hasTrigger` の対象は `TAPPABLE` に依存するので両者を合わせて変える必要がある（[PartPanel.tsx:1225](../../../components/PartPanel.tsx#L1225)）。 <!-- b_g2ehp5ga -->

## 深掘り <!-- b_0aj5gnq4 -->

> [!NOTE]
> **深掘り**
> 入力欄の人工知能による書き出し演出の全体像 <!-- b_ra7d3w4e -->

> [!TIP]
> **まとめ**
> 右ペインの編集パネルと汎用部品を押さえればこの層は足りる。 <!-- b_eekmec0e -->
