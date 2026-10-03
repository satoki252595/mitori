# tsundoku-web

積読（買ったけれどまだ読んでいない本）を管理する小さな Web サービスと CLI。

## できること

- 本の追加・一覧・削除（`/api/books`）
- ISBN からタイトルと著者を自動取得（失敗したときは 1 回だけ再試行する）
- CSV の取り込み（`tsundoku import`）と JSON の書き出し（`tsundoku export`）

## 使い方

```sh
bun install
bun run dev                  # http://localhost:8787
bun test
```

設定は環境変数で行う。

| 変数 | 既定値 | 意味 |
|---|---|---|
| `PORT` | `8787` | 待ち受けポート |
| `DATABASE_URL` | なし | SQLite のパス（未設定ならメモリ上で動く） |
| `LOG_LEVEL` | `info` | `debug` / `info` / `warn` / `error` |
| `TSUNDOKU_API_TOKEN` | なし | 設定すると書き込み API に Bearer トークンを要求する |

## ディレクトリ

- `src/http` — Hono のルート（旧クライアント向けの Express ルートは `legacy-express.js`）
- `src/db` — リポジトリ、drizzle のスキーマ、型
- `src/services` — メタデータ取得、CSV 取り込み
- `bin/tsundoku.js` — CLI
