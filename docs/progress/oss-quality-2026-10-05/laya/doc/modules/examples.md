# 動作例とデモサーバ（examples） <!-- b_vrcfvdgz -->

- ファイル 31 · 5987 行 · 重要度 0.10
<!-- b_27sb0qe6 -->

**変更の手引き**
- 影響が及ぶ先（このモジュールを使う）: [選定と予測公開](laya-router.md)
- 使っているもの: [選定と予測公開](laya-router.md)・[判定基盤と評価群](laya-research-eval-notebooks.md)
- テスト: 見つかりませんでした
- 一緒に変わりやすいファイル（直近 289 commit）: `tests/test_example_server_limits.py` 5 回・`laya/serve.py` 3 回・`tests/test_serve.py` 3 回
- 注意: 大きいファイル `examples/server.py`（3,835 行）・テストが無い・循環依存（[推論エージェント](laya-agent.md)・[ベンチマークと生成スクリプト](research-scripts-laya-java-scripts.md)・[判定基盤と評価群](laya-research-eval-notebooks.md) ほか 2 と）
<!-- b_azxc14k2 -->

**大きなファイルの中身（1,500 行を超えるファイル）**
- `examples/server.py`（3,835 行）
  - `examples/server.py:64-96` 定数・変数（11）: `MAX_QUESTIONS`・`MAX_STATE_CHARS`・`MAX_CHOICE_OPTIONS`・`MAX_SCORE_LEVELS`
  - `examples/server.py:99-111` 関数: `_fallback_state_length`
  - `examples/server.py:120-150` 定数・変数（5）: `_state_length`・`_log`・`MODELS`・`normalise_name`
  - `examples/server.py:153-201` 関数（6）: `_model_names`・`_check_model`・`_fallback_batch_chunk_size`・`_batch_chunk_size`
  - `examples/server.py:204-246` 関数（4）: `_fallback_refuse_body_refusals`・`_fallback_validate_budget_param`・`_fallback_validate_language_param`・`_fallback_validate_min_confidence`
  - `examples/server.py:249-256` 定数・変数（4）: `_refuse_body_refusals`・`_validate_budget_param`・`_validate_language_param`・`_validate_min_confidence`
  - `examples/server.py:259-406` 関数（4）: `_per_call_controls`・`Question`・`PredictRequest`・`BatchRequest`
  - `examples/server.py:413-448` 関数（5）: `_router_kwargs`・`lifespan`・`app`・`ROUTER`
  - `examples/server.py:451-670` 関数（12）: `_wants_html`・`_router`・`_predict`・`_questions`
  - `examples/server.py:677-1115` 定数・変数（10）: `_LIGHT`・`_DARK`・`_CSS`・`_THEME_JS`
  - `examples/server.py:1118-1214` 関数（11）: `_icon`・`_topbar`・`_crumb`・`_html`
  - `examples/server.py:1217-1222` 定数・変数（2）: `_CERTAINTY_TIP`・`_UNSURE`
  - `examples/server.py:1225-1316` 関数（2）: `_answer_row`・`_strip`
  - `examples/server.py:1319-1392` 定数・変数（3）: `_EXAMPLE_STATE`・`_EXAMPLE_QUESTIONS`・`_PRESET_BUILDERS`
  - `examples/server.py:1395-1399` 関数: `_build_presets`
  - `examples/server.py:1402-1681` 定数・変数（3）: `PRESETS`・`_PRESETS_JSON`・`_PLAYGROUND_CSS`
  - `examples/server.py:1684-3394` _PLAYGROUND_JS（定数）
    - `examples/server.py:2052-2079` boot data and state
    - `examples/server.py:2080-2116` state: fields &lt;-> JSON
    - `examples/server.py:2117-2347` questions: form &lt;-> JSON
    - `examples/server.py:2348-2359` auto-growing textareas (CSS field-sizing where supported)
    - `examples/server.py:2360-2548` modes
    - `examples/server.py:2549-2620` refresh after every edit
    - `examples/server.py:2621-2741` popovers & toasts
    - `examples/server.py:2742-2836` loading requests: presets, drafts, share links
    - `examples/server.py:2837-2911` running
    - `examples/server.py:2912-3202` the response pane
    - `examples/server.py:3203-3268` layout: side by side or stacked, with draggable dividers
    - `examples/server.py:3269-3393` wiring
  - `examples/server.py:3397-3517` 関数（4）: `_script_json`・`_mode_seg`・`_sec_head`・`index`
  - `examples/server.py:3520-3539` 定数・変数（2）: `_HOST`・`_MODEL_DOC`
  - `examples/server.py:3542-3595` 関数（2）: `_snippet`・`_models_page`
  - `examples/server.py:3598-3608` 定数・変数: `_ENDPOINTS`
  - `examples/server.py:3611-3654` 関数（2）: `_health_page`・`gui_form`
  - `examples/server.py:3657-3658` 定数・変数（2）: `_UNION_BRANCH`・`_VALID`
  - `examples/server.py:3661-3831` 関数（6）: `_union_branch`・`_error_lines`・`_gui_error`・`gui_predict`
<!-- b_hk3vjvfr -->

> [!NOTE]
> **この章で分かること**
> - この例題群で何を試せるかを把握する。
> - デモ API の入力形状と応答の流れを理解する。
> - 本番実装との対応関係をつかむ。 <!-- b_mz5e34yj -->

## 責務 <!-- b_4ck8myrm -->

このモジュールは `Router` と `agent.predict` の使い方を示す動作例の集まりである（[server.py:413-414](../../../examples/server.py#L413-L414)、[01\_first\_call\_minimal.py:27](../../../examples/01_first_call_minimal.py#L27)）。`main` は引数で受けた設定でデモ API サーバを起動する（[server.py:3794-3798](../../../examples/server.py#L3794-L3798)）。検証は `laya.serve` の判定を模倣するが、本番実装を置き換えるものではない（[server.py:343-348](../../../examples/server.py#L343-L348)）。 <!-- b_5raz1xm1 -->

## 公開インターフェース <!-- b_xbdmzawz -->

- `health` は /health で起動状態と設定を返す（[server.py:481-490](../../../examples/server.py#L481-L490)）。
- `models` は /models に対応する取得口である（[server.py:493-494](../../../examples/server.py#L493-L494)）。
- `qtypes` は /qtypes に対応する取得口である（[server.py:506-507](../../../examples/server.py#L506-L507)）。
- `presets` は /presets に対応する取得口である（[server.py:511-512](../../../examples/server.py#L511-L512)）。
- `predict` は /predict で単一入力の回答を返す（[server.py:596-604](../../../examples/server.py#L596-L604)）。
- `predict_batch` は /predict/batch で複数入力の回答を返す（[server.py:616-620](../../../examples/server.py#L616-L620)、[server.py:670](../../../examples/server.py#L670)）。
- `index` は / に対応する表示口である（[server.py:3420-3421](../../../examples/server.py#L3420-L3421)）。
- `gui_form` と `gui_predict` は /gui の表示と送信に対応する（[server.py:3651-3652](../../../examples/server.py#L3651-L3652)、[server.py:3715-3716](../../../examples/server.py#L3715-L3716)）。 <!-- b_6qxn1hpf -->

## 依存関係 <!-- b_fdft46ec -->

- laya ディレクトリの serve 系から `MAX_QUESTIONS` や `_state_length` を取り込む（[server.py:64-65](../../../examples/server.py#L64-L65)、[server.py:120](../../../examples/server.py#L120)）。
- `normalise_name` と `DEFAULT_MODELS` を laya ディレクトリの router 系から取り込む（[server.py:132](../../../examples/server.py#L132)、[server.py:139](../../../examples/server.py#L139)）。
- リポジトリ直下の評価群への依存と逆方向の参照は補助的である（推測）。 <!-- b_yafnhfwc -->

## データ構造 <!-- b_dhscyfw3 -->

- `Question` は `type` と `instructions` と `criteria` を持つ（[server.py:276](../../../examples/server.py#L276)、[server.py:279-283](../../../examples/server.py#L279-L283)）。
- `PredictRequest` は `state` と `questions` を必須とし `model` や `lang` を任意に持つ（[server.py:308-310](../../../examples/server.py#L308-L310)、[server.py:312-313](../../../examples/server.py#L312-L313)、[server.py:318-319](../../../examples/server.py#L318-L319)）。
- `BatchRequest` は `states` と単一の `questions` を持つ（[server.py:367-369](../../../examples/server.py#L367-L369)）。
- `BatchRequest` は `batch_size` と `sort_by_length` で実行形状を決める（[server.py:367](../../../examples/server.py#L367)、[server.py:382-388](../../../examples/server.py#L382-L388)）。 <!-- b_ec1sqh78 -->

## 処理の流れ <!-- b_1y4hq9gb -->

1. `predict` は `_check_request_limits` で制限を確認する（[server.py:596-598](../../../examples/server.py#L596-L598)）。
2. `predict` は `_questions` と `_per_call_controls` で入力を整えて `_predict` を呼ぶ（[server.py:597-603](../../../examples/server.py#L597-L603)）。
3. `predict_batch` は `_check_request_limits` の後に `requests` を作る（[server.py:616-628](../../../examples/server.py#L616-L628)）。
4. `predict_batch` は一括呼び出しを試み、失敗時は `_predict` で 1 件ずつ返す（[server.py:616-617](../../../examples/server.py#L616-L617)、[server.py:646-663](../../../examples/server.py#L646-L663)）。 <!-- b_xhb3p3gv -->

## エラー処理 <!-- b_f3chdfbn -->

- `predict` は `KeyError` や `ValueError` を 422 に変える（[server.py:597-608](../../../examples/server.py#L597-L608)）。
- 想定外の例外は 500 の固定文言で返し、詳細はログに残す（[server.py:609-613](../../../examples/server.py#L609-L613)）。
- `predict_batch` は一括失敗時に `_predict` で再試行し `error` 入りの要素を返す（[server.py:616-617](../../../examples/server.py#L616-L617)、[server.py:651-669](../../../examples/server.py#L651-L669)）。 <!-- b_atmym14a -->

## 落とし穴 <!-- b_gwa9xhrd -->

> [!WARNING]
> **落とし穴**
> - 上限や検証器は `_laya_serve` からの `getattr` で取得し、欠ければ代替実装に落ちるため、両方を同時に変える必要がある（[server.py:188](../../../examples/server.py#L188)、[server.py:201](../../../examples/server.py#L201)）。
> - `min_confidence` は単発では制御に、バッチでは形状に分離されるため、置き場所を間違えると転送から落ちる（[server.py:623-627](../../../examples/server.py#L623-L627)、[server.py:644-645](../../../examples/server.py#L644-L645)）。
> - `--reload` では `_CFG` の更新が再取り込みに届かず、環境変数経由で引き継ぐ（[server.py:3803-3818](../../../examples/server.py#L3803-L3818)）。 <!-- b_66kfmr97 -->

> [!TIP]
> **まとめ**
> 例題から入り、デモ API で操作を確かめると理解が早い。 <!-- b_hcsczfrq -->
