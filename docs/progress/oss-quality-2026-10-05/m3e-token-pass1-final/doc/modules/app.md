# 編集画面と保存共有 <!-- b_m4h5d72g -->

- ファイル 13 · 5898 行 · 重要度 0.39
<!-- b_km3mz1qm -->

**変更の手引き**
- 影響が及ぶ先（このモジュールを使う）: [プロンプトと多言語化](lib-prompt.md)
- 使っているもの: [部品定義と整形基盤](lib-tokens.md)・[プロンプトと多言語化](lib-prompt.md)・[部品描画とモバイル編集](components-m3node.md)・[部品編集パネル群](components-ui.md)
- テスト: `lib/share.test.ts`（17 件）・`lib/project.test.ts`（10 件） · 実行: `npm test`
- 入口から: `GET /`（`app/page.tsx:37`）・`GET / → lib/prompt.ts`（`app/page.tsx:37`）・`GET / → components/M3Node.tsx`（`app/page.tsx:37`）
- よく使われる宣言（変えると波及する）: `isProject` `lib/project.ts:67`（3 ファイル）・`Logo` `components/Logo.tsx:7`（2 ファイル）
- 一緒に変わりやすいファイル（直近 79 commit）: `lib/tokens.ts` 27 回・`lib/i18n.ts` 26 回・`components/Inspector.tsx` 25 回・`components/M3Node.tsx` 23 回・`lib/prompt.ts` 21 回
- 注意: 大きいファイル `app/Editor.tsx`（4,861 行）・循環依存（[プロンプトと多言語化](lib-prompt.md)・[部品編集パネル群](components-ui.md)・[部品定義と整形基盤](lib-tokens.md) ほか 1 と）
<!-- b_7q6jbwqg -->

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
<!-- b_wga3wq5e -->

> [!NOTE]
> **この章で分かること**
> - 起動オーバーレイと編集画面の全体像をつかむ
> - 保存と共有の仕組みを理解する
> - ツールバーと部品一覧の分担を知る <!-- b_tvxnrr6g -->

## 責務 <!-- b_ntm0kzbc -->

`Page` が `Editor` を遅延読込して単一画面の編集環境を提供する（[page.tsx:8-17](../../../app/page.tsx#L8-L17)、[page.tsx:37](../../../app/page.tsx#L37)）。`Editor` は `groups` と `frames` を中心にパレットやテーマや言語の状態を保持する（[Editor.tsx:454-470](../../../app/Editor.tsx#L454-L470)）。部品の描画やプロンプト生成や配色計算は下位に任せ、ここでは扱わない（推測）。 <!-- b_v6bhqzmr -->

## 公開インターフェース <!-- b_yp4asyqf -->

- `Page` は起動オーバーレイ付き単一ルートで `Editor` を遅延読込する（[page.tsx:8-17](../../../app/page.tsx#L8-L17)、[page.tsx:37](../../../app/page.tsx#L37)）。
- `Editor` は文書とキャンバス操作を束ねる編集画面本体である（[Editor.tsx:454-465](../../../app/Editor.tsx#L454-L465)）。
- `Toolbar` は選択や拡大や画面適合の操作を集める（[Toolbar.tsx:62-69](../../../components/Toolbar.tsx#L62-L69)）。
- `PartsPalette` は部品を送り出す部品一覧である（[PartsPalette.tsx:15-21](../../../components/PartsPalette.tsx#L15-L21)）。
- `isProject` と `projectFileName` と `saveProject` と `readProject` はプロジェクトファイルの検証と保存と読戻しを受け持つ（[project.ts:66-67](../../../lib/project.ts#L66-L67)、[project.ts:70-71](../../../lib/project.ts#L70-L71)、[project.ts:80-81](../../../lib/project.ts#L80-L81)、[project.ts:91-93](../../../lib/project.ts#L91-L93)）。
- `shareable` と `shareLink` と `readShareHash` と `hasShareHash` は共有リンクの縮約と符号化と復元を受け持つ（[share.ts:11-12](../../../lib/share.ts#L11-L12)、[share.ts:45-46](../../../lib/share.ts#L45-L46)、[share.ts:55-56](../../../lib/share.ts#L55-L56)、[share.ts:75-76](../../../lib/share.ts#L75-L76)）。 <!-- b_rq8y3tjd -->

## 依存関係 <!-- b_2zpm3r9j -->

lib のトークン側は `ColorPanel` や `Preview` や `HandleSide` を提供する（推測）。lib のプロンプト側は `aiErrorText` や `AiActionKey` や `AiWriteBtn` を提供し、小さく逆依存もする（推測）。components の描画側は `CardStage` や `LoadingIndicator` や `wavePath` を提供する（推測）。components の UI 側は `ButtonInspector` や `FrameInspector` や `IconPicker` を提供する（推測）。 <!-- b_cf44wv84 -->

## データ構造 <!-- b_db71gacw -->

- `View` は `x` と `y` と `z` でキャンバスの位置と拡大を表す（[Editor.tsx:179](../../../app/Editor.tsx#L179)）。
- `Snapshot` は `groups` と `frames` に全文置換用の `meta` を添えた取消単位である（[Editor.tsx:238-240](../../../app/Editor.tsx#L238-L240)）。
- `DragState` は摘み上げ時の `base` と掴み位置や案内や吸着を保つ（[Editor.tsx:191-210](../../../app/Editor.tsx#L191-L210)）。 <!-- b_yqxa3ad7 -->

## 設定 <!-- b_1b2pdn2k -->

- `NEXT_PUBLIC_BASE_PATH` はベースパスを与える（[Editor.tsx:141](../../../app/Editor.tsx#L141)）。
- `NEXT_PUBLIC_SITE_ORIGIN` はサイトオリジンを与える（[layout.tsx:7](../../../app/layout.tsx#L7)）。 <!-- b_spygez9h -->

## テスト <!-- b_mrw83zww -->

プロジェクト検査は現行文書の受容と旧式最小文書の受容と全要素走査を確かめる（[project.test.ts:18](../../../lib/project.test.ts#L18)、[project.test.ts:25](../../../lib/project.test.ts#L25)、[project.test.ts:68](../../../lib/project.test.ts#L68)）。共有検査は履歴除去と非破壊と空対応と施錠保持を確かめる（[share.test.ts:20](../../../lib/share.test.ts#L20)、[share.test.ts:47](../../../lib/share.test.ts#L47)、[share.test.ts:62](../../../lib/share.test.ts#L62)、[share.test.ts:67](../../../lib/share.test.ts#L67)）。圧縮と平文の両リンクでレール保持と引数名安定を確かめる（[share.test.ts:74](../../../lib/share.test.ts#L74)、[share.test.ts:91](../../../lib/share.test.ts#L91)）。 <!-- b_3ycj9bq0 -->

## 落とし穴 <!-- b_hm7m1mt4 -->

> [!WARNING]
> **落とし穴**
> - `BOOT_FADE_MS` はオーバーレイの CSS 時間と一致させる（[page.tsx:34-35](../../../app/page.tsx#L34-L35)）。
> - `setGroups` は全更新に `constrainModalRails` を強制する（[Editor.tsx:461-464](../../../app/Editor.tsx#L461-L464)）。
> - 検証は `npm run typecheck` と `npm test` と `npm run build` の三点で、CI も同じ三点を行う（[CONTRIBUTING.md:64](../../../CONTRIBUTING.md#L64)）。
> - 新種別は `KINDS` と `LAYOUTS` と `validItem` と `isProject` の検証連鎖に触れる（[project.ts:9](../../../lib/project.ts#L9)、[project.ts:17](../../../lib/project.ts#L17)、[project.ts:20](../../../lib/project.ts#L20)、[project.ts:66-67](../../../lib/project.ts#L66-L67)）。 <!-- b_g7a7z9mg -->

> [!TIP]
> **まとめ**
> 起動から保存と共有までの編集骨格がここに集まる。 <!-- b_rs29g5zx -->
