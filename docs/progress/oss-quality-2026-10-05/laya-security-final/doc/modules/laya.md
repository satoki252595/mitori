# 型付き判定基盤 <!-- b_11j71de7 -->

- ファイル 0 · 12828 行 · 重要度 1.00
- 子モジュール 3
<!-- b_y115yy1g -->

> [!NOTE]
> **この章で分かること**
> - まず選定から予測までの流れを追うと全体像が分かる
> - 次に単一チェックポイント推論と較正の位置付けを押さえる
> - 最後に外部連携の変換過程を確認する <!-- b_0cpheyv6 -->

## 責務 <!-- b_s5sb1xhh -->

`Router.predict` が受け付ける `questions` 辞書と判定対象の `state` を入力に型付き回答を返す判定基盤である（[README.md:28-30](../../../research/evals/README.md#L28-L30)）。`choice` と `score` と `noul` を基本形とする（[README.md:5-7](../../../research/evals/README.md#L5-L7)）。`predict_batch` は複数件の `states` と `questions` をまとめて受け付ける（[agent.py:1394-1399](../../../laya/agent.py#L1394-L1399)）。担当選定と単一チェックポイント推論と外部枠組み連携を分担し、HTTP 公開や MCP 経由でも同じ判定を提供する（推測）。 <!-- b_a18vt3j6 -->

## 構成 <!-- b_1czt5cjn -->

- 選定と予測公開は `Router` を中心に担当選択と常駐操作と公開を担う（[router.py:477](../../../laya/router.py#L477)、[README.md:28-30](../../../research/evals/README.md#L28-L30)）。
- 推論エージェントは `Agent` による単一チェックポイントの予測と較正を担う（[agent.py:449](../../../laya/agent.py#L449)）。
- 外部連携アダプターは `LayaRouter` が枠組み固有の要求を `choice` へ変換して判定に渡す（[langchain.py:390](../../../laya/integrations/langchain.py#L390)、[README.md:5-7](../../../research/evals/README.md#L5-L7)）。 <!-- b_js9fzvew -->

## 相互作用 <!-- b_en038yme -->

`Router` は選定後に `Agent` の予測を呼び出し、回答を受け取って返す（推測）。`Agent` 側も選定側の型や定数を参照し、両者は相互に依存する（推測）。外部連携は選定と予測の窓口を利用し、変換した質問と状態を渡して判定結果を受け取る（推測）。 <!-- b_k8xvgbs6 -->

## 公開インターフェース <!-- b_37gxbbze -->

- `Router.predict` は `questions` 辞書を受けて型付き回答を返す（[README.md:28-30](../../../research/evals/README.md#L28-L30)）。
- `predict_batch` は複数件の `states` をまとめて予測する（[agent.py:1394-1399](../../../laya/agent.py#L1394-L1399)）。
- `system_one` は単一状態への予測を提供し、`predict` はその別名である（[agent.py:1856-1862](../../../laya/agent.py#L1856-L1862)、[agent.py:1955](../../../laya/agent.py#L1955)）。
- `decide` はスキーマ形状の決定を返し、`decide_batch` は複数件へ拡張する（[agent.py:1922-1925](../../../laya/agent.py#L1922-L1925)、[agent.py:1935-1938](../../../laya/agent.py#L1935-L1938)）。
- `fit_temperatures` は記録から温度を較正する（[agent.py:1957](../../../laya/agent.py#L1957)）。 <!-- b_qggh87rs -->

## 不変条件 <!-- b_nwga9tqw -->

- `questions` は `Router.predict` が受け付ける辞書形で共有される（[README.md:28-30](../../../research/evals/README.md#L28-L30)）。
- `choice` と `score` と `noul` が判定の基本形である（[README.md:5-7](../../../research/evals/README.md#L5-L7)）。
- `predict` は `system_one` と同一操作を指す（[agent.py:1955](../../../laya/agent.py#L1955)）。
- 単一チェックポイント推論は `Agent` に集約され、選定側は呼び出しに専念する（推測）。 <!-- b_g0r302qv -->

> [!TIP]
> **まとめ**
> 選定と推論と連携を分担する型付き判定基盤である。選定から予測への流れを追えば全体を把握できる。 <!-- b_d3f03350 -->
