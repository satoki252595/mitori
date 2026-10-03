# レビュー画面本体（web） <!-- b_m9t41mgb -->

- ファイル 1 · 9031 行 · 重要度 0.03
<!-- b_hh36vjpg -->

> [!NOTE]
> **この章で分かること**
> - `web/app.js` が単一ファイルでレビュー画面全体を担うことを知る。
> - 差分表示、コメント、ストーリー表示、SSE 接続の関数群の配置を知る。
> - 関連テストが何を固定しているかを知る。 <!-- b_b19s4rqw -->

## 責務 <!-- b_2a8frb0x -->

このモジュールは `web/app.js` の1ファイルで、約11000行のブラウザ側レビューUIを実装する。コメント用の markdown 描画は `commentMd` が担い（[app.js:34-43](../../../web/app.js#L34-L43)）、文書用は `documentMd` が担う（[app.js:263-277](../../../web/app.js#L263-L277)）。ファイル一覧は `renderFileTree`、差分描画は Pierre 系関数（`ensurePierreView` など）が受け持つ（[app.js:1294](../../../web/app.js#L1294)、[app.js:2007](../../../web/app.js#L2007)）。 <!-- b_dhhmpw27 -->

## 公開インターフェース <!-- b_f0k25x4s -->

- `web/app.js` は `init` を起動の入口とする（[app.js:851](../../../web/app.js#L851)）。
- `window.applyTheme` はテーマ切替用に `window` へ公開される（[app.js:7564](../../../web/app.js#L7564)）。
- 上記以外の関数は即時実行関数内の局所関数であり、外部公開は確認できない。 <!-- b_3e4z0912 -->

## 処理の流れ <!-- b_nnv6ccp8 -->

1. `init` が起動時の初期化を行う（[app.js:851](../../../web/app.js#L851)）。
2. `loadAllFileData` と `loadSingleFile` がファイルデータを取得する（[app.js:578](../../../web/app.js#L578)、[app.js:627](../../../web/app.js#L627)）。
3. `connectSSE` がサーバーからの更新イベントを受ける（[app.js:6734](../../../web/app.js#L6734)）。
4. `renderAllFiles` が各ファイルを描画する（[app.js:1620](../../../web/app.js#L1620)）。 <!-- b_gj8xx7nr -->

## テスト <!-- b_6fgcpjms -->

- `web/__tests__/heading-anchors.test.js:26` は `slugifyHeading` の GitHub 風スラッグ化を検証する。
- `web/__tests__/index-html-load-order.test.js:24` は `crit-shared.js` の読み込み順を検証する。
- `web/__tests__/live-mode.connection-wiring.test.js:18` は live-mode の接続状態の既定値を検証する。 <!-- b_bvyxqx1m -->
