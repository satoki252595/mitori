# レビュー画面本体（web） <!-- b_8w7ak5t7 -->

- ファイル 1 · 9031 行 · 重要度 0.03
<!-- b_rvpkmk53 -->

> [!NOTE]
> **この章で分かること**
> - `web/app.js` が担う画面全体の役割を知る。
> - コメントの描画・編集と、Pierre による差分表示の仕組みを知る。
> - 利用する設定と、変更時の注意点を知る。 <!-- b_qy0ebpct -->

## 責務 <!-- b_9jt1dddv -->

`web/app.js` はレビュー画面のフロントエンド本体で、ファイルツリー、コメントパネル、差分・文書表示、ストーリー表示を 1 つの IIFE 的なスクリプトとして組み立てる（[app.js:6164-6180](../../../web/app.js#L6164-L6180)）。コメントカードの構築そのものは `window.crit.commentCard` に委譲し、ここでは依存関係を渡すだけである（[app.js:4935-4963](../../../web/app.js#L4935-L4963)）。Markdown の HTML 化後のサニタイズも `window.crit.commentHtml` に任せている（[app.js:234-237](../../../web/app.js#L234-L237)）。 <!-- b_byszwzdx -->

## 公開インターフェース <!-- b_rnmpr4pk -->

- `window.applyTheme` はテーマ選択を適用するために外部へ公開されている（[app.js:7564](../../../web/app.js#L7564)）。
- それ以外の関数はスクリプト内部に閉じており、`init` が起動点になる（[app.js:851](../../../web/app.js#L851)）。 <!-- b_vn27t30m -->

## 依存関係 <!-- b_9hb8fnb7 -->

`web/app.js` は `window.crit` 配下の `crit-*` 系モジュール（`commentCard`、`commentHtml` など）に依存する（[app.js:4962](../../../web/app.js#L4962)、[app.js:235-236](../../../web/app.js#L235-L236)）。DEPS では `web/crit-*` と `web/live-mode*` の両方へ依存し、同時にそれらから参照もされている。 <!-- b_cfj2bgjd -->

## 設定 <!-- b_rmymdqas -->

- 設定値は `getSetting(key, fallback)` で読み、未設定ならフォールバックを返す（[app.js:307-310](../../../web/app.js#L307-L310)）。
- コードフォントは設定パネルから専用エンドポイントで遅延読み込みされる（[app.js:8724-8744](../../../web/app.js#L8724-L8744)）。 <!-- b_jma4t2qr -->

## テスト <!-- b_xdj4v4qe -->

テストは `app.js` の文字列やワイヤリングを検証する。例えば `normalizeCommitPins` が null の commitList を空配列扱いにすること（[commit-list-null-guard.test.js:12](../../../web/__tests__/commit-list-null-guard.test.js#L12)）、設定パネルがコードフォントを遅延読込すること（[code-font-loading.test.js:8](../../../web/__tests__/code-font-loading.test.js#L8)）を確認している。 <!-- b_1x0yhpcx -->

## 落とし穴 <!-- b_hpjv4p69 -->

> [!WARNING]
> **落とし穴**
> - `reviewScroller` は Pierre 表示中は `filesContainer`、それ以外は `window` を返すため、スクロール処理はこの分岐に依存する（[app.js:7126-7128](../../../web/app.js#L7126-L7128)）。
> - `showToast` は `innerHTML` に content を直接入れるので、呼び出し側が安全な文字列を渡す必要がある（[app.js:7023-7030](../../../web/app.js#L7023-L7030)）。 <!-- b_shp87qkp -->

> [!TIP]
> **まとめ**
> `web/app.js` はレビュー UI を統括し、部品は `window.crit` に委譲する。 <!-- b_3y0fa98c -->
