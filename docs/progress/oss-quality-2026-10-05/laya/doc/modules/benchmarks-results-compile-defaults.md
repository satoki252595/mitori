# 測定証跡と起動準備 <!-- b_xgvae2j1 -->

- ファイル 54 · 2337 行 · 重要度 0.22
<!-- b_yjd08sk8 -->

**変更の手引き**
- テスト: `research/benchmarks/zh_short_commands/tests/test_benchmark.py`（25 件）・`research/benchmarks/es_phone_turns/tests/test_es_phone_turns.py`（16 件）・`research/benchmarks/es_phone_turns/audit.py`・`research/benchmarks/es_phone_turns/baseline_llm.py` ほか 12
- 入口から: `docker/check_torch.py`（`docker/check_torch.py:88`）・`docker/entrypoint.py`（`docker/entrypoint.py:46`）・`docker/prefetch_modelscope.py`（`docker/prefetch_modelscope.py:307`）・`research/evals/act_head_eval.py`（`research/evals/act_head_eval.py:316`）
- 一緒に変わりやすいファイル（直近 289 commit）: `benchmarks/bench_compile_defaults.py` 3 回・`laya/agent.py` 3 回・`tests/test_compile.py` 3 回・`tests/test_hooks_api.py` 3 回・`laya/_compile.py` 2 回
<!-- b_5ekaek3w -->

> [!NOTE]
> **この章で分かること**
> - 測定証跡の読み方とタイミング解釈の注意点を学ぶ。
> - Docker 側の準備作業の全体像をつかむ。
> - 追加評価の入力と出力の形を理解する。 <!-- b_sg89h6c2 -->

## 責務 <!-- b_yq29t97c -->

このモジュールは compile 既定値の測定証跡を残す置き場である（[README.md:1](../../../benchmarks/results/compile-defaults/README.md#L1)、[README.md:12-18](../../../benchmarks/results/compile-defaults/README.md#L12-L18)）。あわせて `prefetch` による事前取得と `main` による評価集計を入口として持つ（[prefetch\_modelscope.py:240](../../../docker/prefetch_modelscope.py#L240)、[prefetch\_modelscope.py:282-304](../../../docker/prefetch_modelscope.py#L282-L304)、[act\_head\_eval.py:286-297](../../../research/evals/act_head_eval.py#L286-L297)）。推論やコンパイルの本体は実装せず、判定処理自体は持たない（推測）。 <!-- b_yg52tn5h -->

## 公開インターフェース <!-- b_b1cen1dz -->

- 取得側の `main` は ModelScope のチェックポイントを hub キャッシュに焼き込む（[prefetch\_modelscope.py:282-304](../../../docker/prefetch_modelscope.py#L282-L304)）。
- `prefetch` は呼び出し元から渡された取得対象の一覧を受け持つ（[prefetch\_modelscope.py:240](../../../docker/prefetch_modelscope.py#L240)、[prefetch\_modelscope.py:295-301](../../../docker/prefetch_modelscope.py#L295-L301)）。
- `expand_model` と `split_spec` と `cache_root` はモデル指定の展開と保存先の解決に使う（[prefetch\_modelscope.py:69](../../../docker/prefetch_modelscope.py#L69)、[prefetch\_modelscope.py:101](../../../docker/prefetch_modelscope.py#L101)、[prefetch\_modelscope.py:107](../../../docker/prefetch_modelscope.py#L107)、[prefetch\_modelscope.py:292-293](../../../docker/prefetch_modelscope.py#L292-L293)）。
- 評価側の `main` は `laya-evals` のレポートを読み、集計結果を返す（[act\_head\_eval.py:286-297](../../../research/evals/act_head_eval.py#L286-L297)）。
- `report_from_document` と `analyse_cases` と `roc_auc` は act 確率と正解ラベルの照合に使う（[act\_head\_eval.py:223](../../../research/evals/act_head_eval.py#L223)、[act\_head\_eval.py:152](../../../research/evals/act_head_eval.py#L152)、[act\_head\_eval.py:102](../../../research/evals/act_head_eval.py#L102)、[act\_head\_eval.py:286-290](../../../research/evals/act_head_eval.py#L286-L290)）。
- `format_markdown` は人向け要約の整形に使い、`_fmt` が数値表示を担う（[act\_head\_eval.py:243](../../../research/evals/act_head_eval.py#L243)、[act\_head\_eval.py:282](../../../research/evals/act_head_eval.py#L282)、[act\_head\_eval.py:306-312](../../../research/evals/act_head_eval.py#L306-L312)）。
- `repair_cusparselt` と起動側の `main` は検査と秘密情報の受け渡しを担う（[check\_torch.py:23](../../../docker/check_torch.py#L23)、[check\_torch.py:51-54](../../../docker/check_torch.py#L51-L54)、[entrypoint.py:10-13](../../../docker/entrypoint.py#L10-L13)）。 <!-- b_n01g3h33 -->

## 設定 <!-- b_5n41atkk -->

- `--model` は取得するチェックポイント種別または保存元指定である（[prefetch\_modelscope.py:284-286](../../../docker/prefetch_modelscope.py#L284-L286)）。
- `--revision` と `--cache-dir` は版と保存先を決める（[prefetch\_modelscope.py:287-290](../../../docker/prefetch_modelscope.py#L287-L290)）。
- `HF_HUB_CACHE` と `HF_HOME` は既定の保存先解決に使う（[prefetch\_modelscope.py:289-290](../../../docker/prefetch_modelscope.py#L289-L290)、[prefetch\_modelscope.py:111](../../../docker/prefetch_modelscope.py#L111)、[prefetch\_modelscope.py:114](../../../docker/prefetch_modelscope.py#L114)）。
- `report` と `--json` と `--markdown` は評価入力と出力先を指定する（[act\_head\_eval.py:290-292](../../../research/evals/act_head_eval.py#L290-L292)）。 <!-- b_qzqfcwgy -->

## テスト <!-- b_6bedk5th -->

- `test_answering_keep_talking_by_mistake_is_not_a_wrong_action` と `test_acting_when_it_should_not_is_a_wrong_action` と `test_the_gate_only_lets_actions_through` は誤動作判定とゲート通過を確かめる（[test\_es\_phone\_turns.py:29](../../../research/benchmarks/es_phone_turns/tests/test_es_phone_turns.py#L29)、[test\_es\_phone\_turns.py:34](../../../research/benchmarks/es_phone_turns/tests/test_es_phone_turns.py#L34)、[test\_es\_phone\_turns.py:39](../../../research/benchmarks/es_phone_turns/tests/test_es_phone_turns.py#L39)）。
- `test_borderline_cases_stay_out_of_the_headline` と `test_every_rung_asks_the_same_question_with_the_same_options` と `test_every_case_has_a_label_of_its_menu` は境界事例の除外と質問の同一性を確かめる（[test\_es\_phone\_turns.py:49](../../../research/benchmarks/es_phone_turns/tests/test_es_phone_turns.py#L49)、[test\_es\_phone\_turns.py:59](../../../research/benchmarks/es_phone_turns/tests/test_es_phone_turns.py#L59)、[test\_es\_phone\_turns.py:66](../../../research/benchmarks/es_phone_turns/tests/test_es_phone_turns.py#L66)）。
- `test_cases_parse_and_are_unique` と `test_choice_options_are_the_label_policy` と `test_noul_criteria_use_the_two_documented_keys` は事例の形式と方策の整合を確かめる（[test\_benchmark.py:46](../../../research/benchmarks/zh_short_commands/tests/test_benchmark.py#L46)、[test\_benchmark.py:63](../../../research/benchmarks/zh_short_commands/tests/test_benchmark.py#L63)、[test\_benchmark.py:71](../../../research/benchmarks/zh_short_commands/tests/test_benchmark.py#L71)）。 <!-- b_hk57ba3w -->

## 性能 <!-- b_mee28d3h -->

各 `.log` は 30 件の要求タイミングとキャッシュカウンターやメモリー、`nvidia-smi` のスナップショットを含む（[README.md:12-14](../../../benchmarks/results/compile-defaults/README.md#L12-L14)）。cold 実験は新規ディレクトリーで始め、restart は同ディレクトリーを別プロセスで使う（[README.md:14-16](../../../benchmarks/results/compile-defaults/README.md#L14-L16)）。混雑したタイミングは観測値であり、再利用の判定は FX カウンターで行う（[README.md:20-24](../../../benchmarks/results/compile-defaults/README.md#L20-L24)）。 <!-- b_n0qesg42 -->

## 落とし穴 <!-- b_m44w1emd -->

> [!WARNING]
> **落とし穴**
> - `json.dump` の `allow_nan` が `False` のため、非有限値が混ざると出力時に失敗する（[act\_head\_eval.py:301-304](../../../research/evals/act_head_eval.py#L301-L304)）。
> - 共有 GPU 上のタイミングは観測値であり、単独の高速化率とは読めない（[README.md:20-23](../../../benchmarks/results/compile-defaults/README.md#L20-L23)）。 <!-- b_h84xjm3z -->

> [!TIP]
> **まとめ**
> 測定証跡の読み方と準備の入口を押さえれば、この集まりは足りる。 <!-- b_pmafbcny -->
