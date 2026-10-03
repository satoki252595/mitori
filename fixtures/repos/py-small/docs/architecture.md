# tsundoku のアーキテクチャ

積読（買ったけれどまだ読んでいない本）を管理する小さなサービス。HTTP API と CLI が同じ `Repo` を使う。

## 構成

| モジュール | 役割 |
|---|---|
| `tsundoku/api.py` | FastAPI のルート。`/api/books` と `/healthz` |
| `tsundoku/legacy_flask.py` | 旧デスクトップクライアント向けの Flask Blueprint |
| `tsundoku/cli.py` | argparse の CLI（`import` / `export` / `serve`） |
| `tsundoku/cli_click.py` | click の集計コマンド（`tsundoku-stats stats`） |
| `tsundoku/repo.py` | sqlite3 のリポジトリ。標準ライブラリだけで動く |
| `tsundoku/models.py` | SQLAlchemy のモデル（まだ repo からは使っていない） |
| `tsundoku/metadata.py` | ISBN からのメタデータ取得。失敗したら 1 回だけ再試行する |
| `tsundoku/importer.py`・`csvutil.py` | CSV の取り込みと JSON の書き出し |

## 設計上の約束

- `repo.py` と `metadata.py` は標準ライブラリだけに依存する。テストは何もインストールせずに走る。
- スキーマは `migrations/0001_init.sql` が正本で、`Repo` は起動時にそれを流す。
- 設定は環境変数（`PORT` / `DATABASE_URL` / `LOG_LEVEL` / `TSUNDOKU_API_TOKEN`）。関数呼び出しのたびに読み直す。
- 外部への HTTP は 10 秒でタイムアウトする。
