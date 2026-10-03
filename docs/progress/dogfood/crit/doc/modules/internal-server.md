# HTTP サーバー層（internal） <!-- b_h6vqrv9v -->

- ファイル 19 · 5281 行 · 重要度 0.21
<!-- b_gwmn3x0h -->

> [!NOTE]
> **この章で分かること**
> - `Server` が公開する HTTP API の構成を知る。
> - ホスト検査と準備完了ゲートの役割を知る。
> - 共有（share）と認証状態の扱いを知る。 <!-- b_fv9efa79 -->

## 責務 <!-- b_e5g4ghxq -->

`internal/server` は `net/http` の `ServeMux` を持つ `Server` を中心に、レビューセッションをブラウザや CLI へ公開する HTTP 層である（[server.go:58-61](../../../internal/server/server.go#L58-L61)）。コメント、ファイル差分、ラウンド、共有、SSE、添付などのエンドポイントを `/api/` 配下に登録する（[server.go:171-209](../../../internal/server/server.go#L171-L209)）。セッションの実体は `session` パッケージの型を別名で参照するだけで、自前では定義しない（[types.go:11-21](../../../internal/server/types.go#L11-L21)）。 <!-- b_g2rh5wsv -->

## 公開インターフェース <!-- b_3gs1kk7x -->

- `NewServer` は `Session`、埋め込みフロントエンド、共有 URL、認証トークンなどから `Server` を作る（[server.go:127](../../../internal/server/server.go#L127)）。
- `ServeHTTP` はリクエストの入口である（[server.go:278](../../../internal/server/server.go#L278)）。
- `SetSession`、`SetPRInfo`、`SetInitErr` は起動後に状態を差し込む（[server.go:425-441](../../../internal/server/server.go#L425-L441)）。
- `SetShutdownCtx` と `SetStopFunc` はデーモン停止との連携に使う（[server.go:374-380](../../../internal/server/server.go#L374-L380)）。
- `WaitBackground` は背景処理の完了を待つ（[server.go:399](../../../internal/server/server.go#L399)）。 <!-- b_kmf1h5xa -->

## 依存関係 <!-- b_az4cwygz -->

- `internal/session`（`CritJSON`、`DiffHunk` など）の型を利用する（[types.go:9-29](../../../internal/server/types.go#L9-L29)）。
- `internal/share` は共有ペイロード構築とリモートコメントの取得・統合を担う（[share.go:165-191](../../../internal/share/share.go#L165-L191)）。
- `internal/vcs`（`VCS`）と `internal/config`（`Config`）にも依存する（[types.go:13-30](../../../internal/server/types.go#L13-L30)）。 <!-- b_tc8qe9dv -->

## データ構造 <!-- b_pbdwmvzz -->

- `Server` の `session` は `atomic.Pointer[Session]` で、差し替え可能である（[server.go:59](../../../internal/server/server.go#L59)）。
- `authMu` は `authToken` と `cfg` の認証項目を守る（[server.go:64-65](../../../internal/server/server.go#L64-L65)）。
- `prList` は picker 用の 60 秒キャッシュである（[server.go:86](../../../internal/server/server.go#L86)）。
- `StaleIntegration` は古い統合の `Agent`、`Location`、`Hint`、`Hash` を持つ（[types.go:50-55](../../../internal/server/types.go#L50-L55)）。 <!-- b_y0r8c7z9 -->

## 処理の流れ <!-- b_gjc21z55 -->

1. `ServeHTTP` が `checkHost` と `checkSecFetchSite` で要求を検査する（[server.go:255](../../../internal/server/server.go#L255)、[server.go:278](../../../internal/server/server.go#L278)、[server.go:323](../../../internal/server/server.go#L323)）。
2. `withReady` と `requireReady` が初期化完了を確かめる（[server.go:337](../../../internal/server/server.go#L337)、[server.go:361](../../../internal/server/server.go#L361)）。
3. `ServeMux` が `handleFileComments` などのハンドラへ振り分ける（[server.go:210](../../../internal/server/server.go#L210)）。 <!-- b_bvmzfp51 -->

## 設定 <!-- b_4xve7rjs -->

- `CRIT_SHARE_URL` は共有 URL の解決で読まれる（[share.go:1092-1096](../../../internal/share/share.go#L1092-L1096)）。
- `CRIT_AUTH_TOKEN` は認証トークンの解決で読まれる（[share.go:1131-1132](../../../internal/share/share.go#L1131-L1132)）。
- `GOBIN` と `GOPATH` はインストール元の判定に使われる（[install\_source.go:31](../../../internal/server/install_source.go#L31)）。 <!-- b_bk8z708j -->

## テスト <!-- b_fcc17xfp -->

- 共有の成功・失敗・pull・reshare は `internal/server/handle_share_round_test.go:64` から検査する。
- ラウンド指定の差分は `internal/server/round_api_test.go:31` が検査する。
- 解決ラウンドは `internal/server/resolved_round_http_test.go:10` が検査する。 <!-- b_aafevq9m -->

## 並行性 <!-- b_60xcnycy -->

`Server` は用途別に `RWMutex` を持ち、認証は `authMu`、バージョンは `versionMu` で守る（[server.go:64-73](../../../internal/server/server.go#L64-L73)）。背景処理は `bgWG` で追跡される（[server.go:108](../../../internal/server/server.go#L108)）。 <!-- b_xf7vdzhd -->
