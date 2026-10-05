# 寸法と色と整形基盤 <!-- b_vqeyxqe3 -->

- ファイル 8 · 4799 行 · 重要度 1.00
<!-- b_vcdsbjg7 -->

**変更の手引き**
- 影響が及ぶ先（このモジュールを使う）: [編集画面の外枠](app.md)・[検査器と汎用パネル](components-ui.md)・[部品描画と携帯面](components-m3node.md)・[指示文と多言語と AI](lib-prompt.md)
- 使っているもの: [指示文と多言語と AI](lib-prompt.md)・[検査器と汎用パネル](components-ui.md)・[部品描画と携帯面](components-m3node.md)
- テスト: `lib/tokens.extended.test.ts`（52 件）・`lib/color.extended.test.ts`（28 件）・`lib/prompt.extended.test.ts`（25 件）・`lib/button.test.ts`（24 件） ほか 8 · 実行: `npm test`
- 入口から: `GET /`（`app/page.tsx:37`）
- よく使われる宣言（変えると波及する）: `Palette` `lib/tokens.ts:216`（26 ファイル）・`Item` `lib/tokens.ts:1626`（15 ファイル）・`Frame` `lib/tokens.ts:2117`（13 ファイル）・`Group` `lib/tokens.ts:2317`（9 ファイル）・`Kind` `lib/tokens.ts:581`（8 ファイル）
- 一緒に変わりやすいファイル（直近 79 commit）: `components/Inspector.tsx` 27 回・`lib/i18n.ts` 26 回・`components/M3Node.tsx` 23 回・`lib/prompt.ts` 22 回・`app/Editor.tsx` 14 回
- 注意: ハブ（多くから使われ、多くを使う）・大きいファイル `components/Preview.tsx`（1,575 行）・大きいファイル `lib/tokens.ts`（2,732 行）・循環依存（[指示文と多言語と AI](lib-prompt.md)・[編集画面の外枠](app.md)・[検査器と汎用パネル](components-ui.md) ほか 1 と）
<!-- b_vjy4g3ng -->

**大きなファイルの中身（1,500 行を超えるファイル）**
- `components/Preview.tsx`（1,575 行）
  - `components/Preview.tsx:77-80` 定数・変数（3）: `EASE`・`SLIDE_MS`・`WIDE_CONTROL_SPACE`
  - `components/Preview.tsx:82-82` 型: `Anim`
  - `components/Preview.tsx:85-85` 定数・変数: `SPRING`
  - `components/Preview.tsx:87-87` 型: `Entry`
  - `components/Preview.tsx:89-92` 関数（2）: `pct`・`off`
  - `components/Preview.tsx:94-94` 型: `Pose`
  - `components/Preview.tsx:97-142` 関数: `poses`
  - `components/Preview.tsx:144-151` 定数・変数（2）: `screenVariants`・`TOGGLES`
  - `components/Preview.tsx:154-170` 関数（2）: `flips`・`flippedLook`
  - `components/Preview.tsx:176-178` 定数・変数（2）: `TAP_LIT`・`SMOOTH_SCROLL_MS`
  - `components/Preview.tsx:179-179` 型: `Shape`
  - `components/Preview.tsx:181-187` 関数: `sameShapes`
  - `components/Preview.tsx:191-727` Tappable（関数）
    - `components/Preview.tsx:222-230` 状態（useRef 2・useState 2・useLang 1）: `lang`・`pressed`・`ripples`・`nextRipple`
    - `components/Preview.tsx:231-268` 内部の関数（3）: `endRipple`・`addRipple`・`endRipples`
    - `components/Preview.tsx:269-292` 副作用（useRef 8・useEffect 1・useState 1）: `dragging`・`settling`・`settleTimer`・`settlingTimer`
    - `components/Preview.tsx:293-326` 内部の関数（2）: `settleRow`・`restRow`
    - `components/Preview.tsx:327-333` 副作用（useEffect 1）
    - `components/Preview.tsx:334-373` 内部の関数: `dragRow`
    - `components/Preview.tsx:374-401` 副作用（useEffect 1・useRef 1・useState 1）: `menuCorner`・`cornerRef`
    - `components/Preview.tsx:402-406` 状態（useRef 1・useState 1）: `ref`・`shapes`
    - `components/Preview.tsx:407-467` 副作用（useEffect 2・useLayoutEffect 1）
    - `components/Preview.tsx:468-477` 内部の関数: `dragValue`
    - `components/Preview.tsx:478-540` 計算値（useMemo 1）: `cardSlots`
    - `components/Preview.tsx:541-726` 描画（JSX）
  - `components/Preview.tsx:729-729` 定数・変数: `ellipsisText`
  - `components/Preview.tsx:731-1016` 関数: `Screen`
  - `components/Preview.tsx:1019-1019` 型: `Peek`
  - `components/Preview.tsx:1021-1575` Preview（関数）
    - `components/Preview.tsx:1034-1049` 状態（useState 6・useRef 3・useLang 1）: `lang`・`stack`・`anim`・`scale`
    - `components/Preview.tsx:1050-1075` 内部の関数: `flip`
    - `components/Preview.tsx:1076-1094` 副作用（useMotionValue 4・useEffect 2）: `prog`・`shellW`・`shellH`・`screenRadius`
    - `components/Preview.tsx:1095-1107` 状態（useTransform 5・useState 1）: `screenW`・`screenH`・`shellRadius`・`shellLeft`
    - `components/Preview.tsx:1108-1122` 副作用（useEffect 1）
    - `components/Preview.tsx:1123-1167` 内部の関数（3）: `sameSize`・`back`・`go`
    - `components/Preview.tsx:1168-1190` 副作用（useMemo 2・useEffect 1）: `groups`・`peekGroups`
    - `components/Preview.tsx:1191-1217` 状態（useTransform 5・useMotionValue 3・useRef 1）: `axisMV`・`enterMV`・`exitMV`・`curX`
    - `components/Preview.tsx:1218-1293` 副作用（useEffect 1）
    - `components/Preview.tsx:1294-1297` 状態（useRef 2）: `pickerRef`・`pickerButton`
    - `components/Preview.tsx:1298-1343` 副作用（useEffect 2）
    - `components/Preview.tsx:1344-1574` 描画（JSX）
- `lib/tokens.ts`（2,732 行）
  - `lib/tokens.ts:5-214` geometry — 定数・変数 50・関数 18・型 6: `H`・`BUTTON_SIZES`・`ButtonSizeKey`・`BUTTON_H_MIN`
  - `lib/tokens.ts:215-434` color — 定数・変数 3・型 1: `Palette`・`ERROR`・`PRESETS`・`PALETTES`
  - `lib/tokens.ts:435-548` theme: the four expressive axes — 関数 9・定数・変数 6・型 4: `ShapeScale`・`FontKey`・`MotionScheme`・`Theme`
  - `lib/tokens.ts:549-579` contrast roles a component can take — 関数 2・定数・変数 1・型 1: `Variant`・`VARIANTS`・`variantStyle`・`variantShadow`
  - `lib/tokens.ts:580-1620` component kinds — 関数 21・型 11・定数・変数 10: `Kind`・`CarouselLayout`・`CAROUSEL_LAYOUTS`・`DateLayout`
  - `lib/tokens.ts:924-1580` KIND_SPEC（定数）
  - `lib/tokens.ts:1621-2689` screen data — 関数 83・定数・変数 44・型 24: `NavTab`・`Item`・`ToggleLook`・`TOGGLEABLE`
  - `lib/tokens.ts:2690-2733` icon slots — 関数 2・型 1: `IconSlot`・`iconSlotsOf`・`setIconSlot`
<!-- b_7rbhqrjf -->

> [!NOTE]
> **この章で分かること**
> - 寸法と色と配置の受け持ちが分かる
> - 主要な型と関数の使い分けが分かる
> - 整形から試写までの流れが分かる <!-- b_f3h04haz -->

## 責務 <!-- b_w3brp2t4 -->

M3 部品の寸法と色と配置の土台である（推測）。
`KIND_SPEC` と `sizeOf` と `baseRadii` が既定値と外形と角丸を決める（[tokens.ts:924](../../../lib/tokens.ts#L924)、[tokens.ts:2448](../../../lib/tokens.ts#L2448)、[tokens.ts:2530](../../../lib/tokens.ts#L2530)）。
`schemeFromSeed` と `paletteOf` が種色から `Palette` を作り、`tidyFrame` が整列を担う（[color.ts:131](../../../lib/color.ts#L131)、[tokens.ts:538](../../../lib/tokens.ts#L538)、[tokens.ts:216](../../../lib/tokens.ts#L216)、[tidy.ts:388](../../../lib/tidy.ts#L388)）。
`Editor` の状態保持や文章生成や AI 呼び出しは持たない（推測）。 <!-- b_bp35ykes -->

## 公開インターフェース <!-- b_kr3yxh1v -->

- `makeItem` は `KIND_SPEC` の既定値で `Item` を作る（[tokens.ts:2383-2386](../../../lib/tokens.ts#L2383-L2386)）。
- `sizeOf` は `Item` と `widths` から幅と高さを決める（[tokens.ts:2448-2450](../../../lib/tokens.ts#L2448-L2450)）。
- `baseRadii` は種別ごとの角丸を返す（[tokens.ts:2530-2532](../../../lib/tokens.ts#L2530-L2532)）。
- `KIND_SPEC` は全種別の既定値と仕様を持つ（[tokens.ts:924](../../../lib/tokens.ts#L924)）。
- `schemeFromSeed` は種色から `Palette` を生成する（[color.ts:131](../../../lib/color.ts#L131)）。
- `paletteOf` はキーと `Theme` から使う `Palette` を選ぶ（[tokens.ts:538-539](../../../lib/tokens.ts#L538-L539)）。
- `tidyFrame` は `Frame` 内の `Group` 群を整える（[tidy.ts:388](../../../lib/tidy.ts#L388)）。
- `Preview` は `Doc` を試写して遷移を動かす（[Preview.tsx:1021-1028](../../../components/Preview.tsx#L1021-L1028)）。 <!-- b_zmbz7pzc -->

## 依存関係 <!-- b_y9bzhjsc -->

- `aiErrorText` らのある lib に依存する（推測）。
- `IconPicker` らのある components と `LoadingIndicator` らのある components と結ばれる（推測）。
- `Editor` のある app から使われる土台である（推測）。 <!-- b_jswsrf1n -->

## データ構造 <!-- b_rgcezmvj -->

- `Item` は `id` と `kind` と `label` と `icon` と `variant` を持つ（[tokens.ts:1626-1632](../../../lib/tokens.ts#L1626-L1632)）。
- `Group` は `id` と `x` と `y` と `axis` と `items` を持つ（[tokens.ts:2317-2322](../../../lib/tokens.ts#L2317-L2322)）。
- `Frame` は `id` と `name` と `x` と `y` と `w` と `h` を持つ（[tokens.ts:2117-2121](../../../lib/tokens.ts#L2117-L2121)、[tokens.ts:2123-2124](../../../lib/tokens.ts#L2123-L2124)）。
- `Doc` は `groups` と `frames` と `paletteKey` と `title` を持つ（[tokens.ts:2340-2343](../../../lib/tokens.ts#L2340-L2343)、[tokens.ts:2351-2352](../../../lib/tokens.ts#L2351-L2352)）。
- `Palette` は `key` と `label` と `primary` 系の色役割を持つ（[tokens.ts:216-218](../../../lib/tokens.ts#L216-L218)、[tokens.ts:221](../../../lib/tokens.ts#L221)）。
- `Theme` は `dark` と `contrast` と `shape` と `font` と `motion` を持つ（[tokens.ts:441-442](../../../lib/tokens.ts#L441-L442)、[tokens.ts:445-447](../../../lib/tokens.ts#L445-L447)、[tokens.ts:450](../../../lib/tokens.ts#L450)）。 <!-- b_j7fxntgj -->

## 処理の流れ <!-- b_ga25d6ht -->

1. `makeItem` が種別から `Item` を起こす（[tokens.ts:2383](../../../lib/tokens.ts#L2383)）。
2. `sizeOf` が幅と高さを定める（[tokens.ts:2448](../../../lib/tokens.ts#L2448)）。
3. `baseRadii` が角丸を定める（[tokens.ts:2530](../../../lib/tokens.ts#L2530)）。
4. `tidyFrame` が `Frame` 内を整えて `Preview` が映す（[tidy.ts:388](../../../lib/tidy.ts#L388)、[Preview.tsx:1021](../../../components/Preview.tsx#L1021)）。 <!-- b_bvec5de8 -->

## テスト <!-- b_hq1awd7s -->

ボタンの寸法段階は公称値の保持と補間と範囲内保持と描画への反映を確かめる（[button.test.ts:46](../../../lib/button.test.ts#L46)、[button.test.ts:53](../../../lib/button.test.ts#L53)、[button.test.ts:60](../../../lib/button.test.ts#L60)、[button.test.ts:67](../../../lib/button.test.ts#L67)）。
リンク先の解釈は裸のホストの https 化と危険な方式の除外を確かめる（[button.test.ts:80](../../../lib/button.test.ts#L80)、[button.test.ts:86](../../../lib/button.test.ts#L86)）。
プレビューの modal 系は待機画面の無害化と鍵盤処理の登録と終了時の扱いを確かめる（[Preview.test.tsx:101](../../../components/Preview.test.tsx#L101)、[Preview.test.tsx:130](../../../components/Preview.test.tsx#L130)、[Preview.test.tsx:142](../../../components/Preview.test.tsx#L142)）。 <!-- b_434ck9r6 -->

## 不変条件 <!-- b_339ww0zn -->

- `frameSizeOf` は欠けた `w` と `h` を `PHONE_W` と `PHONE_H` で補う（[tokens.ts:2147](../../../lib/tokens.ts#L2147)）。
- `chipHeightOf` は `CHIP_H_MIN` から `CHIP_H_MAX` に収める（[tokens.ts:1759](../../../lib/tokens.ts#L1759)）。
- `railWidth` は `railExpanded` と `isWideRail` で三通りに定まる（[tokens.ts:152-153](../../../lib/tokens.ts#L152-L153)）。
- `normalizeTheme` は未知の `contrast` と `shape` と `font` を既定値に戻す（[tokens.ts:456-464](../../../lib/tokens.ts#L456-L464)）。 <!-- b_7ma423ph -->

## エラー処理 <!-- b_v94fyshp -->

- `hexToRgb` は解釈できない入力に `null` を返す（[color.ts:16](../../../lib/color.ts#L16)）。
- `linkUrlOf` は空や http と https 以外や不正な `URL` に `null` を返す（[tokens.ts:1711-1719](../../../lib/tokens.ts#L1711-L1719)）。
- `tidyFrame` は `Group[]` か `null` を返す（[tidy.ts:388](../../../lib/tidy.ts#L388)）。 <!-- b_6h11ws5b -->

## 落とし穴 <!-- b_e6j2sfxg -->

> [!WARNING]
> **落とし穴**
> - `curShape` は `setGlobalShape` で変わる大域状態で `getShape` が読む（[tokens.ts:517-518](../../../lib/tokens.ts#L517-L518)、[tokens.ts:521](../../../lib/tokens.ts#L521)）。
> - `railExpansionSide` と `fabOpen` と `menuUp` は `Symbol` の付帯状態で写しに出にくい（[tokens.ts:157](../../../lib/tokens.ts#L157)、[tokens.ts:1852](../../../lib/tokens.ts#L1852)、[tokens.ts:1854](../../../lib/tokens.ts#L1854)）。
> - `KIND_SPEC` を足すときは `makeItem` と `sizeOf` と `baseRadii` の分岐を合わせる（[tokens.ts:924](../../../lib/tokens.ts#L924)、[tokens.ts:2383-2384](../../../lib/tokens.ts#L2383-L2384)、[tokens.ts:2448-2449](../../../lib/tokens.ts#L2448-L2449)、[tokens.ts:2530-2531](../../../lib/tokens.ts#L2530-L2531)）。 <!-- b_r829t48r -->

## 深掘り <!-- b_en6g7n2x -->

> [!NOTE]
> **深掘り**
> 行への束ね方と隙間と寄せの決め方の詳細。 <!-- b_zx02ywym -->

> [!TIP]
> **まとめ**
> 寸法と色と整形の土台を押さえれば他画面の読み解きが速くなる。 <!-- b_0hecv3hk -->
