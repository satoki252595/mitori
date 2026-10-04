# 設定・共有・live（internal） <!-- b_6e1s733a -->

- ファイル 25 · 4821 行 · 重要度 0.41
<!-- b_9c6g3bd8 -->

> [!NOTE]
> **この章で分かること**
> - 設定ファイルのマージ規則と、project 設定から除外される項目
> - 共有（share）の CLI がレビューをどう組み立てて送るか
> - live モードが外部サイトへ接続する際の cookie 解決 <!-- b_1vqaqspg -->

## 責務 <!-- b_3tx8t5yf -->

このモジュールは、global と project の設定を読み込んで一つの `Config` に統合する（[config.go:462-528](../../../internal/config/config.go#L462-L528)）。また、レビューを共有サービスへ公開・取得・取り下げする処理を持つ（[cli.go:331](../../../internal/share/cli.go#L331)、[cli.go:550](../../../internal/share/cli.go#L550)、[cli.go:658](../../../internal/share/cli.go#L658)）。さらに、`crit live` の起動とリバースプロキシ、cookie の解決を担う（[live.go:259](../../../internal/live/live.go#L259)、[proxy.go:36](../../../internal/live/proxy.go#L36)）。設定の永続化では、global 設定の書き込みを排他ロックと原子的な置換で行う（[config.go:601-635](../../../internal/config/config.go#L601-L635)）。 <!-- b_c4qjw2z7 -->

## 公開インターフェース <!-- b_v0g8wmg7 -->

- `LoadConfig` は global・project 設定をマージし既定値を補った `Config` を返す（[config.go:462](../../../internal/config/config.go#L462)）。
- `SaveGlobalConfig` は global 設定の JSON を読み、コールバックで変更して書き戻す（[config.go:601-622](../../../internal/config/config.go#L601-L622)）。
- `MatchPattern` と `FilterIgnored` は ignore パターンでファイルを除外する（[config.go:707-733](../../../internal/config/config.go#L707-L733)）。
- `RunShare`、`RunFetch`、`RunUnpublish` は共有系 CLI のエントリである（[cli.go:331](../../../internal/share/cli.go#L331)、[cli.go:550](../../../internal/share/cli.go#L550)、[cli.go:658](../../../internal/share/cli.go#L658)）。
- `RunLive` は live モードの CLI エントリである（[live.go:259](../../../internal/live/live.go#L259)）。
- `BindProxyServer` は上流オリジンへのプロキシを待ち受ける（[proxy.go:425](../../../internal/live/proxy.go#L425)）。 <!-- b_fq1ft0fy -->

## データ構造 <!-- b_wy0scza1 -->

- `ConfigPresence` は JSON にキーが明示されたかを bool で持つ。既定値の適用や project 側の上書き判定に使う（[config.go:260-272](../../../internal/config/config.go#L260-L272)、[config.go:293-304](../../../internal/config/config.go#L293-L304)）。
- `ShareTarget` は共有先の URL、既定フラグ、同意状態、`TargetAuth` を持つ（[share\_targets.go:16-31](../../../internal/config/share_targets.go#L16-L31)）。
- `ShareComment` は共有ペイロード用のコメントで、返信 `Replies` や `DOMAnchor` を含む（[share.go:126-140](../../../internal/share/share.go#L126-L140)）。 <!-- b_xf9qyykr -->

## 設定 <!-- b_mz1ns1jn -->

- `CRIT_PORT`、`CRIT_HOST`、`CRIT_SHARE_URL` は `ResolvePort`、`ResolveHost`、`ResolveShareURL` が読む環境変数である（[cli\_resolve.go:47-75](../../../internal/config/cli_resolve.go#L47-L75)）。
- `CRIT_PUBLIC_URL` は公開 URL の解決で読まれる（[public\_url.go:13-17](../../../internal/config/public_url.go#L13-L17)）。
- `CRIT_ALLOW_UNAUTHENTICATED_NETWORK` は認証なしのネットワーク公開の承認に使う（[network.go:13-15](../../../internal/config/network.go#L13-L15)）。
- global は `GlobalConfigPath()`、project は `.crit.config.json` から読む（[config.go:470-474](../../../internal/config/config.go#L470-L474)）。 <!-- b_qzr6j1b3 -->

## 不変条件 <!-- b_mfmvcffn -->

- `host`、`proxy_auth`、`agent_cmd`、`auth_token`、`share_url`、`public_url`、`open_cmd` などは project 設定からマージされない。悪意あるリポジトリによる乗っ取りや、トークンの送信先変更を防ぐためである（[config.go:330-334](../../../internal/config/config.go#L330-L334)、[config.go:359-373](../../../internal/config/config.go#L359-L373)）。
- `Config.String` は `AuthToken` と各 `ShareTargets` のトークンを `[redacted]` に置き換えて出力する（[config.go:144-154](../../../internal/config/config.go#L144-L154)）。 <!-- b_psmm3v5j -->

## エラー処理 <!-- b_2ekesbpz -->

`LoadConfig` は設定ファイルの読み込み失敗や共有設定の不正を stderr に警告するだけで、処理は続行する（[config.go:464-467](../../../internal/config/config.go#L464-L467)、[config.go:492-494](../../../internal/config/config.go#L492-L494)）。`LoadConfigFile` は不正な `default_markdown_view` を警告して空に戻す（[config.go:309-312](../../../internal/config/config.go#L309-L312)）。`SaveGlobalConfig` は JSON の解析失敗をエラーとして返す（[config.go:613-617](../../../internal/config/config.go#L613-L617)）。 <!-- b_gw3csf2w -->

## 落とし穴 <!-- b_dhz5j162 -->

> [!WARNING]
> **落とし穴**
> - project にマージしてよい項目を増やすと、上記のセキュリティ上の除外理由と衝突しうる。`mergeConfigs` のコメントと合わせて変更する必要がある（[config.go:359-373](../../../internal/config/config.go#L359-L373)）。
> - `ConfigPresence` に新しい bool 項目を足すときは、`LoadConfigFile` の検出と `mergePresenceBools` の両方を直す必要がある（[config.go:293-304](../../../internal/config/config.go#L293-L304)、[config.go:393](../../../internal/config/config.go#L393)）。
> - `share` の `export.go` は非公開関数の公開ラッパーであり、シグネチャ変更は両方に及ぶ（[export.go:21-31](../../../internal/share/export.go#L21-L31)）。 <!-- b_caq18n2g -->

> [!TIP]
> **まとめ**
> 設定の統合規則、共有 CLI、live プロキシが集まったモジュールである。project 設定の信頼境界が設計の軸になっている。 <!-- b_aapmsv2g -->
