# レビューセッション管理（internal） <!-- b_mbqdbhhv -->

- ファイル 18 · 5850 行 · 重要度 0.49
<!-- b_fwbymtgv -->

**変更の手引き**
- 影響が及ぶ先（このモジュールを使う）: [plan 審査と daemon 管理](internal-session-plan-cli.md)・[コメント管理](internal-comment.md)・[変更連携基盤](internal-github-gitlab.md)・[レビュー用 HTTP サーバ](internal-server.md)・[設定と共有と live 中継](internal-share-config-live.md)・[CLI 入口と統合管理](cmd-crit.md) ほか 1
- 使っているもの: [版管理抽象と差分取得](internal-vcs.md)・[plan 審査と daemon 管理](internal-session-plan-cli.md)・[設定と共有と live 中継](internal-share-config-live.md)・[変更連携基盤](internal-github-gitlab.md)
- テスト: `internal/session/session_test.go`（207 件）・`internal/session/watch_test.go`（33 件）・`internal/session/round_snapshots_v4_gaps_test.go`（20 件）・`internal/session/roundtrip_integration_test.go`（19 件） ほか 33 · 実行: `go test ./internal/diff ./internal/session`
- 入口から: `ANY /api/comment/`（`internal/server/server.go:209`）・`ANY /api/review-comment/`（`internal/server/server.go:201`）・`ANY /api/events`（`internal/server/server.go:188`）・`ANY /api/share/upsert-payload`（`internal/server/server.go:180`）・`ANY /api/files/list`（`internal/server/server.go:202`）
- よく使われる宣言（変えると波及する）: `CritJSON` `internal/session/session.go:540`（31 ファイル）・`Comment` `internal/session/session.go:129`（17 ファイル）・`Session` `internal/session/session.go:416`（17 ファイル）・`CritJSONFile` `internal/session/session.go:671`（16 ファイル）・`Focus` `internal/session/session_focus.go:45`（12 ファイル）
- 一緒に変わりやすいファイル: 履歴を読めません（浅いクローンか git の外）
- 注意: ハブ（多くから使われ、多くを使う）・大きいファイル `internal/session/session.go`（3,114 行）・循環依存（[CLI 入口と統合管理](cmd-crit.md)・[変更連携基盤](internal-github-gitlab.md)・[レビュー用 HTTP サーバ](internal-server.md) ほか 4 と）
<!-- b_mkd8smpf -->

**大きなファイルの中身（1,500 行を超えるファイル）**
- `internal/session/session.go`（3,114 行）
  - `internal/session/session.go:28-69` 関数（11）: `computeFileHash`・`fileHash`・`randomID`・`RandomCommentID`
  - `internal/session/session.go:72-255` 型（6）: `Reply`・`DOMAnchor`・`Comment`・`SSEEvent`
  - `internal/session/session.go:262-303` 関数（3）: `ensureFileLoaded`・`isLazy`・`finishLoad`
  - `internal/session/session.go:309-398` FileEntry のメソッド（3）: `ensureLoaded`・`ensureLoadedAtRange`・`diffHunks`
  - `internal/session/session.go:401-413` 関数（2）: `diffHunksForFile`・`diffHunksForFileCtx`
  - `internal/session/session.go:416-583` 型（2）: `Session`・`CritJSON`
  - `internal/session/session.go:586-606` 関数（2）: `RemoteDeletesFor`・`ReplaceRemoteDeletes`
  - `internal/session/session.go:611-675` 型（7）: `Story`・`StoryPrologue`・`StoryChapter`・`StoryHunkRef`
  - `internal/session/session.go:681-805` 関数（8）: `populateLazyFile`・`populateEagerFile`・`populateEagerFileDiff`・`NewSessionFromGit`
  - `internal/session/session.go:812-825` Session のメソッド: `baseRefForWorkingTreeDiscovery`
  - `internal/session/session.go:829-1087` 関数（8）: `NewGitSession`・`NewGitSessionLenient`・`newGitSession`・`canonicalAbsPath`
  - `internal/session/session.go:1099-1116` Session のメソッド: `captureBaselineAndPersist`
  - `internal/session/session.go:1126-1250` 関数（7）: `walkDirectory`・`walkDirSubsFirst`・`fileIgnored`・`dirIgnored`
  - `internal/session/session.go:1253-1279` 関数（2）: `extractAnchor`・`FileByPath`
  - `internal/session/session.go:1282-1684` Session のメソッド（18）: `AddComment`・`AddFileComment`・`AddLivePin`・`AddReviewComment`
  - `internal/session/session.go:1693-1698` 定数・変数（4）: `deleteResultDeleted`・`deleteResultNotFound`・`deleteResultForbidden`・`deleteResult`
  - `internal/session/session.go:1705-2502` Session のメソッド（41）: `DeleteFileCommentAs`・`DeleteComment`・`appendPendingRemoteDelete`・`trackDeletedComment`
  - `internal/session/session.go:2508-2514` 関数: `reportLoadCritJSONLockViolation`
  - `internal/session/session.go:2528-2784` Session のメソッド（8）: `loadCritJSON`・`restoreShareStateLocked`・`restoreFileCommentsLocked`・`loadCritJSONLocked`
  - `internal/session/session.go:2786-2806` 関数（2）: `omitTombstonedComments`・`defaultEmptyCommentScopes`
  - `internal/session/session.go:2811-2929` Session のメソッド（9）: `Subscribe`・`Unsubscribe`・`notify`・`BrowserConnect`
  - `internal/session/session.go:2936-3001` メソッド（2）: `GetFileDiffSnapshot`・`whitespaceIgnoredHunks`
  - `internal/session/session.go:3004-3034` 型（2）: `SessionInfo`・`SessionFileInfo`
  - `internal/session/session.go:3037-3114` Session のメソッド: `GetSessionInfo`
<!-- b_pr2fn4s8 -->

> [!NOTE]
> **この章で分かること**
> - `Session` を中心とした責務と永続化の全体像を学ぶ
> - `Comment` と `Focus` と `CritJSON` の関係を学ぶ
> - 遅延読込と監視と通知の仕組みを学ぶ <!-- b_sbxx8fg2 -->

## 責務 <!-- b_vseq8sr9 -->

対象ファイルとコメントとラウンド状態は `Session` に束ねられ、差分再計算と永続化と通知の中核となる（[session.go:416-430](../../../internal/session/session.go#L416-L430)、[session.go:456-460](../../../internal/session/session.go#L456-L460)、[session.go:487-489](../../../internal/session/session.go#L487-L489)、[session.go:2827-2839](../../../internal/session/session.go#L2827-L2839)）。`Focus` 切替や `ChangeBaseBranch` では一覧を作り直しつつコメントを保持する（[session\_focus.go:45-68](../../../internal/session/session_focus.go#L45-L68)、[session\_focus.go:226](../../../internal/session/session_focus.go#L226)、[session.go:2365-2366](../../../internal/session/session.go#L2365-L2366)、[session.go:2458-2487](../../../internal/session/session.go#L2458-L2487)）。取得の詳細は外部に委ねる設計である（推測）。 <!-- b_7ywb4np1 -->

## 公開インターフェース <!-- b_7r4bvmpr -->

- `NewSessionFromFiles` は明示ファイルからファイル指定モードの `Session` を作る（[session.go:1000-1005](../../../internal/session/session.go#L1000-L1005)、[session.go:1021-1024](../../../internal/session/session.go#L1021-L1024)）。
- `NewGitSession` は Git 向けの `Session` を作る（[session.go:829-844](../../../internal/session/session.go#L829-L844)）。
- `AddComment` は行範囲にコメントを付け、アンカーとラウンドを刻む（[session.go:1282-1321](../../../internal/session/session.go#L1282-L1321)）。
- `GetComments` は `Focus` 可視で絞った複写を返す（[session.go:1870-1882](../../../internal/session/session.go#L1870-L1882)）。
- `SetFocus` は対象範囲を切り替える（[session\_focus.go:226](../../../internal/session/session_focus.go#L226)）。
- `GetFileDiffSnapshot` は表示用の差分ハンクを返す（[session.go:2957-2984](../../../internal/session/session.go#L2957-L2984)）。
- `Watch` は変更を監視する（[watch.go:308-317](../../../internal/session/watch.go#L308-L317)）。 <!-- b_3ktmx3jr -->

## 依存関係 <!-- b_q4dcys72 -->

- `internal/vcs` の `LooksLikePRURL` などと `internal` の共有設定系の `RunAuth` などを使う（推測）。
- `internal/session` の計画系の `RunReviewClient` などと `internal` のフォージ系の `ExitError` などとは相互に呼び合う（推測）。
- `internal/comment` の `BulkCommentEntry` などと `internal/server` の `FS` などと `cmd/crit` の `Config` などから使われる（推測）。 <!-- b_fb8jz443 -->

## データ構造 <!-- b_c9k4a1jy -->

- `Session` はファイル一覧とラウンドと共有状態を持ち、購読者への通知口となる（[session.go:416-430](../../../internal/session/session.go#L416-L430)、[session.go:487-489](../../../internal/session/session.go#L487-L489)、[session.go:499-506](../../../internal/session/session.go#L499-L506)）。
- `FileEntry` はパスと内容と `DiffHunks` とコメントを束ねる（[session.go:210-221](../../../internal/session/session.go#L210-L221)）。
- `Comment` は行範囲と本体とアンカーと解決状態を持ち、返信を抱える（[session.go:129-160](../../../internal/session/session.go#L129-L160)）。
- `CritJSON` は永続化形式で、ファイル別コメントと共有情報を保持する（[session.go:540-555](../../../internal/session/session.go#L540-L555)）。
- `Focus` は作業ツリーか範囲かを示し、対象ハッシュと表示条件を決める（[session\_focus.go:45-68](../../../internal/session/session_focus.go#L45-L68)）。
- `Story` は章立てとハンク参照と網羅報告を持ち、表示順を配列順で表す（[session.go:611-620](../../../internal/session/session.go#L611-L620)、[session.go:636-640](../../../internal/session/session.go#L636-L640)）。 <!-- b_7h3pq7py -->

## 処理の流れ <!-- b_83r8mzqm -->

1. `NewSessionFromFiles` はパスを展開し、`FileEntry` を並べて初期化する（[session.go:1000-1005](../../../internal/session/session.go#L1000-L1005)、[session.go:1061-1070](../../../internal/session/session.go#L1061-L1070)）。
2. `AddComment` はアンカーを切り出して `StampWithFocus` で刻み、追記する（[session.go:1282-1321](../../../internal/session/session.go#L1282-L1321)）。
3. `scheduleWrite` と `WriteFiles` で `CritJSON` へ書く（[session\_write.go:13-38](../../../internal/session/session_write.go#L13-L38)、[session.go:540-544](../../../internal/session/session.go#L540-L544)）。
4. `GetComments` は `visibleInFocusKey` で絞り、`GetFileDiffSnapshot` はハンクを返す（[session.go:1870-1882](../../../internal/session/session.go#L1870-L1882)、[session.go:2957-2984](../../../internal/session/session.go#L2957-L2984)）。 <!-- b_1dpezgkc -->

## テスト <!-- b_f8489q8p -->

`TestComputeLineDiff_BasicChanges` と `TestComputeLineDiff_EmptyOld` と `TestComputeLineDiff_EmptyNew` と `TestComputeLineDiff_Identical` は差分の基本と境界を検証する（[diff\_test.go:9](../../../internal/diff/diff_test.go#L9)、[diff\_test.go:38](../../../internal/diff/diff_test.go#L38)、[diff\_test.go:48](../../../internal/diff/diff_test.go#L48)、[diff\_test.go:58](../../../internal/diff/diff_test.go#L58)）。`TestComputeLineDiff_WhitespaceOnlyChanges` と `TestComputeLineDiff_BothEmpty` と `TestConcurrentSaveCritJSON_NoCorruption` は空白差異と空同士と並行保存を検証する（[diff\_test.go:68](../../../internal/diff/diff_test.go#L68)、[diff\_test.go:87](../../../internal/diff/diff_test.go#L87)、[concurrent\_save\_test.go:24](../../../internal/session/concurrent_save_test.go#L24)）。 <!-- b_ja2m4hfd -->

## エラー処理 <!-- b_gqhrr0y2 -->

入力不足や取得失敗は `fmt.Errorf` で包んで返し、呼び出し側に伝える（[session.go:1000-1011](../../../internal/session/session.go#L1000-L1011)）。`ChangeBaseBranch` は失敗時に上書きを戻し、旧ベースへ巻き戻す（[session.go:2365-2366](../../../internal/session/session.go#L2365-L2366)、[session.go:2411-2418](../../../internal/session/session.go#L2411-L2418)）。 <!-- b_rk5hbwdd -->

## 並行性 <!-- b_pqecbfkq -->

ファイルとコメントへの並行アクセスは `Session` の `mu` で排他する（[session.go:416-418](../../../internal/session/session.go#L416-L418)、[session.go:487-489](../../../internal/session/session.go#L487-L489)）。`subscribers` は `subMu` で守られ、`notify` が `SSEEvent` を配る（[session.go:200-203](../../../internal/session/session.go#L200-L203)、[session.go:487-489](../../../internal/session/session.go#L487-L489)、[session.go:2827-2839](../../../internal/session/session.go#L2827-L2839)）。 <!-- b_7j989y3j -->

## 性能 <!-- b_x1yxb0e1 -->

多ファイル時は `Lazy` で内容取得を遅らせ、`ensureFileLoaded` で必要時に読む（[session.go:231-232](../../../internal/session/session.go#L231-L232)、[session.go:262-285](../../../internal/session/session.go#L262-L285)）。遠隔内容は `bytesLRU` に束ね、反復取得を抑える（[lru\_bytes.go:21-25](../../../internal/session/lru_bytes.go#L21-L25)）。 <!-- b_pv4xy8n1 -->

## 落とし穴 <!-- b_e7tpx3f5 -->

> [!WARNING]
> **落とし穴**
> - 旧側の `AddComment` は作業ツリーではなくベース参照からアンカーを取るため、参照元を誤ると位置がずれる（[session.go:1282-1303](../../../internal/session/session.go#L1282-L1303)）。
> - `ChangeBaseBranch` はコメント保持と削除記録の移送を伴うため、片方のみの変更は不整合を招く（[session.go:2365-2366](../../../internal/session/session.go#L2365-L2366)、[session.go:2458-2487](../../../internal/session/session.go#L2458-L2487)）。 <!-- b_ce9dyvje -->

> [!TIP]
> **まとめ**
> 要点を押さえれば、レビュー基盤の動きが見通せる。 <!-- b_f707w21v -->
