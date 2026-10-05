# 5. コードの地図 <!-- b_ez5f2jvt -->

**読む順番（コードの入口から 4 か所）**
1. 入口: `jev_ultrafast/demo.py:131-141` — `main`
2. 基盤の型: `jev_ultrafast/agent.py:12-174` — `Agent`
3. ハブ（多くをつなぐ）: `jev_ultrafast/__init__.py:6` — `__all__`
4. 機能の芯: `jev_ultrafast/browser.py:120-194` — `browser_operation`
<!-- b_m5mrh5xy -->

| ディレクトリ | モジュール | 要約 | 行数 |
|---|---|---|---|
| `jev_ultrafast` | 観測選択実行本体 | 観測表から次操作を選び実行を分離する | 769 |
| `jev_ultrafast/static` | デモ UI 静的資源 | デモ画面とフィクスチャを提供する静的ファイル群 | 1622 |
| `（ルート）` | 検証用脚本集 | 計測・確認・描画の補助入口を集めたもの | 550 |
<!-- b_83kbdvzz -->

- `jev_ultrafast/demo.py`（jev_ultrafast/demo.py）
- `jev_ultrafast/static/index.html`（jev_ultrafast/static/app.js）
- `scripts/check_guards.py`（scripts/check_guards.py）
- `scripts/smoke.py`（scripts/smoke.py）
- `pyproject.toml`（jev）
<!-- b_5d0xm2c5 -->

| 除外理由 | 件数 |
|---|---|
| バイナリ | 5 |
| ロックファイル | 1 |
| 秘密情報 | 1 |
<!-- b_wven7h8y -->
