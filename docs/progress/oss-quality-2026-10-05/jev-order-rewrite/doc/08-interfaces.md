# 8. 外部インターフェース <!-- b_gb0p0497 -->

- （検出されませんでした）
<!-- b_1113r6z4 -->

- （検出されませんでした）
<!-- b_pj2ta3vn -->

**外とのやり取り（HTTP・RPC・SDK・DB・子プロセス・書き込み）**
| 種類 | 相手 | 経由 | 場所 |
|---|---|---|---|
| HTTP | — | `fetch` | `jev_ultrafast/static/app.js:22` |
| HTTP | — | `httpx` | `jev_ultrafast/model.py:12` |
| HTTP | `/api/state` | `fetch` | `jev_ultrafast/static/app.js:56` `jev_ultrafast/static/app.js:236` |
<!-- b_9jp9aa7p -->

| 名前 | 既定値 | 読む場所 |
|---|---|---|
| `TEXT_MODEL` | あり | `jev_ultrafast/demo.py:34` `jev_ultrafast/model.py:165` |
| `TEXT_MODEL_API_KEY` | なし | `jev_ultrafast/model.py:161` |
| `TEXT_MODEL_BASE_URL` | あり | `jev_ultrafast/model.py:164` |
| `TEXT_MODEL_REASONING` | なし | `jev_ultrafast/model.py:167` |
| `TYPESAFE_API_KEY` | なし | `jev_ultrafast/model.py:119` |
| `TYPESAFE_DEMO_PORT` | あり | `jev_ultrafast/demo.py:16` |
| `TYPESAFE_MODEL` | あり | `jev_ultrafast/model.py:108` |
<!-- b_6kb3p0ex -->

**秘密情報らしい環境変数（名前だけ。値は読みません）**
| 名前 | 読む場所 |
|---|---|
| `TEXT_MODEL_API_KEY` | `jev_ultrafast/model.py:161` |
| `TYPESAFE_API_KEY` | `jev_ultrafast/model.py:119` |
<!-- b_52gf5228 -->
