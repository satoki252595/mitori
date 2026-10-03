# レビュー画面共通部品（web） <!-- b_aynjwxbs -->

- ファイル 19 · 5445 行 · 重要度 0.26
<!-- b_xv3dqvj8 -->

> [!NOTE]
> **この章で分かること**
> - ブラウザ側の共有ユーティリティと設定UIの役割
> - Pierre 差分表示とテーマ処理の構成
> - 変更時に注意すべき点 <!-- b_z2yxpyfw -->

## 責務 <!-- b_43e9g1fq -->

web の `crit-*` 系スクリプトは、ブラウザで動くレビュー画面の部品群である。設定の読み書き、トースト、コメント数表示などの共通処理を提供する（[crit-shared.js:105-108](../../../web/crit-shared.js#L105-L108)、[crit-shared.js:177-190](../../../web/crit-shared.js#L177-L190)、[crit-shared.js:233-246](../../../web/crit-shared.js#L233-L246)）。ライブモードの本体や `app.js` はここに含まれず、別モジュールが担う（推測）。 <!-- b_70qe3bn0 -->

## 公開インターフェース <!-- b_6qayn8z8 -->

- `fetchJSON`：JSON API を呼ぶ。失敗時は `status` 付きの `Error` を投げ、JSON 以外の応答は `null` を返す（[crit-shared.js:23-36](../../../web/crit-shared.js#L23-L36)）。
- `getSetting` / `setSetting`：設定を読み書きする。キーが無ければ fallback を返す（[crit-shared.js:105-108](../../../web/crit-shared.js#L105-L108)）。
- `showToast`：トーストを出し、早期に閉じるための `dismiss` 関数を返す（[crit-shared.js:233-278](../../../web/crit-shared.js#L233-L278)）。
- `updateCommentCountIndicator`：全件数と未解決数からナビの表示を更新する（[crit-shared.js:177-207](../../../web/crit-shared.js#L177-L207)）。
- `createPierreView`：Pierre ベースの差分ビューを作る。`setDiffStyle` で表示形式を切り替える（[crit-pierre-view.js:411-416](../../../web/crit-pierre-view.js#L411-L416)）。 <!-- b_6jkgq008 -->

## 依存関係 <!-- b_7j82z6q1 -->

依存先は `web/app.js` と `web/live-mode*` で、どちらからも依存される相互関係にある（推測）。 <!-- b_faz9trmv -->

## テスト <!-- b_egv50ja0 -->

- `crit-code-highlight` のテストは、未知の言語や pool 欠如時に平文へフォールバックすることを確認する（[crit-code-highlight.test.js:75](../../../web/__tests__/crit-code-highlight.test.js#L75)）。
- `crit-glob-match` のテストは、拡張子・ディレクトリ・完全一致の各パターンを確認する（[crit-glob-match.test.js:9](../../../web/__tests__/crit-glob-match.test.js#L9)）。 <!-- b_sedp4tzm -->

## 落とし穴 <!-- b_rkkvkm6h -->

> [!WARNING]
> **落とし穴**
> - `showToast` は `transitionend` が来ない場合に備え、400ms のフォールバックタイマーで要素を除去する。CSS の遷移時間（300ms）を変えるときは合わせて見直す必要がある（[crit-shared.js:269-271](../../../web/crit-shared.js#L269-L271)）。 <!-- b_sm299f0e -->

> [!TIP]
> **まとめ**
> このモジュールは、画面の共通部品と差分・テーマ表示を担うブラウザ側の土台である。 <!-- b_ndvrrq6r -->
