# CLAUDE.md

- Web は `web/`、API は `services/api/`。`/api/books` は Web が API へ中継するだけで、ロジックは Go 側にある。
- 環境変数は `API_BASE_URL`（web）、`GIN_MODE`（Go）、`REPORT_DIR`（Python）。
- テストは `just test`。
