# 埋め込みWeb資産とエージェント <!-- b_7etdrhyv -->

- ファイル 19 · 2403 行 · 重要度 0.11
<!-- b_1abmvw32 -->

> [!NOTE]
> **この章で分かること**
> - iframe に注入されるエージェントスクリプトの役割
> - ピンのアンカー解決の手順
> - 埋め込みアセットの扱い <!-- b_h18k0zsr -->

## 責務 <!-- b_0jxmk6q6 -->

このモジュールは、フロントエンド資産を Go に埋め込む `webassets` パッケージと、レビュー対象ページの iframe に注入するスクリプト群、およびテーマと live mode 用の CSS をまとめている（[embed.go:1-6](../../../web/embed.go#L1-L6)）。注入スクリプトはピンの解決結果を親ウィンドウへ `postMessage` で通知する側であり、ピンの保存そのものは担わない（[agent-resolution.js:27-43](../../../web/agent-resolution.js#L27-L43)）。 <!-- b_3dkmkpag -->

## 公開インターフェース <!-- b_x19tdtd2 -->

- `FS`: `embed.FS` 型で、埋め込まれた Web 資産を Go 側へ渡す（[embed.go:6](../../../web/embed.go#L6)）。
- `resolvePin`: アンカーから DOM 要素を探し、状態を返す（[agent-anchor-utils.js:190-212](../../../web/agent-anchor-utils.js#L190-L212)）。
- `resolveAllAndEmit`: 全ピンを解決して結果を通知する（[agent-resolution.js:27-43](../../../web/agent-resolution.js#L27-L43)）。
- `MutationBatcher`: DOM 変更レコードをまとめて処理する（[agent-mutation-batcher.js:14-46](../../../web/agent-mutation-batcher.js#L14-L46)）。 <!-- b_8wn97xsn -->

## 処理の流れ <!-- b_bv1g7y8q -->

1. `resolveAllAndEmit` は現在の `pathname` と異なるピンを飛ばす（[agent-resolution.js:30-32](../../../web/agent-resolution.js#L30-L32)）。
2. `resolvePin` が `css_selector` で要素を探し、`tag_chain` を検証して `resolved` を返す（[agent-anchor-utils.js:192-196](../../../web/agent-anchor-utils.js#L192-L196)）。
3. 失敗時は `landmark`・`role`・`accessible_name` で再探索し、`drifted-recoverable` を返す（[agent-anchor-utils.js:197-208](../../../web/agent-anchor-utils.js#L197-L208)）。
4. どちらも失敗なら `drifted` となり、結果が `pin-resolution-result` として投稿される（[agent-resolution.js:34-40](../../../web/agent-resolution.js#L34-L40)）。 <!-- b_xf0h0p71 -->

## テスト <!-- b_e8fdrah1 -->

E2E テストは、エージェントが外部オリジンからのメッセージを拒否すること（[agent.livemode.spec.ts:31](../../../test/e2e/tests/agent.livemode.spec.ts#L31)）と、投稿先を検証済み API オリジンにして `*` を使わないこと（[agent.livemode.spec.ts:53](../../../test/e2e/tests/agent.livemode.spec.ts#L53)）を確認している。 <!-- b_mhseysc5 -->
