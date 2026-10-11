# ブラウザ操作エージェント（jev_ultrafast） <!-- b_ae9dae4d -->

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
> - 公開 API と観測データの読み方を知る。
> - 操作選択からブラウザ入力までを追う。
> - 判断の使い捨て、失敗時の復帰、操作追加時の結合箇所を理解する。 <!-- b_1fhd79ea -->

## 責務 <!-- b_4hsj2wa2 -->

観測済みの操作をモデルが選び、実行はコードが担うブラウザエージェントである（[\_\_init\_\_.py:1](../../../jev_ultrafast/__init__.py#L1)、[model.py:125-133](../../../jev_ultrafast/model.py#L125-L133)、[browser.py:143-145](../../../jev_ultrafast/browser.py#L143-L145)）。入力文を実行側で固定したり推測したりせず、専用モデルに生成させる（[model.py:160-185](../../../jev_ultrafast/model.py#L160-L185)）。 <!-- b_kvvegkrp -->

## 公開インターフェース <!-- b_x1n730nq -->

- `Agent` は URL と目標を受け取り、`command` で進行させ、`snapshot` でブラウザインスタンスを除いた状態を取得する入口である（[agent.py:12-13](../../../jev_ultrafast/agent.py#L12-L13)、[agent.py:46-58](../../../jev_ultrafast/agent.py#L46-L58)）。
- `Browser` は URL を受け取り、`observe`・`act`・`close` を操作窓口として持つ（[browser.py:20-21](../../../jev_ultrafast/browser.py#L20-L21)、[browser.py:44](../../../jev_ultrafast/browser.py#L44)、[browser.py:100](../../../jev_ultrafast/browser.py#L100)、[browser.py:109](../../../jev_ultrafast/browser.py#L109)）。 <!-- b_40hx7mn7 -->

## 依存関係 <!-- b_g965yxva -->

ブラウザ操作には Browser Harness、モデル通信には `httpx` を使う（[browser.py:1](../../../jev_ultrafast/browser.py#L1)、[model.py:12](../../../jev_ultrafast/model.py#L12)）。`scripts` 側の実行例（`URL`、`GOALS`、`verify`）が本体を利用する（推測）。 <!-- b_fc3v2hsz -->

## データ構造 <!-- b_sz0bxvkk -->

- 要素由来の `actions` は識別子 `node`、意味を表す `role`・`label`、位置を表す `rect`、操作種別 `kind` を持ち、画面の `url`・`title`・`text` と共に返る（[snapshot.js:61-62](../../../jev_ultrafast/snapshot.js#L61-L62)、[snapshot.js:68-79](../../../jev_ultrafast/snapshot.js#L68-L79)、[snapshot.js:105-106](../../../jev_ultrafast/snapshot.js#L105-L106)）。 <!-- b_66rvqapx -->

## 処理の流れ <!-- b_rm26bqmc -->

1. `predict` は観測が古ければ更新し、`choose` を呼ぶ（[agent.py:65-77](../../../jev_ultrafast/agent.py#L65-L77)）。
2. `choose` は操作と操作別対象の質問を1リクエストにまとめ、選ばれた操作の対象回答だけを検証・採用する（[model.py:91-106](../../../jev_ultrafast/model.py#L91-L106)、[model.py:116-133](../../../jev_ultrafast/model.py#L116-L133)）。
3. `act` は入力を実行して履歴に記録し、その後に再観測して画面変化を履歴へ反映する（[agent.py:116-148](../../../jev_ultrafast/agent.py#L116-L148)）。 <!-- b_10jnttks -->

## 設定 <!-- b_v3c2dzw3 -->

- `TYPESAFE_DEMO_PORT` の既定値は `8766` である（[demo.py:16](../../../jev_ultrafast/demo.py#L16)）。
- 選択側は `TYPESAFE_MODEL`（既定 `jev-latest`）と `TYPESAFE_API_KEY` を読む（[model.py:108](../../../jev_ultrafast/model.py#L108)、[model.py:119](../../../jev_ultrafast/model.py#L119)）。
- 入力生成側は `TEXT_MODEL_API_KEY`、`TEXT_MODEL_BASE_URL`、`TEXT_MODEL`、`TEXT_MODEL_REASONING` を読み、接続先とモデルの既定値は `https://api.deepseek.com/v1` と `deepseek-chat` である（[model.py:161-168](../../../jev_ultrafast/model.py#L161-L168)）。 <!-- b_vr3n2258 -->

## テスト <!-- b_cta6x86h -->

- `test_all_heads_are_one_request_and_only_matching_head_executes` は全ヘッドの単一リクエスト化と対応ヘッドだけの実行を検証する（[test\_agent.py:77](../../../tests/test_agent.py#L77)）。
- `test_click_cannot_consume_a_text_target` はクリックがテキスト入力用の対象を消費できないことを検証する（[test\_agent.py:99](../../../tests/test_agent.py#L99)）。 <!-- b_21fh37b9 -->

## 不変条件 <!-- b_71rmfpm2 -->

- `validate_choice` は候補集合との一致、有限で範囲内の確率、確率和、最大確率の選択を要求する（[model.py:30-45](../../../jev_ultrafast/model.py#L30-L45)）。
- `act` は判断と観測の `fingerprint` を確認し、変更やモデル呼び出しより前に判断を消費して再実行を防ぐ（[agent.py:86-91](../../../jev_ultrafast/agent.py#L86-L91)）。 <!-- b_cnc50azc -->

## エラー処理 <!-- b_044mjaxc -->

- `tick` は `StalePage` を捕捉すると判断を破棄し、再観測して `ready` に戻す（[agent.py:55-64](../../../jev_ultrafast/agent.py#L55-L64)）。
- 3回続けて画面が変わらず、いずれも `wait` でなければ `blocked` にする（[agent.py:153-158](../../../jev_ultrafast/agent.py#L153-L158)）。 <!-- b_118hss2m -->

## 並行性 <!-- b_557343x6 -->

`ThreadingHTTPServer` はループバックで待ち受け、POST は `LOCK` を非ブロッキング取得して競合時に HTTP 409 を返し、状態取得の GET も同じロックを使う（[demo.py:131-134](../../../jev_ultrafast/demo.py#L131-L134)、[demo.py:104-112](../../../jev_ultrafast/demo.py#L104-L112)、[demo.py:81-87](../../../jev_ultrafast/demo.py#L81-L87)）。終了処理は同期とは別に、`atexit` に登録した `close_browser` がエージェントを閉じ、サーバーは `finally` で閉じる（[demo.py:37-41](../../../jev_ultrafast/demo.py#L37-L41)、[demo.py:131-141](../../../jev_ultrafast/demo.py#L131-L141)）。 <!-- b_4fv3fv1d -->

## 性能 <!-- b_dvcb46qc -->

モデル通信は HTTP/2 対応の共通 `CLIENT` を持ち、入力文は `pending_text` のコンテキストが一致すれば再生成しない（[model.py:12](../../../jev_ultrafast/model.py#L12)、[agent.py:105-118](../../../jev_ultrafast/agent.py#L105-L118)）。実行予算は `MAX_STEPS` の60操作、判断予算はその2倍である（[questions.py:26](../../../jev_ultrafast/questions.py#L26)、[agent.py:75-76](../../../jev_ultrafast/agent.py#L75-L76)、[agent.py:102-104](../../../jev_ultrafast/agent.py#L102-L104)）。 <!-- b_wf8rj01c -->

## 落とし穴 <!-- b_ckd69bj8 -->

> [!WARNING]
> **落とし穴**
> 操作種別の追加は、`snapshot.js` の候補生成と `action_space` の操作別対象集合への対応付けにまたがる（[snapshot.js:68-79](../../../jev_ultrafast/snapshot.js#L68-L79)、[snapshot.js:102-104](../../../jev_ultrafast/snapshot.js#L102-L104)、[model.py:48-78](../../../jev_ultrafast/model.py#L48-L78)）。さらに `choose` の質問構築・回答検証と、`browser_operation` の入力ディスパッチが結合している（[model.py:83-106](../../../jev_ultrafast/model.py#L83-L106)、[model.py:120-133](../../../jev_ultrafast/model.py#L120-L133)、[browser.py:135-164](../../../jev_ultrafast/browser.py#L135-L164)、[browser.py:165-186](../../../jev_ultrafast/browser.py#L165-L186)）。 <!-- b_3td7w57h -->

> [!TIP]
> **まとめ**
> 読む際は、観測、選択、入力、再観測の順に追うとよい。その後に判断の消費順序と復帰経路を確認する。 <!-- b_h83bedx4 -->
