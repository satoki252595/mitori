# 編集画面の外枠 <!-- b_qysdv0b8 -->

- ファイル 13 · 5898 行 · 重要度 0.39
<!-- b_p6pf1f78 -->

**変更の手引き**
- 影響が及ぶ先（このモジュールを使う）: [指示文と多言語と AI](lib-prompt.md)
- 使っているもの: [寸法と色と整形基盤](lib-tokens.md)・[指示文と多言語と AI](lib-prompt.md)・[部品描画と携帯面](components-m3node.md)・[検査器と汎用パネル](components-ui.md)
- テスト: `lib/share.test.ts`（17 件）・`lib/project.test.ts`（10 件） · 実行: `npm test`
- 入口から: `GET /`（`app/page.tsx:37`）・`GET / → lib/prompt.ts`（`app/page.tsx:37`）・`GET / → components/M3Node.tsx`（`app/page.tsx:37`）
- よく使われる宣言（変えると波及する）: `isProject` `lib/project.ts:67`（3 ファイル）・`Logo` `components/Logo.tsx:7`（2 ファイル）
- 一緒に変わりやすいファイル（直近 79 commit）: `lib/tokens.ts` 27 回・`lib/i18n.ts` 26 回・`components/Inspector.tsx` 25 回・`components/M3Node.tsx` 23 回・`lib/prompt.ts` 21 回
- 注意: 大きいファイル `app/Editor.tsx`（4,861 行）・循環依存（[指示文と多言語と AI](lib-prompt.md)・[検査器と汎用パネル](components-ui.md)・[寸法と色と整形基盤](lib-tokens.md) ほか 1 と）
<!-- b_vagj2kqg -->

**大きなファイルの中身（1,500 行を超えるファイル）**
- `app/Editor.tsx`（4,861 行）
  - `app/Editor.tsx:144-177` 定数・変数（16）: `CARRY`・`OPEN`・`INSTANT`・`VANISH_MS`
  - `app/Editor.tsx:179-183` 型（3）: `View`・`Snap`・`Guide`
  - `app/Editor.tsx:184-187` 定数・変数（2）: `GUIDE_PX`・`GRID`
  - `app/Editor.tsx:188-188` ハンドラ: `onGrid`
  - `app/Editor.tsx:189-189` 定数・変数: `FRAME_MARGIN`
  - `app/Editor.tsx:191-240` 型（4）: `DragState`・`Gesture`・`DocMeta`・`Snapshot`
  - `app/Editor.tsx:244-263` 定数・変数（8）: `HANDLED`・`ROUND`・`BUTTON_LIKE`・`WIDE`
  - `app/Editor.tsx:265-278` 関数: `translateSnapshot`
  - `app/Editor.tsx:280-280` 定数・変数: `SEED_FRAMES`
  - `app/Editor.tsx:284-440` 関数（7）: `migrateGroups`・`rekeyed`・`copiedIds`・`lockedGroupMsg`
  - `app/Editor.tsx:442-442` 型: `LeftTab`
  - `app/Editor.tsx:444-452` 定数・変数: `LEFT_TABS`
  - `app/Editor.tsx:454-4861` Editor（関数）
    - `app/Editor.tsx:457-522` document — 状態 29・内部の関数 3・副作用 1（useState 26・useRef 3・useCallback 1）: `lang`・`editAccess`・`groups`・`setGroups`
    - `app/Editor.tsx:523-553` editor ui — 状態 24（useState 24）: `view`・`viewReady`・`easing`・`cameraEasing`
    - `app/Editor.tsx:554-616` tidy and ai — 状態 31・計算値 1（useRef 27・useState 4・useMemo 1）: `tidyRef`・`aiSettings`・`aiBusy`・`aiFrameId`
    - `app/Editor.tsx:617-683` history — 内部の関数 6・状態 3・副作用 1（useCallback 4・useRef 3・useEffect 1）: `pastRef`・`futureRef`・`lastPatchRef`・`snapshot`
    - `app/Editor.tsx:684-925` persistence — 副作用 9・内部の関数 1（useEffect 9）: `applyDoc`
    - `app/Editor.tsx:926-982` measurement (text-sized kinds) — 内部の関数 3・副作用 2・計算値 1（useCallback 3・useEffect 1・useLayoutEffect 1）: `allItems`・`fabAnchor`・`sizeRef`・`alongRef`
    - `app/Editor.tsx:983-1152` coordinates — 内部の関数 6・副作用 2・ハンドラ 1（useCallback 2・useEffect 2・useRef 1）: `canvasRect`・`inCanvas`・`toWorld`・`inBin`
    - `app/Editor.tsx:1153-1267` rest positions and the magnet — 内部の関数 4・状態 2（useCallback 4・useSpring 2）: `restPos`・`findSnap`・`sx`・`sy`
    - `app/Editor.tsx:1268-1866` pointer: parts — 状態 10・内部の関数 9・副作用 6（useEffect 6・useRef 5・useState 5）: `flushPending`・`startPan`・`dragLit`・`landed`
    - `app/Editor.tsx:1867-2072` pointer: canvas (pan / marquee) — ハンドラ 2・内部の関数 2・副作用 1（useCallback 1・useEffect 1）: `itemRects`・`clearSelection`・`onCanvasPointerDown`・`onFramePointerDown`
    - `app/Editor.tsx:2073-2088` panel resize — 副作用 1（useEffect 1）
    - `app/Editor.tsx:2089-3341` editing — 内部の関数 43・状態 11・計算値 10（useCallback 13・useMemo 10・useRef 8）: `selected`・`resizeShift`・`patchSelected`・`deleteSelected`
    - `app/Editor.tsx:3342-4860` render — 内部の関数 12・計算値 6・描画（JSX）（useMemo 6・useRef 4・useCallback 3）: `gapOut`・`gapRef`・`gapTimer`・`setGap`
<!-- b_zsf46r0x -->

> [!NOTE]
> **この章で分かること**
> - 起動から編集可能になるまでの流れを掴む
> - 保存と共有の出入口がどこにあるかを知る
> - 外枠 UI の分担を理解する <!-- b_9vs2gpx6 -->

## 責務 <!-- b_tg686wzq -->

文書状態を保持する編集画面の外枠であり、全体を組み立てる（[Editor.tsx:454-465](../../../app/Editor.tsx#L454-L465)、[Editor.tsx:523-533](../../../app/Editor.tsx#L523-L533)）。起動表示と保存や共有の出入口を束ねる（[page.tsx:15-17](../../../app/page.tsx#L15-L17)、[project.ts:80-81](../../../lib/project.ts#L80-L81)、[project.ts:91-98](../../../lib/project.ts#L91-L98)、[share.ts:45-46](../../../lib/share.ts#L45-L46)）。部品の描画や文面生成自体は持たず、下位の描画と生成に任せる（推測）。 <!-- b_crnk2xyx -->

## 公開インターフェース <!-- b_64a350yb -->

- `Page` は入口で、`Editor` を遅延読込して起動表示と重ねる（[page.tsx:13](../../../app/page.tsx#L13)、[page.tsx:37](../../../app/page.tsx#L37)）。
- `Editor` は `initialLang` と `onReady` を受け取る編集画面である（[Editor.tsx:454](../../../app/Editor.tsx#L454)）。
- `Logo` は読込表示の 1 frame を固めた印で、大きさと色を受け取る（[Logo.tsx:1-2](../../../components/Logo.tsx#L1-L2)、[Logo.tsx:7](../../../components/Logo.tsx#L7)）。
- `Skeleton` は読込中の殻で、部品パネルと検査器の幻影を置く（[Skeleton.tsx:28-29](../../../components/Skeleton.tsx#L28-L29)、[Skeleton.tsx:65-66](../../../components/Skeleton.tsx#L65-L66)、[Skeleton.tsx:81](../../../components/Skeleton.tsx#L81)）。
- `Toolbar` は `Mode` や zoom と undo を束ね、上辺に道具を並べる（[Toolbar.tsx:11](../../../components/Toolbar.tsx#L11)、[Toolbar.tsx:62-69](../../../components/Toolbar.tsx#L62-L69)）。
- `ShareButton` は対話を開くテキストボタンで、起草中は busy を示す（[ShareMenu.tsx:16-17](../../../components/ShareMenu.tsx#L16-L17)）。
- `ShareDialog` は idea 起草と agent 向け指示の複写を束ねる（[ShareMenu.tsx:52-61](../../../components/ShareMenu.tsx#L52-L61)）。
- `PartsPalette` は部品を引出す一覧で、お気に入りの切替を持つ（[PartsPalette.tsx:15-22](../../../components/PartsPalette.tsx#L15-L22)）。 <!-- b_g3a3ry0a -->

- `isProject` は parse 済み値が開ける文書形状か確かめる（[project.ts:66-67](../../../lib/project.ts#L66-L67)）。
- `projectFileName` は app 名を持つとき名に添えて保存名を作る（[project.ts:70-71](../../../lib/project.ts#L70-L71)）。
- `saveProject` は文書を JSON として browser へ渡し download させる（[project.ts:80-81](../../../lib/project.ts#L80-L81)）。
- `readProject` は選択 file を読み、文書でなければ null を返す（[project.ts:91-98](../../../lib/project.ts#L91-L98)）。
- `shareable` は link に載せない選択画像と AI 履歴を落とした写しを作る（[share.ts:11-12](../../../lib/share.ts#L11-L12)）。
- `shareLink` は hash なし app URL を基に文書を開く link を作る（[share.ts:45-46](../../../lib/share.ts#L45-L46)）。
- `readShareHash` は hash が運ぶ文書を返し、無ければ null を返す（[share.ts:55-56](../../../lib/share.ts#L55-L56)）。
- `hasShareHash` は hash が文書を運ぶ主張か確かめる（[share.ts:75-76](../../../lib/share.ts#L75-L76)）。 <!-- b_m7ne98bh -->

## 依存関係 <!-- b_64a7e0vb -->

寸法や整列は `lib` の `Preview` 系に、文面や言語は `lib` の `AiWriteBtn` 系に頼る（推測）。描画は `components` の `CardStage` 系と `IconPicker` 系に委ね、逆に `lib` の `prompt` 系から薄く参照される（推測）。 <!-- b_s124ndtk -->

## データ構造 <!-- b_fhwpmbpk -->

- `View` は視点の平行移動と倍率である（[Editor.tsx:179](../../../app/Editor.tsx#L179)）。
- `Snapshot` は `groups` と `frames` と全置換時の `meta` を持つ（[Editor.tsx:238-240](../../../app/Editor.tsx#L238-L240)）。
- `DragState` は摘み上げ時の `base` と掴み点やガイドを保つ（[Editor.tsx:191-200](../../../app/Editor.tsx#L191-L200)）。
- `Gesture` は `pan` や `marquee` のユニオンである（[Editor.tsx:215-220](../../../app/Editor.tsx#L215-L220)）。 <!-- b_xenees7j -->

## 設定 <!-- b_gw708k4d -->

- `NEXT_PUBLIC_BASE_PATH` は配置基底である（[Editor.tsx:141](../../../app/Editor.tsx#L141)）。
- `NEXT_PUBLIC_SITE_ORIGIN` は公開起点である（[layout.tsx:7](../../../app/layout.tsx#L7)）。
- `DOC_PARAM` と `DOCZ_PARAM` は共有引数名である（[share.ts:8-9](../../../lib/share.ts#L8-L9)）。 <!-- b_rb84q655 -->

## テスト <!-- b_kj305xmn -->

`isProject` は現行と旧来を受け入れ、全件を検査する（[project.test.ts:18](../../../lib/project.test.ts#L18)、[project.test.ts:25](../../../lib/project.test.ts#L25)、[project.test.ts:68](../../../lib/project.test.ts#L68)）。`shareable` は履歴等を除き、空キャンバスやロックを保ち原物を変えない（[share.test.ts:20](../../../lib/share.test.ts#L20)、[share.test.ts:47](../../../lib/share.test.ts#L47)、[share.test.ts:62](../../../lib/share.test.ts#L62)、[share.test.ts:67](../../../lib/share.test.ts#L67)）。`shareLink` と `readShareHash` はレール状態と引数名の安定を守る（[share.test.ts:74](../../../lib/share.test.ts#L74)、[share.test.ts:91](../../../lib/share.test.ts#L91)）。 <!-- b_kcx1ewdc -->

## 落とし穴 <!-- b_svjtct0h -->

> [!WARNING]
> **落とし穴**
> - `setGroups` は常に `constrainModalRails` を通す（[Editor.tsx:461-464](../../../app/Editor.tsx#L461-L464)）。
> - `BOOT_FADE_MS` は CSS と一致が要る（[page.tsx:34-35](../../../app/page.tsx#L34-L35)）。
> - `translateSnapshot` は履歴と整列差分も訳す（[Editor.tsx:472-488](../../../app/Editor.tsx#L472-L488)）。 <!-- b_2t6rjrkt -->

> [!TIP]
> **まとめ**
> ここを押さえれば、残りは下位の描画と生成に進める。 <!-- b_f40m7acw -->
