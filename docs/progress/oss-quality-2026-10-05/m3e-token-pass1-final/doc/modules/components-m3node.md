# 部品描画とモバイル編集 <!-- b_4rrjdmzb -->

- ファイル 9 · 3715 行 · 重要度 0.40
<!-- b_565etejs -->

**変更の手引き**
- 影響が及ぶ先（このモジュールを使う）: [編集画面と保存共有](app.md)・[部品編集パネル群](components-ui.md)・[プロンプトと多言語化](lib-prompt.md)・[部品定義と整形基盤](lib-tokens.md)
- 使っているもの: [部品定義と整形基盤](lib-tokens.md)・[プロンプトと多言語化](lib-prompt.md)・[部品編集パネル群](components-ui.md)
- テスト: `components/Loading.test.tsx`（2 件）・`lib/shapes.extended.test.ts`（20 件）・`lib/shapes.test.ts`（10 件） · 実行: `npm test`
- 入口から: `GET / → components/M3Node.tsx`（`app/page.tsx:37`）
- よく使われる宣言（変えると波及する）: `Icon` `components/M3Node.tsx:81`（21 ファイル）・`ensureFontLoaded` `lib/theme.ts:16`（3 ファイル）・`LoadingIndicator` `components/Loading.tsx:54`（2 ファイル）・`M3Node` `components/M3Node.tsx:1791`（2 ファイル）・`M3Static` `components/M3Node.tsx:1939`（2 ファイル）
- 一緒に変わりやすいファイル（直近 79 commit）: `components/Inspector.tsx` 25 回・`lib/tokens.ts` 25 回・`lib/i18n.ts` 23 回・`lib/prompt.ts` 19 回・`app/Editor.tsx` 13 回
- 注意: ハブ（多くから使われ、多くを使う）・大きいファイル `components/M3Node.tsx`（1,976 行）・循環依存（[プロンプトと多言語化](lib-prompt.md)・[編集画面と保存共有](app.md)・[部品編集パネル群](components-ui.md) ほか 1 と）
<!-- b_f2gqpfpq -->

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
<!-- b_g7v6hrfp -->

> [!NOTE]
> **この章で分かること**
> - `M3Node` 中心の描画構造を学ぶ。
> - モバイル編集 UI とテーマ調整の役割を学ぶ。
> - ローディング形状補間の仕組みを学ぶ。 <!-- b_wamd3a4p -->

## 責務 <!-- b_xn3d5ddv -->

このモジュールは `Item` の描画とモバイル向け編集体験を担う（[M3Node.tsx:1939-1946](../../../components/M3Node.tsx#L1939-L1946)）。中心の `M3Node` が部品を描き、`MobileInspector` や `ShapePanel` が小画面での編集と形状調整を受け持つ（[M3Node.tsx:1791-1798](../../../components/M3Node.tsx#L1791-L1798)、[Mobile.tsx:97-104](../../../components/Mobile.tsx#L97-L104)、[ThemePanel.tsx:62](../../../components/ThemePanel.tsx#L62)）。プロンプト文と配色の生成は別ファイルが担い、ここでは扱わない（[CONTRIBUTING.md:36-37](../../../CONTRIBUTING.md#L36-L37)）。 <!-- b_8ba51kx2 -->

## 公開インターフェース <!-- b_v4h2tg8c -->

- `M3Node` は編集キャンバス向けの対話付き描画に使う（[M3Node.tsx:1791-1798](../../../components/M3Node.tsx#L1791-L1798)）。
- `M3Static` はプレビュー向けの静止描画に使う（[M3Node.tsx:1939-1946](../../../components/M3Node.tsx#L1939-L1946)）。
- `Icon`、`Ripples`、`rippleSize`、`RIPPLE_GROW` はアイコン表示と押下反応に使う（[M3Node.tsx:81-88](../../../components/M3Node.tsx#L81-L88)、[M3Node.tsx:131](../../../components/M3Node.tsx#L131)、[M3Node.tsx:134](../../../components/M3Node.tsx#L134)、[M3Node.tsx:142](../../../components/M3Node.tsx#L142)）。
- `LoadingIndicator`、`LinearProgress`、`CircularProgress` は読み込み表示に使う（[Loading.tsx:54-61](../../../components/Loading.tsx#L54-L61)、[Loading.tsx:122-129](../../../components/Loading.tsx#L122-L129)、[Loading.tsx:243-250](../../../components/Loading.tsx#L243-L250)）。
- `CarouselBody`、`DatePickerBody`、`TimePickerBody` はピッカー本体の描画に使う（[Pickers.tsx:30](../../../components/Pickers.tsx#L30)、[Pickers.tsx:204](../../../components/Pickers.tsx#L204)、[Pickers.tsx:307](../../../components/Pickers.tsx#L307)）。
- `BottomSheet`、`MobileInspector`、`CardStage` はモバイル編集とカード調整に使う（[Mobile.tsx:15](../../../components/Mobile.tsx#L15)、[Mobile.tsx:97-104](../../../components/Mobile.tsx#L97-L104)、[CardStage.tsx:70](../../../components/CardStage.tsx#L70)）。
- `ShapePanel`、`TypePanel`、`MotionPanel` は形状・書体・モーション調整に使う（[ThemePanel.tsx:62](../../../components/ThemePanel.tsx#L62)、[ThemePanel.tsx:110](../../../components/ThemePanel.tsx#L110)、[ThemePanel.tsx:157](../../../components/ThemePanel.tsx#L157)）。
- `getShapes`、`morphedShape`、`LoadingAnimator`、`ThemeContext` は形状補間とテーマ共有に使う（[shapes.ts:154-162](../../../lib/shapes.ts#L154-L162)、[shapes.ts:164-170](../../../lib/shapes.ts#L164-L170)、[shapes.ts:205-212](../../../lib/shapes.ts#L205-L212)、[theme.ts:9-10](../../../lib/theme.ts#L9-L10)）。 <!-- b_716bh1cp -->

## 依存関係 <!-- b_6x9c9j0w -->

描画と文言のため `lib` の `ColorPanel` 系と `lib` の `aiErrorText` 系に依存する（推測）。共通部品として `components` の `IconPicker` 系を使う（推測）。利用側は `app` の `Editor` と `components` の `ButtonInspector` 系である（推測）。 <!-- b_3af1d8h6 -->

## データ構造 <!-- b_hxn4411x -->

- `Ripple` は `id`、`part`、`pointer`、`x`、`y`、`d` で押下を表す（[M3Node.tsx:115-117](../../../components/M3Node.tsx#L115-L117)、[M3Node.tsx:119-122](../../../components/M3Node.tsx#L119-L122)）。
- `Point` は x 座標と y 座標の組である（[shapes.ts:10](../../../lib/shapes.ts#L10)）。
- `Spring` は `pos`、`vel`、`target` を積分で進める（[shapes.ts:180-186](../../../lib/shapes.ts#L180-L186)）。
- `LoadingAnimator` は `rotation` と `morph` を時刻から求める（[shapes.ts:205-212](../../../lib/shapes.ts#L205-L212)）。 <!-- b_vgv4npkk -->

## 処理の流れ <!-- b_pfhm9emf -->

1. `LoadingAnimator` の `update` が周期から `Spring` の `target` を進める（[shapes.ts:180-186](../../../lib/shapes.ts#L180-L186)、[shapes.ts:205-212](../../../lib/shapes.ts#L205-L212)、[shapes.ts:218-229](../../../lib/shapes.ts#L218-L229)）。
2. `Spring` の `step` が 12 分割で `pos` を追従させる（[shapes.ts:180-186](../../../lib/shapes.ts#L180-L186)、[shapes.ts:190-197](../../../lib/shapes.ts#L190-L197)）。
3. `morphedShape` が `getShapes` の隣接形状間を線形補間する（[shapes.ts:164-177](../../../lib/shapes.ts#L164-L177)）。
4. `getShapes` が初回に正規化と再標本化し、以後はキャッシュを返す（[shapes.ts:154-162](../../../lib/shapes.ts#L154-L162)）。 <!-- b_64s9kqrn -->

## テスト <!-- b_tc05nh4q -->

- `getShapes` が 7 形状を同一要素数で返し、正規化とキャッシュを行うことを確認する（[shapes.extended.test.ts:26](../../../lib/shapes.extended.test.ts#L26)、[shapes.extended.test.ts:31](../../../lib/shapes.extended.test.ts#L31)、[shapes.extended.test.ts:41](../../../lib/shapes.extended.test.ts#L41)、[shapes.extended.test.ts:60](../../../lib/shapes.extended.test.ts#L60)）。
- `morphedShape` が整数位置で一致し、中間補間と両端循環することを確認する（[shapes.test.ts:33](../../../lib/shapes.test.ts#L33)、[shapes.test.ts:38](../../../lib/shapes.test.ts#L38)、[shapes.test.ts:44](../../../lib/shapes.test.ts#L44)、[shapes.extended.test.ts:77](../../../lib/shapes.extended.test.ts#L77)）。
- 線形プログレスのトラック厚と可視ギャップを確認する（[Loading.test.tsx:94](../../../components/Loading.test.tsx#L94)、[Loading.test.tsx:54](../../../components/Loading.test.tsx#L54)）。 <!-- b_qqxnd102 -->

## 不変条件 <!-- b_0ypjx22z -->

- `getShapes` は 2 回目以降同一のキャッシュ配列を返す（[shapes.ts:154-162](../../../lib/shapes.ts#L154-L162)）。
- 各形状は `POINTS_PER_SHAPE` 点に再標本化される（[shapes.ts:14](../../../lib/shapes.ts#L14)、[shapes.ts:154-162](../../../lib/shapes.ts#L154-L162)）。
- `morphedShape` は `SHAPE_COUNT` で剰余を取って前後形状を循環させる（[shapes.ts:164-169](../../../lib/shapes.ts#L164-L169)）。 <!-- b_emengn7m -->

## 性能 <!-- b_5jz4f0db -->

`getShapes` は初回のみ SVG 解析と正規化を行い、以後はキャッシュを返す（[shapes.ts:154-162](../../../lib/shapes.ts#L154-L162)）。`Spring` の `step` は 1 更新を 12 分割積分し、`LoadingAnimator` の `update` は `dt` を 0.1 秒に制限する（[shapes.ts:180-186](../../../lib/shapes.ts#L180-L186)、[shapes.ts:190-197](../../../lib/shapes.ts#L190-L197)、[shapes.ts:205-212](../../../lib/shapes.ts#L205-L212)、[shapes.ts:218-222](../../../lib/shapes.ts#L218-L222)）。 <!-- b_k6bjkxva -->

## 落とし穴 <!-- b_1ag7smsw -->

> [!WARNING]
> **落とし穴**
> - 新しい部品種別は `lib/tokens.ts`、`lib/i18n.ts`、`components/M3Node.tsx`、`lib/prompt.ts`、`components/Inspector.tsx` を連動更新する（[CONTRIBUTING.md:41-50](../../../CONTRIBUTING.md#L41-L50)）。
> - `components/M3Node.tsx` 描画では `MEASURED` と `NO_BOX` の該当判定を更新する（[CONTRIBUTING.md:47](../../../CONTRIBUTING.md#L47)、[M3Node.tsx:229](../../../components/M3Node.tsx#L229)）。
> - 部品はパレットトークンのみで描き、4 言語の文言を同時に足す（[CONTRIBUTING.md:53-58](../../../CONTRIBUTING.md#L53-L58)）。
> - 検証は `npm run typecheck`、`npm test`、`npm run build` で行う（[CONTRIBUTING.md:65](../../../CONTRIBUTING.md#L65)）。 <!-- b_e6ws3svy -->

> [!TIP]
> **まとめ**
> 描画核とモバイル編集・テーマ調整を押さえれば、このモジュールの全体像をつかめる。 <!-- b_csr52xdc -->
