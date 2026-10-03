# CLI 入口と統合導入 <!-- b_86b74vn0 -->

- ファイル 21 · 4376 行 · 重要度 0.31
<!-- b_e86vaggs -->

> [!NOTE]
> **この章で分かること**
> - `crit` コマンドがどう振り分けられるかを学ぶ。
> - 統合（integration）のインストールと古さの検出の仕組みを学ぶ。
> - フォーカス解決（`internal/focus`）の役割を学ぶ。 <!-- b_at3r59aw -->

## 責務 <!-- b_9evjc86k -->

このモジュールは `crit` バイナリのエントリポイントであり、コマンド名からハンドラへの振り分けを担う（[cli\_dispatch.go:11-23](../../../cmd/crit/cli_dispatch.go#L11-L23)）。エージェント用統合ファイルの導入と鮮度確認も行う（[integrations.go:373-415](../../../cmd/crit/integrations.go#L373-L415)）。レビュー本体の処理は `internal/session` などに委ね、ここでは配線だけを行う（[wire.go:23-34](../../../cmd/crit/wire.go#L23-L34)）。 <!-- b_s5vctqj0 -->

## 公開インターフェース <!-- b_zmrqxxc1 -->

- `RunReview` は `crit review` の実処理で、引数を受けて `error` を返す（[review\_cli.go:22](../../../internal/session/review_cli.go#L22)）。
- `ResolveFocus` は PR・MR・範囲指定から `Focus` を解決する（[focus.go:137](../../../internal/focus/focus.go#L137)）。
- `ResolveCommentScope` はコメントの差分スコープを決める（[focus.go:429](../../../internal/focus/focus.go#L429)）。
- `SetPRResolveHooks` は PR 取得処理を差し込む（[pr\_hooks.go:32-35](../../../internal/focus/pr_hooks.go#L32-L35)）。 <!-- b_9zt7drnx -->

## データ構造 <!-- b_csdhv96c -->

- `commandDescriptor` は名前、`handler`、ヘルプ、`hidden`、入れ子の `subcommands` を持つ（[cli\_dispatch.go:11-19](../../../cmd/crit/cli_dispatch.go#L11-L19)）。
- `integration` は埋め込み元 `source`、配置先 `dest`、使用ヒント `hint` を持つ（[cli\_install.go:143-146](../../../cmd/crit/cli_install.go#L143-L146)）。
- `staleFile` は古い統合ファイルの agent と場所を記録する（[integrations.go:151-157](../../../cmd/crit/integrations.go#L151-L157)）。 <!-- b_qd6m29b6 -->

## 処理の流れ <!-- b_new8k8y7 -->

1. `main` が `commandRegistry` を基に `dispatchCLI` を呼ぶ（[cli\_dispatch.go:216-220](../../../cmd/crit/cli_dispatch.go#L216-L220)）。
2. 先頭引数がヘルプなら `printRequestedHelp` が処理する（[cli\_dispatch.go:254](../../../cmd/crit/cli_dispatch.go#L254)）。
3. 該当なしの位置引数は `routePositionalArgs` が review・live・preview などへ分類する（[cli\_routing.go:14-17](../../../cmd/crit/cli_routing.go#L14-L17)、[cli\_routing.go:27](../../../cmd/crit/cli_routing.go#L27)）。 <!-- b_890gyf9f -->

## 設定 <!-- b_gccr7pr1 -->

- `CRIT_NO_INTEGRATION_CHECK` は統合チェックを抑止する（[cli\_serve.go:47](../../../cmd/crit/cli_serve.go#L47)）。
- `CRIT_NO_UPDATE_CHECK` は更新確認に関わる（[cli\_serve.go:283](../../../cmd/crit/cli_serve.go#L283)）。
- `CODEX_HOME` は Codex のホーム位置の決定に使われる（[cli\_install.go:1090](../../../cmd/crit/cli_install.go#L1090)）。 <!-- b_wrkdw5sn -->

## テスト <!-- b_kdy1rfs1 -->

- レジストリの不変条件とヘルプ動作を検証する（`cmd/crit/cli_dispatch_test.go:24`）。
- 位置引数のルーティングを検証する（`cmd/crit/cli_routing_test.go:9`）。
- Aider 設定 YAML のマージを検証する（`cmd/crit/aider_install_test.go:56`）。
- 古い統合の検出を検証する（`cmd/crit/integrations_test.go:30`）。 <!-- b_7cxbqh1j -->
