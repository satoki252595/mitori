# tsundoku monorepo

積読を管理するサービスを 4 つの言語で書いたモノレポ。

| ディレクトリ | 言語 | 内容 |
|---|---|---|
| `web/` | TypeScript（Next.js app router） | 画面と、Go API へ中継する `/api/books` |
| `services/api/` | Go | 本の API（gin）と集計 API（echo）、管理 CLI（`cmd/admin`） |
| `scripts/` | Python / Bash / Ruby | 週次レポート、バックアップ、ISBN のチェックディジット |
| `tools/indexer-rs/` | Rust | 書名の検索インデックスを作る CLI |
| `legacy/` | Java | 旧デスクトップクライアントの名残 |

開発は `nix develop` の中で `just dev`、テストは `just test`。
