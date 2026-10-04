# 4. 動かしてみる <!-- b_xn276g9g -->

**スクリプト**
| 用途 | 名前 | コマンド | 定義 |
|---|---|---|---|
| test | `test` | `test` | `Makefile:6` |
| build | `build` | `build` | `Makefile:3` |
| lint | `lint` | `lint` | `Makefile:9` |
| format | `fmt` | `fmt` | `Makefile:12` |
<!-- b_59zqtq6w -->

**環境変数**
| 名前 | 既定値 | 読む場所 |
|---|---|---|
| `DATABASE_URL` | なし | `internal/config/config.go:25` |
| `LOG_LEVEL` | なし | `internal/config/config.go:27` |
| `PORT` | あり | `internal/config/config.go:20` |
| `TSUNDOKU_API_TOKEN` | なし | `internal/config/config.go:36` |
<!-- b_7jpkd0se -->

**入口**
| 入口 | 種類 | 場所 |
|---|---|---|
| cmd/tsundoku-cobra | main | `cmd/tsundoku-cobra/main.go:1` |
| cmd/tsundoku | main | `cmd/tsundoku/main.go:1` |
<!-- b_0h895x4x -->
