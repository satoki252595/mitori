# 8. 外部インターフェース <!-- b_4px30qmk -->

| メソッド | パス | ハンドラ | 定義 |
|---|---|---|---|
| GET | `/` | — | `web/app/page.tsx:1` |
| GET | `/api/books` | — | `web/app/api/books/route.ts:1` |
| POST | `/api/books` | — | `web/app/api/books/route.ts:1` |
| DELETE | `/api/books/[id]` | — | `web/app/api/books/[id]/route.ts:1` |
| GET | `/api/books/[id]` | — | `web/app/api/books/[id]/route.ts:1` |
| GET | `/api/v1/books` | — | `services/api/main.go:48` |
| POST | `/api/v1/books` | — | `services/api/main.go:51` |
| GET | `/api/v1/stats` | — | `services/api/echo.go:13` |
<!-- b_fy6j047k -->

| コマンド | フラグ | 定義 |
|---|---|---|
| `admin migrate` | `--dry-run` | `services/api/cmd/admin/main.go:1` |
| `indexer build` | `--full` | `tools/indexer-rs/src/main.rs:1` |
| `report weekly` | `--since` | `scripts/report.py:1` |
| `web-cli sync` | `--dry-run` | `web/tools/cli.js:1` |
<!-- b_pb7fbtty -->

| 名前 | 既定値 | 読む場所 |
|---|---|---|
| `API_BASE_URL` | なし | `web/lib/upstream.ts:3` |
| `GIN_MODE` | なし | `services/api/main.go:41` |
| `REPORT_DIR` | あり | `scripts/report.py:12` |
<!-- b_n17ff8er -->
