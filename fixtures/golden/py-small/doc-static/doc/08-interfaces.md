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

**外とのやり取り（HTTP・RPC・SDK・DB・子プロセス・書き込み）**
- 外への呼び出しは見つかりませんでした（HTTP・SDK / DB クライアント・RPC・子プロセスの起動を探しました）。
<!-- b_vckgmkw8 -->

| 名前 | 既定値 | 読む場所 |
|---|---|---|
| `DATABASE_URL` | なし | `tsundoku/config.py:15` |
| `LOG_LEVEL` | あり | `tsundoku/config.py:20` |
| `PORT` | あり | `tsundoku/config.py:10` |
| `TSUNDOKU_API_TOKEN` | なし | `tsundoku/config.py:26` |
<!-- b_n17ff8er -->

**秘密情報らしい環境変数（名前だけ。値は読みません）**
| 名前 | 読む場所 |
|---|---|
| `DATABASE_URL` | `tsundoku/config.py:15` |
| `TSUNDOKU_API_TOKEN` | `tsundoku/config.py:26` |
<!-- b_28h655da -->
