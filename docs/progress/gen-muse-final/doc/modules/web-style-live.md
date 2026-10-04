# 埋め込み資産と agent 注入 <!-- b_h07fp91r -->

- ファイル 19 · 2403 行 · 重要度 0.11
<!-- b_70xa5r72 -->

**変更の手引き**
- 影響が及ぶ先（このモジュールを使う）: [CLI 入口と統合管理](cmd-crit.md)・[レビュー用 HTTP サーバ](internal-server.md)
- 使っているもの: [開発支援スクリプト群](scripts.md)
- テスト: `web/__tests__/agent-anchor-utils.test.js`（37 件）・`web/__tests__/agent-marker-overlay.test.js`（12 件）・`web/__tests__/agent-scroll-utils.test.js`（11 件）・`web/__tests__/agent-resolution.test.js`（5 件） ほか 142 · 実行: `make test`
- よく使われる宣言（変えると波及する）: `FS` `web/embed.go:6`（2 ファイル）
- 一緒に変わりやすいファイル: 履歴を読めません（浅いクローンか git の外）
<!-- b_54x0wef7 -->

> [!NOTE]
> **この章で分かること**
> - 埋め込み資産の公開方法を理解する
> - 要素解決の流れを理解する
> - 注入群の役割分担を理解する <!-- b_f20yb9ng -->

## 責務 <!-- b_12j3dtc2 -->

埋め込み frontend 資産と live-mode 用 iframe 注入 script を提供する（[AGENTS.md:11](../../../AGENTS.md#L11)、[AGENTS.md:15](../../../AGENTS.md#L15)）。HTML shell と theme 系 CSS を同梱し、Go 側へ `FS` 経由で渡す（[AGENTS.md:11-12](../../../AGENTS.md#L11-L12)、[AGENTS.md:17](../../../AGENTS.md#L17)、[embed.go:6](../../../web/embed.go#L6)）。サーバ側の API 処理や永続化は担わない（推測）。 <!-- b_hgcb7vba -->

## 公開インターフェース <!-- b_0hw5eb70 -->

- `FS` は埋め込み frontend 資産である（[embed.go:6](../../../web/embed.go#L6)）。
- `resolvePin` は DOM `anchor` から要素を解決する（[agent-anchor-utils.js:190-195](../../../web/agent-anchor-utils.js#L190-L195)）。
- `resolveAllAndEmit` は全 `pin` を解決して結果を送出する（[agent-resolution.js:27-42](../../../web/agent-resolution.js#L27-L42)）。 <!-- b_ez9bh18x -->

## 依存関係 <!-- b_v1y4nbpd -->

- 資産生成で `scripts` の `parse_threshold` 系に依存する（推測）。
- 資産配信で `cmd/crit` の `Config` と `internal/server` の `FS` に利用される（推測）。 <!-- b_enhjcewq -->

## データ構造 <!-- b_pjdw12y8 -->

- `anchor` は `css_selector` と `tag_chain` で要素を特定する（[agent-anchor-utils.js:190-195](../../../web/agent-anchor-utils.js#L190-L195)）。
- `anchor` は `role` と `accessible_name` と `landmark` を fallback に持つ（[agent-anchor-utils.js:197](../../../web/agent-anchor-utils.js#L197)）。
- 解決結果は `pin_id` と `status` と `rect` で返る（[agent-resolution.js:34-37](../../../web/agent-resolution.js#L34-L37)）。
- `ReanchorState` は `pinId` を一つだけ保持する（[agent-reanchor-state.js:11-16](../../../web/agent-reanchor-state.js#L11-L16)）。
- `accessibleNameFor` は最大 80 文字に切る（[agent-anchor-utils.js:91-100](../../../web/agent-anchor-utils.js#L91-L100)）。 <!-- b_vspjaz37 -->

## 処理の流れ <!-- b_f6psge28 -->

1. `resolveAllAndEmit` は `pathname` が違う `pin` を飛ばす（[agent-resolution.js:27-33](../../../web/agent-resolution.js#L27-L33)）。
2. `resolvePin` は `css_selector` と `tag_chain` で解決を試す（[agent-anchor-utils.js:190-195](../../../web/agent-anchor-utils.js#L190-L195)）。
3. 失敗時は `role` 検索で `drifted-recoverable` を返す（[agent-anchor-utils.js:197-208](../../../web/agent-anchor-utils.js#L197-L208)）。
4. 結果を `pin-resolution-result` で送出する（[agent-resolution.js:34-42](../../../web/agent-resolution.js#L34-L42)）。 <!-- b_e6r3jxf5 -->

## テスト <!-- b_de5jw0rn -->

起動時 handshake と origin 検証を確認する（[agent.livemode.spec.ts:25](../../../test/e2e/tests/agent.livemode.spec.ts#L25)、[agent.livemode.spec.ts:31](../../../test/e2e/tests/agent.livemode.spec.ts#L31)、[agent.livemode.spec.ts:53](../../../test/e2e/tests/agent.livemode.spec.ts#L53)）。pin mode 切替と hover overlay を確認する（[agent.livemode.spec.ts:67](../../../test/e2e/tests/agent.livemode.spec.ts#L67)、[agent.livemode.spec.ts:80](../../../test/e2e/tests/agent.livemode.spec.ts#L80)、[agent.livemode.spec.ts:99](../../../test/e2e/tests/agent.livemode.spec.ts#L99)）。theme の color contrast 違反がないことを確認する（[accessibility.spec.ts:104](../../../test/e2e/tests/accessibility.spec.ts#L104)）。 <!-- b_qxt1pvwj -->

## 落とし穴 <!-- b_xe1fezay -->

> [!WARNING]
> **落とし穴**
> - `css_selector` が一致しても `tag_chain` 不一致なら fallback に進む（[agent-anchor-utils.js:193-197](../../../web/agent-anchor-utils.js#L193-L197)）。
> - `pathname` 不一致の `pin` は解決も送出もされない（[agent-resolution.js:31-40](../../../web/agent-resolution.js#L31-L40)）。 <!-- b_y1ey92y2 -->

> [!TIP]
> **まとめ**
> 埋め込み資産と pin 解決が中心である。注入 script の責務を押さえれば十分である。 <!-- b_mv8jjwj4 -->
