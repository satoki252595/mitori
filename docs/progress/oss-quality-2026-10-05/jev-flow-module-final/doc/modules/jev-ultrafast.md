# 観測選択実行本体（jev_ultrafast） <!-- b_ae9dae4d -->

- ファイル 7 · 769 行 · 重要度 1.00
<!-- b_jhrx5jvs -->

**変更の手引き**
- 影響が及ぶ先（このモジュールを使う）: [検証用脚本集](scripts.md)
- テスト: `tests/test_agent.py`（19 件）
- 入口から: `command`（`jev_ultrafast/demo.py:44`）・`Handler.do_POST`（`jev_ultrafast/demo.py:104`）・`Handler.do_GET`（`jev_ultrafast/demo.py:81`）・`response_state`（`jev_ultrafast/demo.py:32`）・`jev_ultrafast/demo.py`（`jev_ultrafast/demo.py:144`）
- よく使われる宣言（変えると波及する）: `Agent` `jev_ultrafast/agent.py:12`（2 ファイル）・`Browser` `jev_ultrafast/browser.py:20`（2 ファイル）・`MAX_STEPS` `jev_ultrafast/questions.py:26`（2 ファイル）
- 一緒に変わりやすいファイル（直近 3 commit）: `docs/flights-measurement.json` 2 回・`scripts/measure_flights.py` 2 回・`scripts/record_flights.py` 2 回・`scripts/render_demo.py` 2 回
<!-- b_fsb8w5gx -->

> [!NOTE]
> **この章で分かること**
> - 本体の役割と境界が分かる
> - 公開 API と設定と検証点が分かる
> - 失敗と上限と落とし穴が分かる <!-- b_1fhd79ea -->

## 責務 <!-- b_4hsj2wa2 -->

`Agent` が観測と選択と実行の循環を受け持つ（[agent.py:1](../../../jev_ultrafast/agent.py#L1)、[agent.py:12-13](../../../jev_ultrafast/agent.py#L12-L13)）。選択は観測済みの操作と要素に限り、実行自体はコードが所有する（[\_\_init\_\_.py:1](../../../jev_ultrafast/__init__.py#L1)）。小さな LLM は `TYPE_TEXT` のときだけ文面を書く（[README.md:11](../../../README.md#L11)）。 <!-- b_kvvegkrp -->

## 公開インターフェース <!-- b_x1n730nq -->

- `Agent` は起点の `url` と `goals` で循環を進める（[agent.py:12-13](../../../jev_ultrafast/agent.py#L12-L13)、[agent.py:163](../../../jev_ultrafast/agent.py#L163)）。
- `Browser` は観測と操作の実行を受け持つ（[browser.py:20-21](../../../jev_ultrafast/browser.py#L20-L21)、[browser.py:44](../../../jev_ultrafast/browser.py#L44)、[browser.py:100](../../../jev_ultrafast/browser.py#L100)）。
- `StalePage` は頁ずれを知らせる例外である（[browser.py:16-17](../../../jev_ultrafast/browser.py#L16-L17)）。
- `choose` は `state` と `goal` と `history` から次手を選ぶ（[model.py:81](../../../jev_ultrafast/model.py#L81)）。
- `action_space` は要素ごとの対象選択肢を作る（[model.py:48-49](../../../jev_ultrafast/model.py#L48-L49)）。 <!-- b_40hx7mn7 -->

## 依存関係 <!-- b_g965yxva -->

`scripts` は `URL` と `GOALS` と `verify` を持ち、本体に依存する（推測）。本体は外部の `browser_harness` と `httpx` にだけ依存する（推測）。 <!-- b_fc3v2hsz -->

## 設定 <!-- b_v3c2dzw3 -->

- `TYPESAFE_DEMO_PORT` は検査器の待受ポートを決める（[demo.py:16](../../../jev_ultrafast/demo.py#L16)）。
- `TEXT_MODEL` は文面生成のモデル名を指定する（[demo.py:34](../../../jev_ultrafast/demo.py#L34)）。
- `TYPESAFE_MODEL` と `TYPESAFE_API_KEY` は選択器の設定である（[model.py:108](../../../jev_ultrafast/model.py#L108)、[model.py:119](../../../jev_ultrafast/model.py#L119)）。 <!-- b_vr3n2258 -->

## テスト <!-- b_cta6x86h -->

`test_invalid_choice_is_rejected` は無効選択の拒否を確かめる（[test\_agent.py:49](../../../tests/test_agent.py#L49)）。`test_one_index_per_node_with_operation_specific_targets` と `test_click_cannot_consume_a_text_target` は操作別の分離を確かめる（[test\_agent.py:67](../../../tests/test_agent.py#L67)、[test\_agent.py:99](../../../tests/test_agent.py#L99)）。`test_all_heads_are_one_request_and_only_matching_head_executes` は単一リクエストの実行を確かめる（[test\_agent.py:77](../../../tests/test_agent.py#L77)）。 <!-- b_21fh37b9 -->

## 不変条件 <!-- b_71rmfpm2 -->

- `action_space` は観測要素ごとに `index` を一つ作る（[model.py:48-49](../../../jev_ultrafast/model.py#L48-L49)）。
- 各操作は自分の対象選択肢だけを持つ（[model.py:48-49](../../../jev_ultrafast/model.py#L48-L49)）。 <!-- b_cnc50azc -->

## エラー処理 <!-- b_044mjaxc -->

`StalePage` は頁ずれを `ValueError` で知らせる（[browser.py:16-17](../../../jev_ultrafast/browser.py#L16-L17)）。`command` は不明な `scenario` や空の `goal` を `ValueError` で拒否する（[demo.py:44-52](../../../jev_ultrafast/demo.py#L44-L52)）。 <!-- b_118hss2m -->

## 並行性 <!-- b_557343x6 -->

検査器は `ThreadingHTTPServer` で受け付け、`AGENT` を共有する（[demo.py:19-20](../../../jev_ultrafast/demo.py#L19-L20)、[demo.py:134](../../../jev_ultrafast/demo.py#L134)）。`LOCK` と `atexit` と `close_browser` で終了時に後始末する（[demo.py:19](../../../jev_ultrafast/demo.py#L19)、[demo.py:133](../../../jev_ultrafast/demo.py#L133)）。 <!-- b_4fv3fv1d -->

## 性能 <!-- b_dvcb46qc -->

単一の CDP セッションを使い、`CLIENT` は `http2` を使う（[browser.py:1](../../../jev_ultrafast/browser.py#L1)、[model.py:12](../../../jev_ultrafast/model.py#L12)）。 <!-- b_wf8rj01c -->

## 落とし穴 <!-- b_ckd69bj8 -->

> [!WARNING]
> **落とし穴**
> - `fresh` と `act` は同じ `page` を共有する（[browser.py:88](../../../jev_ultrafast/browser.py#L88)、[browser.py:100](../../../jev_ultrafast/browser.py#L100)）。
> - `StalePage` は頁ずれを示す（[browser.py:16-17](../../../jev_ultrafast/browser.py#L16-L17)）。 <!-- b_3td7w57h -->

## 深掘り <!-- b_tnxex9jr -->

> [!NOTE]
> **深掘り**
> `choose` の促し文構築と履歴要約の手順 <!-- b_p99fk7jr -->

> [!TIP]
> **まとめ**
> 観測選択と実行分離の本体である。 <!-- b_h83bedx4 -->
