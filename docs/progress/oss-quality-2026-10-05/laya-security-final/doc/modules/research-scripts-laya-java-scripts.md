# ベンチマークと生成スクリプト <!-- b_psw3s5sg -->

- ファイル 12 · 3312 行 · 重要度 0.36
<!-- b_fc38s84z -->

**変更の手引き**
- 影響が及ぶ先（このモジュールを使う）: [判定基盤と評価群](laya-research-eval-notebooks.md)・[選定と予測公開](laya-router.md)・[推論エージェント](laya-agent.md)・[書き出しと計測道具](laya-dotnet-tools-research-scripts.md)
- 使っているもの: [選定と予測公開](laya-router.md)・[推論エージェント](laya-agent.md)・[判定基盤と評価群](laya-research-eval-notebooks.md)・[書き出しと計測道具](laya-dotnet-tools-research-scripts.md)
- テスト: `tests/test_onnx.py`（2 件）・`scripts/test_suites.py`
- 入口から: `laya-java/scripts/check_test_results.py`（`laya-java/scripts/check_test_results.py:104`）・`laya-java/scripts/gen_fixtures.py`（`laya-java/scripts/gen_fixtures.py:804`）・`laya-java/scripts/gen_language_tables.py`（`laya-java/scripts/gen_language_tables.py:202`）・`laya-java/scripts/gen_unicode_tables.py`（`laya-java/scripts/gen_unicode_tables.py:339`）・`laya-java/scripts/prepare_checkpoint.py`（`laya-java/scripts/prepare_checkpoint.py:146`）
- 一緒に変わりやすいファイル（直近 289 commit）: `laya-java/laya-java/src/main/java/com/convaiinnovations/laya/Question.java` 3 回・`laya-java/.gitignore` 2 回・`laya-java/build.gradle.kts` 2 回・`laya-java/laya-java/src/main/java/com/convaiinnovations/laya/Agent.java` 2 回・`laya-java/laya-java/src/main/java/com/convaiinnovations/laya/json/PythonJson.java` 2 回
- 注意: ハブ（多くから使われ、多くを使う）・循環依存（[推論エージェント](laya-agent.md)・[動作例とデモサーバ](examples.md)・[判定基盤と評価群](laya-research-eval-notebooks.md) ほか 2 と）
<!-- b_fnmpc984 -->

> [!NOTE]
> **この章で分かること**
> - ベンチマーク実行と作図の流れが分かる
> - Java 用テーブルとフィクスチャ生成の役割が分かる
> - チェックポイント準備と ONNX 出力の入口が分かる <!-- b_5h5x55ds -->

## 責務 <!-- b_1wvdwkcq -->

ベンチマーク実行と作図のためのスクリプト群である（[bench\_local.py:189](../../../research/scripts/bench_local.py#L189)、[bench\_local.py:256](../../../research/scripts/bench_local.py#L256)、[make\_plots.py:36](../../../research/scripts/make_plots.py#L36)、[make\_plots.py:41](../../../research/scripts/make_plots.py#L41)）。Java 用テーブルの `render` 生成や `fetch` による取得、`export_to_onnx` による出力など準備作業を担う（[gen\_unicode\_tables.py:78](../../../laya-java/scripts/gen_unicode_tables.py#L78)、[prepare\_checkpoint.py:39](../../../laya-java/scripts/prepare_checkpoint.py#L39)、[export\_onnx.py:57](../../../scripts/export_onnx.py#L57)）。推論本体のルーターやエージェントは含まず、実行や検証の前後処理だけを担う（推測）。 <!-- b_6vg3h2zt -->

## 公開インターフェース <!-- b_1f8e6pz5 -->

- `score_cases` は `agent` と `cases` を受けて採点する（[bench\_local.py:58](../../../research/scripts/bench_local.py#L58)）。
- `run_part_a` と `run_part_b` はベンチマークの実行単位である（[bench\_local.py:189](../../../research/scripts/bench_local.py#L189)、[bench\_local.py:256](../../../research/scripts/bench_local.py#L256)）。
- `register` は `name` と `cases` と `gold` を `SUITES` に登録する（[bench\_apps.py:65](../../../research/scripts/bench_apps.py#L65)、[bench\_apps.py:68](../../../research/scripts/bench_apps.py#L68)）。
- `predict_golden` は `PREDICT_CASES` の期待値を作る（[gen\_fixtures.py:610](../../../laya-java/scripts/gen_fixtures.py#L610)、[gen\_fixtures.py:645](../../../laya-java/scripts/gen_fixtures.py#L645)）。
- `fetch` は `name` と `revision` と `destination` を受けて取得する（[prepare\_checkpoint.py:39](../../../laya-java/scripts/prepare_checkpoint.py#L39)）。
- `export_to_onnx` は `model_id_or_path` から `output_path` に出す（[export\_onnx.py:57](../../../scripts/export_onnx.py#L57)）。 <!-- b_d7f8akt4 -->

## 依存関係 <!-- b_p9k9bafr -->

`laya` のルーター側（`PRESETS` など）とエージェント側（`compile_model` など）、`.` の評価基盤（`load_policy` など）と道具群（`TOOLS` など）を利用する（推測）。逆に同じ `laya` や評価側からも参照される（推測）。 <!-- b_56s5xf4d -->

## データ構造 <!-- b_jgdfd5cn -->

- `MODELS` は言語名からモデル置き場への対応である（[bench\_local.py:40](../../../research/scripts/bench_local.py#L40)）。
- `SUITES` は `register` の登録先である（[bench\_apps.py:65](../../../research/scripts/bench_apps.py#L65)、[bench\_apps.py:68](../../../research/scripts/bench_apps.py#L68)）。
- `SEQUENCE_CASES` は系列生成の入力列である（[gen\_fixtures.py:251](../../../laya-java/scripts/gen_fixtures.py#L251)、[gen\_fixtures.py:331](../../../laya-java/scripts/gen_fixtures.py#L331)）。
- `PREDICT_CASES` は期待値生成の入力列である（[gen\_fixtures.py:610](../../../laya-java/scripts/gen_fixtures.py#L610)、[gen\_fixtures.py:645](../../../laya-java/scripts/gen_fixtures.py#L645)）。 <!-- b_be9r5jjp -->

## 設定 <!-- b_f2j3hqkv -->

- `LAYA_MODELS` はモデル置き場の上書きである（[bench\_local.py:39](../../../research/scripts/bench_local.py#L39)）。
- `BENCH_N` は件数の上書きである（[bench\_apps.py:47](../../../research/scripts/bench_apps.py#L47)）。
- `src` と `out` は引数で変わる入出力先である（[plot\_long\_context.py:8-9](../../../research/scripts/plot_long_context.py#L8-L9)）。 <!-- b_8mw0jzhk -->

## テスト <!-- b_akkv37fr -->

`test_onnx_graph_runs_at_any_batch` は任意バッチでの ONNX グラフ実行を確かめる（[test\_onnx.py:36](../../../tests/test_onnx.py#L36)）。`test_onnx_numerical_parity` は数値の一致を確かめる（[test\_onnx.py:76](../../../tests/test_onnx.py#L76)）。 <!-- b_39wpc6zs -->

## 落とし穴 <!-- b_5vg8vm2a -->

> [!WARNING]
> **落とし穴**
> - `WANTED` は `WANTED_LIGHT` を継ぎ足して作り、軽量側の変更が全体に及ぶ（[prepare\_checkpoint.py:34](../../../laya-java/scripts/prepare_checkpoint.py#L34)、[prepare\_checkpoint.py:36](../../../laya-java/scripts/prepare_checkpoint.py#L36)）。
> - `render` と `unverifiable` は同じ `payload` を受け、形式変更時は両方を見る（[gen\_fixtures.py:705](../../../laya-java/scripts/gen_fixtures.py#L705)、[gen\_fixtures.py:719](../../../laya-java/scripts/gen_fixtures.py#L719)）。 <!-- b_7wnkz4mx -->

> [!TIP]
> **まとめ**
> 評価と生成の周辺作業を集めた置き場である。 <!-- b_0erhmm32 -->
