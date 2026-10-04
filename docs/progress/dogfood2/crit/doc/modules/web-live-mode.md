# live mode の UI（web） <!-- b_hx1hcb90 -->

- ファイル 36 · 4820 行 · 重要度 0.21
<!-- b_4asv8rbk -->

> [!NOTE]
> **この章で分かること**
> - live mode の親フレームが何を担うか
> - iframe と agent の間でメッセージがどう流れるか
> - pin と返信の扱いと、変更時の注意点 <!-- b_nj32zxpc -->

## 責務 <!-- b_rrd7azc2 -->

live mode は、レビュー対象のページを iframe に読み込み、その上にピン留めコメントのパネルを重ねる UI である。`web/live-mode.js` が `buildShell` でシェルを組み立て、`boot` で起動する（[live-mode.js:153](../../../web/live-mode.js#L153)、[live-mode.js:442](../../../web/live-mode.js#L442)）。小さな純粋関数や状態クラスは `live-mode-*.js` と `live-mode.*.js` に分かれている（[live-mode-pin-state.js:12-14](../../../web/live-mode-pin-state.js#L12-L14)、[live-mode.toggle.js:11](../../../web/live-mode.toggle.js#L11)）。 <!-- b_1awd6zkh -->

## 公開インターフェース <!-- b_qyf81mpm -->

- `registerInstaller` / `registerPanelRefresh`: 拡張側が初期化処理とパネル再描画を登録する（[live-mode.js:111-112](../../../web/live-mode.js#L111-L112)）。
- `validateMessage`: agent との間のメッセージを検証する（[agent-protocol.js:48](../../../web/agent-protocol.js#L48)）。
- `makeMessageDispatcher`: 検証済みメッセージをハンドラへ振り分ける（[live-mode.dispatch.js:16](../../../web/live-mode.dispatch.js#L16)）。
- `createSSE`: サーバーイベントの購読を作る（[crit-sse.js:18](../../../web/crit-sse.js#L18)）。
- `buildCommentCard`: コメントカードの DOM を生成する（[crit-comment-card.js:43](../../../web/crit-comment-card.js#L43)）。 <!-- b_cfwwmtqn -->

## データ構造 <!-- b_7842rexp -->

- `PinState` は id をキーに Map でピンの解決結果を保持し、`statusOf` と `driftedRows` で参照する（[live-mode-pin-state.js:12-36](../../../web/live-mode-pin-state.js#L12-L36)）。
- `ResolutionGate` は viewport 変更中かどうかを `_pendingViewport` で持つ（[live-mode-resolution-gate.js:11-22](../../../web/live-mode-resolution-gate.js#L11-L22)）。 <!-- b_wbbfx7nb -->

## 落とし穴 <!-- b_z9q101nw -->

> [!WARNING]
> **落とし穴**
> - `buildCommentCard` は `opts.deps` の関数に既定値を持つため、依存を渡し忘れても例外にならず空表示になる（[crit-comment-card.js:47-55](../../../web/crit-comment-card.js#L47-L55)）。
> - `/live-mode-*.js` は `internal/server/server.go` で個別のルートとして登録されているため、ファイルを増やすとサーバー側の登録も要る（[server.go:156-168](../../../internal/server/server.go#L156-L168)）。 <!-- b_86z846mf -->

> [!TIP]
> **まとめ**
> live mode は iframe 上の pin コメントを扱う親フレームで、状態と判定は小さなモジュールに分割されている。 <!-- b_gq59hs8p -->
