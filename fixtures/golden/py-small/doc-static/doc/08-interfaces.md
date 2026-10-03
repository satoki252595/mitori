# 8. 外部インターフェース <!-- b_4px30qmk -->

| メソッド | パス | ハンドラ | 定義 |
|---|---|---|---|
| GET | `/api/books` | — | `tsundoku/api.py:1` |
| POST | `/api/books` | — | `tsundoku/api.py:1` |
| DELETE | `/api/books/{book_id}` | — | `tsundoku/api.py:1` |
| GET | `/api/books/{book_id}` | — | `tsundoku/api.py:1` |
| GET | `/books` | — | `tsundoku/api.py:1` |
| POST | `/books` | — | `tsundoku/api.py:1` |
| DELETE | `/books/{book_id}` | — | `tsundoku/api.py:1` |
| GET | `/books/{book_id}` | — | `tsundoku/api.py:1` |
| GET | `/healthz` | — | `tsundoku/api.py:1` |
| GET | `/legacy/export` | — | `tsundoku/legacy_flask.py:1` |
| POST | `/legacy/import` | — | `tsundoku/legacy_flask.py:1` |
| PUT | `/legacy/import` | — | `tsundoku/legacy_flask.py:1` |
<!-- b_fy6j047k -->

| コマンド | フラグ | 定義 |
|---|---|---|
| `tsundoku export` | `--format` | `tsundoku/cli.py:1` |
| `tsundoku import` | `--dry-run` | `tsundoku/cli.py:1` |
| `tsundoku serve` | `-p` `--port` | `tsundoku/cli.py:1` |
| `tsundoku-stats stats` | `--since` | `tsundoku/cli_click.py:1` |
<!-- b_pb7fbtty -->

| 名前 | 既定値 | 読む場所 |
|---|---|---|
| `DATABASE_URL` | なし | `tsundoku/config.py:15` |
| `LOG_LEVEL` | あり | `tsundoku/config.py:20` |
| `PORT` | あり | `tsundoku/config.py:10` |
| `TSUNDOKU_API_TOKEN` | なし | `tsundoku/config.py:26` |
<!-- b_n17ff8er -->
