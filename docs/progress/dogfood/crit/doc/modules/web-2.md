# live mode フロント（web） <!-- b_p8j4qp0n -->

- ファイル 35 · 4908 行 · 重要度 0.21
<!-- b_d8gb2n91 -->

> [!NOTE]
> **この章で分かること**
> - live mode の iframe 親側と、iframe 内 agent の役割分担
> - ピンの解決と再アンカーの仕組み
> - 親と agent の間のメッセージ検証 <!-- b_kt7erxsp -->

## 責務 <!-- b_9ej7nr5k -->

このモジュールは live mode のブラウザ側コードである。`web/live-mode.js` は親ページのシェルを組み立て、接続状態や UI モードを扱う（[live-mode.js:153](../../../web/live-mode.js#L153)、[live-mode.js:442](../../../web/live-mode.js#L442)、[live-mode.js:714](../../../web/live-mode.js#L714)）。`web/crit-agent.js` は対象ページ内で動き、ピンのマーカー表示と選択の通知を担う（[crit-agent.js:69](../../../web/crit-agent.js#L69)、[crit-agent.js:144](../../../web/crit-agent.js#L144)、[crit-agent.js:567](../../../web/crit-agent.js#L567)）。小さな補助は `live-mode-*.js` や `agent-*.js` に分割されている（[agent-anchor-utils.js:190](../../../web/agent-anchor-utils.js#L190)、[live-mode-pin-filter.js:15](../../../web/live-mode-pin-filter.js#L15)）。 <!-- b_hpwraeqv -->

## 公開インターフェース <!-- b_rrc9z733 -->

- `resolvePin` は anchor と document からピンの解決結果を返す（[agent-anchor-utils.js:190](../../../web/agent-anchor-utils.js#L190)）。
- `validateMessage` は親と agent の間のメッセージを検証する（[agent-protocol.js:48](../../../web/agent-protocol.js#L48)）。
- `createSSE` は URL とハンドラから SSE 接続を作る（[crit-sse.js:18](../../../web/crit-sse.js#L18)）。
- `filterPinsForPath` は pathname に合うピンだけを選ぶ（[live-mode-pin-filter.js:15](../../../web/live-mode-pin-filter.js#L15)）。 <!-- b_c578arg5 -->

## 処理の流れ <!-- b_aq1e9bj2 -->

1. 親が `boot` で起動し、`loadIframe` で対象ページを読み込む（[live-mode.js:442](../../../web/live-mode.js#L442)、[live-mode.js:772](../../../web/live-mode.js#L772)）。
2. iframe 内の agent が `onSetPins` でピンを受け取る（[crit-agent.js:144](../../../web/crit-agent.js#L144)）。
3. `resolvePin` が DOM 上の位置を解決する（[agent-anchor-utils.js:190](../../../web/agent-anchor-utils.js#L190)）。
4. 利用者の選択は `emitSelection` で親へ送られ、親の `handleSelection` が処理する（[crit-agent.js:567](../../../web/crit-agent.js#L567)、[live-mode.js:2034](../../../web/live-mode.js#L2034)）。 <!-- b_d02rkkzg -->

## テスト <!-- b_gzmttjb8 -->

- `web/__tests__/agent-anchor-utils.test.js:253` は `resolvePin` の resolved・fallback・drifted の分岐を確かめる（[agent-anchor-utils.test.js:253](../../../web/__tests__/agent-anchor-utils.test.js#L253)）。
- `web/__tests__/agent-mutation-batcher.test.js:51` は pause 後の再解決を確かめる（[agent-mutation-batcher.test.js:51](../../../web/__tests__/agent-mutation-batcher.test.js#L51)）。
- `web/__tests__/agent-protocol.test.js:23` は selection メッセージの検証を確かめる（[agent-protocol.test.js:23](../../../web/__tests__/agent-protocol.test.js#L23)）。 <!-- b_xh15mgw2 -->
