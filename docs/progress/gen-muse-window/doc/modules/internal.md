# レビュー内部基盤 <!-- b_ezbsar9b -->

- ファイル 0 · 31035 行 · 重要度 1.00
- 子モジュール 7
<!-- b_8keab4h7 -->

> [!NOTE]
> **この章で分かること**
> - 差分取得の統一口 `VCS` から触ると全体像を掴みやすい（[vcs.go:14-16](../../../internal/vcs/vcs.go#L14-L16)、[vcs.go:50-63](../../../internal/vcs/vcs.go#L50-L63)）。
> - `Session` とコメントの往復を追うと保存と表示の対応が分かる（[session.go:416-430](../../../internal/session/session.go#L416-L430)、[session.go:456-460](../../../internal/session/session.go#L456-L460)、[session.go:487-489](../../../internal/session/session.go#L487-L489)、[session.go:2827-2839](../../../internal/session/session.go#L2827-L2839)）。
> - `NewServer` からの公開と共有や live の接続を試すと流れを掴める（[server.go:127-136](../../../internal/server/server.go#L127-L136)）。 <!-- b_f2c5s086 -->

## 責務 <!-- b_x65ysh5e -->

`VCS` から `Session` を経て `Server` に至る流れが中核である（[vcs.go:14-16](../../../internal/vcs/vcs.go#L14-L16)、[vcs.go:50-63](../../../internal/vcs/vcs.go#L50-L63)、[session.go:416-430](../../../internal/session/session.go#L416-L430)、[server.go:127-136](../../../internal/server/server.go#L127-L136)）。`Provider` と `RunComment` と `LoadConfig` が周辺を支え、差分取得から公開までを閉じる（[forge.go:126-135](../../../internal/forge/forge.go#L126-L135)、[run.go:19](../../../internal/comment/run.go#L19)、[config.go:462](../../../internal/config/config.go#L462)）。 <!-- b_ppp1dvtx -->

## 構成 <!-- b_0tvz0dqs -->

- 版管理抽象と差分取得は `VCS` を統一口として差分と変更一覧の取得を受け持つ（[vcs.go:14-16](../../../internal/vcs/vcs.go#L14-L16)、[vcs.go:50-63](../../../internal/vcs/vcs.go#L50-L63)、[git\_vcs.go:12-14](../../../internal/vcs/git_vcs.go#L12-L14)、[jj.go:22-30](../../../internal/vcs/jj.go#L22-L30)）。
- レビューセッション管理は `Session` にコメントと差分とラウンド状態を束ねる（[session.go:416-430](../../../internal/session/session.go#L416-L430)、[session.go:456-460](../../../internal/session/session.go#L456-L460)、[session.go:487-489](../../../internal/session/session.go#L487-L489)、[session.go:2827-2839](../../../internal/session/session.go#L2827-L2839)）。
- plan 審査と daemon 管理は `StartDaemon` と `StopDaemon` で寿命と session file を扱う（[daemon.go:790-798](../../../internal/daemon/daemon.go#L790-L798)、[daemon.go:1085-1086](../../../internal/daemon/daemon.go#L1085-L1086)、[daemon.go:266-276](../../../internal/daemon/daemon.go#L266-L276)、[daemon.go:311-321](../../../internal/daemon/daemon.go#L311-L321)）。
- レビュー用 HTTP サーバは `NewServer` が振り分け表を組み立てて公開受け口となる（[server.go:127-136](../../../internal/server/server.go#L127-L136)、[server.go:170-176](../../../internal/server/server.go#L170-L176)、[render.go:134-140](../../../internal/prompt/render.go#L134-L140)、[resolve.go:143-149](../../../internal/hooks/resolve.go#L143-L149)）。
- 設定と共有と live 中継は `LoadConfig` と `RunShare` と `BindProxyServer` で読み込みと送受信を担う（[config.go:462](../../../internal/config/config.go#L462)、[share\_targets.go:124](../../../internal/config/share_targets.go#L124)、[cli.go:331](../../../internal/share/cli.go#L331)、[proxy.go:425](../../../internal/live/proxy.go#L425)）。
- 変更連携基盤は `Provider` が認証から取得と送受信までの共通操作を束ねる（[forge.go:126-135](../../../internal/forge/forge.go#L126-L135)、[provider.go:16-18](../../../internal/github/provider.go#L16-L18)、[provider.go:53-55](../../../internal/gitlab/provider.go#L53-L55)、[forge.go:132-133](../../../internal/forge/forge.go#L132-L133)）。
- コメント管理は `RunComment` と `ResolveReviewPath` で追加と所在解決を受け持つ（[run.go:19](../../../internal/comment/run.go#L19)、[list\_cli.go:136](../../../internal/comment/list_cli.go#L136)、[review\_file.go:37-39](../../../internal/review/review_file.go#L37-L39)、[export.go:19](../../../internal/review/export.go#L19)）。 <!-- b_12f6weaj -->

## 相互作用 <!-- b_337ag0n6 -->

`Server` は `Session` から差分とコメントを取り出し、`VCS` から差分を引いて画面と API に渡す（推測）。`RunComment` 系は `Session` と `ResolveReviewPath` を介して保存先を決め、`Provider` からの取り込み分と合流させる（推測）。設定と共有と live は `LoadConfig` の結果を各部に配り、`BindProxyServer` で中継しながら daemon と往復する（推測）。 <!-- b_8vg3ajv8 -->

## 公開インターフェース <!-- b_w6pvv2m7 -->

- `VCS` で差分と変更一覧を取得できる（[vcs.go:14-16](../../../internal/vcs/vcs.go#L14-L16)、[vcs.go:50-63](../../../internal/vcs/vcs.go#L50-L63)）。
- `Session` でコメントと差分とラウンドを保持できる（[session.go:416-430](../../../internal/session/session.go#L416-L430)、[session.go:456-460](../../../internal/session/session.go#L456-L460)、[session.go:487-489](../../../internal/session/session.go#L487-L489)、[session.go:2827-2839](../../../internal/session/session.go#L2827-L2839)）。
- `NewServer` でレビュー UI を公開できる（[server.go:127-136](../../../internal/server/server.go#L127-L136)）。
- `Provider` の `Pull` と `Push` で変更連携を行える（[forge.go:126-135](../../../internal/forge/forge.go#L126-L135)）。
- `RunComment` と `LoadCritJSON` でコメント操作を行える（[run.go:19](../../../internal/comment/run.go#L19)、[review\_file.go:325](../../../internal/review/review_file.go#L325)）。
- `LoadConfig` と `RunShare` と `BindProxyServer` で設定と共有と中継を扱える（[config.go:462](../../../internal/config/config.go#L462)、[cli.go:331](../../../internal/share/cli.go#L331)、[proxy.go:425](../../../internal/live/proxy.go#L425)）。 <!-- b_0nfsdznc -->

## 不変条件 <!-- b_57rnk42b -->

- `Server` は保存や差分生成を持たず、`Session` の取得と追加に委ねる（[server.go:127-136](../../../internal/server/server.go#L127-L136)、[session.go:416-430](../../../internal/session/session.go#L416-L430)）。
- コメント永続は `CritJSON` に寄せ、`LoadCritJSON` と `SaveCritJSON` で読み書きする（[review\_file.go:325](../../../internal/review/review_file.go#L325)、[review\_file.go:373](../../../internal/review/review_file.go#L373)）。
- HTTP 受付は loopback のみを前提とし、`agent_cmd` があれば shell 実行に届く（[README.md:9-11](../../../integrations/docker/README.md#L9-L11)）。
- 差分取得は `VCS` 経由に寄せ、具象差を呼び出し側に漏らさない（[vcs.go:14-16](../../../internal/vcs/vcs.go#L14-L16)、[vcs.go:50-63](../../../internal/vcs/vcs.go#L50-L63)）。 <!-- b_56yxh73b -->

> [!TIP]
> **まとめ**
> 以上を起点に、各部の詳細へ進むと理解が早い。 <!-- b_prsp4mtm -->
