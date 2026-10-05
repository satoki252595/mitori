# 判定基盤と評価群 <!-- b_z19scdvg -->

- ファイル 18 · 5854 行 · 重要度 0.79
<!-- b_mx23cwkv -->

**変更の手引き**
- 影響が及ぶ先（このモジュールを使う）: [書き出しと計測道具](laya-dotnet-tools-research-scripts.md)・[推論エージェント](laya-agent.md)・[動作例とデモサーバ](examples.md)・[ベンチマークと生成スクリプト](research-scripts-laya-java-scripts.md)・[選定と予測公開](laya-router.md)
- 使っているもの: [選定と予測公開](laya-router.md)・[書き出しと計測道具](laya-dotnet-tools-research-scripts.md)・[ベンチマークと生成スクリプト](research-scripts-laya-java-scripts.md)・[推論エージェント](laya-agent.md)
- テスト: `tests/test_evals.py`（119 件）・`research/eval/test_metamorphic.py`（41 件）・`tests/test_shortlist_cosine.py`（15 件）・`tests/test_question_token_reuse.py`（12 件） ほか 21
- 入口から: `POST /v1/systemone/batch`（`laya/serve.py:1130`）・`POST /v1/systemone`（`laya/serve.py:1044`）・`GET /health`（`laya/serve.py:978`）・`research/eval/presentation_checks.py`（`research/eval/presentation_checks.py:552`）・`laya/serve.py`（`laya/serve.py:1289`）
- よく使われる宣言（変えると波及する）: `QTYPES` `laya/common.py:18`（8 ファイル）・`render_options` `laya/common.py:107`（7 ファイル）・`build_sequence` `laya/common.py:136`（7 ファイル）・`encode_text` `laya/common.py:32`（5 ファイル）・`collate_items` `laya/common.py:780`（5 ファイル）
- 一緒に変わりやすいファイル（直近 289 commit）: `laya/agent.py` 4 回・`tests/test_onnx_batch.py` 2 回・`tests/test_serve.py` 2 回
- 注意: ハブ（多くから使われ、多くを使う）・循環依存（[推論エージェント](laya-agent.md)・[ベンチマークと生成スクリプト](research-scripts-laya-java-scripts.md)・[動作例とデモサーバ](examples.md) ほか 2 と）
<!-- b_eeyamge2 -->

> [!NOTE]
> **この章で分かること**
> - 型付き判定の共通部品と評価の全体像を掴める。
> - 主要な入口と報告書の読み方を掴める。
> - 検証手順と変異評価の役割を掴める。 <!-- b_vbqc8hjr -->

## 責務 <!-- b_m41t0h79 -->

このまとまりは `QTYPES` や `DecisionModel` といった判定の共通部品と、`Evaluator` や `evaluate` などの評価ハーネスを束ねる（[common.py:18-19](../../../laya/common.py#L18-L19)、[common.py:472-476](../../../laya/common.py#L472-L476)、[evals.py:262-267](../../../laya/evals.py#L262-L267)、[evals.py:851-854](../../../laya/evals.py#L851-L854)）。`shortlist_choice` による候補絞り込みや、`report` と `shapes_ok` による検証スクリプトもここに含まれる（[shortlist.py:29-36](../../../laya/shortlist.py#L29-L36)、[edge\_sweep.py:37-47](../../../verify/edge_sweep.py#L37-L47)）。評価コードは `laya` パッケージの依存を軽く保つため意図的に分離され、本体の推論経路には組み込まれない（[README.md:27-28](../../../research/eval/README.md#L27-L28)）。 <!-- b_yv7bw2d7 -->

## 公開インターフェース <!-- b_sqtnaxty -->

- `render_options` は質問型ごとの選択肢文面を描画する（[common.py:107-113](../../../laya/common.py#L107-L113)）。
- `build_sequence` は状態と質問からモデル入力系列を組み立てる（[common.py:136-143](../../../laya/common.py#L136-L143)）。
- `DecisionModel` は符号化器上に注意層と採点器を載せた判定モデルである（[common.py:472-495](../../../laya/common.py#L472-L495)）。
- `evaluate` は `Dataset` に対して `Evaluator` 群を回し `EvalReport` を返す（[evals.py:851-854](../../../laya/evals.py#L851-L854)）。
- `compare` は基準報告との差分を許容範囲付きで判定する（[evals.py:682-683](../../../laya/evals.py#L682-L683)）。
- `shortlist_choice` は埋め込み類似度で多肢選択を上位 `k` 件に絞る（[shortlist.py:29-36](../../../laya/shortlist.py#L29-L36)）。
- `evaluate_variants` は言い換え変異に対する予測の安定性を測る（[metamorphic.py:609-610](../../../research/eval/metamorphic.py#L609-L610)）。 <!-- b_361mpqpe -->

## 依存関係 <!-- b_ntc2vxnw -->

- 外向きには `laya` の `PRESETS` ら配送群と `compile_model` らの実行群に依存する（推測）。
- 内向きには `examples` の `agent` や研究スクリプト群の `main` らから評価のために使われる（推測）。
- 基盤には `torch` と `transformers` を用いる（推測）。 <!-- b_hy4epg3y -->

## データ構造 <!-- b_7xwfze8k -->

- `Example` は `state` と `questions` と `expected` に `tags` や `language` と `model` を添えた 1 件分の入力である（[evals.py:70-78](../../../laya/evals.py#L70-L78)）。
- `Dataset` は `Example` 列を束ね、`from_jsonl` で読み込む（[evals.py:103-113](../../../laya/evals.py#L103-L113)）。
- `EvalReport` は `config` と `overall` と `slices` と `cases` から成る集計結果である（[evals.py:625-631](../../../laya/evals.py#L625-L631)）。
- `MetamorphicCase` は `state` と `questions` に `gold_index` を添えた変異評価の基線事例である（[metamorphic.py:20-25](../../../research/eval/metamorphic.py#L20-L25)）。
- `MetamorphicVariant` は `kind` と `case` と対応表で変形を表す（[metamorphic.py:51-56](../../../research/eval/metamorphic.py#L51-L56)）。 <!-- b_sb8zj8ge -->

## 処理の流れ <!-- b_p5rj8f4f -->

1. `Dataset` の `from_jsonl` で評価事例を読み込む（[evals.py:112-113](../../../laya/evals.py#L112-L113)）。
2. `evaluate` が `predict` 系を呼び出して回答を集める（[evals.py:851-854](../../../laya/evals.py#L851-L854)、[evals\_cli.py:30-31](../../../laya/evals_cli.py#L30-L31)）。
3. `Evaluator` の `score` 群が回答と期待値を採点する（[evals.py:262-274](../../../laya/evals.py#L262-L274)）。
4. `_aggregate` が事例別得点を集約し `EvalReport` を作る（[evals.py:756](../../../laya/evals.py#L756)、[evals.py:625-628](../../../laya/evals.py#L625-L628)）。
5. `compare` や `assert_regression` で基準との後退を判定する（[evals.py:682-683](../../../laya/evals.py#L682-L683)、[evals.py:1071-1072](../../../laya/evals.py#L1071-L1072)）。 <!-- b_z2pndrbn -->

## 設定 <!-- b_vhrhn1br -->

- `--model` は評価対象のチェックポイント指定である（[presentation\_checks.py:441-442](../../../research/eval/presentation_checks.py#L441-L442)）。
- `--lang` と `--langs` は対象言語の絞り込みである（[presentation\_checks.py:451-453](../../../research/eval/presentation_checks.py#L451-L453)、[README.md:37-38](../../../research/eval/README.md#L37-L38)）。
- `--out` は `JSON` 報告の出力先である（[presentation\_checks.py:450](../../../research/eval/presentation_checks.py#L450)）。 <!-- b_ebkf5zvz -->

## テスト <!-- b_dyws0rcq -->

- `test_mapping_and_unchanged_inputs` と `test_rename_labels_preserves_order_and_descriptions` は変異の写像とラベル順序の保持を確かめる（[test\_metamorphic.py:27](../../../research/eval/test_metamorphic.py#L27)、[test\_metamorphic.py:42](../../../research/eval/test_metamorphic.py#L42)）。
- `test_new_export_removes_inherited_buckets_and_uses_fitted_types` と `test_missing_bucket_falls_back_to_corresponding_type` は温度校正バケットの継承と欠落時の退避を確かめる（[test\_calibration\_persistence.py:146](../../../tests/test_calibration_persistence.py#L146)、[test\_calibration\_persistence.py:191](../../../tests/test_calibration_persistence.py#L191)）。
- `test_single_option_question_does_not_crash` と `test_multi_option_question_is_unaffected` は単一選択肢の異常回避と複数選択肢への無影響を確かめる（[test\_decision\_model.py:41](../../../tests/test_decision_model.py#L41)、[test\_decision\_model.py:82](../../../tests/test_decision_model.py#L82)）。 <!-- b_vjwq6en8 -->

## 不変条件 <!-- b_0wz14hbd -->

- `QTYPES` は `choice` を 0、`score` を 1、`noul` を 2 に固定する（[common.py:18-19](../../../laya/common.py#L18-L19)）。
- `render_options` は `noul` 以外で `labels` を受け付けない（[common.py:107-111](../../../laya/common.py#L107-L111)）。
- `clamp_temperature` は温度を `TEMP_MIN` から `TEMP_MAX` に収める（[common.py:711-715](../../../laya/common.py#L711-L715)）。
- `_canonical` は `sort_keys` を使わず選択肢順序を保持する（[evals.py:130-136](../../../laya/evals.py#L130-L136)）。 <!-- b_d3ny0pjk -->

## エラー処理 <!-- b_sr9vq47s -->

- `Example` の `from_dict` と `Dataset` の `from_jsonl` は不正行を `EvalError` で拒む（[evals.py:65-81](../../../laya/evals.py#L65-L81)、[evals.py:112-113](../../../laya/evals.py#L112-L113)）。
- `evaluate` は `on_error` に既定の継続方針を持ち、失敗時の振る舞いを呼び出し側に委ねる（[evals.py:851-853](../../../laya/evals.py#L851-L853)）。
- `main` は未知の検査名や言語指定誤りを終了符号 2 で返す（[presentation\_checks.py:437-438](../../../research/eval/presentation_checks.py#L437-L438)、[presentation\_checks.py:460-468](../../../research/eval/presentation_checks.py#L460-L468)）。 <!-- b_jz2jk1zh -->

## 並行性 <!-- b_c5s4pcsj -->

質問文の符号化再利用は `_TOKENIZE_LOCK` と `_QUESTION_TOKEN_CACHE` で排他と隔離を行う（[common.py:28-29](../../../laya/common.py#L28-L29)）。 <!-- b_k9vqwa7j -->

## 性能 <!-- b_4jvs5gt0 -->

`_reuse_question_tokens` と `_QUESTION_TOKEN_CACHE` は質問の符号化を再利用して費用を抑える（[common.py:28-29](../../../laya/common.py#L28-L29)、[common.py:38](../../../laya/common.py#L38)）。`cached_embed_fn` は上限付きで埋め込みを保持して絞り込みを速める（[shortlist.py:183-186](../../../laya/shortlist.py#L183-L186)）。`window_budget` と `window_batch_cap` は窓数と一括量を抑えて膨張を防ぐ（[common.py:272-273](../../../laya/common.py#L272-L273)、[common.py:360-361](../../../laya/common.py#L360-L361)）。 <!-- b_kbc1hpp3 -->

## 落とし穴 <!-- b_zz67vyy1 -->

> [!WARNING]
> **落とし穴**
> - `render_options` の表示整形は `crit` の順序と対の列挙処理に依存する（[common.py:107-122](../../../laya/common.py#L107-L122)）。
> - `DecisionModel` の `no_init` 生成は乱数生成器を進めないよう `meta` 装置に依存する（[common.py:472-476](../../../laya/common.py#L472-L476)、[common.py:480-487](../../../laya/common.py#L480-L487)）。
> - `_canonical` の順序保持は `_question_schema` の扱いと対で変える（[evals.py:130-136](../../../laya/evals.py#L130-L136)）。 <!-- b_aanpc07e -->

## 深掘り <!-- b_navxfasp -->

> [!NOTE]
> **深掘り**
> - 言語別温度の適合と欠落時の退避順序の詳細。 <!-- b_vc69pgny -->

> [!TIP]
> **まとめ**
> 共通部品で判定を組み立て、評価ハーネスで言語別に測るまとまりである。 <!-- b_9efw9bec -->
