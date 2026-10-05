# 8. 外部インターフェース <!-- b_4px30qmk -->

- （検出されませんでした）
<!-- b_fy6j047k -->

| コマンド | フラグ | 定義 |
|---|---|---|
| `tsundoku export` | `--format` | `detect-only/clap_cli.rs:1` |
| `tsundoku import` | `--dry-run` | `detect-only/clap_cli.rs:1` |
| `tsundoku serve` | `--port` | `detect-only/clap_cli.rs:1` |
<!-- b_pb7fbtty -->

**外とのやり取り（HTTP・RPC・SDK・DB・子プロセス・書き込み）**
- 外への呼び出しは見つかりませんでした（HTTP・SDK / DB クライアント・RPC・子プロセスの起動を探しました）。
<!-- b_vckgmkw8 -->

| 名前 | 既定値 | 読む場所 |
|---|---|---|
| `DATABASE_URL` | なし | `src/config.rs:27` |
| `LOG_LEVEL` | あり | `src/config.rs:28` |
| `PORT` | あり | `src/config.rs:23` |
| `TSUNDOKU_API_TOKEN` | なし | `src/config.rs:29` |
<!-- b_n17ff8er -->

**秘密情報らしい環境変数（名前だけ。値は読みません）**
| 名前 | 読む場所 |
|---|---|
| `DATABASE_URL` | `src/config.rs:27` |
| `TSUNDOKU_API_TOKEN` | `src/config.rs:29` |
<!-- b_28h655da -->
