# plan 審査と daemon 管理（internal） <!-- b_qtqkf4wq -->

- ファイル 39 · 4482 行 · 重要度 0.48
<!-- b_ts53fk6y -->

**変更の手引き**
- 影響が及ぶ先（このモジュールを使う）: [変更連携基盤](internal-github-gitlab.md)・[CLI 入口と統合管理](cmd-crit.md)・[コメント管理](internal-comment.md)・[設定と共有と live 中継](internal-share-config-live.md)・[レビューセッション管理](internal-session-session.md)・[レビュー用 HTTP サーバ](internal-server.md) ほか 1
- 使っているもの: [レビューセッション管理](internal-session-session.md)・[設定と共有と live 中継](internal-share-config-live.md)・[版管理抽象と差分取得](internal-vcs.md)・[変更連携基盤](internal-github-gitlab.md)・[コメント管理](internal-comment.md)
- テスト: `internal/session/session_reconnect_test.go`（32 件）・`internal/session/attachments_test.go`（27 件）・`internal/session/resume_cli_test.go`（23 件）・`internal/session/plans_test.go`（22 件） ほか 26 · 実行: `go test ./internal/daemon ./internal/picker ./internal/session`
- 入口から: `ANY /api/files/list`（`internal/server/server.go:202`）・`ANY /api/attachments`（`internal/server/server.go:218`）・`crit share`（`cmd/crit/cli_dispatch.go:24`）
- よく使われる宣言（変えると波及する）: `ReviewPathsFor` `internal/session/review_paths.go:15`（19 ファイル）・`SessionEntry` `internal/daemon/daemon.go:94`（14 ファイル）・`ResolvedCWD` `internal/daemon/daemon.go:162`（13 ファイル）・`ReadFileShared` `internal/session/atomic_unix.go:15`（13 ファイル）・`SessionKey` `internal/daemon/daemon.go:178`（8 ファイル）
- 一緒に変わりやすいファイル: 履歴を読めません（浅いクローンか git の外）
- 注意: ハブ（多くから使われ、多くを使う）・循環依存（[CLI 入口と統合管理](cmd-crit.md)・[変更連携基盤](internal-github-gitlab.md)・[レビューセッション管理](internal-session-session.md) ほか 4 と）
<!-- b_rw6ya7gn -->

> [!NOTE]
> **この章で分かること**
> - daemon 起動と session 寿命の扱いが分かる。
> - plan 読取りと slug 解決と review 接続が分かる。
> - resume・status・stop と選択 UI の分担が分かる。 <!-- b_s6eqyde0 -->

## 責務 <!-- b_pv75qtvq -->

`StartDaemon` と `StopDaemon` で daemon 寿命と session file を管理する（[daemon.go:790-798](../../../internal/daemon/daemon.go#L790-L798)、[daemon.go:1085-1086](../../../internal/daemon/daemon.go#L1085-L1086)、[daemon.go:266-276](../../../internal/daemon/daemon.go#L266-L276)、[daemon.go:311-321](../../../internal/daemon/daemon.go#L311-L321)）。`RunPlan` 系で plan 読取りと保存と review 接続を行う（[plan\_cli.go:109-118](../../../internal/session/plan_cli.go#L109-L118)、[plan\_cli.go:181](../../../internal/session/plan_cli.go#L181)）。diff 算出や描画は扱わない（推測）。 <!-- b_6ahtxpgr -->

## 公開インターフェース <!-- b_ze5k5r23 -->

- `SessionKey` は session 分けの key を作る（[daemon.go:178-194](../../../internal/daemon/daemon.go#L178-L194)）。
- `FindAliveSession` は生存 daemon を返す（[daemon.go:311-321](../../../internal/daemon/daemon.go#L311-L321)）。
- `StartDaemon` と `StopDaemon` は起動と停止を行う（[daemon.go:790-798](../../../internal/daemon/daemon.go#L790-L798)、[daemon.go:1085-1086](../../../internal/daemon/daemon.go#L1085-L1086)）。
- `RunPlan` は plan 審査を進める（[plan\_cli.go:79-118](../../../internal/session/plan_cli.go#L79-L118)）。
- `RunResume` と `RunStatus` と `RunStop` は再開と表示と停止に使う（[resume\_cli.go:49](../../../internal/session/resume_cli.go#L49)、[status\_cli.go:15](../../../internal/session/status_cli.go#L15)、[stop\_cli.go:15](../../../internal/session/stop_cli.go#L15)）。
- `Select` は候補選択を行う（[picker.go:70](../../../internal/picker/picker.go#L70)）。 <!-- b_1skdw91h -->

## 依存関係 <!-- b_k3stktcw -->

internal/session の `DiffEntry` 系と internal の `RunAuth` 系と internal/vcs の `LooksLikePRURL` 系を使う（推測）。cmd/crit の `Config` 系と internal の `ExitError` 系と internal/comment の `BulkCommentEntry` 系から呼ばれる（推測）。 <!-- b_27n2mvjj -->

## データ構造 <!-- b_cjcgmg91 -->

- `SessionEntry` は `PID` と `Port` と `CWD` で実体を表す（[daemon.go:94-103](../../../internal/daemon/daemon.go#L94-L103)）。
- `resumableReview` は `key` と `branch` と `unresolved` を持つ（[resume\_cli.go:35-44](../../../internal/session/resume_cli.go#L35-L44)）。
- `staleReview` は `key` と `age` と `comments` で古さを表す（[stale\_reviews.go:13-20](../../../internal/session/stale_reviews.go#L13-L20)）。 <!-- b_wf8gv0je -->

## 処理の流れ <!-- b_0yr3aqm5 -->

1. `FindAliveSession` で生存を確認する（[daemon.go:311-321](../../../internal/daemon/daemon.go#L311-L321)）。
2. 無ければ `StartDaemon` し `SignalReadiness` で port を受取る（[daemon.go:790-798](../../../internal/daemon/daemon.go#L790-L798)、[daemon.go:954-960](../../../internal/daemon/daemon.go#L954-L960)）。
3. `RunReviewClient` で待ち `StopDaemon` で片付ける（[client.go:25](../../../internal/daemon/client.go#L25)、[daemon.go:1085-1086](../../../internal/daemon/daemon.go#L1085-L1086)）。 <!-- b_0h6r2zk6 -->

## 設定 <!-- b_t0rnkhtj -->

- `CRIT_PLAN_REVIEW` と `CRIT_NO_INTEGRATION_CHECK` は切替えに使う（[plan\_cli.go:355](../../../internal/session/plan_cli.go#L355)、[daemon\_cli.go:57](../../../internal/session/daemon_cli.go#L57)）。
- `_CRIT_READY_STDOUT` は readiness 受渡しに使う（[daemon.go:940](../../../internal/daemon/daemon.go#L940)）。
- `CommonDaemonFlags` と `PlanDaemonFlags` が起動条件を運ぶ（[daemon.go:24-31](../../../internal/daemon/daemon.go#L24-L31)、[plans.go:99-106](../../../internal/session/plans.go#L99-L106)）。 <!-- b_79rs8gpf -->

## テスト <!-- b_0tf83g9r -->

`TestJoinParts` と `TestPrintSessionSummary_SkipsEmpty` と `TestPrintSessionSummary_FormatsParts` は整形を確かめる（[client\_helpers\_test.go:13](../../../internal/daemon/client_helpers_test.go#L13)、[client\_helpers\_test.go:30](../../../internal/daemon/client_helpers_test.go#L30)、[client\_helpers\_test.go:43](../../../internal/daemon/client_helpers_test.go#L43)）。`TestReadReviewCycleResponse_OK` と `TestReadReviewCycleResponse_GatewayTimeout` と `TestParseCommentFlags` と `TestResolveCommentFlagsOutputPrecedence` は応答と flag を確かめる（[client\_helpers\_test.go:62](../../../internal/daemon/client_helpers_test.go#L62)、[client\_helpers\_test.go:82](../../../internal/daemon/client_helpers_test.go#L82)、[flags\_main\_test.go:22](../../../internal/comment/flags_main_test.go#L22)、[flags\_main\_test.go:132](../../../internal/comment/flags_main_test.go#L132)）。 <!-- b_cp98qwd1 -->

## 不変条件 <!-- b_3jystfqc -->

- `ValidSessionKey` は 12 文字 hex のみ通す（[daemon.go:209-220](../../../internal/daemon/daemon.go#L209-L220)）。
- `WriteSessionFile` は 0600 で不可分に書く（[daemon.go:266-276](../../../internal/daemon/daemon.go#L266-L276)）。 <!-- b_djhf0hxt -->

## エラー処理 <!-- b_ytbdd989 -->

`FindAliveSession` は不成立時に掃除する（[daemon.go:311-321](../../../internal/daemon/daemon.go#L311-L321)）。`RequestShutdown` は不能と不一致を分ける（[daemon.go:998-1012](../../../internal/daemon/daemon.go#L998-L1012)）。`StopDaemon` は失敗時に file を残す（[daemon.go:1085-1086](../../../internal/daemon/daemon.go#L1085-L1086)、[daemon.go:1117-1124](../../../internal/daemon/daemon.go#L1117-L1124)）。 <!-- b_r22gwfs8 -->

## 並行性 <!-- b_bz5bfk7d -->

競合は `acquireSessionLock` 系と `WithShareLock` で排他する（[daemon.go:582](../../../internal/daemon/daemon.go#L582)、[share\_lock.go:12](../../../internal/session/share_lock.go#L12)）。`UnlessSessionTakenOver` は `pid` 再確認で後継を守る（[daemon.go:1058-1069](../../../internal/daemon/daemon.go#L1058-L1069)）。 <!-- b_tmkzs38d -->

## 性能 <!-- b_sq6yy44a -->

`aliveClient` 系の timeout と `stopWait` が待ちを区切る（[daemon.go:61-74](../../../internal/daemon/daemon.go#L61-L74)）。 <!-- b_se6e4vew -->

## 落とし穴 <!-- b_yvpb93re -->

> [!WARNING]
> **落とし穴**
> - `RemoveSessionFile` は log と lock も消す（[daemon.go:297-307](../../../internal/daemon/daemon.go#L297-L307)）。
> - `SessionKey` は `args` 有無で意味が変わる（[daemon.go:178-194](../../../internal/daemon/daemon.go#L178-L194)）。 <!-- b_7k3h4xm1 -->

## 深掘り <!-- b_fg7ng85j -->

> [!NOTE]
> **深掘り**
> daemon 起動 pipe と readiness 失敗経路の全体像。 <!-- b_v6ntgmsq -->

> [!TIP]
> **まとめ**
> plan 審査の入口と daemon 寿命を束ねる部分である。 <!-- b_p85wmrkf -->
