# 設定・認証・起動引数（internal） <!-- b_82r0e90s -->

- ファイル 18 · 3396 行 · 重要度 0.32
<!-- b_0a74davq -->

> [!NOTE]
> **この章で分かること**
> - 設定ファイルの構造と読み込み・マージの仕組み
> - 共有先（share target）と認証の扱い
> - 設定を参照する CLI 解決処理と環境変数 <!-- b_6vkynw6w -->

## 責務 <!-- b_ttkegawq -->

このモジュールは `internal/config` の設定読み込み、`internal/auth` のデバイスコード認証、`internal/server` のデーモン CLI 設定解決をまとめている。`Config` はグローバル設定とプロジェクト設定を `mergeConfigs` で統合した結果を表す（[config.go:22-36](../../../internal/config/config.go#L22-L36)、[config.go:322](../../../internal/config/config.go#L322)）。認証は `RunAuth` が入口で、ログイン・ログアウト・whoami を扱う（[auth.go:23](../../../internal/auth/auth.go#L23)、[auth.go:76](../../../internal/auth/auth.go#L76)、[auth.go:351](../../../internal/auth/auth.go#L351)、[auth.go:407](../../../internal/auth/auth.go#L407)）。 <!-- b_1nhkvsgp -->

## 公開インターフェース <!-- b_vw1f1fxa -->

- `LoadConfig` は `projectDir` から統合済みの `Config` を返す（[config.go:462](../../../internal/config/config.go#L462)）。
- `SaveGlobalConfig` は JSON マップを更新関数で書き換えてグローバル設定に保存する（[config.go:601](../../../internal/config/config.go#L601)）。
- `ResolveShareTargets` と `SelectShareTarget` は共有先を解決・選択する（[share\_targets.go:124](../../../internal/config/share_targets.go#L124)、[share\_targets.go:190](../../../internal/config/share_targets.go#L190)）。
- `ResolvePort`、`ResolveHost`、`ResolveShareURL` はフラグと設定から値を決める（[cli\_resolve.go:47](../../../internal/config/cli_resolve.go#L47)、[cli\_resolve.go:60](../../../internal/config/cli_resolve.go#L60)、[cli\_resolve.go:71](../../../internal/config/cli_resolve.go#L71)）。
- `ResolveDaemonCLIConfig` は引数から `DaemonCLIConfig` を作る（[daemon\_cli.go:244](../../../internal/server/daemon_cli.go#L244)）。 <!-- b_vkr9vhcf -->

## データ構造 <!-- b_b87zambr -->

- `Config` の `ShareTargets` は `ShareTarget` の配列で、各要素が `URL`、`Default`、`ProxyAuth`、`Auth` を持つ（[share\_targets.go:24-30](../../../internal/config/share_targets.go#L24-L30)）。
- `TargetAuth` はトークンとユーザー情報を保持する（[share\_targets.go:16-21](../../../internal/config/share_targets.go#L16-L21)）。
- `ConfigPresence` は項目が設定ファイルに明示されたかを示す真偽値群である（[config.go:260-272](../../../internal/config/config.go#L260-L272)）。 <!-- b_23ejcgee -->

## 設定 <!-- b_34xbqcch -->

- `CRIT_PORT`、`CRIT_HOST`、`CRIT_SHARE_URL` は `internal/config/cli_resolve.go` で読まれる（[cli\_resolve.go:47-75](../../../internal/config/cli_resolve.go#L47-L75)）。
- `CRIT_PUBLIC_URL` は `internal/config/public_url.go` で読まれる（[public\_url.go:13-17](../../../internal/config/public_url.go#L13-L17)）。
- `CRIT_AUTH_TOKEN` は認証トークンの上書きに使われる（[auth.go:644-645](../../../internal/auth/auth.go#L644-L645)）。
- `CRIT_ALLOW_UNAUTHENTICATED_NETWORK` は非認証ネットワーク許可の確認用である（[network.go:13-15](../../../internal/config/network.go#L13-L15)）。 <!-- b_5evtjne3 -->

## テスト <!-- b_nz4n7csr -->

- `internal/auth/auth_test.go:21` 以降でデバイスコード要求とトークンのポーリングを検証する（[auth\_test.go:21](../../../internal/auth/auth_test.go#L21)）。
- `internal/auth/auth_test.go:293` 以降でトークン失効と whoami を検証する（[auth\_test.go:293](../../../internal/auth/auth_test.go#L293)）。
- `internal/auth/auth_test.go:822` 以降で `LazyBackfillAuthUserID` を検証する（[auth\_test.go:822](../../../internal/auth/auth_test.go#L822)）。 <!-- b_sa29ass3 -->

> [!TIP]
> **まとめ**
> 設定の統合、共有先と認証、デーモン起動引数の解決を担う層である。 <!-- b_1xrja43q -->
