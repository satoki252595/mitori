# 画面スタイルと資産（web） <!-- b_8kwh390x -->

- ファイル 6 · 7019 行 · 重要度 0.03
<!-- b_ay23xcvz -->

> [!NOTE]
> **この章で分かること**
> - このモジュールが持つ静的アセットの種類を知る。
> - ライブモードの切替関数 `reduceToggle` の動きを知る。
> - テストがどこまで確認しているかを知る。 <!-- b_zsmgyg39 -->

## 責務 <!-- b_hcpgab7m -->

`web` の6ファイルは、スタイルシート（`style.css`、`style-live.css`、`theme.css`）、`themes.html`、`site.webmanifest`、そして小さなスクリプト `live-mode.toggle.js` で構成される。データからは、これらが画面の見た目と切替ロジックを担うことだけが分かる。 <!-- b_k54xvga1 -->

## 公開インターフェース <!-- b_8cs1t6r8 -->

- `reduceToggle(mode)` は現在のモードが `'pin'` なら `'navigate'` を、それ以外なら `'pin'` を返す（[live-mode.toggle.js:11](../../../web/live-mode.toggle.js#L11)）。 <!-- b_35mb4fh6 -->

## テスト <!-- b_abx3a13s -->

- 切替テストは navigate から pin への遷移を確認する（[live-mode.toggle.test.js:6](../../../web/__tests__/live-mode.toggle.test.js#L6)）。
- pin から navigate への遷移も確認する（[live-mode.toggle.test.js:10](../../../web/__tests__/live-mode.toggle.test.js#L10)）。 <!-- b_48j0xhck -->

> [!TIP]
> **まとめ**
> `web` は見た目の資産と、pin と navigate を切り替える小関数からなる。 <!-- b_1ezvnwx1 -->
