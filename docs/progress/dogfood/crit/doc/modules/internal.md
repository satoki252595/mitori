# デーモン管理とセッションCLI <!-- b_b6d50f4m -->

- ファイル 24 · 3356 行 · 重要度 0.27
<!-- b_d593d7n5 -->

> [!NOTE]
> **この章で分かること**
> - デーモンのセッション登録（`SessionEntry`）の仕組みを学ぶ。
> - セッション操作用 CLI（status・stop・resume）の位置づけを学ぶ。
> - 他モジュールとの依存関係を学ぶ。 <!-- b_f9m7jkav -->

## 責務 <!-- b_04dx5gdt -->

`internal/daemon` はレビュー用デーモンの起動・探索・停止を担う（[daemon.go:790-800](../../../internal/daemon/daemon.go#L790-L800)、[daemon.go:998-1017](../../../internal/daemon/daemon.go#L998-L1017)、[daemon.go:1085-1090](../../../internal/daemon/daemon.go#L1085-L1090)）。デーモンは cwd・ブランチ・引数から決まるセッションキーで識別され、情報は `SessionEntry` としてファイルに保存される（[daemon.go:94-103](../../../internal/daemon/daemon.go#L94-L103)、[daemon.go:178](../../../internal/daemon/daemon.go#L178)、[daemon.go:266-279](../../../internal/daemon/daemon.go#L266-L279)）。`internal/session` の CLI 群（`RunStatus`、`RunStop`、`RunResume`）はこの層を呼び出して操作を提供する（[status\_cli.go:15](../../../internal/session/status_cli.go#L15)、[stop\_cli.go:13-15](../../../internal/session/stop_cli.go#L13-L15)、[resume\_cli.go:49](../../../internal/session/resume_cli.go#L49)）。 <!-- b_6bbkycg5 -->

## 公開インターフェース <!-- b_egc3kz66 -->

- `StartDaemon` / `StartDaemonInDir` はデーモンを起動して `SessionEntry` を返す（[daemon.go:790](../../../internal/daemon/daemon.go#L790)、[daemon.go:798](../../../internal/daemon/daemon.go#L798)）。
- `FindAliveSession` は生存中のセッションを探す（[daemon.go:311](../../../internal/daemon/daemon.go#L311)）。
- `ListSessionsForCWD` は cwd のセッション一覧を返す（[daemon.go:328](../../../internal/daemon/daemon.go#L328)）。
- `RequestShutdown` は停止要求を送り、`ShutdownResult` を返す（[daemon.go:983-998](../../../internal/daemon/daemon.go#L983-L998)）。
- `StopDaemon` はデーモンを停止する（[daemon.go:1085](../../../internal/daemon/daemon.go#L1085)）。 <!-- b_qzdp0436 -->

## データ構造 <!-- b_qb4fatx1 -->

- `SessionEntry` は `PID`、`Port`、`Host`、`PublicURL`、`CWD`、`Args`、`Branch`、`ReviewPath`、`StartedAt` を持つ（[daemon.go:94-103](../../../internal/daemon/daemon.go#L94-L103)）。
- `ShutdownResult` は `ShutdownUnavailable`、`ShutdownAccepted`、`ShutdownWrongDaemon` の値を取る（[daemon.go:983-993](../../../internal/daemon/daemon.go#L983-L993)）。 <!-- b_0vj9kgx3 -->

## 設定 <!-- b_9ea54bkj -->

- `_CRIT_READY_STDOUT` は準備完了通知に使われる（[daemon.go:939-943](../../../internal/daemon/daemon.go#L939-L943)）。
- `CRIT_NO_INTEGRATION_CHECK` は統合ヒント表示に関わる（[daemon\_cli.go:56-57](../../../internal/session/daemon_cli.go#L56-L57)）。 <!-- b_2t62mch9 -->
