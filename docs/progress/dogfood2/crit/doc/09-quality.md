# 9. 非機能 <!-- b_na6fdnfn -->

## キャッシュ <!-- b_pgtw6jas -->

キャッシュは GitHub 連携に集中している。`prMetadataCache` は PR メタデータを `prCacheKey` のキーで保持し、取得中に別の goroutine が同じキーを埋めた場合は既存エントリを優先して、全呼び出し元が同じポインタに収束するようにしている（[pr\_cache.go:58-87](../../internal/github/pr_cache.go#L58-L87)）。容量 `cap` を超えると `evictOldestLocked` で追い出す（[pr\_cache.go:16](../../internal/github/pr_cache.go#L16)、[pr\_cache.go:82-85](../../internal/github/pr_cache.go#L82-L85)）。 <!-- b_chspgtxk -->

## セキュリティ境界 <!-- b_qay82wwv -->

- 設定とトークンの扱いは `internal/config` と `internal/daemon` にまたがる。`Config.String` は `AuthToken` と各共有先のトークンを `[redacted]` に置き換えてから出力する（[config.go:144-154](../../internal/config/config.go#L144-L154)）。
- グローバル設定にはベアラートークンが入るため、`SaveGlobalConfig` は `lockGlobalConfig` でロックし、一時ファイル経由の `AtomicWriteFile` をパーミッション 0o600 で書く（[config.go:601-635](../../internal/config/config.go#L601-L635)）。
- セッションファイルも `WriteSessionFile` が 0600 で原子的に書く（[daemon.go:266-276](../../internal/daemon/daemon.go#L266-L276)）。
- トークンの参照元は環境変数 `CRIT_AUTH_TOKEN` を含み、`internal/auth`、`internal/config`、`internal/server`、`internal/share` に現れる（[auth.go:368](../../internal/auth/auth.go#L368)、[share\_targets.go:230](../../internal/config/share_targets.go#L230)、[share\_targets.go:123](../../internal/server/share_targets.go#L123)、[share.go:1132](../../internal/share/share.go#L1132)）。 <!-- b_6k069cah -->

## 信頼性 <!-- b_deqysxn9 -->

- デーモンの生存確認は `FindAliveSession` が行い、死んでいるセッションファイルは `RemoveSessionFile` で消して「無い」扱いにする（[daemon.go:311-321](../../internal/daemon/daemon.go#L311-L321)）。
- `DaemonHasBrowser` は、到達不能・非 200 など判定できない場合にすべて「ブラウザあり」と倒す。誤ってデーモンを止めない側に寄せた設計である（[daemon.go:553-576](../../internal/daemon/daemon.go#L553-L576)）。
- `ResolvedCWD` は `EvalSymlinks` に失敗しても未解決のパスで続行する（[daemon.go:162-172](../../internal/daemon/daemon.go#L162-L172)）。
- `ParseUnifiedDiff` は `diff.suppressBlankEmpty` で先頭の空白が落ちた空行を、境界内に限りコンテキスト行として復元する（[git.go:1575-1587](../../internal/vcs/git.go#L1575-L1587)）。 <!-- b_znn7yv2a -->

## 可観測性 <!-- b_yrnbytz1 -->

- 環境変数 `CRIT_DEBUG` が `internal/session/session.go` で参照される（[session.go:2510](../../internal/session/session.go#L2510)）。
- `CRIT_NO_UPDATE_CHECK` と `CRIT_NO_INTEGRATION_CHECK` は `cmd/crit` の起動時チェックを切るスイッチである（[cli\_serve.go:47](../../cmd/crit/cli_serve.go#L47)、[cli\_serve.go:283](../../cmd/crit/cli_serve.go#L283)）。
- HTTP では `/api/health` が `Server.handleHealth` で提供され、デーモンの稼働確認に使われる（[server.go:136](../../internal/server/server.go#L136)）。 <!-- b_0z70ptn1 -->
