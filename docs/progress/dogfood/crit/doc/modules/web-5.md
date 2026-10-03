# ブラウザUI一式 <!-- b_h2s7qt0w -->

- ファイル 0 · 29211 行 · 重要度 0.21
- 子モジュール 4
<!-- b_8mj20xcn -->

> [!NOTE]
> **この章で分かること**
> - web 配下は、ブラウザで動くレビュー UI 一式である。
> - 画面本体の app.js と live mode のフロントが、共有ヘルパーを土台にしている。
> - 見た目は CSS とテーマの資産が担う。 <!-- b_xwpy01kn -->

## 責務 <!-- b_4ebh649c -->

このグループは、crit が配信するブラウザ側のコードと資産をまとめたものである。コード差分や markdown のレビュー画面は web/app.js が実装し（[app.js:34-43](../../../web/app.js#L34-L43)）、live mode の親ページは web/live-mode.js が組み立てる（[live-mode.js:153](../../../web/live-mode.js#L153)）。両者が使う設定、テーマ、トースト、API 呼び出しの共通処理は web/crit-shared.js に置かれている（[crit-shared.js:13-40](../../../web/crit-shared.js#L13-L40)）。 <!-- b_t8vn889h -->

## 構成 <!-- b_1238yf7d -->

- 共有UIヘルパーと補助スクリプト：`fetchJSON` や `showToast` など、ブラウザ UI 共通の関数を提供する（[crit-shared.js:13-40](../../../web/crit-shared.js#L13-L40)）。
- live mode フロント：`web/live-mode.js` の `buildShell` が親ページの殻を作り、`web/crit-agent.js` が対象ページ内でピンを扱う（[live-mode.js:153](../../../web/live-mode.js#L153)）。
- レビュー画面本体：`web/app.js` で、起動の入口は `init` である（[app.js:2007](../../../web/app.js#L2007)）。
- 画面スタイルと資産：CSS、`web/themes.html`、`web/site.webmanifest` と、モード切替の `reduceToggle` を含む（[live-mode.toggle.js:11](../../../web/live-mode.toggle.js#L11)）。 <!-- b_3hmjhhd5 -->

## 相互作用 <!-- b_14z5wfn6 -->

レビュー画面本体と live mode フロントは、どちらも共有ヘルパーを import している。レビュー画面本体は live mode フロントも import している。流れる中身は、設定、テーマ、API 取得などの共通関数が中心である。ただし後者の import で具体的に何が渡るかは、与えられた範囲からは確認できない。 <!-- b_byk59s4d -->

## 公開インターフェース <!-- b_dmqdw5r1 -->

- `reduceToggle(mode)` は `'pin'` なら `'navigate'` を、それ以外なら `'pin'` を返す（[live-mode.toggle.js:11](../../../web/live-mode.toggle.js#L11)）。
- `web/live-mode.js` は `waitForSession` と `boot` を持つ（[live-mode.js:145-150](../../../web/live-mode.js#L145-L150)、[live-mode.js:442](../../../web/live-mode.js#L442)）。
- `web/app.js` の `init` が起動の入口で、その他の関数は局所である。 <!-- b_87kv8gfd -->

> [!TIP]
> **まとめ**
> web グループは、レビュー画面、live mode、共有ヘルパー、スタイル資産の四つで一つのブラウザ UI を成す。 <!-- b_70hh2dwx -->
