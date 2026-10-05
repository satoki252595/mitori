# 部品描画と携帯面 <!-- b_38j7keqf -->

- ファイル 9 · 3715 行 · 重要度 0.40
<!-- b_mphgjnty -->

**変更の手引き**
- 影響が及ぶ先（このモジュールを使う）: [編集画面の外枠](app.md)・[検査器と汎用パネル](components-ui.md)・[指示文と多言語と AI](lib-prompt.md)・[寸法と色と整形基盤](lib-tokens.md)
- 使っているもの: [寸法と色と整形基盤](lib-tokens.md)・[指示文と多言語と AI](lib-prompt.md)・[検査器と汎用パネル](components-ui.md)
- テスト: `components/Loading.test.tsx`（2 件）・`lib/shapes.extended.test.ts`（20 件）・`lib/shapes.test.ts`（10 件） · 実行: `npm test`
- 入口から: `GET / → components/M3Node.tsx`（`app/page.tsx:37`）
- よく使われる宣言（変えると波及する）: `Icon` `components/M3Node.tsx:81`（21 ファイル）・`ensureFontLoaded` `lib/theme.ts:16`（3 ファイル）・`LoadingIndicator` `components/Loading.tsx:54`（2 ファイル）・`M3Node` `components/M3Node.tsx:1791`（2 ファイル）・`M3Static` `components/M3Node.tsx:1939`（2 ファイル）
- 一緒に変わりやすいファイル（直近 79 commit）: `components/Inspector.tsx` 25 回・`lib/tokens.ts` 25 回・`lib/i18n.ts` 23 回・`lib/prompt.ts` 19 回・`app/Editor.tsx` 13 回
- 注意: ハブ（多くから使われ、多くを使う）・大きいファイル `components/M3Node.tsx`（1,976 行）・循環依存（[指示文と多言語と AI](lib-prompt.md)・[編集画面の外枠](app.md)・[検査器と汎用パネル](components-ui.md) ほか 1 と）
<!-- b_jbes5bkd -->

**大きなファイルの中身（1,500 行を超えるファイル）**
- `components/M3Node.tsx`（1,976 行）
  - `components/M3Node.tsx:76-111` 関数（2）: `useWeight`・`Icon`
  - `components/M3Node.tsx:115-128` 型: `Ripple`
  - `components/M3Node.tsx:131-131` 定数・変数: `RIPPLE_GROW`
  - `components/M3Node.tsx:134-168` 関数（2）: `rippleSize`・`Ripples`
  - `components/M3Node.tsx:171-171` 定数・変数: `RippleCtx`
  - `components/M3Node.tsx:174-221` 関数（2）: `RippleShape`・`useRipples`
  - `components/M3Node.tsx:223-242` 定数・変数（2）: `ellipsis`・`NO_BOX`
  - `components/M3Node.tsx:245-653` 関数（12）: `ButtonContent`・`ExtendedFabContent`・`ChipContent`・`SwitchContent`
  - `components/M3Node.tsx:656-671` 定数・変数（10）: `MENU_ROLL`・`MENU_STAGGER`・`MENU_BUTTON_ROLL`・`MENU_SHUT`
  - `components/M3Node.tsx:674-876` 関数（7）: `menuShutMs`・`menuEntriesShut`・`overTall`・`menuButtonWait`
  - `components/M3Node.tsx:878-1683` Body（関数）
    - `components/M3Node.tsx:879-1682` 状態（useLang 1・useWeight 1）: `lang`・`w`
  - `components/M3Node.tsx:1688-1784` 関数（3）: `contentColor`・`boxStyle`・`shadowOf`
  - `components/M3Node.tsx:1789-1789` 定数・変数: `RADIUS_TWEEN`
  - `components/M3Node.tsx:1791-1976` 関数（2）: `M3Node`・`M3Static`
<!-- b_rsrb4tga -->

> [!NOTE]
> **この章で分かること**
> - 描画核が部品をどう描くかを学ぶ
> - 形状補間と進捗表示の仕組みを学ぶ
> - 携帯用編集面の役割を学ぶ <!-- b_257spk30 -->

## 責務 <!-- b_zkvf6n07 -->

この層は `M3Node` と `M3Static` で部品描画を集める（[M3Node.tsx:1791-1798](../../../components/M3Node.tsx#L1791-L1798)、[M3Node.tsx:1939-1946](../../../components/M3Node.tsx#L1939-L1946)）。保存や共有、文面生成は担わない（推測）。 <!-- b_7mjkpm0a -->

## 公開インターフェース <!-- b_gctschbp -->

- `M3Node` は押下や選択つき部品の対話表示に使う（[M3Node.tsx:1791-1798](../../../components/M3Node.tsx#L1791-L1798)）。
- `M3Static` は寸法確定済み見本の静的表示に使う（[M3Node.tsx:1939-1946](../../../components/M3Node.tsx#L1939-L1946)）。
- `Icon` は名称指定の書体絵文字描画に使う（[M3Node.tsx:81-88](../../../components/M3Node.tsx#L81-L88)）。
- `LoadingIndicator` は回転変形つき読込表示に使う（[Loading.tsx:54-61](../../../components/Loading.tsx#L54-L61)）。
- `DatePickerBody` は月面つき日付選択の描画に使う（[Pickers.tsx:204](../../../components/Pickers.tsx#L204)）。
- `getShapes` は正規化済み補間元形状列の取得に使う（[shapes.ts:154-162](../../../lib/shapes.ts#L154-L162)）。
- `MobileInspector` は携帯画面用の属性編集面に使う（[Mobile.tsx:97-104](../../../components/Mobile.tsx#L97-L104)）。
- `ShapePanel` は角丸主題の切替操作面に使う（[ThemePanel.tsx:62](../../../components/ThemePanel.tsx#L62)）。 <!-- b_z8wa2cp2 -->

## 依存関係 <!-- b_exnh02cd -->

lib の `ColorPanel` と `Preview` による基盤と、`aiErrorText` による文面基盤に依存する（推測）。app の `Editor` と components の `IconPicker` 側から利用される（推測）。 <!-- b_714xaxhq -->

## データ構造 <!-- b_pqrda0y7 -->

- `Ripple` は `id` と `part`、`x` と `y`、`d` で押下光を表す（[M3Node.tsx:115-127](../../../components/M3Node.tsx#L115-L127)）。
- `Point` は形状点の座標対である（[shapes.ts:10](../../../lib/shapes.ts#L10)）。
- `LoadingAnimator` は `rotation` と `morph` を時刻進行で保つ（[shapes.ts:205-212](../../../lib/shapes.ts#L205-L212)）。 <!-- b_zd4yvswh -->

## 処理の流れ <!-- b_8ha95dzs -->

1. `getShapes` が SVG 定義を点列化して蓄える（[shapes.ts:154-162](../../../lib/shapes.ts#L154-L162)）。
2. `morphedShape` が前後形状を線形補間する（[shapes.ts:164-175](../../../lib/shapes.ts#L164-L175)）。
3. `LoadingAnimator` の `update` が時刻から周期を進める（[shapes.ts:205-206](../../../lib/shapes.ts#L205-L206)、[shapes.ts:218-230](../../../lib/shapes.ts#L218-L230)）。 <!-- b_4905nnhv -->

## テスト <!-- b_zr2ssrzt -->

`getShapes` の点数と正規化と再利用を確かめる（[shapes.test.ts:6](../../../lib/shapes.test.ts#L6)、[shapes.test.ts:14](../../../lib/shapes.test.ts#L14)、[shapes.test.ts:27](../../../lib/shapes.test.ts#L27)、[shapes.extended.test.ts:26](../../../lib/shapes.extended.test.ts#L26)）。`morphedShape` の一致と補間と循環を確かめる（[shapes.test.ts:33](../../../lib/shapes.test.ts#L33)、[shapes.test.ts:38](../../../lib/shapes.test.ts#L38)、[shapes.test.ts:44](../../../lib/shapes.test.ts#L44)、[shapes.extended.test.ts:77](../../../lib/shapes.extended.test.ts#L77)）。線形進捗の溝幅表示を確かめる（[Loading.test.tsx:94](../../../components/Loading.test.tsx#L94)）。 <!-- b_a70njwbd -->

## 不変条件 <!-- b_ngh25msc -->

- 全形状は `POINTS_PER_SHAPE` 点で揃う（[shapes.ts:154-162](../../../lib/shapes.ts#L154-L162)）。
- 補間係数は 0 から 1 に収まる（[shapes.ts:164-170](../../../lib/shapes.ts#L164-L170)）。 <!-- b_m0574bff -->

## 性能 <!-- b_ve5vkj0h -->

`getShapes` は初回点列を `cache` に保ち再計算しない（[shapes.ts:154-162](../../../lib/shapes.ts#L154-L162)）。`Spring` は微分を 12 分割して安定させる（[shapes.ts:180-183](../../../lib/shapes.ts#L180-L183)、[shapes.ts:190-197](../../../lib/shapes.ts#L190-L197)）。 <!-- b_2mt5z68k -->

## 落とし穴 <!-- b_16687gkc -->

> [!WARNING]
> **落とし穴**
> - `morphedShape` は前後列の長さが等しい前提で回す（[shapes.ts:164-175](../../../lib/shapes.ts#L164-L175)）。
> - `getShapes` は `cache` の実体を共有するため書換えが波及する（[shapes.ts:154-162](../../../lib/shapes.ts#L154-L162)）。 <!-- b_82e21yqx -->

> [!TIP]
> **まとめ**
> 描画核と形状補間と携帯面を押さえれば足りる。 <!-- b_h10kw30c -->
