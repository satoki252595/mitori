# 共有UIヘルパーと補助スクリプト <!-- b_zcen332p -->

- ファイル 51 · 8253 行 · 重要度 0.46
<!-- b_rmqgx24j -->

> [!NOTE]
> **この章で分かること**
> - 共有フロントエンドヘルパー `web/crit-shared.js` の役割を知る。
> - 設定・テーマ・トースト・レビュー完了処理の入口を知る。
> - scripts と opencode 連携のテストがどこにあるかを知る。 <!-- b_gfe7qb6j -->

## 責務 <!-- b_yqkwq27y -->

このモジュールは `web/crit-shared.js` に、設定・テーマ・トースト・レビュー完了などブラウザ UI 共通のヘルパーを集めている（[crit-shared.js:13-40](../../../web/crit-shared.js#L13-L40)、[crit-shared.js:233](../../../web/crit-shared.js#L233)、[crit-shared.js:494](../../../web/crit-shared.js#L494)）。加えて scripts のビルド補助や opencode 連携も含む。サーバー側の処理は持たず、API 呼び出しは `fetchJSON` 経由で行う（[crit-shared.js:23](../../../web/crit-shared.js#L23)）。 <!-- b_1erc09ka -->

## 公開インターフェース <!-- b_dt7vsh89 -->

- `fetchJSON` は HTTP 取得の共通ラッパーである（[crit-shared.js:23](../../../web/crit-shared.js#L23)）。
- `getSetting` / `setSetting` は設定の読み書きに使う（[crit-shared.js:105-109](../../../web/crit-shared.js#L105-L109)）。
- `applyThemeFromCookie` と `setCodeFont` はテーマとコードフォントを反映する（[crit-shared.js:76](../../../web/crit-shared.js#L76)、[crit-shared.js:159](../../../web/crit-shared.js#L159)）。
- `showToast` は通知を表示する（[crit-shared.js:233](../../../web/crit-shared.js#L233)）。
- `runFinishReview` と `waitForSession` はレビュー完了とセッション待機を扱う（[crit-shared.js:494](../../../web/crit-shared.js#L494)、[crit-shared.js:638](../../../web/crit-shared.js#L638)）。
- `installSidebarResize` はサイドバー幅のドラッグ変更、`attachImageUploads` は textarea への画像貼り付け・ドロップを担う（[crit-shared.js:726](../../../web/crit-shared.js#L726)、[crit-shared.js:916](../../../web/crit-shared.js#L916)）。
- `showProjectPromptTrustDialog` と `ensureProjectPromptTrust` はプロジェクトプロンプトの信頼確認を行う（[crit-shared.js:1024](../../../web/crit-shared.js#L1024)、[crit-shared.js:1126](../../../web/crit-shared.js#L1126)）。 <!-- b_pwtrc8j0 -->

## テスト <!-- b_xzw5rt1k -->

- `critWaitTimeout` は短い待機を延長し、長いタイムアウトは保持することを検証する（[crit-wait-notify.test.js:38](../../../integrations/opencode/plugin/lib/crit-wait-notify.test.js#L38)）。
- `isCritWaitCommand` は live/preview/review/plan の wait を受け入れ、他のサブコマンドを拒否する（[crit-wait-notify.test.js:14](../../../integrations/opencode/plugin/lib/crit-wait-notify.test.js#L14)、[crit-wait-notify.test.js:31](../../../integrations/opencode/plugin/lib/crit-wait-notify.test.js#L31)）。
- `scripts/bench-compare_test.py` はベンチマーク比較の時間・アロケーション回帰判定を検証する（[bench-compare\_test.py:48-66](../../../scripts/bench-compare_test.py#L48-L66)）。 <!-- b_x5yvbvgv -->
