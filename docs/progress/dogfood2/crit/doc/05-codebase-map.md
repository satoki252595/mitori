# 5. コードの地図 <!-- b_2zygxmbh -->

| ディレクトリ | モジュール | 要約 | 行数 |
|---|---|---|---|
| `internal` | コメント操作とレビュー解決 | コメント追加・一覧とレビューファイルのパス解決 | 2318 |
| `internal` | forge 同期 | GitHub PR と GitLab MR のコメント同期 | 4214 |
| `internal` | デーモンとプランCLI | デーモンのセッション管理とplan・status・stop等のCLI | 4482 |
| `internal` | レビューセッション管理 | コメント・差分・ラウンドを保持し review.json に永続化 | 5850 |
| `internal` | 設定・共有・live | 設定のマージ、レビュー共有 CLI、live プロキシ | 4821 |
| `internal` | VCS 抽象化と focus 解決 | git・sl・jj の差異を吸収し、レビュー対象を解決する | 3551 |
| `scripts` | 開発補助スクリプト | ベンチ比較・アセット検証・ビルド・E2E の補助 | 997 |
| `web` | レビュー画面本体 | ファイルツリー・コメント・差分表示を組み立てる主スクリプト | 9031 |
| `web` | レビュー画面共通部品 | 設定・トースト・差分表示・テーマなどの画面部品群 | 5445 |
| `web` | live mode の UI | iframe 上でピンコメントを扱う親フレーム UI | 4820 |
| `web` | 本体スタイルシート | web 配下の画面全体を整える単一の CSS ファイル | 6279 |
| `（ルート）` | crit CLI 本体 | サブコマンド振り分け、連携の導入検査、story 取り込み | 4901 |
| `（ルート）` | ローカルHTTPサーバー | レビューUI用APIと終了時プロンプト・フックを提供する | 5799 |
| `（ルート）` | 埋め込みWeb資産とエージェント | iframe注入スクリプトとCSS、Go埋め込み資産 | 2403 |
<!-- b_8m6cyt0v -->

- `cmd/crit/gen_integration_hashes.go`（cmd/crit/gen_integration_hashes.go）
- `cmd/crit/main.go`（cmd/crit）
- `scripts/bench-compare.py`（scripts/bench-compare.py）
- `integrations/docker/Dockerfile`（/usr/local/bin/entrypoint.sh）
- `integrations/docker/Dockerfile`（bash）
<!-- b_ksex2x1j -->

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
<!-- b_4qz6cbr2 -->
