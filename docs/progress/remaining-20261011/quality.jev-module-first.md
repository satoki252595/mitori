# 観測に基づくブラウザ実行（jev_ultrafast） <!-- b_ae9dae4d -->

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
> - 公開 API と観測データの読み方を把握する。
> - 操作選択からブラウザ入力までの流れを追う。
> - 鮮度検証、失敗時の復帰、操作種別の結合箇所を理解する。 <!-- b_1fhd79ea -->

## 責務 <!-- b_4hsj2wa2 -->

観測済みの要素と操作から TypeSafe が次の一手を選び、実行はコードが担うブラウザエージェントである （[\_\_init\_\_.py:1](../../../jev_ultrafast/__init__.py#L1)）。小さな LLM の役割は `TYPE_TEXT` の入力文字列生成に限られる （[README.md:11](../../../README.md#L11)）。 <!-- b_kvvegkrp -->

## 公開インターフェース <!-- b_x1n730nq -->

- `Agent(url, goals, *, record_dir=None, screenshots=False)` が入口で、`command` は命令を受け取り、`snapshot` は内部の `browser` を除いた状態と要素一覧を返す （[agent.py:12-13](../../../jev_ultrafast/agent.py#L12-L13)、[agent.py:46-54](../../../jev_ultrafast/agent.py#L46-L54)）。
- `Browser` は URL を開き、`observe` で観測し、`act` で入力し、`close` で所有タブを閉じる API である （[browser.py:20-28](../../../jev_ultrafast/browser.py#L20-L28)、[browser.py:77-85](../../../jev_ultrafast/browser.py#L77-L85)、[browser.py:100-107](../../../jev_ultrafast/browser.py#L100-L107)、[browser.py:109-112](../../../jev_ultrafast/browser.py#L109-L112)）。 <!-- b_40hx7mn7 -->

## 依存関係 <!-- b_g965yxva -->

ブラウザ側は Browser Harness、モデル側は `httpx` を使う （[browser.py:1](../../../jev_ultrafast/browser.py#L1)、[model.py:12](../../../jev_ultrafast/model.py#L12)）。`scripts` はこの本体を利用する側である （推測）。 <!-- b_fc3v2hsz -->

## データ構造 <!-- b_sz0bxvkk -->

- 観測結果には URL、タイトル、可視テキスト、スクロール位置、`actions`、鮮度比較用の `marker`・`page_key`・`guards` が含まれ、要素アクションは `node`、`role`、`label`、`rect` と操作の `kind` を持つ （[snapshot.js:61-62](../../../jev_ultrafast/snapshot.js#L61-L62)、[snapshot.js:68-79](../../../jev_ultrafast/snapshot.js#L68-L79)、[snapshot.js:92-106](../../../jev_ultrafast/snapshot.js#L92-L106)）。 <!-- b_66rvqapx -->

## 処理の流れ <!-- b_rm26bqmc -->

1. `predict` は古い観測を更新してから `choose` を呼ぶ （[agent.py:65-77](../../../jev_ultrafast/agent.py#L65-L77)）。
2. `choose` は操作の回答を検証し、その操作に対応する対象の回答だけを検証・採用する （[model.py:119-130](../../../jev_ultrafast/model.py#L119-L130)）。
3. `fill` なら入力文を生成し、`Browser.act` が入力直前にもう一度鮮度を検証する （[agent.py:106-116](../../../jev_ultrafast/agent.py#L106-L116)、[browser.py:100-105](../../../jev_ultrafast/browser.py#L100-L105)）。 <!-- b_10jnttks -->

## 設定 <!-- b_v3c2dzw3 -->

- `TYPESAFE_DEMO_PORT` の既定値は `8766` で、起動時には作業ディレクトリの `.env` を既存環境変数を上書きせず読み込む （[demo.py:16](../../../jev_ultrafast/demo.py#L16)、[demo.py:23-29](../../../jev_ultrafast/demo.py#L23-L29)、[demo.py:131-132](../../../jev_ultrafast/demo.py#L131-L132)）。
- 選択側は `TYPESAFE_API_KEY` と `TYPESAFE_MODEL` を参照する （[model.py:108](../../../jev_ultrafast/model.py#L108)、[model.py:119](../../../jev_ultrafast/model.py#L119)）。
- 入力文生成には `TEXT_MODEL_API_KEY` が必須で、`TEXT_MODEL_BASE_URL` と `TEXT_MODEL` の既定値はそれぞれ `https://api.deepseek.com/v1` と `deepseek-chat` である （[model.py:161-165](../../../jev_ultrafast/model.py#L161-L165)）。
- `TEXT_MODEL_REASONING=none` は推論設定を無効化する （[model.py:167-168](../../../jev_ultrafast/model.py#L167-L168)）。 <!-- b_vr3n2258 -->

## テスト <!-- b_cta6x86h -->

- `test_all_heads_are_one_request_and_only_matching_head_executes` は、全ヘッドを1リクエストにまとめ、対応するヘッドだけを実行する点を検証する （[test\_agent.py:77](../../../tests/test_agent.py#L77)）。
- `test_click_cannot_consume_a_text_target` は、クリックが入力用の対象を利用できないことを検証する （[test\_agent.py:99](../../../tests/test_agent.py#L99)）。 <!-- b_21fh37b9 -->

## 不変条件 <!-- b_71rmfpm2 -->

- `action_space` は同じ `node` に1つのインデックスを割り当て、操作別の対象集合を作る （[model.py:50-78](../../../jev_ultrafast/model.py#L50-L78)）。
- `validate_choice` は候補との一致、有限な確率・信頼度の範囲、確率合計の許容誤差、選択肢が最大確率であることを要求する （[model.py:30-44](../../../jev_ultrafast/model.py#L30-L44)）。 <!-- b_cnc50azc -->

## エラー処理 <!-- b_044mjaxc -->

`StalePage` は観測と判断のずれを示す `ValueError` で、`tick` はこれを捕捉すると判断を破棄し、再観測して状態を `ready` に戻す （[browser.py:16-17](../../../jev_ultrafast/browser.py#L16-L17)、[agent.py:55-64](../../../jev_ultrafast/agent.py#L55-L64)）。`post_json` は HTTP 429・529・503 を最大3回試行し、接続失敗や他の HTTP エラーは `RuntimeError` として報告する （[model.py:15-25](../../../jev_ultrafast/model.py#L15-L25)）。 <!-- b_118hss2m -->

## 並行性 <!-- b_557343x6 -->

検査用サーバーは `ThreadingHTTPServer` を使い、POST 処理は `LOCK` を非ブロッキングで取得し、競合時には HTTP 409 を返す （[demo.py:104-125](../../../jev_ultrafast/demo.py#L104-L125)、[demo.py:134](../../../jev_ultrafast/demo.py#L134)）。状態取得も同じ `LOCK` で保護する （[demo.py:85-87](../../../jev_ultrafast/demo.py#L85-L87)）。ライフサイクルの後始末は別の仕組みで、終了時の `close_browser` を `atexit` に登録し、サーバーは `finally` で閉じる （[demo.py:131-141](../../../jev_ultrafast/demo.py#L131-L141)）。 <!-- b_4fv3fv1d -->

## 性能 <!-- b_dvcb46qc -->

モデル通信は HTTP/2 対応の共通 `CLIENT` を使う （[model.py:12](../../../jev_ultrafast/model.py#L12)、[model.py:18](../../../jev_ultrafast/model.py#L18)）。入力文は `pending_text` に保持し、生成用コンテキストが同じなら再生成せず利用する （[agent.py:109-115](../../../jev_ultrafast/agent.py#L109-L115)）。 <!-- b_wf8rj01c -->

## 落とし穴 <!-- b_ckd69bj8 -->

> [!WARNING]
> **落とし穴**
> 操作種別の追加は、`snapshot.js` のアクション生成と `action_space` の操作名への対応付けにまたがる （[snapshot.js:68-79](../../../jev_ultrafast/snapshot.js#L68-L79)、[snapshot.js:102-104](../../../jev_ultrafast/snapshot.js#L102-L104)、[model.py:51-55](../../../jev_ultrafast/model.py#L51-L55)）。さらに `choose` の選択肢構築と `browser_operation` の実行分岐が対応する必要があり、選択と入力の片側だけでは完結しない （[model.py:81-95](../../../jev_ultrafast/model.py#L81-L95)、[browser.py:135-143](../../../jev_ultrafast/browser.py#L135-L143)、[browser.py:161-169](../../../jev_ultrafast/browser.py#L161-L169)）。 <!-- b_3td7w57h -->

> [!TIP]
> **まとめ**
> 調査時は、まず観測から入力までを追い、次に鮮度検証と例外処理を確認するとよい。 <!-- b_h83bedx4 -->
