# 4. 動かしてみる <!-- b_xn276g9g -->

| 用途 | 名前 | コマンド | 定義 | 状態 |
|---|---|---|---|---|
| run | `dev` | `dev` | `justfile:4` | 未実行 |
| run | `dev` | `dev` | `web/package.json:6` | 未実行 |
| test | `test` | `test` | `justfile:8` | 未実行 |
| build | `build` | `build` | `web/package.json:7` | 未実行 |
<!-- b_59zqtq6w -->

| 名前 | 既定値 | 読む場所 |
|---|---|---|
| `API_BASE_URL` | なし | `web/lib/upstream.ts:3` |
| `GIN_MODE` | なし | `services/api/main.go:41` |
| `REPORT_DIR` | あり | `scripts/report.py:12` |
<!-- b_7jpkd0se -->

| 入口 | 種類 | 場所 | 状態 |
|---|---|---|---|
| /app/server | dockerfile | `Dockerfile:1` | 未実行 |
| web | procfile | `Procfile:1` | 未実行 |
| worker | procfile | `Procfile:1` | 未実行 |
| scripts/report.py | main | `scripts/report.py:1` | 未実行 |
| services/api/cmd/admin | main | `services/api/cmd/admin/main.go:1` | 未実行 |
| services/api | main | `services/api/main.go:1` | 未実行 |
| tools/indexer-rs/src/main.rs | main | `tools/indexer-rs/src/main.rs:1` | 未実行 |
<!-- b_0h895x4x -->
