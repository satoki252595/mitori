# ADR 0001: HTTP には net/http を使う

- 状態: 採用
- 日付: 2026-01-01

## 背景

tsundoku の API は 5 本のルートしかなく、外部依存を増やす理由が弱い。Go 1.22 以降の `http.ServeMux` は
メソッドとパスパラメータ（`GET /api/books/{id}`）を扱える。

## 決定

ルーティングは標準の `net/http` で行う。chi と cobra は `//go:build ignore` の下書き（`internal/server/chi_routes.go`、
`cmd/tsundoku-cobra`）に置き、依存を入れる判断は v2 API を作るときに行う。

## 結果

- ビルドとテストにネットワークも `go mod download` も要らない。
- ミドルウェアは自前の薄い層（トークン検査）で足りる間はそのままにする。
- 外部リクエストのタイムアウトは `internal/meta` の 10 秒に統一する。
