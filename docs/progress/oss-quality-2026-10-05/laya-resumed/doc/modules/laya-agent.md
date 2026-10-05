# 推論エージェント（laya） <!-- b_55ph9z9e -->

- ファイル 14 · 4713 行 · 重要度 0.36
<!-- b_eyq9q715 -->

**変更の手引き**
- 影響が及ぶ先（このモジュールを使う）: [書き出しと計測道具](laya-dotnet-tools-research-scripts.md)・[選定と予測公開](laya-router.md)・[ベンチマークと生成スクリプト](research-scripts-laya-java-scripts.md)・[判定基盤と評価群](laya-research-eval-notebooks.md)・[動作例と連携見本](examples-laya-dotnet-samples-laya-ts-examples.md)
- 使っているもの: [判定基盤と評価群](laya-research-eval-notebooks.md)・[選定と予測公開](laya-router.md)・[書き出しと計測道具](laya-dotnet-tools-research-scripts.md)・[ベンチマークと生成スクリプト](research-scripts-laya-java-scripts.md)
- テスト: `tests/test_revision_pinning.py`（82 件）・`tests/test_download.py`（23 件）・`tests/test_router_batch.py`（23 件）・`tests/test_train.py`（23 件） ほか 23
- 入口から: `POST /v1/systemone/batch`（`laya/serve.py:1130`）・`POST /v1/systemone`（`laya/serve.py:1044`）・`GET /health`（`laya/serve.py:978`）・`research/eval/presentation_checks.py`（`research/eval/presentation_checks.py:552`）・`laya/serve.py`（`laya/serve.py:1289`）
- よく使われる宣言（変えると波及する）: `load` `laya/agent.py:2050`（4 ファイル）・`Backend` `laya/backends/base.py:79`（4 ファイル）・`PredictContext` `laya/hooks.py:22`（4 ファイル）・`validate_timeout` `laya/hooks.py:243`（4 ファイル）・`Agent` `laya/agent.py:449`（3 ファイル）
- 一緒に変わりやすいファイル（直近 289 commit）: `tests/test_hooks_api.py` 10 回・`laya/router.py` 5 回・`tests/test_criteria.py` 4 回・`benchmarks/bench_compile_defaults.py` 3 回・`laya/__init__.py` 2 回
- 注意: ハブ（多くから使われ、多くを使う）・大きいファイル `laya/agent.py`（2,117 行）・循環依存（[ベンチマークと生成スクリプト](research-scripts-laya-java-scripts.md)・[動作例とデモサーバ](examples.md)・[判定基盤と評価群](laya-research-eval-notebooks.md) ほか 2 と）
<!-- b_cs5envbx -->

**大きなファイルの中身（1,500 行を超えるファイル）**
- `laya/agent.py`（2,117 行）
  - `laya/agent.py:60-159` 関数（2）: `_fix_tokenizer_config`・`_verify_compatibility`
  - `laya/agent.py:162-163` 定数・変数（2）: `_TOKENIZERS`・`_TOKENIZERS_LOCK`
  - `laya/agent.py:165-210` 関数: `_InferenceGate`
  - `laya/agent.py:216-217` 定数・変数（2）: `_OOM_FALLBACK_LOCK`・`_BATCH_AUTOCAST_CACHE`
  - `laya/agent.py:220-279` 関数（3）: `_load_tokenizer`・`_amp_context`・`_pad_cuda_compile_batch`
  - `laya/agent.py:282-285` 定数・変数（2）: `MPS_AMP_MIN_ROWS_DEFAULT`・`_AMP_FAIL_LIMIT`
  - `laya/agent.py:288-446` 関数（8）: `_mps_amp_min_rows`・`_cuda_amp_dtype`・`_cpu_amp_dtype`・`_option_count`
  - `laya/agent.py:449-2024` Agent（クラス）
    - `laya/agent.py:459-480` 状態（15）: `hooks_raise`・`hooks_concurrent`・`hooks_timeout`・`_hooks_lock`
    - `laya/agent.py:482-897` メソッド（5）: `__init__`・`backend`・`backend_object`・`set_backend`
    - `laya/agent.py:901-901` 状態: `WARMUP_SHAPES`
    - `laya/agent.py:903-1953` メソッド（19）: `warmup`・`deaccelerate`・`_restore_runtime`・`_check_question`
    - `laya/agent.py:1955-1955` 状態: `predict`
    - `laya/agent.py:1957-2024` メソッド（4）: `fit_temperatures`・`fit_binning`・`save_calibration`・`load_calibration`
  - `laya/agent.py:2027-2027` 定数・変数: `RLAgent`
  - `laya/agent.py:2030-2117` 関数（2）: `_is_local_checkpoint_arg`・`load`
<!-- b_3j5a47nh -->

> [!NOTE]
> **この章で分かること**
> - 単一チェックポイントの推論入口とバックエンド切替えを学ぶ
> - フックによる観測と較正の適用点を学ぶ
> - 学習と評価支援の配置を学ぶ <!-- b_5qam6xpg -->

## 責務 <!-- b_yvz7d5qx -->

このモジュールは単一チェックポイントの推論を担い、`Agent` と `ONNXAgent` を提供する（[agent.py:449](../../../laya/agent.py#L449)、[onnx\_agent.py:38](../../../laya/onnx_agent.py#L38)）。`install` によるバックエンド選択や `HookRegistry` によるフック、`fit_temperature_map` による温度較正、`finetune` による学習支援までが範囲である（[\_\_init\_\_.py:57-78](../../../laya/backends/__init__.py#L57-L78)、[hooks.py:374-385](../../../laya/hooks.py#L374-L385)、[calibrate.py:250-251](../../../laya/calibrate.py#L250-L251)、[train.py:455-456](../../../laya/train.py#L455-L456)）。複数チェックポイントの選択や HTTP 公開は扱わない（推測）。 <!-- b_mknb2469 -->

## 公開インターフェース <!-- b_8ff51m13 -->

- `load` は名前解決とバックエンド振分けを行う入口である（[agent.py:2050-2060](../../../laya/agent.py#L2050-L2060)、[agent.py:2093-2098](../../../laya/agent.py#L2093-L2098)、[agent.py:2099-2104](../../../laya/agent.py#L2099-L2104)）。
- `Agent` は既定の予測本体である（[agent.py:449](../../../laya/agent.py#L449)、[agent.py:1855-1862](../../../laya/agent.py#L1855-L1862)）。
- `ONNXAgent` は同じ予測機能を別実行系で提供する（[onnx\_agent.py:38](../../../laya/onnx_agent.py#L38)、[onnx\_agent.py:244-251](../../../laya/onnx_agent.py#L244-L251)）。
- `PredictContext` は 1 呼出しの状態と結果を運ぶ（[hooks.py:23-37](../../../laya/hooks.py#L23-L37)）。
- `HookRegistry` はフックの登録と解除を管理する（[hooks.py:374-390](../../../laya/hooks.py#L374-L390)）。
- `install` と `make_backend` はバックエンドを構築して装着する（[\_\_init\_\_.py:57-78](../../../laya/backends/__init__.py#L57-L78)）。
- `fit_temperature_map` と `apply_calibration_payload` と `finetune` は較正と学習を担う（[calibrate.py:250-251](../../../laya/calibrate.py#L250-L251)、[calibrate.py:600-601](../../../laya/calibrate.py#L600-L601)、[train.py:455-456](../../../laya/train.py#L455-L456)）。 <!-- b_a77h1z5f -->

## 依存関係 <!-- b_h92n5fwe -->

このモジュールは dir laya の選択系に名前解決を委ね、`resolve_model_spec` で別名を引く（[agent.py:2093-2098](../../../laya/agent.py#L2093-L2098)）。dir `.` の評価系（`load_policy` ら）や他言語向けスクリプト系（`TOOLS`、`main` ら）と相互に利用し合う（推測）。dir laya の選択系や dir `.` の事例系（`agent` ら）から利用される下位の推論基盤である（推測）。 <!-- b_e1j6xw9z -->

## データ構造 <!-- b_czadm0h9 -->

- `PredictContext` は `states`、`questions`、`results`、`model`、`agent`、`router`、`usage`、`elapsed_ms`、`error` を持つ 1 呼出しの文脈である（[hooks.py:23-47](../../../laya/hooks.py#L23-L47)）。
- `TrainConfig` は `epochs`、`micro_batch`、`encoder_lr`、`head_lr`、`loss`、`max_len`、`head_max_len` を集めた学習条件である（[train.py:54-90](../../../laya/train.py#L54-L90)）。
- `Agent` は `hooks_raise`、`hooks_concurrent`、`hooks_timeout`、`model_id`、`amp_enabled`、`cpu_fallback_count`、`last_fallback_reason` を保持する（[agent.py:449-480](../../../laya/agent.py#L449-L480)）。 <!-- b_ts4p48hk -->

## 処理の流れ <!-- b_n86c9prc -->

1. `load` が名前を解決して `Agent` または `ONNXAgent` を返す（[agent.py:2050-2052](../../../laya/agent.py#L2050-L2052)、[agent.py:2102-2110](../../../laya/agent.py#L2102-L2110)）。
2. `system_one` や `predict_batch` が `_to_internal` で質問を直し `_encode_state` で状態を符号化する（[agent.py:1392-1399](../../../laya/agent.py#L1392-L1399)、[agent.py:1855-1862](../../../laya/agent.py#L1855-L1862)、[agent.py:1104-1105](../../../laya/agent.py#L1104-L1105)、[agent.py:1128-1129](../../../laya/agent.py#L1128-L1129)）。
3. `_infer` と `_forward` が推論し `_decode_answers` が回答に戻す（[agent.py:1200](../../../laya/agent.py#L1200)、[agent.py:1311](../../../laya/agent.py#L1311)、[agent.py:1316-1317](../../../laya/agent.py#L1316-L1317)）。
4. 前後で `dispatch` がフックを呼び、`PredictContext` に結果と使用量を残す（[hooks.py:23-44](../../../laya/hooks.py#L23-L44)、[hooks.py:510-517](../../../laya/hooks.py#L510-L517)）。 <!-- b_44grg7t2 -->

## 設定 <!-- b_vv3h00d2 -->

- `backend`、`fast`、`compile`、`compile_mode`、`compile_warmup`、`compile_cache` が実行形態を選ぶ（[agent.py:482-503](../../../laya/agent.py#L482-L503)）。
- `revision` と `expected_sha256` が取得版と完全性を固定する（[agent.py:490-491](../../../laya/agent.py#L490-L491)）。
- `LAYA_CUDA_AMP`、`LAYA_CPU_AMP`、`LAYA_MPS_AMP_MIN_ROWS` が混合精度の条件を変える（[agent.py:303](../../../laya/agent.py#L303)、[agent.py:316](../../../laya/agent.py#L316)、[agent.py:290](../../../laya/agent.py#L290)）。
- `LAYA_REVISION`、`LAYA_SHA256_DIGESTS`、`TORCHINDUCTOR_CACHE_DIR`、`XDG_CACHE_HOME` が既定の取得とキャッシュを変える（[revisions.py:71](../../../laya/revisions.py#L71)、[revisions.py:110](../../../laya/revisions.py#L110)、[compile.py:57](../../../laya/backends/compile.py#L57)、[\_compile.py:49](../../../laya/_compile.py#L49)）。 <!-- b_hzcrxddv -->

## テスト <!-- b_xa5jrdeg -->

推論ゲートの並行読み取り、書き込み排他、優先度と例外安全性を検証する（[test\_agent\_gate.py:61](../../../tests/test_agent_gate.py#L61)、[test\_agent\_gate.py:94](../../../tests/test_agent_gate.py#L94)、[test\_agent\_gate.py:132](../../../tests/test_agent_gate.py#L132)、[test\_agent\_gate.py:187](../../../tests/test_agent_gate.py#L187)）。バックエンド選択、コンパイル済みグラフの再利用と復元、既定路の非干渉を検証する（[test\_backends.py:275](../../../tests/test_backends.py#L275)、[test\_compile.py:83](../../../tests/test_compile.py#L83)、[test\_compile.py:117](../../../tests/test_compile.py#L117)、[test\_compile.py:159](../../../tests/test_compile.py#L159)）。サブフォルダー取得、空質問の短絡、高速カーネルの一致を検証する（[test\_download.py:120](../../../tests/test_download.py#L120)、[test\_empty\_questions.py:109](../../../tests/test_empty_questions.py#L109)、[test\_fast.py:83](../../../tests/test_fast.py#L83)）。 <!-- b_84pm7s0v -->

## 不変条件 <!-- b_2hvbmdw4 -->

- 明示の `backend` は `fast` と `compile` に優先する（[agent.py:507-508](../../../laya/agent.py#L507-L508)）。
- `backend` が `onnx` の場合 `load` は `ONNXAgent` を返す（[agent.py:2050](../../../laya/agent.py#L2050)、[agent.py:2102-2104](../../../laya/agent.py#L2102-L2104)）。
- `expected_sha256` は重み解釈の前に検証され、不一致や欠落は読込みを拒否する（[agent.py:513-516](../../../laya/agent.py#L513-L516)）。 <!-- b_jjvjapnh -->

## エラー処理 <!-- b_v2jkxrx6 -->

- 成果物の欠落は `FileNotFoundError` を、不一致は `ValueError` を送出し読込みを拒否する（[agent.py:513-516](../../../laya/agent.py#L513-L516)）。
- フック失敗は `hooks_raise` が真なら送出し、偽なら警告して続行する（[agent.py:543-545](../../../laya/agent.py#L543-L545)）。
- 利用不能なバックエンドは `BackendUnavailable` で通知される（[base.py:75](../../../laya/backends/base.py#L75)）。 <!-- b_bk3pmrbn -->

## 並行性 <!-- b_ayhecahs -->

`_InferenceGate` が `read_lock` と `write_lock` で推論と更新を調停する（[agent.py:165-196](../../../laya/agent.py#L165-L196)）。`_TOKENIZERS` を `_TOKENIZERS_LOCK` で共有し、`_hooks_lock` が非並行フックを直列化する（[agent.py:162-163](../../../laya/agent.py#L162-L163)、[agent.py:557-561](../../../laya/agent.py#L557-L561)）。コンパイル済みグラフの再入は `_cudagraph_lock` と `_lock` で守られる（[\_compile.py:36-39](../../../laya/_compile.py#L36-L39)）。 <!-- b_xz3b8eg9 -->

## 性能 <!-- b_ababnfd3 -->

トークナイザーを `_TOKENIZERS` に集約し、`warmup` が `WARMUP_SHAPES` で事前にグラフを構築する（[agent.py:162-163](../../../laya/agent.py#L162-L163)、[agent.py:901-904](../../../laya/agent.py#L901-L904)）。形状の丸め（`bucket_shape`）と高速路（`FastLaya`）が再コンパイルと注意計算の費用を抑える（[base.py:37](../../../laya/backends/base.py#L37)、[fast.py:28-29](../../../laya/fast.py#L28-L29)）。 <!-- b_assd2x2h -->

## 落とし穴 <!-- b_mfn0yx4g -->

> [!WARNING]
> **落とし穴**
> - `Agent` に `backend` として `onnx` を渡すと失敗し、`load` 経由が必要である（[agent.py:449](../../../laya/agent.py#L449)、[agent.py:550-551](../../../laya/agent.py#L550-L551)、[agent.py:2050](../../../laya/agent.py#L2050)）。
> - `fast` は `compile` に優先し、両指定でも高速路が選ばれる（[agent.py:521-525](../../../laya/agent.py#L521-L525)）。
> - `compile_cache` はプロセス全体の既定に触れるため、呼出し順が結果を変える（[agent.py:528-529](../../../laya/agent.py#L528-L529)）。 <!-- b_9nqppty0 -->

## 深掘り <!-- b_hzphmtmg -->

> [!NOTE]
> **深掘り**
> 長文窓の分割と集約（`predict_long` の `window`、`stride`、`aggregate`）の詳細 <!-- b_q2dar1m7 -->

> [!NOTE]
> **深掘り**
> 温度と棄却しきい値の適合（`fit_temperature_map` 系）の詳細 <!-- b_qwx7v3jc -->

> [!TIP]
> **まとめ**
> 単一モデルの予測とその周辺機構がここに集まり、上位の選択や公開は別モジュールが担う。 <!-- b_hfse4dzb -->
