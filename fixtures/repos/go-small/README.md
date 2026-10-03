# tsundoku (Go)

積読（買ったけれどまだ読んでいない本）を管理する小さな HTTP サービスと CLI。標準ライブラリだけで動く。

## 動かす

```sh
make build
./bin/tsundoku serve -port 8080
curl localhost:8080/api/books
```

| 変数 | 既定値 | 意味 |
|---|---|---|
| `PORT` | `8080` | 待ち受けポート |
| `DATABASE_URL` | なし | 将来の SQL ストア用（未設定ならメモリ） |
| `LOG_LEVEL` | `info` | ログの詳しさ |
| `TSUNDOKU_API_TOKEN` | なし | 設定すると書き込み系 API に Bearer トークンを要求する |

## API

| メソッド・パス | 説明 |
|---|---|
| `GET /api/books` | 一覧 |
| `GET /api/books/{id}` | 1 冊 |
| `POST /api/books` | 追加。title が無ければ ISBN から取得する |
| `DELETE /api/books/{id}` | 削除。存在しない id は 404 |
| `/healthz` | 死活監視 |

## 構成

- `cmd/tsundoku` — CLI（標準の `flag`）
- `internal/server` — HTTP ハンドラ
- `internal/store` — 永続化のポートとメモリ実装
- `internal/meta` — ISBN からのメタデータ取得
- `migrations` — SQL ストア用のスキーマ

テスト: `make test`。整形: `make fmt`。静的検査: `make lint`。
