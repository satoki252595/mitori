# ライブレビュー画面（web） <!-- b_4k9wszbj -->

- ファイル 36 · 4820 行 · 重要度 0.21
<!-- b_f4kcwc21 -->

**変更の手引き**
- 影響が及ぶ先（このモジュールを使う）: [レビュー画面主制御](web-app.md)・[共有画面部品群](web-crit.md)
- 使っているもの: [共有画面部品群](web-crit.md)・[レビュー画面主制御](web-app.md)
- テスト: `web/__tests__/agent-protocol.test.js`（25 件）・`web/__tests__/crit-comment-card-helpers.test.js`（16 件）・`web/__tests__/live-mode.shortcut.test.js`（14 件）・`web/__tests__/crit-settings-overlay.test.js`（12 件） ほか 31 · 実行: `make test`
- 一緒に変わりやすいファイル: 履歴を読めません（浅いクローンか git の外）
- 注意: 大きいファイル `web/live-mode.js`（2,805 行）・循環依存（[共有画面部品群](web-crit.md)・[レビュー画面主制御](web-app.md) と）
<!-- b_b6ccqx3q -->

**大きなファイルの中身（1,500 行を超えるファイル）**
- `web/live-mode.js`（2,805 行）
  - `web/live-mode.js:14-58` State namespace contract
  - `web/live-mode.js:59-490` Tab-Ready Indicator — 関数 16: `setDocumentTitle`・`setTabBadge`・`clearTabBadge`・`notifyRoundReady`
  - `web/live-mode.js:491-747` Viewport selector — 関数 9: `applyViewport`・`reflowFitViewport`・`setActiveModeButton`・`modeHintDismissed`
  - `web/live-mode.js:748-830` Iframe src wired to proxy_port — 関数 3・ハンドラ 1: `proxyURL`・`loadIframe`・`startConnectionTracking`・`onIframeLoad`
  - `web/live-mode.js:831-882` Drag-resize handle on iframe right edge — ハンドラ 2: `onPointerMove`・`onPointerUp`
  - `web/live-mode.js:883-1832` Route detection via postMessage — 関数 26: `renderBreadcrumb`・`recordRoute`・`startLiveTipRotation`・`stopLiveTipRotation`
  - `web/live-mode.js:1833-1854` Deep-link #pin=&lt;id> parsing — activation lives below. — 関数 1: `parsePinFragment`
  - `web/live-mode.js:1855-1907` Iframe load-error banner — 関数 3: `showIframeError`・`postToAgent`・`showToast`
  - `web/live-mode.js:1908-1918` composer — 関数 1: `ensureComposerHost`
  - `web/live-mode.js:1919-2096` Draft persistence (delegates to window.crit.draft) — 関数 5・ハンドラ 2: `composerDraftKey`・`closeComposer`・`saveComposer`・`optimisticInsertComment`
  - `web/live-mode.js:2097-2282` ancestor menu — ハンドラ 5・関数 2: `closeAncestorMenu`・`closeAncestorMenuOnce`・`handleAncestorMenu`・`handleAgentReady`
  - `web/live-mode.js:2283-2468` Pins, resolution gate, re-anchor flow. — 関数 5・ハンドラ 4: `fireRequestResolution`・`currentPathname`・`pushPinsToAgent`・`handlePinResolutionResult`
  - `web/live-mode.js:2469-2536` keyboard shortcut (p/Esc) gated on focus-state — 関数 2: `announceLive`・`lookupPin`
  - `web/live-mode.js:2537-2621` pinsByRoute view derived from state.comments — 関数 2: `pinsByRoute`・`scheduleResolutionForPath`
  - `web/live-mode.js:2622-2730` deep-link activation — 関数 5: `performFlashAndScroll`・`activatePendingPinId`・`openPinAndFocus`・`attempt`
  - `web/live-mode.js:2731-2751` Esc cancels re-anchor (chrome side).
  - `web/live-mode.js:2752-2806` Round-counter tooltip — 関数 2: `show`・`hide`
<!-- b_89b2yqw4 -->

> [!NOTE]
> **この章で分かること**
> - ライブレビュー画面の役割と対象外が分かる。
> - ピンとコメント表示の部品構成が分かる。
> - 代表的な操作の流れと検査の観点が分かる。 <!-- b_61mz7jv1 -->

## 責務 <!-- b_633ggp5k -->

実況レビュー画面の操作と表示を受け持つ（[live-mode.js:153](../../../web/live-mode.js#L153)、[live-mode.js:442](../../../web/live-mode.js#L442)）。ピン配置やスレッド表示、再配置要求の組み立てを扱う（[live-mode-pin-filter.js:15](../../../web/live-mode-pin-filter.js#L15)、[crit-comment-card.js:43](../../../web/crit-comment-card.js#L43)、[live-mode-reanchor-put.js:11](../../../web/live-mode-reanchor-put.js#L11)）。保存や配信の本体は持たず、橋渡しに徹する（推測）。 <!-- b_rz176n53 -->

## 依存関係 <!-- b_83bqw45q -->

- web 配下の共通表示部品に処理を委ねる（推測）。
- 単一ファイルの画面実装と相互に呼び合う（推測）。 <!-- b_f557yrxk -->

## データ構造 <!-- b_j1arb4xq -->

- `PinState` は `setComments` で一覧を受け `applyResolution` で結果を反映し `driftedRows` でずれを列挙する（[live-mode-pin-state.js:12-14](../../../web/live-mode-pin-state.js#L12-L14)、[live-mode-pin-state.js:29](../../../web/live-mode-pin-state.js#L29)、[live-mode-pin-state.js:35-36](../../../web/live-mode-pin-state.js#L35-L36)）。
- `ResolutionGate` は `beginViewportChange` と `onViewportApplied`、`requestResolution` を持つ（[live-mode-resolution-gate.js:11-12](../../../web/live-mode-resolution-gate.js#L11-L12)、[live-mode-resolution-gate.js:17-18](../../../web/live-mode-resolution-gate.js#L17-L18)、[live-mode-resolution-gate.js:22](../../../web/live-mode-resolution-gate.js#L22)）。
- `buildCommentCard` は `author` や `review_round`、`scope` と行範囲を読む（[crit-comment-card.js:43-44](../../../web/crit-comment-card.js#L43-L44)、[crit-comment-card.js:100-114](../../../web/crit-comment-card.js#L100-L114)、[crit-comment-card.js:115-122](../../../web/crit-comment-card.js#L115-L122)）。 <!-- b_766d14xj -->

## 処理の流れ <!-- b_xzzax0zg -->

1. `handleSelection` で選択を受け `ensureComposerHost` で入力欄を用意する（[live-mode.js:1909](../../../web/live-mode.js#L1909)、[live-mode.js:2034](../../../web/live-mode.js#L2034)）。
2. `saveComposer` で保存し `optimisticInsertComment` で先行表示する（[live-mode.js:1941](../../../web/live-mode.js#L1941)、[live-mode.js:1979](../../../web/live-mode.js#L1979)）。
3. `refreshCommentsForRoute` で再読込し `pushPinsToAgent` で配置を伝える（[live-mode.js:1992](../../../web/live-mode.js#L1992)、[live-mode.js:2309](../../../web/live-mode.js#L2309)）。 <!-- b_ew6q190k -->

## テスト <!-- b_77jv4554 -->

- 送受信定数の分離や必須項目の検証など通信規約を確認する（[agent-protocol.test.js:6](../../../web/__tests__/agent-protocol.test.js#L6)、[agent-protocol.test.js:11](../../../web/__tests__/agent-protocol.test.js#L11)、[agent-protocol.test.js:15](../../../web/__tests__/agent-protocol.test.js#L15)、[agent-protocol.test.js:23](../../../web/__tests__/agent-protocol.test.js#L23)）。
- 表示補助の書式や色付け、時刻表現を確認する（[crit-comment-card-helpers.test.js:6](../../../web/__tests__/crit-comment-card-helpers.test.js#L6)、[crit-comment-card-helpers.test.js:23](../../../web/__tests__/crit-comment-card-helpers.test.js#L23)、[crit-comment-card-helpers.test.js:28](../../../web/__tests__/crit-comment-card-helpers.test.js#L28)、[crit-comment-card-helpers.test.js:33](../../../web/__tests__/crit-comment-card-helpers.test.js#L33)）。
- 返信入力の結線や下書き保存、描画登録を確認する（[crit-comment-card.test.js:76](../../../web/__tests__/crit-comment-card.test.js#L76)、[crit-comment-card.test.js:148](../../../web/__tests__/crit-comment-card.test.js#L148)、[crit-draft.test.js:22](../../../web/__tests__/crit-draft.test.js#L22)、[crit-renderer.test.js:26](../../../web/__tests__/crit-renderer.test.js#L26)）。 <!-- b_7mmzama8 -->

## 不変条件 <!-- b_pgxxmrn9 -->

- `liveOrPending` が真の未解決は折りたたまない（[crit-comment-card.js:71-74](../../../web/crit-comment-card.js#L71-L74)）。
- `collapseOverride` は `liveOrPending` の偽の場合にだけ効く（[crit-comment-card.js:72-77](../../../web/crit-comment-card.js#L72-L77)）。 <!-- b_wpfj19mm -->

## 並行性 <!-- b_7mzwy0jz -->

`waitForSession` で待機し `loadAllComments` で一覧を読む非同期起動である（[live-mode.js:145](../../../web/live-mode.js#L145)、[live-mode.js:1161](../../../web/live-mode.js#L1161)）。`doFinishReview` と `submitReply` が終了と返信を非同期に進める（[live-mode.js:1037](../../../web/live-mode.js#L1037)、[live-mode.js:1300](../../../web/live-mode.js#L1300)）。 <!-- b_1ww2nrax -->

## 落とし穴 <!-- b_7w74j48k -->

> [!WARNING]
> **落とし穴**
> - `deps` の未指定は空実装で補われ欠落に気づきにくい（[crit-comment-card.js:43-60](../../../web/crit-comment-card.js#L43-L60)）。 <!-- b_he1mqh11 -->

> [!TIP]
> **まとめ**
> 操作と表示を束ねる部分である。仕上げの確認は表示補助と通信規約の検査が担う。 <!-- b_s8gkcfs3 -->
