# 1. これは何か・誰のためか・なぜあるか <!-- b_bgk30zfm -->

## 解決する課題 <!-- b_krp9f362 -->

変わり続ける `page` 上で自然言語の `goal` を素早く実行するには、観測のたびに変わる `elements` と `operation` の組合せをその場で決める必要がある（[AGENTS.md:3](../../AGENTS.md#L3)、[AGENTS.md:5](../../AGENTS.md#L5)）。`TypeSafe` への 1 回の要求で `operation` と操作別の `target` を選び、実行をコードに分離することで待ち時間と誤操作を抑える（[design.md:5](../../docs/design.md#L5)）。 <!-- b_h966dngt -->

## 利用者 <!-- b_vp0v552t -->

- 自然言語の `goal` を 1 つ渡して `browser` 操作を自動化したい開発者が使う（[README.md:11](../../README.md#L11)、[AGENTS.md:9](../../AGENTS.md#L9)）。
- 動的な `operation` と `target` 選択を試したい利用者が、1 回の `TypeSafe` 要求で次手を決める実行に使う（[design.md:5](../../docs/design.md#L5)）。
- 計測や回帰確認をしたい開発者が、検証と計測と描画の補助入口を使う（[check\_guards.py:1](../../scripts/check_guards.py#L1)、[measure\_flights.py:1](../../scripts/measure_flights.py#L1)、[render\_demo.py:1](../../scripts/render_demo.py#L1)、[flights.py:1](../../examples/flights.py#L1)）。
- まず `uv run pytest` で局所確認を通し、`main` を実行してデモ画面を開く（[AGENTS.md:16](../../AGENTS.md#L16)、[smoke.py:56](../../scripts/smoke.py#L56)、[index.html:142](../../jev_ultrafast/static/index.html#L142)）。 <!-- b_9v3ag95v -->

## 範囲 <!-- b_7v68jpr4 -->

- 観測ごとに `accessible` な要素と現在値を集めた `indexed table` を作る（[design.md:3](../../docs/design.md#L3)）。
- 対応する `operations` と `targets` だけを提供し、`CLICK` などから次の一手を選ぶ（[README.md:31](../../README.md#L31)）。
- 1 回の `TypeSafe` 要求で `operation` と操作別の `target` 候補を問い、選ばれた操作の `target head` だけを消費する（[design.md:5](../../docs/design.md#L5)）。
- `TYPE_TEXT` の場合に `goal` と選択欄と可視文脈と履歴を小さな `LLM` に送り、1 つの `text` 値を得る（[design.md:9](../../docs/design.md#L9)）。
- サイト別の計画や固定欄値の埋め込みをせず、`model` に `selectors` や実行可能コードを出させず、`browser` の `mutation` を再試行しない（[AGENTS.md:5](../../AGENTS.md#L5)、[AGENTS.md:7](../../AGENTS.md#L7)、[AGENTS.md:9](../../AGENTS.md#L9)）。
- 画面撮像を `model` 入力に使わず、最終成否を `DONE` 選択だけで断定しない（[AGENTS.md:10](../../AGENTS.md#L10)、[AGENTS.md:12](../../AGENTS.md#L12)）。 <!-- b_tae5g8dj -->

## 制約 <!-- b_8bxty48x -->

- Python と JavaScript で構成され、検査に `ruff` と `pytest` と `node` を使う（[AGENTS.md:16](../../AGENTS.md#L16)、[agent.py:1](../../jev_ultrafast/agent.py#L1)、[app.js:1](../../jev_ultrafast/static/app.js#L1)）。
- 実行に `TypeSafe` の `Jev` と小さな `LLM` を使い、認証情報は server 側に置き `.env` を無視する（[README.md:11](../../README.md#L11)、[AGENTS.md:11](../../AGENTS.md#L11)）。
- 計測条件は既存の `Chrome` profile と `1120×780` viewport に固定され、helper には `inception/mercury-2.5` を使う（[performance.md:9](../../docs/performance.md#L9)）。
- `screenshots=True` がない限り画面撮像は無効であり、demo 映像は等倍で保つ（[design.md:15](../../docs/design.md#L15)）。
- 性能主張は計測 `JSON` に限定され、3 組の比較は強い統計的主張には足りない（[performance.md:18-20](../../docs/performance.md#L18-L20)）。 <!-- b_f3v3z3kf -->
