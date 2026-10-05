# 9. 非機能 <!-- b_ym7rwsm3 -->

## ホットパス <!-- b_tazqak7d -->

- 時間消費は browser と model にわたる往復と待機に集まり、往復削減が高速化の中心である（[design.md:5](../../docs/design.md#L5)）。
- 例として `observe` は読取り専用待機と可視性確認を挟む（[browser.py:44-63](../../jev_ultrafast/browser.py#L44-L63)）。
- 待機時間の例では `wait` が 1 回に 0.1 秒眠る（[browser.py:100](../../jev_ultrafast/browser.py#L100)、[browser.py:103-104](../../jev_ultrafast/browser.py#L103-L104)）。
- 接続維持の例では `CLIENT` が http2 で通信する（[browser.py:1](../../jev_ultrafast/browser.py#L1)、[model.py:12](../../jev_ultrafast/model.py#L12)）。 <!-- b_qqg7ma4c -->

## キャッシュ <!-- b_062fpafr -->

- 文面生成の再利用は agent 内に閉じ、同一入力の停滞再試行に限り前回結果を使い回す（[design.md:9](../../docs/design.md#L9)）。
- 例として `field_text` の結果は `field_context` が一致する場合に `pending_text` から再利用され、実行後は破棄される（[agent.py:109-114](../../jev_ultrafast/agent.py#L109-L114)、[agent.py:117-118](../../jev_ultrafast/agent.py#L117-L118)）。 <!-- b_rfcf3htd -->

## 上限値 <!-- b_e2rpv7w2 -->

- 実行量の上限は demo と browser と scripts にわたり、観測ごとと要求ごとと実行ごとに分かれる（推測）。
- `reset` では `goal` を 1 文字以上 2000 文字以下とし、`scenario` を 3 種に限る（[demo.py:46-52](../../jev_ultrafast/demo.py#L46-L52)）。
- `do_POST` は本体を 0 バイト超 8192 バイト未満の 1 要求に限り、サーバー全体で同時実行は 1 要求に限って衝突時は 409 で拒否する（[demo.py:104-116](../../jev_ultrafast/demo.py#L104-L116)）。
- `observe` は 1 呼出しで 10 回を限度に 0.02 秒おきに取得し直す（[browser.py:77-85](../../jev_ultrafast/browser.py#L77-L85)）。
- 1 実行の決定要求回数は `MAX_STEPS` の 2 倍を上限とし、超過時の `predict` は `ValueError` となる（[agent.py:65-76](../../jev_ultrafast/agent.py#L65-L76)）。
- 診断スクリプトの 1 回の実行は 15 操作で打ち切られる（[smoke.py:19-20](../../scripts/smoke.py#L19-L20)、[smoke.py:35-36](../../scripts/smoke.py#L35-L36)）。 <!-- b_yxhdrj1m -->

## セキュリティ境界 <!-- b_s6jjct8r -->

- 信頼境界は demo と static と model にわたり、待受けの閉鎖と要求検査と秘密のサーバー側保持で守られる（推測）。
- デモサーバーは既定で 127.0.0.1 に束縛される（[demo.py:134](../../jev_ultrafast/demo.py#L134)）。
- `do_POST` は `Host` と `TOKEN` と `Origin` を検査して 403 や 409 で拒否し、`Origin` の欠落は許されるが `do_GET` にはトークン検査が無い（[demo.py:104-112](../../jev_ultrafast/demo.py#L104-L112)、[demo.py:81-87](../../jev_ultrafast/demo.py#L81-L87)）。
- 鍵管理の例では `TYPESAFE_API_KEY` と `TEXT_MODEL_API_KEY` を環境経由で読む（[model.py:119](../../jev_ultrafast/model.py#L119)、[model.py:161](../../jev_ultrafast/model.py#L161)）。
- 入力検証の例として `command` は未知の `scenario` や空の `goal` を拒否する（[demo.py:44-52](../../jev_ultrafast/demo.py#L44-L52)）。
- 表示側の例では `escape` が HTML 特殊文字を無害化する（[app.js:12-19](../../jev_ultrafast/static/app.js#L12-L19)）。 <!-- b_54ymq7g7 -->

## 信頼性 <!-- b_7c331kbw -->

- 失敗処理は browser と agent と demo にわたり、頁ずれの再観測と変更操作の非再試行に分かれる（推測）。
- 例として `tick` は `StalePage` を受けると `observe` を取得し直して `ready` に復帰する（[agent.py:52-64](../../jev_ultrafast/agent.py#L52-L64)）。
- 例として `fresh` 不成立時や文面生成前の画面変化は `StalePage` となり実行しない（[browser.py:100-102](../../jev_ultrafast/browser.py#L100-L102)、[agent.py:106-108](../../jev_ultrafast/agent.py#L106-L108)）。
- 終了処理の例として `close_browser` は `AGENT` を閉じて破棄し、別例では `snapshot` 保存後に `SystemExit` で合否を伝える（[demo.py:37-41](../../jev_ultrafast/demo.py#L37-L41)、[flights.py:53-56](../../examples/flights.py#L53-L56)、[flights.py:62-64](../../examples/flights.py#L62-L64)）。
- 書き込みの失敗時は繰り返しを避け、観測より先に実行済みを残す（[design.md:19](../../docs/design.md#L19)）。 <!-- b_wckfphrd -->

## 可観測性 <!-- b_0mf0h7yy -->

- 可観測性は agent と demo にわたり、状態取得と経過時間と成果物記録で支えられる（推測）。
- 例として `response_state` は `snapshot` に `text_model` と `max_steps` を添えて `/api/state` で返す（[demo.py:32-34](../../jev_ultrafast/demo.py#L32-L34)、[demo.py:85-87](../../jev_ultrafast/demo.py#L85-L87)）。
- 例として `command` は `elapsed_ms` を更新し、`Agent` は `screenshots` と `record_dir` で記録を残す（[agent.py:52-63](../../jev_ultrafast/agent.py#L52-L63)、[demo.py:54-60](../../jev_ultrafast/demo.py#L54-L60)）。
- 起動時は `ORIGIN` を標準出力に表示する（[demo.py:135](../../jev_ultrafast/demo.py#L135)）。 <!-- b_pzvvjk4d -->
