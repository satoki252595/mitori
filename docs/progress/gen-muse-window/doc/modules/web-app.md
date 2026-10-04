# レビュー画面主制御（web） <!-- b_cb6tw5m7 -->

- ファイル 1 · 9031 行 · 重要度 0.03
<!-- b_ty5d7s7d -->

**変更の手引き**
- 影響が及ぶ先（このモジュールを使う）: [共有画面部品群](web-crit.md)・[ライブレビュー画面](web-live-mode.md)
- 使っているもの: [共有画面部品群](web-crit.md)・[ライブレビュー画面](web-live-mode.md)
- テスト: `web/__tests__/live-mode.connection-wiring.test.js`（17 件）・`web/__tests__/heading-anchors.test.js`（12 件）・`web/__tests__/story-line-navigation.test.js`（12 件）・`web/__tests__/defer-file-body.test.js`（8 件） ほか 18 · 実行: `make test`
- 一緒に変わりやすいファイル: 履歴を読めません（浅いクローンか git の外）
- 注意: 大きいファイル `web/app.js`（11,055 行）・循環依存（[ライブレビュー画面](web-live-mode.md)・[共有画面部品群](web-crit.md) と）
<!-- b_ye5s6a5y -->

**大きなファイルの中身（1,500 行を超えるファイル）**
- `web/app.js`（11,055 行）
  - `web/app.js:4-16` Comment Markdown Renderer
  - `web/app.js:17-127` File Reference Inline Rule — 関数 5: `file_ref`・`code_inline`・`linkifyCommentRefsInDom`・`scrollToCommentRef`
  - `web/app.js:128-146` Attachment Image Src Rewrite — 関数 1: `image`
  - `web/app.js:147-191` Suggestion Diff Renderer — 関数 1: `renderSuggestionDiff`
  - `web/app.js:192-243` Tab-Ready Indicator — 関数 4: `noop`・`fence`・`render`・`renderInline`
  - `web/app.js:244-285` Document Markdown Renderer — 関数 2: `heading_open`・`heading_close`
  - `web/app.js:286-294` Cookie helpers (persist across random ports on 127.0.0.1) — 関数 2: `setCookie`・`getCookie`
  - `web/app.js:295-334` Settings (consolidated cookie) — 関数 4: `loadSettings`・`getSetting`・`setSetting`・`bindSubmitCancelKeys`
  - `web/app.js:335-714` State — 関数 15: `initialViewMode`・`hasActivePendingUpdates`・`syncPendingUpdateButtons`・`isHideResolved`
  - `web/app.js:715-849` Viewed State — 関数 8: `viewedIdentityHash`・`viewedStorageKey`・`autoViewedMarkerKey`・`applyAutoViewedOnce`
  - `web/app.js:850-1155` Init — 関数 2: `init`・`updateDiffModeToggle`
  - `web/app.js:1156-1193` Markdown Parsing — 関数 4: `parseMarkdownTokens`・`fencesIn`・`buildMarkdown`・`extractTocItems`
  - `web/app.js:1194-1247` Utility Functions — 関数 4: `processTaskLists`・`resolveImagePath`・`rewriteImageSrcs`・`getFileByPath`
  - `web/app.js:1248-1633` File Tree Sidebar — 関数 12: `buildFileTree`・`collapseCommonPrefixes`・`renderFileTree`・`renderMobileFilePicker`
  - `web/app.js:1634-2058` Pierre review view (the review list, git and files mode) — 関数 24: `pierreViewActive`・`pierreThreadKey`・`pierrePreparedHunks`・`renderedDiffLineKeys`
  - `web/app.js:2059-2339` Keyboard focus (model-driven; Pierre rows are virtualized) — 関数 12: `pierreNavRows`・`clearPierreDocVisual`・`pierreDocBlockElement`・`markPierreDocFocus`
  - `web/app.js:2340-3069` Quote highlights inside Pierre (CSS Custom Highlight API) — 関数 36・ハンドラ 1: `pierreQuotedComments`・`pierreCommentRangeCSS`・`syncPierreCommentRanges`・`onPierrePostRender`
  - `web/app.js:3070-3354` Rendered Diff View (Markdown, file mode) — 関数 8: `buildDiffLineSetFromHunks`・`classifyBlock`・`applyBlockSelectionState`・`annotateBlocks`
  - `web/app.js:3355-3404` Change Detection (for inter-round diffs in document view) — 関数 1: `getChangeInfo`
  - `web/app.js:3405-3628` Document View (Markdown) — 関数 1: `renderDocumentView`
  - `web/app.js:3629-3701` Diff Gutter Drag (multi-line comment selection) — 関数 3: `expandHunksForComments`・`buildContextLines`・`buildHunkHeader`
  - `web/app.js:3702-3767` Unified diff (interleaved lines, single pane) — 関数 3: `storyRawHunks`・`storyRawHunksWithTrailingContext`・`autoExpandSmallGaps`
  - `web/app.js:3768-3805` Comment Helpers — 関数 2: `buildCommentIndices`・`getCommentsForBlock`
  - `web/app.js:3806-3938` Gutter Drag Selection — 関数 3・ハンドラ 2: `attachDocGutterMouseHandler`・`beginDocGutterDrag`・`updateDragSelectionVisuals`・`handleDragMove`
  - `web/app.js:3939-4063` Text Selection → Line Range Mapping — 関数 8: `getLineRangeFromSelection`・`closeEmptyReviewForm`・`formTextarea`・`closeEmptyForms`
  - `web/app.js:4064-4162` Comment Templates — 関数 2: `attachTemplateUI`・`showSaveTemplateDialog`
  - `web/app.js:4163-4331` File Picker Autocomplete — 関数 1: `attachFilePicker`
  - `web/app.js:4332-4501` Image Paste — 関数 6: `attachImagePaste`・`attachImageDragDrop`・`attachImageUploads`・`uploadAndInsertImage`
  - `web/app.js:4502-4776` Comment Form — 関数 8: `createCommentFormUI`・`createCommentForm`・`getOldSideLinesFromHunks`・`insertSuggestion`
  - `web/app.js:4777-4900` Draft Autosave (delegates to window.crit.draft) — 関数 5: `saveDraft`・`debouncedSaveDraft`・`clearDraft`・`restoreDrafts`
  - `web/app.js:4901-4917` Agent Button — 関数 2: `isLiveThread`・`checkAgentReplies`
  - `web/app.js:4918-5071` Comment Display — 関数 4: `buildCommentEnv`・`buildCommentCard`・`createCommentElement`・`renderReplyList`
  - `web/app.js:5072-5342` Quote Highlighting in Document/Diff Body — 関数 6: `highlightQuotesInSection`・`createInlineEditor`・`editComment`・`deleteComment`
  - `web/app.js:5343-5496` Review-Level (General) Comments — 関数 9: `addReviewComment`・`updateReviewComment`・`deleteReviewComment`・`openReviewCommentForm`
  - `web/app.js:5497-6057` Inline Review Conversation Section (top of document) — 関数 13: `createReviewConversationCard`・`isReviewConversationCollapsed`・`setReviewConversationCollapsed`・`renderReviewConversation`
  - `web/app.js:6058-6387` Comment Count — 関数 11: `updateCommentCount`・`updateTocPosition`・`toggleCommentsPanel`・`createPanelCommentCard`
  - `web/app.js:6388-6525` PR Overview Panel — 関数 3: `togglePRPanel`・`renderPRPanel`・`updateViewedCount`
  - `web/app.js:6526-6544` Waiting Modal Tips — 関数 2: `startTipRotation`・`stopTipRotation`
  - `web/app.js:6545-6597` UI State — 関数 2: `updateHeaderRound`・`setUIState`
  - `web/app.js:6598-6599` General Comment Button (in panel header)
  - `web/app.js:6600-6731` Finish Review — 関数 4: `doFinishReview`・`resolveAllAndFinish`・`showNoChangesConfirm`・`hideNoChangesConfirm`
  - `web/app.js:6732-6988` SSE Client — 関数 2: `connectSSE`・`showDisconnected`
  - `web/app.js:6989-7021` Share — 関数 2: `refreshAllComments`・`announceCopy`
  - `web/app.js:7022-7049` Toast System — 関数 2: `showToast`・`dismissToast`
  - `web/app.js:7050-7181` Table of Contents — 関数 5: `buildToc`・`reviewScroller`・`reviewScrollerTop`・`scrollReviewToElement`
  - `web/app.js:7182-7205` Hash Navigation (heading anchors) — 関数 1: `scrollToHashHeading`
  - `web/app.js:7206-7264` Mermaid — 関数 4: `getMermaidTheme`・`mermaidOptions`・`watchCodeBlocks`・`renderMermaidBlocks`
  - `web/app.js:7265-7550` Mermaid fullscreen overlay (GitHub-style pan/zoom) — 関数 10: `mermaidOverlayNodes`・`mermaidOverlayApply`・`mermaidOverlayZoomAt`・`mermaidOverlayZoomCenter`
  - `web/app.js:7551-7581` Theme — 関数 3: `initTheme`・`applyCritPalette`・`applyTheme`
  - `web/app.js:7582-7594` Width — 関数 2: `initWidth`・`applyWidth`
  - `web/app.js:7595-7626` Sidebar Resize — 関数 1: `initSidebarWidths`
  - `web/app.js:7627-7631` Update Button
  - `web/app.js:7632-7645` Diff Mode Toggle (Split / Unified)
  - `web/app.js:7646-7652` Toggle Diff (rendered diff view for file mode)
  - `web/app.js:7653-8266` Compare chrome (target + commit range) — 関数 25: `sessionInRangeFocus`・`effectiveDiffScope`・`sessionFocusIsRange`・`currentFileDataScope`
  - `web/app.js:8267-8473` Scope Toggle (All / Branch / Staged / Unstaged) — 関数 9・ハンドラ 1: `reloadForScope`・`isStoryMobileRail`・`isStoryRailCollapsed`・`syncSidebarToggleAria`
  - `web/app.js:8474-8492` Comments Panel Toggle (mirrors file-tree slide on right) — 関数 2: `setCommentsPanelCollapsed`・`startCommentsPanelAnimation`
  - `web/app.js:8493-8505` TOC Toggle
  - `web/app.js:8506-8615` Comment Navigation — 関数 3: `collectNavigableComments`・`highlightNavComment`・`navigateToComment`
  - `web/app.js:8616-8675` Comments Panel Toggle — 関数 1: `activateFilterBtn`
  - `web/app.js:8676-9081` Settings Panel — 関数 8: `getSettingsCtl`・`loadCodeFonts`・`openSettingsPanel`・`applyHideResolved`
  - `web/app.js:9082-9187` Select-to-Comment helper — 関数 1: `tryOpenFormFromSelection`
  - `web/app.js:9188-9267` Stack breadcrumb + working-tree pill — 関数 3: `truncateLabel`・`entryLabel`・`focusPayloadFromStackEntry`
  - `web/app.js:9268-9718` Stack chip + popover — 関数 11: `chipLabelForFocus`・`isStackChipOpen`・`focusableStackPopoverItems`・`closeStackChip`
  - `web/app.js:9719-9902` Story mode — 関数 12: `hunkKey`・`storyPageId`・`storyHasContent`・`storyNeedsRawDiff`
  - `web/app.js:9903-10069` Story progress — 関数 11: `isStoryFileViewed`・`storyPageProgress`・`updateStoryMarkButton`・`storyStatusClass`
  - `web/app.js:10070-10174` Rail — 関数 3: `renderStoryRail`・`railStatusHtml`・`countHunksForPage`
  - `web/app.js:10175-10287` Overview — 関数 2: `renderStoryOverview`・`renderStoryPrologueBullets`
  - `web/app.js:10288-10626` Chapter / Support page — 関数 5: `renderStoryPage`・`renderStoryFileGroup`・`storySupportReasonForFile`・`renderStoryFileByPath`
  - `web/app.js:10627-10940` Router — 関数 15・ハンドラ 1: `renderStory`・`resetStoryScroll`・`showStory`・`storyFromHash`
  - `web/app.js:10941-11056` Start — 関数 2: `locateFile`・`locate`
<!-- b_j4qtb0n9 -->

> [!NOTE]
> **この章で分かること**
> - この画面が何を表示し、何を別部品に任せているか
> - 起動から描画と投稿、更新反映までの流れ
> - 設定取得と一覧描画の約束事 <!-- b_br2mx127 -->

## 責務 <!-- b_p0nra0zt -->

`init` から起動し、`renderAllFiles` や `renderCommentsPanel`、`renderStory` でファイルとコメントと物語表示を担う（[app.js:851](../../../web/app.js#L851)、[app.js:1620](../../../web/app.js#L1620)、[app.js:6164](../../../web/app.js#L6164)、[app.js:10628](../../../web/app.js#L10628)）。
投稿と解決の操作は `submitComment` や `toggleResolveStatus`、`addReviewComment` が受け持つ（[app.js:4679](../../../web/app.js#L4679)、[app.js:5296](../../../web/app.js#L5296)、[app.js:5345](../../../web/app.js#L5345)）。
実描画の多くは `window.crit.commentCard` と `window.crit.commentHtml` に委ね、自前では持たない（[app.js:4935-4963](../../../web/app.js#L4935-L4963)、[app.js:234-237](../../../web/app.js#L234-L237)）。 <!-- b_8ysfw56d -->

## 依存関係 <!-- b_mnewez46 -->

- 実描画は `window.crit.commentCard` と `window.crit.commentHtml` に委譲する（[app.js:4935-4963](../../../web/app.js#L4935-L4963)、[app.js:234-237](../../../web/app.js#L234-L237)）。
- 生スレッド判定は `isLiveThread` を介して共有する（[app.js:4902](../../../web/app.js#L4902)、[app.js:4947-4949](../../../web/app.js#L4947-L4949)）。
- web の crit 系と live-mode 系の双方と双方向に依存し合う（推測）。 <!-- b_nw06v6g4 -->

## 処理の流れ <!-- b_fwes3tbh -->

1. `init` が設定と一覧の読み込みから起動する（[app.js:851](../../../web/app.js#L851)）。
2. `loadAllFileData` が取得し、`renderAllFiles` が描画する（[app.js:578](../../../web/app.js#L578)、[app.js:1620](../../../web/app.js#L1620)）。
3. `openForm` から `submitComment` で投稿し、`renderCommentsPanel` が一覧を更新する（[app.js:3995](../../../web/app.js#L3995)、[app.js:4679](../../../web/app.js#L4679)、[app.js:6164](../../../web/app.js#L6164)）。
4. `connectSSE` が更新を受け取り、`refreshAllComments` で再描画する（[app.js:6734](../../../web/app.js#L6734)、[app.js:7000](../../../web/app.js#L7000)）。 <!-- b_jjsy1x6r -->

## 設定 <!-- b_ggvnz9w2 -->

- `getSetting` は `loadSettings` の結果を読み、なければ既定値を返す（[app.js:307-310](../../../web/app.js#L307-L310)）。
- `setSetting` と `setCookie`、`getCookie` が設定の保存と取得を担う（[app.js:312](../../../web/app.js#L312)、[app.js:287](../../../web/app.js#L287)、[app.js:290](../../../web/app.js#L290)）。 <!-- b_vwn8qt4a -->

## テスト <!-- b_2gew05xz -->

`normalizeCommentMarkdown` の引用変換と `slugifyHeading` の正規化で表示の基礎を確かめる（[comment-blockquote.test.js:26](../../../web/__tests__/comment-blockquote.test.js#L26)、[heading-anchors.test.js:26](../../../web/__tests__/heading-anchors.test.js#L26)）。
`navigateToComment` や `buildChangeGroups`、`setUIState` で遅延読み込みと状態遷移を確かめる（[defer-file-body.test.js:17](../../../web/__tests__/defer-file-body.test.js#L17)、[defer-file-body.test.js:57](../../../web/__tests__/defer-file-body.test.js#L57)、[auto-close-dismiss-wiring.test.js:14](../../../web/__tests__/auto-close-dismiss-wiring.test.js#L14)）。
`normalizeCommitPins` と `fetchCommits` の空耐性や読み込み順序を確かめる（[commit-list-null-guard.test.js:12](../../../web/__tests__/commit-list-null-guard.test.js#L12)、[commit-list-null-guard.test.js:23](../../../web/__tests__/commit-list-null-guard.test.js#L23)、[index-html-load-order.test.js:24](../../../web/__tests__/index-html-load-order.test.js#L24)）。 <!-- b_m6jdte5n -->

## 不変条件 <!-- b_tph1zxvg -->

- `renderCommentsPanel` は保存したスクロール位置を描画後に復元する（[app.js:6164-6170](../../../web/app.js#L6164-L6170)、[app.js:6262](../../../web/app.js#L6262)）。
- `buildCommentCard` は欠けた折り畳みや判定の関数を既定で補う（[app.js:4935-4949](../../../web/app.js#L4935-L4949)）。
- `showToast` は同名の表示を消してから作り直す（[app.js:7023-7030](../../../web/app.js#L7023-L7030)）。 <!-- b_ka73avap -->

## 並行性 <!-- b_baackpb1 -->

`loadAllFileData` や `loadSingleFile`、`fetchWhenReady` が非同期に取得し、`connectSSE` が更新を流し込む（[app.js:578](../../../web/app.js#L578)、[app.js:627](../../../web/app.js#L627)、[app.js:814](../../../web/app.js#L814)、[app.js:6734](../../../web/app.js#L6734)）。
`renderCommentsPanel` は `files` と `reviewComments` を束ねて描画する（[app.js:6164-6175](../../../web/app.js#L6164-L6175)）。 <!-- b_sgw86n26 -->

## 落とし穴 <!-- b_5k9zy7vf -->

> [!WARNING]
> **落とし穴**
> - `window.crit.commentCard` や `window.crit.commentHtml` の変更は `buildCommentCard` 越しに全体へ波及する（[app.js:4935-4963](../../../web/app.js#L4935-L4963)、[app.js:234-237](../../../web/app.js#L234-L237)）。
> - `pierreViewActive` の切り替えは `reviewScroller` の返す対象を変える（[app.js:7126-7128](../../../web/app.js#L7126-L7128)、[app.js:1648](../../../web/app.js#L1648)）。 <!-- b_wejaq5k7 -->

## 深掘り <!-- b_tv3sn3a3 -->

> [!NOTE]
> **深掘り**
> - 物語表示における遅延取得と既読連動の成立条件の詳細 <!-- b_65mpznzr -->

> [!TIP]
> **まとめ**
> 画面全体の制御点であり、実描画の多くは別部品に委ねる。 <!-- b_h2efv8mz -->
