# 共有画面部品群（web） <!-- b_pm3mqxww -->

- ファイル 19 · 5445 行 · 重要度 0.26
<!-- b_fy2ms44n -->

**変更の手引き**
- 影響が及ぶ先（このモジュールを使う）: [レビュー画面主制御](web-app.md)・[ライブレビュー画面](web-live-mode.md)
- 使っているもの: [レビュー画面主制御](web-app.md)・[ライブレビュー画面](web-live-mode.md)
- テスト: `web/__tests__/crit-shared.test.js`（77 件）・`web/__tests__/crit-settings-panes.test.js`（35 件）・`web/__tests__/crit-diff-renderer.test.js`（26 件）・`web/__tests__/crit-pierre-view.test.js`（17 件） ほか 15 · 実行: `make test`
- 一緒に変わりやすいファイル: 履歴を読めません（浅いクローンか git の外）
- 注意: 循環依存（[ライブレビュー画面](web-live-mode.md)・[レビュー画面主制御](web-app.md) と）
<!-- b_h2qxk0ks -->

> [!NOTE]
> **この章で分かること**
> - この層が担う共有操作の範囲が分かる。
> - 設定の保存と復元の仕組みが分かる。
> - 失敗通知と表示更新の約束事が分かる。 <!-- b_b0zvbq73 -->

## 責務 <!-- b_a8997g9c -->

批評画面のための共有前処理と表示補助を束ねる層である（推測）。
通信や通知、設定読書きなどの横断処理は `fetchJSON` や `showToast`、`getSetting` が担う（[crit-shared.js:23-32](../../../web/crit-shared.js#L23-L32)、[crit-shared.js:105-108](../../../web/crit-shared.js#L105-L108)、[crit-shared.js:233-242](../../../web/crit-shared.js#L233-L242)）。
画面全体の構成や接続の維持は扱わず、上位の画面層に任せる（推測）。 <!-- b_tz4ap712 -->

## 依存関係 <!-- b_sh9v9rgz -->

- 同一 web 書庫の応用本体とは相互利用の関係にあり、共通処理を提供する側に立つ（推測）。
- 同一 web 書庫の live-mode 群とも相互利用の関係にあり、画面固有の接続処理は持たない（推測）。 <!-- b_4ydxsqbx -->

## 設定 <!-- b_qvb9mcbz -->

- `readSettings` と `getSetting`、`setSetting` で設定の読み書きを行う（[crit-shared.js:96](../../../web/crit-shared.js#L96)、[crit-shared.js:105](../../../web/crit-shared.js#L105)、[crit-shared.js:109](../../../web/crit-shared.js#L109)）。
- `readThemeFromSettings` や `applyThemeFromCookie`、`applyCodeFontFromCookie` で表示の既定値を復元する（[crit-shared.js:65](../../../web/crit-shared.js#L65)、[crit-shared.js:76](../../../web/crit-shared.js#L76)、[crit-shared.js:153](../../../web/crit-shared.js#L153)）。
- `savedSettings` と `applySaved` で配色選択を復元する（[crit-theme-palette.js:30](../../../web/crit-theme-palette.js#L30)、[crit-theme-palette.js:38](../../../web/crit-theme-palette.js#L38)）。 <!-- b_7p6sxp5b -->

## テスト <!-- b_zgrjg9gy -->

- 符号強調の事前処理と言語名の正規化、退避後の可読性、未知言語の退化を確かめる（[crit-code-highlight.test.js:38](../../../web/__tests__/crit-code-highlight.test.js#L38)、[crit-code-highlight.test.js:52](../../../web/__tests__/crit-code-highlight.test.js#L52)、[crit-code-highlight.test.js:62](../../../web/__tests__/crit-code-highlight.test.js#L62)、[crit-code-highlight.test.js:75](../../../web/__tests__/crit-code-highlight.test.js#L75)）。
- 注釈雛形の保存と復元、棒表示の有無を確かめる（[crit-comment-templates.test.js:52](../../../web/__tests__/crit-comment-templates.test.js#L52)、[crit-comment-templates.test.js:58](../../../web/__tests__/crit-comment-templates.test.js#L58)、[crit-comment-templates.test.js:68](../../../web/__tests__/crit-comment-templates.test.js#L68)、[crit-comment-templates.test.js:88](../../../web/__tests__/crit-comment-templates.test.js#L88)）。
- 注釈入力欄の生成と初期値、送信合図、入力通知を確かめる（[crit-comment-form.test.js:37](../../../web/__tests__/crit-comment-form.test.js#L37)、[crit-comment-form.test.js:46](../../../web/__tests__/crit-comment-form.test.js#L46)、[crit-comment-form.test.js:57](../../../web/__tests__/crit-comment-form.test.js#L57)、[crit-comment-form.test.js:74](../../../web/__tests__/crit-comment-form.test.js#L74)）。
- 差分描画の類似度計算と標記除去を確かめる（[crit-diff-renderer.test.js:53](../../../web/__tests__/crit-diff-renderer.test.js#L53)、[crit-diff-renderer.test.js:61](../../../web/__tests__/crit-diff-renderer.test.js#L61)、[crit-diff-renderer.test.js:70](../../../web/__tests__/crit-diff-renderer.test.js#L70)、[crit-diff-renderer.test.js:78](../../../web/__tests__/crit-diff-renderer.test.js#L78)）。
- 照合処理の接尾辞と接頭辞、区画付き照合、任意一致を確かめる（[crit-glob-match.test.js:9](../../../web/__tests__/crit-glob-match.test.js#L9)、[crit-glob-match.test.js:17](../../../web/__tests__/crit-glob-match.test.js#L17)、[crit-glob-match.test.js:33](../../../web/__tests__/crit-glob-match.test.js#L33)、[crit-glob-match.test.js:48](../../../web/__tests__/crit-glob-match.test.js#L48)）。
- 図像出力の形式と代表物の存在、公開面の一致を確かめる（[crit-icons.test.js:13](../../../web/__tests__/crit-icons.test.js#L13)、[crit-icons.test.js:23](../../../web/__tests__/crit-icons.test.js#L23)、[crit-icons.test.js:30](../../../web/__tests__/crit-icons.test.js#L30)、[crit-icons.test.js:35](../../../web/__tests__/crit-icons.test.js#L35)）。 <!-- b_11dzd2f9 -->

## エラー処理 <!-- b_m3x5dd8t -->

- `fetchJSON` は応答の失敗を状態文付きの例外で知らせる（[crit-shared.js:23-32](../../../web/crit-shared.js#L23-L32)）。
- `showToast` は種別に応じた通知を出し、時間切れで破棄する（[crit-shared.js:233-245](../../../web/crit-shared.js#L233-L245)、[crit-shared.js:274-276](../../../web/crit-shared.js#L274-L276)）。 <!-- b_7kh2tz0z -->

## 落とし穴 <!-- b_q9yph2rv -->

> [!WARNING]
> **落とし穴**
> - `fetchJSON` は JSON 以外では空値を返すため、呼び出し側の空値処理が要る（[crit-shared.js:23-35](../../../web/crit-shared.js#L23-L35)）。
> - `showToast` は遷移終了を待たず後始末するため、要素の寿命を仮定できない（[crit-shared.js:233](../../../web/crit-shared.js#L233)、[crit-shared.js:263-272](../../../web/crit-shared.js#L263-L272)）。
> - `setDiffStyle` は同一値では何もせず、再描画には値の変更と資料の受け渡しが要る（[crit-pierre-view.js:411-416](../../../web/crit-pierre-view.js#L411-L416)）。 <!-- b_w2zyhdhv -->

> [!TIP]
> **まとめ**
> 共有操作の置き場所と約束事を押さえれば、画面固有の処理に集中できる。 <!-- b_sh4mqqhd -->
