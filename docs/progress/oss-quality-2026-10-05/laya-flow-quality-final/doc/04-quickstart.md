# 4. 動かしてみる <!-- b_fgzhde64 -->

**手順（コードから読み取った 0 tok の手順）**
1. 必要なもの: Python `>=3.10`（`pyproject.toml:10`）
2. 開く: http://127.0.0.1:8000（`README.md:364`）
<!-- b_vek3g6vd -->

**スクリプト**
| 用途 | 名前 | コマンド | 定義 |
|---|---|---|---|
| test | `test` | `vitest` | `laya-ts/package.json:13` |
| test | `test` | `npm run build && npm run typecheck && node --test test/*.test.mjs` | `sdk/typescript/package.json:31` |
| test | `test:integration` | `node --test test/integration.mjs` | `sdk/typescript/package.json:32` |
| test | `test:package` | `node --test tests/package-e2e.mjs` | `laya-ts/package.json:14` |
| build | `build` | `npm run clean && tsc -p tsconfig.json && node -e "require('node:fs').copyFileSync('../LICENSE', 'LICENSE')"` | `laya-ts/package.json:12` |
| build | `build` | `node scripts/build.mjs` | `sdk/typescript/package.json:29` |
| typecheck | `typecheck` | `tsc --noEmit -p test/tsconfig.json` | `sdk/typescript/package.json:30` |
| other | `clean` | `node -e "require('node:fs').rmSync('dist', { recursive: true, force: true })"` | `laya-ts/package.json:11` |
| other | `devShell:default` | `nix develop` | `flake.nix:43` |
| other | `prepack` | `npm run build` | `laya-ts/package.json:15` |
| other | `prepack` | `npm run build` | `sdk/typescript/package.json:33` |
| other | `prepublishOnly` | `npm test` | `sdk/typescript/package.json:34` |
<!-- b_p70tfb50 -->

**環境変数**
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
<!-- b_1kkbb4wn -->

**入口**
| 入口 | 種類 | 場所 |
|---|---|---|
| python | dockerfile | `Dockerfile:87` |
| python | dockerfile | `Dockerfile:88` |
| assets/make_logo.py | main | `assets/make_logo.py:140` |
| docker/check_torch.py | main | `docker/check_torch.py:88` |
| docker/entrypoint.py | main | `docker/entrypoint.py:46` |
| docker/prefetch_modelscope.py | main | `docker/prefetch_modelscope.py:307` |
| laya-dotnet/tools/bench_python.py | main | `laya-dotnet/tools/bench_python.py:326` |
| laya-dotnet/tools/check_test_skips.py | main | `laya-dotnet/tools/check_test_skips.py:115` |
| laya-dotnet/tools/dump_golden.py | main | `laya-dotnet/tools/dump_golden.py:533` |
| laya-dotnet/tools/dump_routing_golden.py | main | `laya-dotnet/tools/dump_routing_golden.py:403` |
| laya-dotnet/tools/export_onnx.py | main | `laya-dotnet/tools/export_onnx.py:884` |
| laya-dotnet/tools/regen_golden.py | main | `laya-dotnet/tools/regen_golden.py:262` |
| laya-java/scripts/check_test_results.py | main | `laya-java/scripts/check_test_results.py:104` |
| laya-java/scripts/gen_fixtures.py | main | `laya-java/scripts/gen_fixtures.py:804` |
| laya-java/scripts/gen_language_tables.py | main | `laya-java/scripts/gen_language_tables.py:202` |
| laya-java/scripts/gen_unicode_tables.py | main | `laya-java/scripts/gen_unicode_tables.py:339` |
| laya-java/scripts/prepare_checkpoint.py | main | `laya-java/scripts/prepare_checkpoint.py:146` |
| laya-ts/dist/index.js | main | `laya-ts/package.json:6` |
| laya-ts/scripts/export_onnx.py | main | `laya-ts/scripts/export_onnx.py:250` |
| laya/cli.py | main | `laya/cli.py:418` |
| laya/evals_cli.py | main | `laya/evals_cli.py:489` |
| laya/mcp/server.py | main | `laya/mcp/server.py:526` |
| laya/serve.py | main | `laya/serve.py:1289` |
| notebooks/laya_finetune_typed_decisions_mps.py | main | `notebooks/laya_finetune_typed_decisions_mps.py:403` |
| laya | script | `pyproject.toml:80` |
| laya-serve | script | `pyproject.toml:81` |
| laya-evals | script | `pyproject.toml:82` |
| laya-mcp-server | script | `pyproject.toml:83` |
| research/eval/laya_eval.py | main | `research/eval/laya_eval.py:383` |
| research/eval/metamorphic.py | main | `research/eval/metamorphic.py:699` |
| research/eval/presentation_checks.py | main | `research/eval/presentation_checks.py:552` |
| research/evals/act_head_eval.py | main | `research/evals/act_head_eval.py:316` |
| research/evals/check_regression.py | main | `research/evals/check_regression.py:71` |
| research/evals/massive_route_comparison.py | main | `research/evals/massive_route_comparison.py:154` |
| research/scripts/bench_apps.py | main | `research/scripts/bench_apps.py:307` |
| research/scripts/bench_latency.py | main | `research/scripts/bench_latency.py:171` |
| research/scripts/bench_length_batching.py | main | `research/scripts/bench_length_batching.py:214` |
| research/scripts/bench_local.py | main | `research/scripts/bench_local.py:340` |
| research/scripts/bench_long_context.py | main | `research/scripts/bench_long_context.py:97` |
| research/scripts/bench_nvidia_capacity.py | main | `research/scripts/bench_nvidia_capacity.py:420` |
| research/scripts/bench_position_sensitivity.py | main | `research/scripts/bench_position_sensitivity.py:170` |
| research/scripts/bench_question_token_reuse.py | main | `research/scripts/bench_question_token_reuse.py:156` |
| research/scripts/bench_router_grouping.py | main | `research/scripts/bench_router_grouping.py:84` |
| research/scripts/build_benchmark_nb.py | main | `research/scripts/build_benchmark_nb.py:841` |
| research/scripts/confidence_definitions.py | main | `research/scripts/confidence_definitions.py:259` |
| research/scripts/finetune_single_device.py | main | `research/scripts/finetune_single_device.py:354` |
| research/scripts/make_plots.py | main | `research/scripts/make_plots.py:155` |
| scripts/check_aoti.py | main | `scripts/check_aoti.py:188` |
| scripts/export_onnx.py | main | `scripts/export_onnx.py:130` |
| sdk/typescript/dist/cjs/index.js | main | `sdk/typescript/package.json:7` |
| verify/bench_devices.py | main | `verify/bench_devices.py:70` |
| verify/checkpoints.py | main | `verify/checkpoints.py:144` |
| verify/edge_sweep.py | main | `verify/edge_sweep.py:211` |
| verify/numerics_check.py | main | `verify/numerics_check.py:188` |
| verify/soak_check.py | main | `verify/soak_check.py:258` |
<!-- b_51v1p7r4 -->
