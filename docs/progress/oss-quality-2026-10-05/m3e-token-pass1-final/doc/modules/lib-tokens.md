# 部品定義と整形基盤 <!-- b_8ykk66d5 -->

- ファイル 8 · 4799 行 · 重要度 1.00
<!-- b_mfz9115p -->

**変更の手引き**
- 影響が及ぶ先（このモジュールを使う）: [編集画面と保存共有](app.md)・[部品編集パネル群](components-ui.md)・[部品描画とモバイル編集](components-m3node.md)・[プロンプトと多言語化](lib-prompt.md)
- 使っているもの: [プロンプトと多言語化](lib-prompt.md)・[部品編集パネル群](components-ui.md)・[部品描画とモバイル編集](components-m3node.md)
- テスト: `lib/tokens.extended.test.ts`（52 件）・`lib/color.extended.test.ts`（28 件）・`lib/prompt.extended.test.ts`（25 件）・`lib/button.test.ts`（24 件） ほか 8 · 実行: `npm test`
- 入口から: `GET /`（`app/page.tsx:37`）
- よく使われる宣言（変えると波及する）: `Palette` `lib/tokens.ts:216`（26 ファイル）・`Item` `lib/tokens.ts:1626`（15 ファイル）・`Frame` `lib/tokens.ts:2117`（13 ファイル）・`Group` `lib/tokens.ts:2317`（9 ファイル）・`Kind` `lib/tokens.ts:581`（8 ファイル）
- 一緒に変わりやすいファイル（直近 79 commit）: `components/Inspector.tsx` 27 回・`lib/i18n.ts` 26 回・`components/M3Node.tsx` 23 回・`lib/prompt.ts` 22 回・`app/Editor.tsx` 14 回
- 注意: ハブ（多くから使われ、多くを使う）・大きいファイル `components/Preview.tsx`（1,575 行）・大きいファイル `lib/tokens.ts`（2,732 行）・循環依存（[プロンプトと多言語化](lib-prompt.md)・[編集画面と保存共有](app.md)・[部品編集パネル群](components-ui.md) ほか 1 と）
<!-- b_5e5gjvcj -->

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
<!-- b_kph5sp8v -->

> [!NOTE]
> **この章で分かること**
> - 部品定義と寸法や角丸の決め方が分かる
> - 配色生成と配置整形の役割が分かる
> - プレビュー再生の扱いが分かる <!-- b_k2e27v5f -->

## 責務 <!-- b_cqj4njtw -->

このモジュールは部品の定義や寸法と角丸、配色やテーマ、配置の整形とタップ再生の土台である（[tokens.ts:920-924](../../../lib/tokens.ts#L920-L924)、[tokens.ts:216-224](../../../lib/tokens.ts#L216-L224)、[tidy.ts:368-388](../../../lib/tidy.ts#L368-L388)、[Preview.tsx:1021-1028](../../../components/Preview.tsx#L1021-L1028)）。個別部品の描画やインスペクター編集、プロンプト文の生成は他に任せ、ここでは扱わない（[CONTRIBUTING.md:31-38](../../../CONTRIBUTING.md#L31-L38)）。配色はシードからの生成と選択で賄う（[color.ts:126-131](../../../lib/color.ts#L126-L131)、[tokens.ts:538-542](../../../lib/tokens.ts#L538-L542)）。 <!-- b_8x9qf8b0 -->

## 公開インターフェース <!-- b_t3kqdp5k -->

- `KIND_SPEC` は部品種別の既定寸法や属性を引く辞書である（[tokens.ts:920-924](../../../lib/tokens.ts#L920-L924)）。
- `sizeOf` は `widths` と種別から描画寸法を返す（[tokens.ts:2448-2452](../../../lib/tokens.ts#L2448-L2452)）。
- `baseRadii` は種別ごとの角丸を返す（[tokens.ts:2530-2535](../../../lib/tokens.ts#L2530-L2535)）。
- `makeItem` は種別から初期部品を作る（[tokens.ts:2383-2386](../../../lib/tokens.ts#L2383-L2386)）。
- `schemeFromSeed` はシード色から配色を作る（[color.ts:126-131](../../../lib/color.ts#L126-L131)）。
- `paletteOf` はキーとテーマから使う配色を選ぶ（[tokens.ts:538-542](../../../lib/tokens.ts#L538-L542)）。
- `tidyFrame` は枠内の配置を整える（[tidy.ts:368-388](../../../lib/tidy.ts#L368-L388)）。
- `Preview` は文書のタップ再生を受け持つ（[Preview.tsx:1021-1028](../../../components/Preview.tsx#L1021-L1028)）。 <!-- b_z3zy9pdm -->

## 依存関係 <!-- b_hnvp69hh -->

- 外向きには `lib` の国際化やプロンプト（`aiErrorText` など）と `components` の共通 UI（`ButtonInspector` など）や描画（`CardStage` など）を使う（推測）。
- 内向きには `app` の `Editor` と `components` の `ButtonInspector` や `CardStage` と `lib` の `aiErrorText` から使われる（推測）。 <!-- b_tg5qknw5 -->

## データ構造 <!-- b_w5p368vs -->

- `Palette` は `primary` や `surface` などの色トークンを束ねる（[tokens.ts:216-232](../../../lib/tokens.ts#L216-L232)）。
- `Theme` は `dark` や `contrast` や `shape` などの見た目の設定を持つ（[tokens.ts:441-446](../../../lib/tokens.ts#L441-L446)）。
- `Item` は `id` と `kind` と `label` と `variant` を持つ部品である（[tokens.ts:1626-1632](../../../lib/tokens.ts#L1626-L1632)）。
- `Group` は `axis` 方向に `items` を並べた塊である（[tokens.ts:2317-2322](../../../lib/tokens.ts#L2317-L2322)）。
- `Frame` は `name` と位置や寸法で画面枠を表す（[tokens.ts:2117-2124](../../../lib/tokens.ts#L2117-L2124)）。
- `Doc` は `groups` と `frames` と `title` を持つ文書である（[tokens.ts:2340-2351](../../../lib/tokens.ts#L2340-L2351)）。
- `Action` は `to` と `transition` で遷移先を表す（[tokens.ts:1751-1752](../../../lib/tokens.ts#L1751-L1752)）。
- `Transition` は `slide` などの遷移種別である（[tokens.ts:1751-1752](../../../lib/tokens.ts#L1751-L1752)）。 <!-- b_68e0r1ga -->

## 処理の流れ <!-- b_wbnzr7vr -->

1. `makeItem` は `KIND_SPEC` から既定値を引いて初期部品を作る（[tokens.ts:2383-2385](../../../lib/tokens.ts#L2383-L2385)）。
2. `sizeOf` は `widths` から描画寸法を決める（[tokens.ts:2448-2450](../../../lib/tokens.ts#L2448-L2450)）。
3. `baseRadii` は種別に応じた角丸を返す（[tokens.ts:2530-2532](../../../lib/tokens.ts#L2530-L2532)）。
4. `tidyFrame` は枠内の `groups` を整えて返す（[tidy.ts:368-388](../../../lib/tidy.ts#L368-L388)）。 <!-- b_vzxhy5d5 -->

## テスト <!-- b_42z1sf3f -->

プレビューのモーダル表示の不活性やフォーカスや終了時の振る舞いを確かめる（[Preview.test.tsx:101](../../../components/Preview.test.tsx#L101)、[Preview.test.tsx:130](../../../components/Preview.test.tsx#L130)、[Preview.test.tsx:142](../../../components/Preview.test.tsx#L142)）。ボタンの M3 サイズ段階が既定値や補間や範囲保持を満たすことを確かめる（[button.test.ts:46](../../../lib/button.test.ts#L46)、[button.test.ts:53](../../../lib/button.test.ts#L53)、[button.test.ts:60](../../../lib/button.test.ts#L60)、[button.test.ts:67](../../../lib/button.test.ts#L67)）。リンクを開くタップが https 補完や不正アドレスの拒否を正しく扱うことを確かめる（[button.test.ts:80](../../../lib/button.test.ts#L80)、[button.test.ts:86](../../../lib/button.test.ts#L86)）。 <!-- b_armj0y3a -->

## 不変条件 <!-- b_f31zqzgx -->

- `chipHeightOf` は `CHIP_H_MIN` から `CHIP_H_MAX` の範囲に収まる（[tokens.ts:1759](../../../lib/tokens.ts#L1759)）。
- `isPhoneFrame` は幅と高さが `PHONE_W` と `PHONE_H` に等しいときだけ真になる（[tokens.ts:2148-2151](../../../lib/tokens.ts#L2148-L2151)）。
- `isPlace` は 4 値のみ真になる（[tokens.ts:2144](../../../lib/tokens.ts#L2144)）。
- `FULL_WIDTH` は `topAppBar` など全幅部品を定める（[tokens.ts:2164](../../../lib/tokens.ts#L2164)）。 <!-- b_rp1z8wr8 -->

## エラー処理 <!-- b_58mgfmxx -->

`linkUrlOf` は空白や `http` 以外や不正入力に `null` を返す（[tokens.ts:1711-1720](../../../lib/tokens.ts#L1711-L1720)）。`hexToRgb` は不正入力に `null` を返し、`normalizeTheme` は欠落や不正値を既定値で補う（[color.ts:16](../../../lib/color.ts#L16)、[tokens.ts:456-458](../../../lib/tokens.ts#L456-L458)）。`isHex` は 6 桁形式のみ受け付ける（[color.ts:185](../../../lib/color.ts#L185)）。 <!-- b_10dx30ke -->

## 落とし穴 <!-- b_8zdr20xa -->

> [!WARNING]
> **落とし穴**
> - 新しい `Kind` は `lib/tokens.ts` の `KIND_SPEC` や `KIND_ORDER` と必要に応じた `sizeOf` などを同時に更新する（[CONTRIBUTING.md:43-46](../../../CONTRIBUTING.md#L43-L46)）。
> - `KIND_TEXT` の 4 言語分と `lib/prompt.ts` の言語別文や `STYLE_NOTES` を欠かさず足す（[CONTRIBUTING.md:46-48](../../../CONTRIBUTING.md#L46-L48)）。
> - 描画は `components/M3Node.tsx`、測定対象なら `MEASURED`、タップ可能なら `components/Preview.tsx` の対象も更新する（[CONTRIBUTING.md:47-49](../../../CONTRIBUTING.md#L47-L49)）。
> - 変更後は `npm run typecheck` と `npm test` と `npm run build` を通す（[CONTRIBUTING.md:64-66](../../../CONTRIBUTING.md#L64-L66)）。
> - 表示文は 4 言語に必ず足し、注釈は英語で書く（[CONTRIBUTING.md:53-54](../../../CONTRIBUTING.md#L53-L54)）。 <!-- b_nstpp0mf -->

## 深掘り <!-- b_fv7rj6vp -->

> [!NOTE]
> **深掘り**
> `railMotionTargets` の前後比較の詳細。 <!-- b_k3ca4zs9 -->

> [!NOTE]
> **深掘り**
> `snapEdges` の端寄せ条件。 <!-- b_x49f1zvq -->

> [!TIP]
> **まとめ**
> 部品定義と配色と整形がこのモジュールの核であり、描画や編集やプロンプトは外に任せる。 <!-- b_t5m78277 -->
