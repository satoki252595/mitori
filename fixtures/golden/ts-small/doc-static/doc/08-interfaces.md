# 8. 外部インターフェース <!-- b_4px30qmk -->

| メソッド | パス | ハンドラ | 定義 |
|---|---|---|---|
| POST | `/admin/reindex` | — | `src/http/routes.ts:48` |
| GET | `/api/books` | — | `src/http/routes.ts:24` |
| POST | `/api/books` | — | `src/http/routes.ts:32` |
| DELETE | `/api/books/:id` | — | `src/http/routes.ts:39` |
| GET | `/api/books/:id` | — | `src/http/routes.ts:26` |
| GET | `/healthz` | — | `src/http/routes.ts:22` |
| GET | `/legacy/export` | — | `src/http/legacy-express.js:11` |
| POST | `/reindex` | — | `src/http/routes.ts:48` |
<!-- b_fy6j047k -->

| コマンド | フラグ | 定義 |
|---|---|---|
| `tsundoku export` | `--format` | `bin/tsundoku.js:1` |
| `tsundoku import` | `--dry-run` | `bin/tsundoku.js:1` |
| `tsundoku serve` | `-p` `--port` | `bin/tsundoku.js:1` |
<!-- b_pb7fbtty -->

| 名前 | 既定値 | 読む場所 |
|---|---|---|
| `DATABASE_URL` | なし | `src/config.ts:24` |
| `LOG_LEVEL` | あり | `src/config.ts:21` |
| `PORT` | あり | `src/config.ts:23` |
| `TSUNDOKU_API_TOKEN` | なし | `src/config.ts:26` |
<!-- b_n17ff8er -->
