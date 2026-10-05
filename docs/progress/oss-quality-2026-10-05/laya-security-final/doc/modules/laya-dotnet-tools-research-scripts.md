# 書き出しと計測道具 <!-- b_6w08qady -->

- ファイル 23 · 5768 行 · 重要度 0.37
<!-- b_wce6s1jx -->

**変更の手引き**
- 影響が及ぶ先（このモジュールを使う）: [判定基盤と評価群](laya-research-eval-notebooks.md)・[ベンチマークと生成スクリプト](research-scripts-laya-java-scripts.md)・[推論エージェント](laya-agent.md)
- 使っているもの: [選定と予測公開](laya-router.md)・[判定基盤と評価群](laya-research-eval-notebooks.md)・[推論エージェント](laya-agent.md)・[ベンチマークと生成スクリプト](research-scripts-laya-java-scripts.md)
- テスト: `laya-dotnet/tools/test_ci_tools.py`（12 件）
- 入口から: `laya-dotnet/tools/bench_python.py`（`laya-dotnet/tools/bench_python.py:326`）・`laya-dotnet/tools/check_test_skips.py`（`laya-dotnet/tools/check_test_skips.py:115`）・`laya-dotnet/tools/dump_golden.py`（`laya-dotnet/tools/dump_golden.py:533`）・`laya-dotnet/tools/dump_routing_golden.py`（`laya-dotnet/tools/dump_routing_golden.py:403`）・`laya-dotnet/tools/export_onnx.py`（`laya-dotnet/tools/export_onnx.py:884`）
- 一緒に変わりやすいファイル（直近 289 commit）: `laya-dotnet/tests/Laya.Tests/ShortlistEndToEndTests.cs` 2 回
- 注意: ハブ（多くから使われ、多くを使う）・循環依存（[推論エージェント](laya-agent.md)・[ベンチマークと生成スクリプト](research-scripts-laya-java-scripts.md)・[動作例とデモサーバ](examples.md) ほか 2 と）
<!-- b_4wrs11gs -->

> [!NOTE]
> **この章で分かること**
> - 書き出しと golden 生成の全体像を学ぶ
> - ベンチマーク群の使い分けを学ぶ
> - 再生成と検証の流れを学ぶ <!-- b_kgfqa3nd -->

## 責務 <!-- b_qgp5374n -->

オフライン作業用のツール群で、書き出しと golden 生成と計測を集める（[export\_onnx.py:264](../../../laya-dotnet/tools/export_onnx.py#L264)、[dump\_golden.py:391](../../../laya-dotnet/tools/dump_golden.py#L391)、[bench\_python.py:169](../../../laya-dotnet/tools/bench_python.py#L169)）。チェックポイント単位の再生成と検証補助を担う（[regen\_golden.py:182](../../../laya-dotnet/tools/regen_golden.py#L182)、[check\_test\_skips.py:43](../../../laya-dotnet/tools/check_test_skips.py#L43)）。実行時の提供や判断自体は担当しない（推測）。 <!-- b_adgyn9b3 -->

## 公開インターフェース <!-- b_rt67x01t -->

- `export_one` は指定名の ONNX 書き出しを実行する（[export\_onnx.py:658](../../../laya-dotnet/tools/export_onnx.py#L658)）。
- `verify` は書き出し済み ONNX の整合を確認する（[export\_onnx.py:409](../../../laya-dotnet/tools/export_onnx.py#L409)）。
- `run_checkpoint` は golden 群を生成する（[dump\_golden.py:391](../../../laya-dotnet/tools/dump_golden.py#L391)）。
- `regen_checkpoint` は `export_fused` と `export_split` をまとめて再生成する（[regen\_golden.py:182](../../../laya-dotnet/tools/regen_golden.py#L182)、[regen\_golden.py:166](../../../laya-dotnet/tools/regen_golden.py#L166)、[regen\_golden.py:174](../../../laya-dotnet/tools/regen_golden.py#L174)）。
- `bench_checkpoint` は Python 基準の速度を測る（[bench\_python.py:169](../../../laya-dotnet/tools/bench_python.py#L169)）。
- `embed` は決定的な簡易埋め込みを返す（[hashing\_embedder.py:95](../../../laya-dotnet/tools/hashing_embedder.py#L95)）。 <!-- b_nsb9zbps -->

## 依存関係 <!-- b_6wn1s5xd -->

- `laya` 直下の `PRESETS` 周りと提供処理を使う（推測）。
- `laya` の `Agent` 系と `compile_model` 周りを使う（推測）。
- 直下の評価系の `load_policy` 周りや隣接スクリプトの `main` 群と往復する（推測）。 <!-- b_q5tspqpe -->

## データ構造 <!-- b_asdd5g54 -->

- `CASES` は golden 用の事例群である（[golden\_cases.py:38](../../../laya-dotnet/tools/golden_cases.py#L38)）。
- `ERROR_CASES` は異常系の事例群である（[golden\_cases.py:282](../../../laya-dotnet/tools/golden_cases.py#L282)）。
- `SHORTLIST_E2E_CASES` は絞り込み通しの事例群である（[golden\_cases.py:304](../../../laya-dotnet/tools/golden_cases.py#L304)）。
- `ROUTE_CASES` は経路判定の事例群である（[routing\_cases.py:265](../../../laya-dotnet/tools/routing_cases.py#L265)）。 <!-- b_4pyzjrgh -->

## 処理の流れ <!-- b_kwescvya -->

1. `build_agent` が ONNX 先から実行体を作る（[dump\_golden.py:208](../../../laya-dotnet/tools/dump_golden.py#L208)）。
2. `record_case` が事例を記録形式に整える（[dump\_golden.py:295](../../../laya-dotnet/tools/dump_golden.py#L295)）。
3. `dump` がファイルに書き出す（[dump\_golden.py:384](../../../laya-dotnet/tools/dump_golden.py#L384)）。 <!-- b_0wthyxne -->

## 設定 <!-- b_re5d01r4 -->

- `--checkpoint` で対象を指定し、`--onnx` と `--out` を省略できる（[dump\_golden.py:486](../../../laya-dotnet/tools/dump_golden.py#L486)、[dump\_golden.py:492](../../../laya-dotnet/tools/dump_golden.py#L492)、[dump\_golden.py:499](../../../laya-dotnet/tools/dump_golden.py#L499)）。
- `--model-dir` と `--workload` と `--backend` で計測条件を指定する（[bench\_nvidia\_capacity.py:394](../../../research/scripts/bench_nvidia_capacity.py#L394)、[bench\_nvidia\_capacity.py:397](../../../research/scripts/bench_nvidia_capacity.py#L397)、[bench\_nvidia\_capacity.py:398](../../../research/scripts/bench_nvidia_capacity.py#L398)）。
- `LAYA_MODELS` でモデル置き場を切り替える（[bench\_latency.py:36](../../../research/scripts/bench_latency.py#L36)）。 <!-- b_0np2004h -->

## テスト <!-- b_w512ndgs -->

`test_passed_run` と `test_absent_checkpoint_is_allowed` は許容系を確認する（[test\_ci\_tools.py:27](../../../laya-dotnet/tools/test_ci_tools.py#L27)、[test\_ci\_tools.py:30](../../../laya-dotnet/tools/test_ci_tools.py#L30)）。`test_owned_checkpoint_is_not_allowed` と `test_missing_goldens_are_not_allowed` と `test_unknown_skip_fails_closed` と `test_failure_and_unknown_outcome_fail` は失敗閉じを確認する（[test\_ci\_tools.py:35](../../../laya-dotnet/tools/test_ci_tools.py#L35)、[test\_ci\_tools.py:40](../../../laya-dotnet/tools/test_ci_tools.py#L40)、[test\_ci\_tools.py:45](../../../laya-dotnet/tools/test_ci_tools.py#L45)、[test\_ci\_tools.py:48](../../../laya-dotnet/tools/test_ci_tools.py#L48)）。 <!-- b_vftmaq31 -->

## 落とし穴 <!-- b_gzcpfg7q -->

> [!WARNING]
> **落とし穴**
> - `is_valid` が `STAMP` 不一致で再書き出しを要求するため、成果物だけの差し替えは検出される（[regen\_golden.py:100](../../../laya-dotnet/tools/regen_golden.py#L100)、[regen\_golden.py:80](../../../laya-dotnet/tools/regen_golden.py#L80)）。
> - `CHECKPOINTS` の名寄せ変更は複数道具に波及するため同時更新が必要である（[dump\_golden.py:61](../../../laya-dotnet/tools/dump_golden.py#L61)、[bench\_python.py:57](../../../laya-dotnet/tools/bench_python.py#L57)、[regen\_golden.py:63](../../../laya-dotnet/tools/regen_golden.py#L63)）。 <!-- b_hw8h2x7c -->

> [!TIP]
> **まとめ**
> 書き出しと再生成と計測の入口を押さえれば十分である。 <!-- b_f56drg2q -->
