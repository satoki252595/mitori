# 9. 非機能 <!-- b_ym7rwsm3 -->

## ホットパス <!-- b_tazqak7d -->

- `observe` は `after_input` が残る場合に読取り専用の待機を挟み、自動補完時は 200、それ以外は 50 を上限に 2 フレームの可視性を確認する（[browser.py:44-63](../../jev_ultrafast/browser.py#L44-L63)）。
- `act` の `wait` は 0.1 秒の固定睡眠で時間を消費する（[browser.py:100](../../jev_ultrafast/browser.py#L100)、[browser.py:103-104](../../jev_ultrafast/browser.py#L103-L104)）。
- jev_ultrafast 内のブラウザ操作とモデル選択にまたがる往復削減が高速化の柱で、逐次呼出しの回避と 2 決定の 1 往復化がその例である（[design.md:5](../../docs/design.md#L5)）。
- browser と model にまたがる接続維持が往復削減を支え、単一 CDP セッションと http2 の利用がその例である（[browser.py:1](../../jev_ultrafast/browser.py#L1)、[model.py:12](../../jev_ultrafast/model.py#L12)）。 <!-- b_qqg7ma4c -->

## 上限値 <!-- b_e2rpv7w2 -->

- demo と browser と scripts にわたる実行は有界で、1 実行は 60 操作と 120 決定要求と 250 候補に収める例がある（[design.md:31](../../docs/design.md#L31)）。
- `command` は `scenario` を 3 種に限定し、`goal` を 1 文字以上 2000 文字以下に制限する（[demo.py:44](../../jev_ultrafast/demo.py#L44)、[demo.py:47-52](../../jev_ultrafast/demo.py#L47-L52)）。
- `observe` は最大 10 回まで 0.02 秒間隔で再取得し、収束しなければ失敗とする（[browser.py:44-45](../../jev_ultrafast/browser.py#L44-L45)、[browser.py:77-86](../../jev_ultrafast/browser.py#L77-L86)）。
- 診断実行は既定で 15 操作を上限とし、超過時は中断する（[smoke.py:19-20](../../scripts/smoke.py#L19-L20)、[smoke.py:35-36](../../scripts/smoke.py#L35-L36)）。 <!-- b_yxhdrj1m -->

## セキュリティ境界 <!-- b_s6jjct8r -->

- demo と static にわたる検査は loopback 専用で直列化し、Host と Origin と局所トークンで検査する例がある（[design.md:31](../../docs/design.md#L31)）。
- model と demo にわたる秘密情報の扱いは server 側保持に寄せ、.env を無視する例がある（[README.md:11](../../README.md#L11)、[AGENTS.md:11](../../AGENTS.md#L11)）。
- `TYPESAFE_API_KEY` と `TEXT_MODEL_API_KEY` は環境変数で受け取る（[model.py:119](../../jev_ultrafast/model.py#L119)、[model.py:161](../../jev_ultrafast/model.py#L161)）。
- `call` は `X-Demo-Token` を付けて `fetch` し、失敗時は例外として扱う（[app.js:21-28](../../jev_ultrafast/static/app.js#L21-L28)）。
- `command` は未開始の操作を `ValueError` で拒む（[demo.py:44](../../jev_ultrafast/demo.py#L44)、[demo.py:64-65](../../jev_ultrafast/demo.py#L64-L65)）。
- browser と model にわたる対象決定は観測内要素に閉じ、選択子や実行コードの出力を許さない例がある（[AGENTS.md:7](../../AGENTS.md#L7)）。
- `escape` は HTML 特殊文字を実体参照に置換する（[app.js:12-19](../../jev_ultrafast/static/app.js#L12-L19)）。 <!-- b_54ymq7g7 -->

## 信頼性 <!-- b_7c331kbw -->

- `act` は `fresh` でなければ `StalePage` を送出し、再観測を促す（[browser.py:100-102](../../jev_ultrafast/browser.py#L100-L102)）。
- jev_ultrafast と scripts にわたる変更操作は再試行を避ける例がある（[AGENTS.md:5](../../AGENTS.md#L5)、[AGENTS.md:7](../../AGENTS.md#L7)、[AGENTS.md:9](../../AGENTS.md#L9)）。
- examples と scripts にわたる終了処理は `snapshot` を残し、不通過は `SystemExit` で知らせる例がある（[flights.py:53-56](../../examples/flights.py#L53-L56)、[flights.py:62-64](../../examples/flights.py#L62-L64)）。
- `perform` は失敗時に `state` を再取得して表示を戻し、元障害を保持する（[app.js:45-60](../../jev_ultrafast/static/app.js#L45-L60)）。
- jev_ultrafast 内の中断処理は native select 評価を change 発火済みの恐れがあるため止める例がある（[design.md:19](../../docs/design.md#L19)）。 <!-- b_wckfphrd -->

## 可観測性 <!-- b_0mf0h7yy -->

- `timed` は `perf_counter` で計測し、呼出し毎のミリ秒を `calls` に蓄積する（[measure\_flights.py:34-38](../../scripts/measure_flights.py#L34-L38)）。
- 診断結果の計測値は `summary.json` に保存される（[smoke.py:46-53](../../scripts/smoke.py#L46-L53)）。
- 診断実行は `elapsed_ms` と履歴長と最終操作を標準出力に残す（[smoke.py:28-33](../../scripts/smoke.py#L28-L33)）。
- demo と scripts にわたる記録は `record` 指定時に残す（[demo.py:59-60](../../jev_ultrafast/demo.py#L59-L60)、[smoke.py:23-24](../../scripts/smoke.py#L23-L24)）。
- `main` は待受け開始時に `ORIGIN` を表示する（[demo.py:131](../../jev_ultrafast/demo.py#L131)、[demo.py:134-135](../../jev_ultrafast/demo.py#L134-L135)）。 <!-- b_pzvvjk4d -->
