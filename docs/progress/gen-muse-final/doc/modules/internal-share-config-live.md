# 設定と共有と live 中継（internal） <!-- b_y7mh2n54 -->

- ファイル 25 · 4821 行 · 重要度 0.41
<!-- b_a6ybcsnh -->

**変更の手引き**
- 影響が及ぶ先（このモジュールを使う）: [レビュー用 HTTP サーバ](internal-server.md)・[plan 審査と daemon 管理](internal-session-plan-cli.md)・[CLI 入口と統合管理](cmd-crit.md)・[変更連携基盤](internal-github-gitlab.md)・[レビューセッション管理](internal-session-session.md)・[コメント管理](internal-comment.md)
- 使っているもの: [plan 審査と daemon 管理](internal-session-plan-cli.md)・[レビューセッション管理](internal-session-session.md)・[変更連携基盤](internal-github-gitlab.md)・[レビュー用 HTTP サーバ](internal-server.md)・[版管理抽象と差分取得](internal-vcs.md)・[コメント管理](internal-comment.md)
- テスト: `internal/share/share_test.go`（104 件）・`internal/config/config_test.go`（71 件）・`internal/auth/auth_test.go`（65 件）・`internal/live/live_test.go`（52 件） ほか 52 · 実行: `go test ./internal/...`
- 入口から: `ANY /api/share/upsert-payload`（`internal/server/server.go:180`）・`crit share`（`cmd/crit/cli_dispatch.go:24`）・`cmd/crit`（`cmd/crit/main.go:21`）
- よく使われる宣言（変えると波及する）: `Config` `internal/config/config.go:22`（17 ファイル）・`LoadConfig` `internal/config/config.go:462`（11 ファイル）・`OpenBrowserWithCommand` `internal/browser/browser.go:14`（7 ファイル）・`LoadCurrentConfig` `internal/config/cli_resolve.go:24`（7 ファイル）・`ShareTarget` `internal/config/share_targets.go:24`（7 ファイル）
- 一緒に変わりやすいファイル: 履歴を読めません（浅いクローンか git の外）
- 注意: ハブ（多くから使われ、多くを使う）・循環依存（[CLI 入口と統合管理](cmd-crit.md)・[変更連携基盤](internal-github-gitlab.md)・[レビューセッション管理](internal-session-session.md) ほか 4 と）
<!-- b_jcymrvay -->

> [!NOTE]
> **この章で分かること**
> - 設定の層と優先順位の考え方を学ぶ。
> - 共有の作成と取得の流れを学ぶ。
> - live 起動とプロキシの役割を学ぶ。 <!-- b_7mennkah -->

## 責務 <!-- b_9c90e253 -->

全体と項目の設定読み込み、共有先の検証と選択を担う（[config.go:462](../../../internal/config/config.go#L462)、[share\_targets.go:124](../../../internal/config/share_targets.go#L124)）。共有の作成や取得、取り消しと live 表示のための中継も担う（[cli.go:331](../../../internal/share/cli.go#L331)、[proxy.go:425](../../../internal/live/proxy.go#L425)）。差分やセッション、画面描画の本体は別領域に譲り、ここでは持たない（推測）。 <!-- b_xjpmrhvq -->

## 公開インターフェース <!-- b_baghhy0k -->

- `LoadConfig` は全体設定の取得に使う（[config.go:462](../../../internal/config/config.go#L462)）。
- `SelectShareTarget` は共有先の決定に使う（[share\_targets.go:190](../../../internal/config/share_targets.go#L190)）。
- `RunShare` は共有の作成と更新に使う（[cli.go:331](../../../internal/share/cli.go#L331)）。
- `RunFetch` は共有先からの取り込みに使う（[cli.go:550](../../../internal/share/cli.go#L550)）。
- `RunUnpublish` は共有の公開停止に使う（[cli.go:658](../../../internal/share/cli.go#L658)）。
- `RunLive` は live の起動に使う（[live.go:259](../../../internal/live/live.go#L259)）。
- `BindProxyServer` は中継待受の構築に使う（[proxy.go:425](../../../internal/live/proxy.go#L425)）。
- `RunConfig` は設定の表示に使う（[cli.go:8](../../../internal/config/cli.go#L8)）。 <!-- b_70cn8h5b -->

## 依存関係 <!-- b_pvhz61w2 -->

- `internal/session` の `RunReviewClient` と `DiffEntry` を入力に使う（推測）。
- `internal/vcs` の `LooksLikePRURL` と `internal/comment` の `CheckCommentCLIAllowed` に頼る（推測）。
- `internal/server` の `FS` 側と `cmd/crit` の `Session` 側から利用される（推測）。 <!-- b_p78ytg30 -->

## データ構造 <!-- b_jrprsneh -->

- `Config` は待ち受けや共有、作成者の全体設定を束ねる（[config.go:22-33](../../../internal/config/config.go#L22-L33)）。
- `ShareTarget` は共有先 URL と認証、同意状態を束ねる（[share\_targets.go:24-30](../../../internal/config/share_targets.go#L24-L30)）。
- `ShareComment` は指摘の位置と本文、返信を束ねる（[share.go:126-140](../../../internal/share/share.go#L126-L140)）。
- `WebComment` は取得指摘の外部 ID と解決状態を束ねる（[share.go:573-588](../../../internal/share/share.go#L573-L588)）。
- `ConfigPresence` は明示設定の有無を記録する（[config.go:260-263](../../../internal/config/config.go#L260-L263)）。 <!-- b_q26xd0fy -->

## 処理の流れ <!-- b_e45htjdc -->

1. `LoadConfigFile` で全体と項目の設定を読む（[config.go:277](../../../internal/config/config.go#L277)）。
2. `mergeConfigs` で両者を統合する（[config.go:322](../../../internal/config/config.go#L322)）。
3. `ShareReviewFiles` で成果物を共有先へ送る（[share.go:281](../../../internal/share/share.go#L281)）。
4. `FetchWebComments` と `MergeWebComments` で指摘を取り込む（[export.go:33](../../../internal/share/export.go#L33)、[share.go:886](../../../internal/share/share.go#L886)）。
5. `runSmokeTest` と `newLiveProxy` で live 接続を確かめて中継する（[live.go:76](../../../internal/live/live.go#L76)、[proxy.go:36](../../../internal/live/proxy.go#L36)）。
6. `UnpublishFromWeb` で公開を取り消す（[share.go:377](../../../internal/share/share.go#L377)）。 <!-- b_zshg3f8f -->

## 設定 <!-- b_y4zykf71 -->

- `CRIT_HOST` は待ち受け先の上書きに使う（[cli\_resolve.go:64](../../../internal/config/cli_resolve.go#L64)）。
- `CRIT_SHARE_URL` は共有先の上書きに使う（[cli\_resolve.go:75](../../../internal/config/cli_resolve.go#L75)）。
- `CRIT_PUBLIC_URL` は公開 URL の上書きに使う（[public\_url.go:17](../../../internal/config/public_url.go#L17)）。
- `CRIT_AUTH_TOKEN` は認証に使う（[auth.go:368](../../../internal/auth/auth.go#L368)）。
- `LiveCookieFile` と `LiveCDPURL` は live 認証の入力に使う（[config.go:72-73](../../../internal/config/config.go#L72-L73)）。 <!-- b_h25fvxc8 -->

## 不変条件 <!-- b_5qkvxbjs -->

- `String` は `AuthToken` を伏せ字にして返す（[config.go:144-148](../../../internal/config/config.go#L144-L148)）。
- `SaveGlobalConfig` は施錠と原子書き込みで保存する（[config.go:601-611](../../../internal/config/config.go#L601-L611)、[config.go:631-634](../../../internal/config/config.go#L631-L634)）。
- `FilterIgnored` は条件なしでは入力をそのまま返す（[config.go:733-736](../../../internal/config/config.go#L733-L736)）。
- `MatchPattern` は末尾斜線で接頭辞照合する（[config.go:707-716](../../../internal/config/config.go#L707-L716)）。 <!-- b_k1y7hw1y -->

## エラー処理 <!-- b_e1cx06bp -->

- `ErrShareUnauthorized` と `ErrShareNotFound` で失敗理由を区別する（[share.go:59-60](../../../internal/share/share.go#L59-L60)）。
- `CrossOriginRedirectError` で異なる起点への転送を拒む（[share\_targets.go:35-37](../../../internal/config/share_targets.go#L35-L37)）。
- `decodeJSONOrHTMLHint` で応答復号の失敗を扱う（[share.go:418](../../../internal/share/share.go#L418)）。
- `ErrUnauthenticatedNetwork` で未承認公開を止める（[network.go:52](../../../internal/config/network.go#L52)）。 <!-- b_4jazsgb0 -->

## 並行性 <!-- b_r7fk7j4x -->

全体設定の更新は `flockExclusiveNB` で排他的に抑える（[flock\_unix.go:10](../../../internal/config/flock_unix.go#L10)）。使い終われば `funlock` で解放する（[flock\_unix.go:14](../../../internal/config/flock_unix.go#L14)）。 <!-- b_x0jm5dcv -->

## 落とし穴 <!-- b_9rveg38f -->

> [!WARNING]
> **落とし穴**
> - `IgnorePatterns` は全体と項目の和集合で上書きではない（[config.go:378-380](../../../internal/config/config.go#L378-L380)）。
> - `ShareURL` は全体専用で項目側は無視される（[config.go:486-491](../../../internal/config/config.go#L486-L491)）。
> - `DefaultShareURL` は二箇所に重複し連動が必要だ（[config.go:17](../../../internal/config/config.go#L17)、[share.go:27](../../../internal/share/share.go#L27)）。 <!-- b_8pc6twcf -->

> [!TIP]
> **まとめ**
> 設定と共有、live 結合を一体で捉えれば見通しが良い。 <!-- b_dgp4h96f -->
