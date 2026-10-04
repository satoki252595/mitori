# デーモンとプランCLI（internal） <!-- b_4h8c01m5 -->

- ファイル 39 · 4482 行 · 重要度 0.48
<!-- b_e5qtv49a -->

> [!NOTE]
> **この章で分かること**
> - デーモンのセッションファイルとセッションキーの仕組み
> - デーモンの起動・停止・生存確認の流れ
> - プランレビューと再開・状態表示 CLI の入口 <!-- b_kxb05bpj -->

## 責務 <!-- b_yxv7pys5 -->

このモジュールは、レビュー用デーモンの管理（`internal/daemon`）と、`plan`・`status`・`stop`・`resume` などの CLI 実装（`internal/session`）を担う。セッション情報は `~/.crit/reviews` 配下や sessions ディレクトリの JSON ファイルとして永続化される（[daemon.go:246-252](../../../internal/daemon/daemon.go#L246-L252)、[daemon.go:266-276](../../../internal/daemon/daemon.go#L266-L276)）。対話選択の UI は `internal/picker` が受け持つ。 <!-- b_783618g5 -->

## 公開インターフェース <!-- b_mrc9ekt6 -->

- `SessionKey` は cwd・ブランチ・引数から 12 桁の 16 進キーを作る（[daemon.go:178-194](../../../internal/daemon/daemon.go#L178-L194)）。
- `ValidSessionKey` はキーが 12 桁の小文字 16 進かを検査する（[daemon.go:209-220](../../../internal/daemon/daemon.go#L209-L220)）。
- `FindAliveSession` はキーのセッションを読み、生存していなければファイルを消す（[daemon.go:311-321](../../../internal/daemon/daemon.go#L311-L321)）。
- `ListSessionsForRepoRoot` はリポジトリ配下の生存セッションを返す（[daemon.go:469-509](../../../internal/daemon/daemon.go#L469-L509)）。
- `StopDaemon` はデーモンを停止する（[daemon.go:1085-1135](../../../internal/daemon/daemon.go#L1085-L1135)）。
- `RequestShutdown` は `/api/shutdown` に POST して結果を `ShutdownResult` で返す（[daemon.go:998-1012](../../../internal/daemon/daemon.go#L998-L1012)）。
- `RunPlan`・`RunPlanHook`・`RunStatus`・`RunStop`・`RunResume`・`RunStats` は CLI の入口である（[plan\_cli.go:118](../../../internal/session/plan_cli.go#L118)、[plan\_cli.go:359](../../../internal/session/plan_cli.go#L359)）。 <!-- b_q9wvv59w -->

## データ構造 <!-- b_q2x0x7es -->

- `SessionEntry` は `PID`、`Port`、`Host`、`PublicURL`、`CWD`、`Branch`、`ReviewPath` などを持つ（[daemon.go:94-103](../../../internal/daemon/daemon.go#L94-L103)）。
- `ConnURL` は接続用で、`Host` が空なら `127.0.0.1` を使う（[daemon.go:144-150](../../../internal/daemon/daemon.go#L144-L150)）。
- `AdvertisedURL` は `PublicURL` があればそれを、なければ表示用ホストで URL を組む（[daemon.go:117-136](../../../internal/daemon/daemon.go#L117-L136)）。 <!-- b_es8fgv53 -->

## 設定 <!-- b_018r9bgr -->

- `CRIT_PLAN_REVIEW` は自動プランレビューの無効化判定に使われる（[plan\_cli.go:354-357](../../../internal/session/plan_cli.go#L354-L357)）。
- `CRIT_NO_INTEGRATION_CHECK` は連携未導入のヒント表示に関わる（[daemon\_cli.go:56-60](../../../internal/session/daemon_cli.go#L56-L60)）。
- `_CRIT_READY_STDOUT` はデーモン側の準備完了通知に関わる（[daemon.go:939-950](../../../internal/daemon/daemon.go#L939-L950)）。 <!-- b_xgeva72f -->

## エラー処理 <!-- b_q4bpn57a -->

`DaemonHasBrowser` は到達不能・非 200・JSON 不正・`browser_clients` 欠落のいずれでも「ブラウザあり」と扱う（[daemon.go:553-576](../../../internal/daemon/daemon.go#L553-L576)）。`StopDaemon` は停止を確認できなければ、再試行できるようセッションファイルを残してエラーを返す（[daemon.go:1117-1128](../../../internal/daemon/daemon.go#L1117-L1128)）。 <!-- b_5ejjrsvq -->

## 並行性 <!-- b_m72bansz -->

`UnlessSessionTakenOver` はセッションロックを取り、ファイルの `PID` が別のデーモンに替わっていれば処理を実行しない（[daemon.go:1058-1069](../../../internal/daemon/daemon.go#L1058-L1069)）。`StopDaemon` も後継が同じキーを持つ場合はファイルを消さない（[daemon.go:1129-1133](../../../internal/daemon/daemon.go#L1129-L1133)）。 <!-- b_w70a900q -->

## 落とし穴 <!-- b_2rqnvhyd -->

> [!WARNING]
> **落とし穴**
> `RemoveSessionFile` は `.json` と `.log` を消すが、ロックは空いている場合だけ消す。起動時に取得済みのロックを残すためである（[daemon.go:297-307](../../../internal/daemon/daemon.go#L297-L307)）。 <!-- b_4046zfgz -->
