# 8. 外部インターフェース <!-- b_2x9brvp0 -->

| メソッド | パス | ハンドラ | 定義 |
|---|---|---|---|
| GET | `/health` | `laya/serve.py#create_app.health` | `laya/serve.py:978` |
| POST | `/v1/systemone` | `laya/serve.py#create_app.systemone` | `laya/serve.py:1044` |
| POST | `/v1/systemone/batch` | `laya/serve.py#create_app.systemone_batch` | `laya/serve.py:1130` |
<!-- b_4166tv0e -->

- （検出されませんでした）
<!-- b_0py4vw7f -->

**外とのやり取り（HTTP・RPC・SDK・DB・子プロセス・書き込み）**
| 種類 | 相手 | 経由 | 場所 |
|---|---|---|---|
| HTTP | — | `urllib.request` | `docker/prefetch_modelscope.py:136` `docker/prefetch_modelscope.py:187` `laya/integrations/crewai.py:183` ほか 4 件 |
| HTTP | — | `fetch` | `laya-ts/src/providers.ts:206` `laya-ts/src/tokenizer.ts:476` |
| 子プロセス | — | `os` | `docker/entrypoint.py:43` |
| 子プロセス | — | `subprocess` | `docker/entrypoint.py:42` |
| 子プロセス | `git` | `subprocess` | `research/evals/massive_route_comparison.py:38` |
| 子プロセス | `rsvg-convert` | `subprocess` | `assets/make_logo.py:116` |
<!-- b_rwvznz01 -->

| 名前 | 既定値 | 読む場所 |
|---|---|---|
| `HF_HOME` | なし | `docker/prefetch_modelscope.py:114` |
| `HF_HUB_CACHE` | なし | `docker/prefetch_modelscope.py:111` |
| `HF_HUB_OFFLINE` | なし | `compose.yaml:24` |
| `HF_TOKEN` | なし | `compose.yaml:25` `laya/agent.py:585` `laya/onnx_agent.py:117` `laya/router.py:643` |
| `HF_TOKEN_FILE` | なし | `compose.yaml:26` |
| `LAYA_API_KEY` | なし | `laya/mcp/server.py:170` `laya/serve.py:878` |
| `LAYA_BASE_URL` | あり | `laya/mcp/server.py:137` |
| `LAYA_CPU_AMP` | あり | `compose.yaml:15` `laya/agent.py:316` |
| `LAYA_CUDA_AMP` | あり | `compose.yaml:14` `laya/agent.py:303` |
| `LAYA_DEFAULT_MODEL` | なし | `laya/serve.py:503` |
| `LAYA_DEVICE` | なし | `compose.yaml:9` |
| `LAYA_HOST` | あり | `laya/serve.py:1282` |
| `LAYA_IDLE_UNLOAD_SECONDS` | あり | `laya/serve.py:284` |
| `LAYA_LOG_LEVEL` | あり | `laya/serve.py:1284` |
| `LAYA_MAX_BATCH_TOKENS` | なし | `laya/serve.py:319` |
| `LAYA_MAX_CONCURRENT` | なし | `laya/serve.py:272` |
| `LAYA_MAX_LOADED` | なし | `laya/serve.py:476` |
| `LAYA_MAX_TOKEN_BUDGET` | なし | `laya/serve.py:299` |
| `LAYA_MODEL` | なし | `compose.yaml:16` |
| `LAYA_MODELS` | あり | `laya/mcp/server.py:126` `laya/serve.py:847` |
| `LAYA_MODEL_PATH` | なし | `compose.yaml:17` |
| `LAYA_MPS_AMP_MIN_ROWS` | あり | `laya/agent.py:290` |
| `LAYA_PORT` | あり | `laya/serve.py:517` |
| `LAYA_REMOTE_TIMEOUT` | あり | `laya/mcp/remote.py:52` |
| `LAYA_REQUEST_FILE` | なし | `compose.yaml:18` |
| `LAYA_REVISION` | あり | `compose.yaml:23` `laya/revisions.py:71` |
| `LAYA_ROOT_PATH` | あり | `laya/serve.py:954` |
| `LAYA_SHA256_DIGESTS` | あり | `laya-ts/src/router.ts:195` `laya/revisions.py:110` `laya/router.py:370` |
| `LAYA_THREADS` | なし | `laya/serve.py:822` |
| `MODELSCOPE_MODEL` | なし | `Dockerfile:38` |
| `MODELSCOPE_REVISION` | なし | `Dockerfile:39` |
| `OMP_NUM_THREADS` | なし | `compose.yaml:27` |
| `PATH` | なし | `Dockerfile:12` `Dockerfile:49` |
| `PIP_NO_CACHE_DIR` | なし | `Dockerfile:6` |
| `PYTHON_IMAGE` | なし | `Dockerfile:2` |
| `TORCHINDUCTOR_CACHE_DIR` | なし | `laya/backends/compile.py:57` |
| `TORCH_INDEX` | なし | `Dockerfile:17` |
| `TORCH_VERSION` | なし | `Dockerfile:18` |
| `XDG_CACHE_HOME` | あり | `laya/_compile.py:49` |
<!-- b_rnkbj8dt -->

**秘密情報らしい環境変数（名前だけ。値は読みません）**
| 名前 | 読む場所 |
|---|---|
| `HF_TOKEN` | `compose.yaml:25` `laya/agent.py:585` `laya/onnx_agent.py:117` |
| `HF_TOKEN_FILE` | `compose.yaml:26` |
| `LAYA_API_KEY` | `laya/mcp/server.py:170` `laya/serve.py:878` |
| `LAYA_MAX_BATCH_TOKENS` | `laya/serve.py:319` |
| `LAYA_MAX_TOKEN_BUDGET` | `laya/serve.py:299` |
<!-- b_dt1tkzzq -->
