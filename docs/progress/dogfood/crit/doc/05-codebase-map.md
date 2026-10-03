# 5. コードの地図 <!-- b_bv77m246 -->

| ディレクトリ | モジュール | 要約 | 行数 |
|---|---|---|---|
| `internal` | 設定・認証・起動引数 | 設定統合、共有先解決、認証、デーモン引数の解決 | 3396 |
| `internal` | PR/MR 同期とレビュー経路 | GitHub/GitLab の PR・MR コメントを pull/push で同期する | 4023 |
| `internal` | HTTP サーバー層 | レビューセッションと共有を公開する HTTP API | 5281 |
| `internal` | レビュー状態管理 | セッションとコメントを保持し CritJSON に保存する | 5383 |
| `internal` | VCS抽象化層 | git・jj・Saplingの差異を吸収し差分と履歴を共通形で返す | 3209 |
| `web` | live mode フロント | iframe 親と agent によるピン操作のブラウザ側実装 | 4908 |
| `web` | レビュー画面本体 | ブラウザ側レビューUIを実装する app.js | 9031 |
| `web` | 画面スタイルと資産 | CSS、テーマ、マニフェスト、モード切替関数 | 7019 |
| `（ルート）` | CLI 入口と統合導入 | crit コマンドの振り分けと統合のインストール・検査 | 4376 |
| `（ルート）` | デーモン管理とセッションCLI | デーモンの起動・探索・停止とセッション系CLI | 3356 |
| `（ルート）` | 終了プロンプトとフック | レビュー終了時のプロンプト・フック・ストーリー取り込み | 2733 |
| `（ルート）` | フォーカスとコメント | レビュー対象のフォーカス管理とコメントCLI | 3943 |
| `（ルート）` | 共有UIヘルパーと補助スクリプト | web の共有 JS と scripts、opencode 連携をまとめる | 8253 |
<!-- b_z8xkc97v -->

- `scripts/bench-compare.py`（scripts/bench-compare.py）
- `cmd/crit/gen_integration_hashes.go`（cmd/crit/gen_integration_hashes.go）
- `cmd/crit/main.go`（cmd/crit）
- `integrations/docker/Dockerfile`（/usr/local/bin/entrypoint.sh）
- `integrations/docker/Dockerfile`（bash）
<!-- b_wxwnbhy7 -->

| 除外理由 | 件数 |
|---|---|
| binary | 299 |
| deny_glob | 16 |
| fixture | 13 |
| generated | 1 |
| lockfile | 5 |
| minified | 3 |
| oversize | 1 |
| special | 2 |
<!-- b_a5js0d29 -->
