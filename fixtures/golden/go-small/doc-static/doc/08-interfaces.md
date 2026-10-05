# 8. 外部インターフェース <!-- b_4px30qmk -->

| メソッド | パス | ハンドラ | 定義 |
|---|---|---|---|
| GET | `/api/books` | — | `internal/server/server.go:34` |
| POST | `/api/books` | — | `internal/server/server.go:36` |
| DELETE | `/api/books/{id}` | — | `internal/server/server.go:37` |
| GET | `/api/books/{id}` | — | `internal/server/server.go:35` |
| ANY | `/healthz` | — | `internal/server/server.go:33` |
| GET | `/v2/books` | — | `internal/server/chi_routes.go:18` |
| POST | `/v2/books` | — | `internal/server/chi_routes.go:19` |
<!-- b_fy6j047k -->

| コマンド | フラグ | 定義 |
|---|---|---|
| `tsundoku export` | `--format` | `cmd/tsundoku-cobra/main.go:1` |
| `tsundoku export` | — | `cmd/tsundoku/main.go:1` |
| `tsundoku import` | `--dry-run` | `cmd/tsundoku-cobra/main.go:1` |
| `tsundoku import` | — | `cmd/tsundoku/main.go:1` |
| `tsundoku serve` | `--port` | `cmd/tsundoku-cobra/main.go:1` |
| `tsundoku serve` | — | `cmd/tsundoku/main.go:1` |
<!-- b_pb7fbtty -->

**外とのやり取り（HTTP・RPC・SDK・DB・子プロセス・書き込み）**
- 外への呼び出しは見つかりませんでした（HTTP・SDK / DB クライアント・RPC・子プロセスの起動を探しました）。
<!-- b_vckgmkw8 -->

| 名前 | 既定値 | 読む場所 |
|---|---|---|
| `DATABASE_URL` | なし | `internal/config/config.go:25` |
| `LOG_LEVEL` | なし | `internal/config/config.go:27` |
| `PORT` | あり | `internal/config/config.go:20` |
| `TSUNDOKU_API_TOKEN` | なし | `internal/config/config.go:36` |
<!-- b_n17ff8er -->

**秘密情報らしい環境変数（名前だけ。値は読みません）**
| 名前 | 読む場所 |
|---|---|
| `DATABASE_URL` | `internal/config/config.go:25` |
| `TSUNDOKU_API_TOKEN` | `internal/config/config.go:36` |
<!-- b_28h655da -->
