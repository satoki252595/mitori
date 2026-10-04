# ローカルHTTPサーバー <!-- b_1zbqzd5p -->

- ファイル 38 · 5799 行 · 重要度 0.43
<!-- b_d1ykgxxt -->

> [!NOTE]
> **この章で分かること**
> - `Server` がどのように HTTP ルートを組み立て、リクエストを守るか。
> - コメント・共有・終了処理のハンドラがセッションとどう結びつくか。
> - 終了時のプロンプトとフックがどの層で解決されるか。 <!-- b_5y66ee8d -->

## 責務 <!-- b_9nzeceqj -->

internal/server は crit のローカル HTTP サーバーで、レビュー UI 用の API と埋め込み静的アセットを配信する（[server.go:127-228](../../../internal/server/server.go#L127-L228)）。internal/prompt と internal/hooks も同じモジュールに属し、終了時のプロンプト生成とフック実行を受け持つ（[run.go:49](../../../internal/hooks/run.go#L49)、[render.go:140](../../../internal/prompt/render.go#L140)）。セッションの実体は `session` パッケージ側にあり、このモジュールは型エイリアスで参照するだけである（[types.go:11-20](../../../internal/server/types.go#L11-L20)）。 <!-- b_fqppccyd -->

## 公開インターフェース <!-- b_ywk60yqs -->

- `NewServer`: ルートを登録した `Server` を返す（[server.go:127-128](../../../internal/server/server.go#L127-L128)）。
- `Server.SetSession`: セッションを差し替え、開始時刻を記録する（[server.go:425-430](../../../internal/server/server.go#L425-L430)）。
- `Server.CheckForUpdates`: GitHub の最新リリースを取得し `latestVersion` に保存する（[server.go:449-479](../../../internal/server/server.go#L449-L479)）。
- `ResolveDaemonCLIConfig`: デーモンの引数を `DaemonCLIConfig` に解決する（[daemon\_cli.go:244](../../../internal/server/daemon_cli.go#L244)）。
- `hooks.Run`: 解決済みコマンドをタイムアウト付きで実行する（[run.go:45](../../../internal/hooks/run.go#L45)）。 <!-- b_0176mg1z -->

## 処理の流れ <!-- b_hgcmj5rq -->

1. `ServeHTTP` がまず `checkHost` で Host ヘッダを検証し、不一致なら 403 を返す（[server.go:278-282](../../../internal/server/server.go#L278-L282)）。
2. 次に `checkSecFetchSite` で別オリジンからのブラウザ要求を拒否する。ヘッダが無い CLI や curl は通す（[server.go:283-291](../../../internal/server/server.go#L283-L291)）。
3. `mux` がルートに振り分け、セッション依存のものは `withReady` を経由する（[server.go:170-174](../../../internal/server/server.go#L170-L174)）。 <!-- b_vz89bkfz -->

## 並行性 <!-- b_qphbna4x -->

セッションは `atomic.Pointer[Session]` で保持され、差し替えとハンドラの読み出しが競合しない（[server.go:59](../../../internal/server/server.go#L59)）。認証トークンは `authMu`、バージョン情報は `versionMu` の RWMutex で守られる（[server.go:64-73](../../../internal/server/server.go#L64-L73)）。バックグラウンド処理は `bgWG` で待ち合わせる（[server.go:108](../../../internal/server/server.go#L108)）。 <!-- b_se9rg2d7 -->

## 落とし穴 <!-- b_qzeh1jpk -->

> [!WARNING]
> **落とし穴**
> - `/api/health` や `/preview`、`/live` は `withReady` で包まれておらず、セッション準備前でも応答する。新ルートを足すときはどちらにするか決める必要がある（[server.go:135-148](../../../internal/server/server.go#L135-L148)）。
> - 追加の live-mode スクリプトは `NewServer` に個別に列挙されている（[server.go:156-168](../../../internal/server/server.go#L156-L168)）。 <!-- b_zhjhy05t -->
