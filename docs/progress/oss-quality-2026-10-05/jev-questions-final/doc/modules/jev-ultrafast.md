# 観測駆動エージェント（jev_ultrafast） <!-- b_ae9dae4d -->

- ファイル 7 · 769 行 · 重要度 1.00
<!-- b_jhrx5jvs -->

**変更の手引き**
- 影響が及ぶ先（このモジュールを使う）: [検証用脚本集](scripts.md)
- テスト: `tests/test_agent.py`（19 件）
- 入口から: `jev_ultrafast/demo.py`（`jev_ultrafast/demo.py:144`）
- よく使われる宣言（変えると波及する）: `Agent` `jev_ultrafast/agent.py:12`（2 ファイル）・`Browser` `jev_ultrafast/browser.py:20`（2 ファイル）・`MAX_STEPS` `jev_ultrafast/questions.py:26`（2 ファイル）
- 一緒に変わりやすいファイル（直近 3 commit）: `docs/flights-measurement.json` 2 回・`scripts/measure_flights.py` 2 回・`scripts/record_flights.py` 2 回・`scripts/render_demo.py` 2 回
<!-- b_fsb8w5gx -->

> [!NOTE]
> **この章で分かること**
> - 本体の役割と境界が分かる
> - 公開 API と設定と検証点が分かる
> - 失敗と上限と落とし穴が分かる <!-- b_1fhd79ea -->

## 責務 <!-- b_4hsj2wa2 -->

観測肢から次の一手だけを選び、実行はコードが担う（[\_\_init\_\_.py:1](../../../jev_ultrafast/__init__.py#L1)）。`Agent` は循環を束ね、`Browser` は単一セッションで観測と操作を担う（[agent.py:1](../../../jev_ultrafast/agent.py#L1)、[agent.py:12-13](../../../jev_ultrafast/agent.py#L12-L13)、[browser.py:1](../../../jev_ultrafast/browser.py#L1)、[browser.py:20-21](../../../jev_ultrafast/browser.py#L20-L21)）。`choose` は状態から次手を選び、実行は呼び出し側に残る（[model.py:1](../../../jev_ultrafast/model.py#L1)、[model.py:81](../../../jev_ultrafast/model.py#L81)、[\_\_init\_\_.py:1](../../../jev_ultrafast/__init__.py#L1)）。逐次 `subprocess` を起こさない（[browser.py:1](../../../jev_ultrafast/browser.py#L1)）。 <!-- b_kvvegkrp -->

## 公開インターフェース <!-- b_x1n730nq -->

- `Agent` は起点の `url` と `goals` で循環を進める（[agent.py:1](../../../jev_ultrafast/agent.py#L1)、[agent.py:12-13](../../../jev_ultrafast/agent.py#L12-L13)）。
- `Browser` は `observe` と `act` で観測と実行を担う（[browser.py:20-21](../../../jev_ultrafast/browser.py#L20-L21)、[browser.py:44](../../../jev_ultrafast/browser.py#L44)、[browser.py:100](../../../jev_ultrafast/browser.py#L100)）。
- `StalePage` は頁ずれ決定の例外である（[browser.py:16-17](../../../jev_ultrafast/browser.py#L16-L17)）。
- `choose` と `action_space` と `validate_choice` は選択と生成と検証を担う（[model.py:1](../../../jev_ultrafast/model.py#L1)、[model.py:30](../../../jev_ultrafast/model.py#L30)、[model.py:48-49](../../../jev_ultrafast/model.py#L48-L49)、[model.py:81](../../../jev_ultrafast/model.py#L81)）。
- `field_context` と `field_text` は入力文脈と文字列を作る（[model.py:1](../../../jev_ultrafast/model.py#L1)、[model.py:151](../../../jev_ultrafast/model.py#L151)、[model.py:160](../../../jev_ultrafast/model.py#L160)）。
- `command` と `Handler` は検査器の操作口である（[demo.py:1](../../../jev_ultrafast/demo.py#L1)、[demo.py:44](../../../jev_ultrafast/demo.py#L44)、[demo.py:70-71](../../../jev_ultrafast/demo.py#L70-L71)）。 <!-- b_40hx7mn7 -->

## 依存関係 <!-- b_g965yxva -->

- `scripts` が `URL` と `GOALS` と `verify` で使う（推測）。
- 外側は `httpx` 要求と CDP 観測に頼る（[model.py:12](../../../jev_ultrafast/model.py#L12)、[browser.py:1](../../../jev_ultrafast/browser.py#L1)）。 <!-- b_fc3v2hsz -->

## 設定 <!-- b_v3c2dzw3 -->

- 検査器は `TYPESAFE_DEMO_PORT` と `TEXT_MODEL` を読む（[demo.py:1](../../../jev_ultrafast/demo.py#L1)、[demo.py:16](../../../jev_ultrafast/demo.py#L16)、[demo.py:34](../../../jev_ultrafast/demo.py#L34)）。
- 選択は `TYPESAFE_MODEL` と `TYPESAFE_API_KEY` を読む（[model.py:1](../../../jev_ultrafast/model.py#L1)、[model.py:108](../../../jev_ultrafast/model.py#L108)、[model.py:119](../../../jev_ultrafast/model.py#L119)）。
- 入力文は `TEXT_MODEL_API_KEY` 等 3 変数を読む（[model.py:1](../../../jev_ultrafast/model.py#L1)、[model.py:161](../../../jev_ultrafast/model.py#L161)、[model.py:164](../../../jev_ultrafast/model.py#L164)、[model.py:167](../../../jev_ultrafast/model.py#L167)）。 <!-- b_vr3n2258 -->

## テスト <!-- b_cta6x86h -->

- 無効拒否と操作別分離を確かめる（[test\_agent.py:49](../../../tests/test_agent.py#L49)、[test\_agent.py:67](../../../tests/test_agent.py#L67)）。
- 単一要求と混用禁止を確かめる（[test\_agent.py:77](../../../tests/test_agent.py#L77)、[test\_agent.py:99](../../../tests/test_agent.py#L99)）。
- 状態受け渡しと LLM 経由を確かめる（[test\_agent.py:116](../../../tests/test_agent.py#L116)、[test\_agent.py:143](../../../tests/test_agent.py#L143)）。 <!-- b_21fh37b9 -->

## 不変条件 <!-- b_71rmfpm2 -->

- `action_space` は要素ごと一つで操作別に分ける（[model.py:48-49](../../../jev_ultrafast/model.py#L48-L49)）。
- 実行は `MAX_STEPS` で有界で検査器はループバックのみ（[questions.py:26](../../../jev_ultrafast/questions.py#L26)、[agent.py:1](../../../jev_ultrafast/agent.py#L1)、[demo.py:1](../../../jev_ultrafast/demo.py#L1)、[demo.py:134](../../../jev_ultrafast/demo.py#L134)）。 <!-- b_cnc50azc -->

## エラー処理 <!-- b_044mjaxc -->

- `StalePage` は頁ずれを `ValueError` で知らせる（[browser.py:16-17](../../../jev_ultrafast/browser.py#L16-L17)）。
- `command` は未開始等を `ValueError` で拒む（[demo.py:44-45](../../../jev_ultrafast/demo.py#L44-L45)、[demo.py:48-52](../../../jev_ultrafast/demo.py#L48-L52)、[demo.py:64-65](../../../jev_ultrafast/demo.py#L64-L65)）。 <!-- b_118hss2m -->

## 並行性 <!-- b_557343x6 -->

検査器は `ThreadingHTTPServer` で受け、`AGENT` を共有する（[demo.py:20](../../../jev_ultrafast/demo.py#L20)、[demo.py:134](../../../jev_ultrafast/demo.py#L134)）。`LOCK` と `AGENT` は大域で `close_browser` を登録する（[demo.py:19-20](../../../jev_ultrafast/demo.py#L19-L20)、[demo.py:133](../../../jev_ultrafast/demo.py#L133)）。 <!-- b_4fv3fv1d -->

## 性能 <!-- b_dvcb46qc -->

単一 CDP セッションを使い、`CLIENT` は `http2` を使う（[browser.py:1](../../../jev_ultrafast/browser.py#L1)、[model.py:12](../../../jev_ultrafast/model.py#L12)）。 <!-- b_wf8rj01c -->

## 落とし穴 <!-- b_ckd69bj8 -->

> [!WARNING]
> **落とし穴**
> - `fresh` と `act` は `page` を共有し `StalePage` は頁ずれを示す（[browser.py:16-17](../../../jev_ultrafast/browser.py#L16-L17)、[browser.py:88](../../../jev_ultrafast/browser.py#L88)、[browser.py:100](../../../jev_ultrafast/browser.py#L100)）。
> - `READ_STATE` は導入時に `snapshot.js` を読む（[browser.py:13-14](../../../jev_ultrafast/browser.py#L13-L14)）。 <!-- b_3td7w57h -->

## 深掘り <!-- b_tnxex9jr -->

> [!NOTE]
> **深掘り**
> - `choose` の促し文構築と履歴要約の手順 <!-- b_p99fk7jr -->

> [!TIP]
> **まとめ**
> 観測選択と実行分離の本体である。 <!-- b_h83bedx4 -->
