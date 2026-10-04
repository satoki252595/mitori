# ブラウザ批評画面群 <!-- b_yhq3j6f8 -->

- ファイル 0 · 27978 行 · 重要度 0.19
- 子モジュール 5
<!-- b_3s9025sh -->

> [!NOTE]
> **この章で分かること**
> - ブラウザで動く批評画面の全体像と層の置き場をつかみたいときに読む。
> - 差分表示と実況レビューと共通部品と装飾土台の分担を知りたいときに役立つ。
> - 細部の実装に入る前の道案内として、層の置き場と橋渡しの向きを確認する。 <!-- b_nqqd71cz -->

## 責務 <!-- b_kfcfb7bb -->

`Single-binary` な `Go` 製 `CLI` が開く `browser-based` な `UI` である（[AGENTS.md:3](../../../AGENTS.md#L3)）。`crit` は `markdown` ファイルと `git` 変更の `diffs`、起動中 `app` の `proxies` 表示を束ねる（[README.md:18-20](../../../README.md#L18-L20)）。`index.html` は `HTML` `shell` として `code-review` と `live-mode` の `fork` を担う（[AGENTS.md:12](../../../AGENTS.md#L12)）。`live-mode*.js` と `crit-*.js` が実況部品と共有描画を分担する（[AGENTS.md:14](../../../AGENTS.md#L14)、[AGENTS.md:16](../../../AGENTS.md#L16)）。 <!-- b_4td25ha5 -->

## 構成 <!-- b_3h58ysxm -->

- 共有画面部品群は批評画面の共通操作と表示補助を束ね、横断処理の置き場となり再利用の要となる（[crit-shared.js:23-32](../../../web/crit-shared.js#L23-L32)）。
- ライブレビュー画面は `buildShell` と `boot` で実況画面を組み立て、`pushPinsToAgent` で表示更新を渡す（[live-mode.js:153](../../../web/live-mode.js#L153)、[live-mode.js:442](../../../web/live-mode.js#L442)、[live-mode.js:2309](../../../web/live-mode.js#L2309)）。
- 埋め込み資産と agent 注入は `FS` で資産を渡し `resolvePin` で解決を担い、`webassets` の置き場となる（[embed.go:6](../../../web/embed.go#L6)、[agent-anchor-utils.js:190](../../../web/agent-anchor-utils.js#L190)）。
- レビュー画面主制御はファイルとコメントと物語表示の制御を束ね、投稿と解決の入口となり画面遷移の起点にもなる（[app.js:851](../../../web/app.js#L851)）。
- 全体スタイル定義は `style.css` と `style-live.css` と `theme.css` で共通の装飾土台を保つ（[AGENTS.md:17](../../../AGENTS.md#L17)）。 <!-- b_jah20z1b -->

## 相互作用 <!-- b_t4c6gj9j -->

主制御とライブ画面は共有部品群の操作に頼り、表示補助を受け取り重複を避ける（推測）。主制御はライブ画面の部品も取り込み、画面間の往復が生じ状態の受け渡しが要となる（推測）。共有層からの戻り参照もあり、描画の委譲が循環して責務の境界がにじむ（推測）。 <!-- b_xhps49j7 -->

## 公開インターフェース <!-- b_p58zzwwf -->

- `FS` は `embed.FS` として `frontend` 資産を `Go` 側へ渡す（[embed.go:6](../../../web/embed.go#L6)）。
- `index.html` は `HTML` `shell` として二つの画面起動点を渡す（[AGENTS.md:12](../../../AGENTS.md#L12)）。
- `resolvePin` は `anchor` から要素解決を渡す（[agent-anchor-utils.js:190](../../../web/agent-anchor-utils.js#L190)）。
- `crit-agent.js` と `agent-marker.css` は `iframe` 注入用の `scripts` を渡す（[AGENTS.md:15](../../../AGENTS.md#L15)）。 <!-- b_v9j5j8e2 -->

> [!TIP]
> **まとめ**
> 批評画面の部品と制御と見た目がそろい、ブラウザでの指摘作業を支える。埋め込み資産が土台となり、各画面層が描画と操作の役割を分担する。 <!-- b_c8p4zycv -->
