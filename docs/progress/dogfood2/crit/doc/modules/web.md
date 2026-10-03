# ブラウザ側レビューUI <!-- b_gbzyn0c5 -->

- ファイル 0 · 27978 行 · 重要度 0.19
- 子モジュール 5
<!-- b_fsc5jwtn -->

> [!NOTE]
> **この章で分かること**
> - web は Go バイナリに埋め込まれるフロントエンド資産の置き場である（[embed.go:1-6](../../../web/embed.go#L1-L6)）。
> - 画面はコードレビュー用の app.js と、iframe を使う live mode に分かれる（推測）。
> - 共通部品は crit-*.js にまとまっている（推測）。 <!-- b_8rs0qqhx -->

## 責務 <!-- b_m353cq4d -->

web は、ブラウザで動くレビュー画面一式を担うグループである。ファイルツリーや差分表示を組み立てる本体スクリプト、レビュー対象ページを iframe に載せてピン留めコメントを扱う live mode、その iframe に注入するスクリプトとCSSを含む。資産は `webassets.FS` として Go 側へ渡される（[embed.go:1-6](../../../web/embed.go#L1-L6)）。ピンの保存はここでは扱わず、注入側は解決結果を親へ通知するだけである。 <!-- b_9f94mb55 -->

## 構成 <!-- b_z0cbrssj -->

- レビュー画面共通部品（web の crit-*.js）：設定、トースト、差分ビューなどの共通処理を提供する（[crit-shared.js:23-36](../../../web/crit-shared.js#L23-L36)）。
- live mode の UI：親フレームでピンコメントのパネルを組み立てる（[live-mode.js:153](../../../web/live-mode.js#L153)）。
- 埋め込みWeb資産とエージェント：資産の埋め込みと iframe 注入スクリプトを持つ（[embed.go:6](../../../web/embed.go#L6)）。
- レビュー画面本体（web/app.js）：ファイルツリー、コメント、差分表示を組み立てる（[app.js:7564](../../../web/app.js#L7564)）。
- 本体スタイルシート（web/style.css）：画面全体の見た目を定める単一のCSSである（推測）。 <!-- b_k4hkwwpm -->

## 相互作用 <!-- b_9y05zsn9 -->

app.js と live mode はどちらも共通部品を import し、設定の読み書きやトーストなどを借りる。app.js と live mode の間も相互に依存がある。注入スクリプトは `resolvePin` で解決したピンの状態を親ウィンドウへ通知し、live mode 側の `handlePinResolutionResult` が受け取る（[agent-anchor-utils.js:190](../../../web/agent-anchor-utils.js#L190)、[live-mode.js:2319](../../../web/live-mode.js#L2319)）。 <!-- b_ntp5jmc8 -->

## 公開インターフェース <!-- b_1f0r0zxs -->

- `webassets.FS` が埋め込み資産を Go 側へ公開する（[embed.go:3](../../../web/embed.go#L3)）。
- `window.applyTheme` が app.js の外からテーマ適用を可能にする（[app.js:7564](../../../web/app.js#L7564)）。 <!-- b_p8c2tshm -->

> [!TIP]
> **まとめ**
> web は、レビュー画面、live mode、注入スクリプトを一つのバイナリに同梱するフロントエンド群である。 <!-- b_j261xs6n -->
