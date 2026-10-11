# 部品定義と配置の基盤 <!-- b_8ykk66d5 -->

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
> - 部品の初期値、寸法、角丸を決める入口。
> - 配色とグループ配置のデータ構造。
> - 部品種別の追加で連動する変更箇所と検証手順。 <!-- b_k2e27v5f -->

## 責務 <!-- b_cqj4njtw -->

部品定義、寸法、角丸、テーマ、配色とタップ操作のプレビューを扱う基盤である（[CONTRIBUTING.md:31-38](../../../CONTRIBUTING.md#L31-L38)）。部品の描画は `components/M3Node.tsx`、属性編集は `components/Inspector.tsx` と `components/Mobile.tsx`、プロンプト生成は `lib/prompt.ts` が担当する（[CONTRIBUTING.md:33-36](../../../CONTRIBUTING.md#L33-L36)）。 <!-- b_8x9qf8b0 -->

## 公開インターフェース <!-- b_t3kqdp5k -->

- `KIND_SPEC` は種別ごとの既定寸法、対応属性、接続仕様を引く辞書である（[tokens.ts:891-921](../../../lib/tokens.ts#L891-L921)、[tokens.ts:924](../../../lib/tokens.ts#L924)）。
- `makeItem` は種別の定義と現在の言語から初期部品を作る（[tokens.ts:2383-2395](../../../lib/tokens.ts#L2383-L2395)）。
- `sizeOf` は実効幅と高さを返し、文字内容に依存する部品では `widths` の実測幅を利用する（[tokens.ts:2448-2466](../../../lib/tokens.ts#L2448-L2466)、[tokens.ts:2474-2475](../../../lib/tokens.ts#L2474-L2475)）。
- `baseRadii` は種別と部品属性から四隅の角丸を返す（[tokens.ts:2530-2557](../../../lib/tokens.ts#L2530-L2557)）。
- `paletteOf` はカスタム・プリセット配色を選び、ダークモードや標準以外のコントラストではシード色から配色を生成する（[tokens.ts:538-546](../../../lib/tokens.ts#L538-L546)）。
- `tidyFrame` はグループ列、対象フレーム、全フレーム列、幅情報を受け取り、戻り値の型は `Group[] | null` である（[tidy.ts:388](../../../lib/tidy.ts#L388)）。 <!-- b_z3zy9pdm -->

## 依存関係 <!-- b_hnvp69hh -->

言語別の初期テキストは `lib/i18n.ts` の `getLang` と `KIND_TEXT` に依存し、配色生成には `lib/color.ts` の `schemeFromSeed` を使う（[tokens.ts:2383-2389](../../../lib/tokens.ts#L2383-L2389)、[tokens.ts:538-546](../../../lib/tokens.ts#L538-L546)）。利用側には `app` の `Editor`、`components` の `Inspector` と `M3Node`、`lib` の `buildPrompt` がある（推測）。 <!-- b_tg5qknw5 -->

## データ構造 <!-- b_w5p368vs -->

- `Item` は識別子、種別、ラベル、アイコン、表示バリアントを持つ部品データである（[tokens.ts:1626-1633](../../../lib/tokens.ts#L1626-L1633)）。
- `Group` は座標、配置軸、部品列と任意のロック状態を保持する（[tokens.ts:2317-2324](../../../lib/tokens.ts#L2317-L2324)）。
- `Frame` は画面の位置、任意の幅・高さ、背景、説明、スワイプ遷移先を保持する（[tokens.ts:2117-2131](../../../lib/tokens.ts#L2117-L2131)）。
- `Doc` はグループ列、フレーム列、配色選択、対象プラットフォーム、タイトル、概要、プロンプト編集内容、テーマをまとめる（[tokens.ts:2340-2358](../../../lib/tokens.ts#L2340-L2358)）。 <!-- b_68e0r1ga -->

## 処理の流れ <!-- b_wbnzr7vr -->

1. `explodeGroup` は自由配置でなければ元のグループだけを返す（[tokens.ts:2245-2246](../../../lib/tokens.ts#L2245-L2246)）。
2. 自由配置では `layoutOf` がグループ座標に部品ごとの相対座標を加え、`explodeGroup` が上から下、左から右へ走査する（[tokens.ts:2210-2218](../../../lib/tokens.ts#L2210-L2218)、[tokens.ts:2247](../../../lib/tokens.ts#L2247)）。
3. 接続可能な部品を、配置軸に沿った隣接位置と直交方向のずれがともに 3 以内なら同じ列にまとめる（[tokens.ts:2251-2269](../../../lib/tokens.ts#L2251-L2269)）。
4. 出力グループの識別子と返却順は、元の部品列における順序を基準に決める（[tokens.ts:2270-2275](../../../lib/tokens.ts#L2270-L2275)）。 <!-- b_vzxhy5d5 -->

## テスト <!-- b_42z1sf3f -->

プレビューのテストは、非アクティブ画面の不活性とモーダル副作用の抑制、アクティブ時のフォーカスとキーボード処理、退出時にフォーカスを奪い直さないことを確認する（[Preview.test.tsx:101](../../../components/Preview.test.tsx#L101)、[Preview.test.tsx:130](../../../components/Preview.test.tsx#L130)、[Preview.test.tsx:142](../../../components/Preview.test.tsx#L142)）。ボタンのテストは、名前付きサイズの Material 値、中間高さの補間、範囲外入力の制限、寸法と角丸への高さの反映を確認する（[button.test.ts:46](../../../lib/button.test.ts#L46)、[button.test.ts:53](../../../lib/button.test.ts#L53)、[button.test.ts:60](../../../lib/button.test.ts#L60)、[button.test.ts:67](../../../lib/button.test.ts#L67)）。 <!-- b_armj0y3a -->

## 不変条件 <!-- b_f31zqzgx -->

- `chipHeightOf` は高さを丸め、`CHIP_H_MIN` から `CHIP_H_MAX` の範囲に制限する（[tokens.ts:1759](../../../lib/tokens.ts#L1759)）。
- `isPhoneFrame` は幅と高さが両方とも `PHONE_W`、`PHONE_H` に一致する場合だけ真を返す（[tokens.ts:2147-2150](../../../lib/tokens.ts#L2147-L2150)）。
- `canJoin` は両部品に接続仕様があり、軸とファミリーが一致する場合だけ真を返す（[tokens.ts:2684-2688](../../../lib/tokens.ts#L2684-L2688)）。 <!-- b_rp1z8wr8 -->

## エラー処理 <!-- b_58mgfmxx -->

`linkUrlOf` は空の入力、解析できない URL、HTTP・HTTPS 以外のスキームに `null` を返し、スキームなしの入力には HTTPS を補う（[tokens.ts:1711-1719](../../../lib/tokens.ts#L1711-L1719)）。 <!-- b_10dx30ke -->

## 落とし穴 <!-- b_8zdr20xa -->

> [!WARNING]
> **落とし穴**
> - 新種別では `Kind`、`KIND_SPEC`、`KIND_ORDER` を更新する（[CONTRIBUTING.md:45](../../../CONTRIBUTING.md#L45)）。
> - 必要に応じて、寸法の `sizeOf`、角丸の `baseRadii`、アイコン編集対象の `iconSlotsOf` も更新する（[CONTRIBUTING.md:45](../../../CONTRIBUTING.md#L45)）。
> - `lib/i18n.ts` の `KIND_TEXT` に 4 言語分の初期値を追加する（[CONTRIBUTING.md:46](../../../CONTRIBUTING.md#L46)）。
> - `components/M3Node.tsx` に描画を追加する（[CONTRIBUTING.md:47](../../../CONTRIBUTING.md#L47)）。
> - 該当する場合は `MEASURED` と `NO_BOX` も更新する（[CONTRIBUTING.md:47](../../../CONTRIBUTING.md#L47)）。
> - `lib/prompt.ts` の `itemJa`、`itemEn`、`itemZh`、`itemKo` に部品の文を追加し、各言語の `STYLE_NOTES` にも項目を追加する（[CONTRIBUTING.md:48](../../../CONTRIBUTING.md#L48)）。
> - 特別な編集 UI が必要なら `components/Inspector.tsx` に追加する（[CONTRIBUTING.md:49](../../../CONTRIBUTING.md#L49)）。
> - タップ可能な部品なら `components/Preview.tsx` にタップ対象を追加する（[CONTRIBUTING.md:49](../../../CONTRIBUTING.md#L49)）。 <!-- b_nstpp0mf -->

> [!WARNING]
> **落とし穴**
> - 新部品、新パネル、プロンプト文など大きな変更は、実装前に issue で方針を合意する手順である（[CONTRIBUTING.md:9-12](../../../CONTRIBUTING.md#L9-L12)）。
> - コメントは英語とし、UI 文字列とプロンプト文は日本語、英語、中国語、韓国語のすべてに追加する（[CONTRIBUTING.md:53-54](../../../CONTRIBUTING.md#L53-L54)）。
> - サイズ、角丸、トークンと名称は Material 3 Expressive の標準に合わせる（[CONTRIBUTING.md:55-56](../../../CONTRIBUTING.md#L55-L56)）。
> - エディターの UI と部品描画は分離し、部品は配色トークンだけから描画する規約である（[CONTRIBUTING.md:57-58](../../../CONTRIBUTING.md#L57-L58)）。
> - 検証は `npm run typecheck`、`npm test`、`npm run build` の 3 つで、CI も各 PR で同じ検証を行う（[CONTRIBUTING.md:65](../../../CONTRIBUTING.md#L65)）。 <!-- b_7x0h09xf -->

## 深掘り <!-- b_fv7rj6vp -->

> [!NOTE]
> **深掘り**
> `railMotionTargets` による変更前後の状態比較。 <!-- b_k3ca4zs9 -->

> [!NOTE]
> **深掘り**
> `snapEdges` の端寄せ判定条件。 <!-- b_x49f1zvq -->

> [!TIP]
> **まとめ**
> 部品の生成から寸法・角丸、グループ配置へと読み進める。種別追加では、描画・編集・プロンプトの変更箇所と検証手順を一緒に確認する。 <!-- b_t5m78277 -->
