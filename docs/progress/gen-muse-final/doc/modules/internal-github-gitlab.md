# 変更連携基盤（internal） <!-- b_2a183thr -->

- ファイル 19 · 4214 行 · 重要度 0.22
<!-- b_kk3nb6h5 -->

**変更の手引き**
- 影響が及ぶ先（このモジュールを使う）: [CLI 入口と統合管理](cmd-crit.md)・[設定と共有と live 中継](internal-share-config-live.md)・[レビュー用 HTTP サーバ](internal-server.md)・[plan 審査と daemon 管理](internal-session-plan-cli.md)・[コメント管理](internal-comment.md)・[レビューセッション管理](internal-session-session.md)
- 使っているもの: [plan 審査と daemon 管理](internal-session-plan-cli.md)・[レビューセッション管理](internal-session-session.md)・[設定と共有と live 中継](internal-share-config-live.md)・[コメント管理](internal-comment.md)・[版管理抽象と差分取得](internal-vcs.md)
- テスト: `internal/github/github_test.go`（133 件）・`internal/github/push_buckets_test.go`（27 件）・`internal/github/push_cli_flags_test.go`（19 件）・`internal/gitlab/push_operations_test.go`（19 件） ほか 25 · 実行: `go test ./internal/...`
- 入口から: `ANY /api/comment/`（`internal/server/server.go:209`）・`ANY /api/review-comment/`（`internal/server/server.go:201`）・`ANY /api/events`（`internal/server/server.go:188`）・`ANY /api/share/upsert-payload`（`internal/server/server.go:180`）・`cmd/crit`（`cmd/crit/main.go:21`）
- よく使われる宣言（変えると波及する）: `ChangeID` `internal/forge/forge.go:21`（13 ファイル）・`ExitError` `internal/clicmd/clicmd.go:11`（12 ファイル）・`Kind` `internal/forge/forge.go:10`（7 ファイル）・`GitLab` `internal/forge/forge.go:15`（7 ファイル）・`RepoContext` `internal/forge/forge.go:37`（6 ファイル）
- 一緒に変わりやすいファイル: 履歴を読めません（浅いクローンか git の外）
- 注意: ハブ（多くから使われ、多くを使う）・循環依存（[CLI 入口と統合管理](cmd-crit.md)・[レビューセッション管理](internal-session-session.md)・[レビュー用 HTTP サーバ](internal-server.md) ほか 4 と）
<!-- b_qx5mqg33 -->

> [!NOTE]
> **この章で分かること**
> - GitHub と GitLab を束ねる共通化の方針が分かる。
> - 取り込みと投稿の基本操作の進み方が分かる。
> - 失敗時の振る舞いと再利用時の注意点が分かる。 <!-- b_r1vs4mgb -->

## 責務 <!-- b_gb4ts1ns -->

internal/forge が変更要求の共通抽象を定め、internal/github と internal/gitlab が提供者別の取得と同期を受け持つ（[forge.go:126-135](../../../internal/forge/forge.go#L126-L135)、[provider.go:16-18](../../../internal/github/provider.go#L16-L18)、[provider.go:53-55](../../../internal/gitlab/provider.go#L53-L55)）。番号や URL で指定した変更の取り込みと投稿が中心である（[forge.go:132-133](../../../internal/forge/forge.go#L132-L133)、[spec.go:17-39](../../../internal/github/spec.go#L17-L39)）。差分算出や保存形式の管理は別部品に任せる（推測）。画面描画や常駐動作も扱わない（推測）。 <!-- b_njxz89f6 -->

## 公開インターフェース <!-- b_xy16dv5j -->

- `Provider` は認証要求から取得と送受信までの共通操作を束ねる（[forge.go:126-135](../../../internal/forge/forge.go#L126-L135)）。
- `RunPull` は取り込み側の処理入口である（[cli.go:19](../../../internal/forge/cli.go#L19)、[pull\_cli.go:95-99](../../../internal/github/pull_cli.go#L95-L99)）。
- `RunPush` は投稿側の処理入口である（[cli.go:44](../../../internal/forge/cli.go#L44)、[push\_cli.go:469](../../../internal/github/push_cli.go#L469)）。
- `ParsePRSpec` は番号や pull 要求 URL を正規化して対象を決める（[spec.go:17-39](../../../internal/github/spec.go#L17-L39)）。
- `ParseMRSpec` は merge 要求指定の解釈を受け持つ（[spec.go:14](../../../internal/gitlab/spec.go#L14)）。
- `FetchPR` は pull 要求の書誌情報を取得する（[github.go:314](../../../internal/github/github.go#L314)）。
- `InvalidatePR` は書誌情報の保持分を破棄して再取得させる（[pr\_cache.go:154](../../../internal/github/pr_cache.go#L154)）。 <!-- b_5hvxnwca -->

## 依存関係 <!-- b_40pn58pr -->

- internal/session の検討支援と表示用の型や実行部に頼り、`RunReviewClient` などで処理を委ねる（推測）。
- internal/comment の `BulkCommentEntry` 周りと internal/vcs の URL 判定に頼って注釈と対象を扱う（推測）。
- internal/share 側の `RunAuth` による認証状態と設定に依存する（推測）。
- cmd/crit や internal/server から呼ばれ、`Config` などの上位型と組み合わせて使われる（推測）。 <!-- b_av9hq254 -->

## データ構造 <!-- b_amy59kbp -->

- `ChangeID` は番号と project と host で変更を指す（[forge.go:21-24](../../../internal/forge/forge.go#L21-L24)）。
- `ChangeRequest` は題名や本文と base や head の参照や SHA を束ねる（[forge.go:52-70](../../../internal/forge/forge.go#L52-L70)）。
- `PullRequest` と `PushRequest` は対象指定と出力先や会合識別子を運ぶ（[forge.go:89-94](../../../internal/forge/forge.go#L89-L94)、[forge.go:97-105](../../../internal/forge/forge.go#L97-L105)）。
- `PullResult` と `PushResult` は件数と警告文を返す（[forge.go:108-112](../../../internal/forge/forge.go#L108-L112)、[forge.go:115-121](../../../internal/forge/forge.go#L115-L121)）。
- `ghComment` は行範囲と side と本文を保持する（[github.go:54-68](../../../internal/github/github.go#L54-L68)）。
- `gitlabDiscussion` は識別子と注釈列で対話を表す（[pull.go:84-98](../../../internal/gitlab/pull.go#L84-L98)）。 <!-- b_avrkap8z -->

## 処理の流れ <!-- b_52hkgd69 -->

1. 仕様文字列を解釈して対象変更を定める（[spec.go:17-39](../../../internal/github/spec.go#L17-L39)）。
2. 認証と取得の前提を確かめて遠隔の注釈や書誌情報を読む（[pull\_cli.go:95-115](../../../internal/github/pull_cli.go#L95-L115)）。
3. 既存の検討文と突き合わせて新規分だけを取り込む（[pull\_cli.go:157-163](../../../internal/github/pull_cli.go#L157-L163)）。
4. 投稿時は対象を選別して下書きと編集や削除を順に送る（[push\_cli.go:242](../../../internal/github/push_cli.go#L242)、[push\_cli.go:388](../../../internal/github/push_cli.go#L388)、[push\_cli.go:420](../../../internal/github/push_cli.go#L420)）。
5. 識別子と本文ハッシュを書き戻して再送を抑える（[github.go:1333-1350](../../../internal/github/github.go#L1333-L1350)）。 <!-- b_qvytj3ga -->

## テスト <!-- b_513p8vx4 -->

起動補助の複数形化や終了符号と引数並べ替えの振る舞いを確かめる（[clicmd\_test.go:12](../../../internal/clicmd/clicmd_test.go#L12)、[clicmd\_test.go:31](../../../internal/clicmd/clicmd_test.go#L31)、[clicmd\_test.go:92](../../../internal/clicmd/clicmd_test.go#L92)）。変更種別の判定と pull や push 要求の解釈を確かめる（[cli\_test.go:55](../../../internal/forge/cli_test.go#L55)、[cli\_test.go:65](../../../internal/forge/cli_test.go#L65)、[cli\_test.go:92](../../../internal/forge/cli_test.go#L92)、[detect\_test.go:5](../../../internal/forge/detect_test.go#L5)）。投稿用の仕分けや下書き表示と認証失敗の判定を確かめる（[export\_cli\_test.go:46](../../../internal/github/export_cli_test.go#L46)、[export\_cli\_test.go:75](../../../internal/github/export_cli_test.go#L75)、[export\_cli\_test.go:100](../../../internal/github/export_cli_test.go#L100)、[github\_auth\_test.go:10](../../../internal/github/github_auth_test.go#L10)）。 <!-- b_7nd22c1g -->

## 並行性 <!-- b_1tv7rqsn -->

書誌情報の保持は `prMetadataCache` が `mu` で守り、取得の競合時は既存項目へ寄せる（[pr\_cache.go:31-39](../../../internal/github/pr_cache.go#L31-L39)、[pr\_cache.go:58-87](../../../internal/github/pr_cache.go#L58-L87)）。一覧の保持も `PRListCache` が `mu` を備えて共有に備える（[github.go:388-391](../../../internal/github/github.go#L388-L391)）。 <!-- b_q6kjzxjb -->

## 落とし穴 <!-- b_41nvq4pk -->

> [!WARNING]
> **落とし穴**
> - 取り込み前に `InvalidatePRCache` で古い書誌情報を捨てないと最新を見落とす（[pull\_cli.go:110-113](../../../internal/github/pull_cli.go#L110-L113)）。
> - 本文比較は `bodyHashAtPush` と `LastPushedBodyHash` に依存し、解決済みは編集対象から外れる（[github.go:1044-1048](../../../internal/github/github.go#L1044-L1048)）。
> - 識別子の書き戻しは `AtomicWriteFile` で原子的に行い、中断時の半端な保存を避ける（[github.go:1130-1134](../../../internal/github/github.go#L1130-L1134)）。 <!-- b_g0k1sdn8 -->

> [!TIP]
> **まとめ**
> 共通抽象の上で提供者別の差異を閉じ込め、取り込みと投稿を往復できる形に整えている。 <!-- b_wxzm2spa -->
