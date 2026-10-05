# JVM 推論と回答生成 <!-- b_ngwqjtnc -->

- ファイル 25 · 3006 行 · 重要度 0.09
<!-- b_bbvpxh2k -->

**変更の手引き**
- テスト: 見つかりませんでした
- 入口から: `assets/make_logo.py`（`assets/make_logo.py:140`）
- 一緒に変わりやすいファイル（直近 289 commit）: `laya-java/scripts/gen_fixtures.py` 3 回・`laya-java/build.gradle.kts` 2 回
- 注意: テストが無い
<!-- b_h2vdskfy -->

> [!NOTE]
> **この章で分かること**
> - JVM 推論の役割と対象外を学ぶ
> - 公開要素の使い分けを学ぶ
> - チェックポイント配置と推論の流れを学ぶ <!-- b_9nh5ja7m -->

## 責務 <!-- b_9w3ezsd4 -->

決定推論を JVM 上で提供する（[README.md:3-4](../../../laya-java/README.md#L3-L4)）。双方向エンコーダーと型付きヘッドで単一フォワードパスにより回答する（[README.md:6-7](../../../laya-java/README.md#L6-L7)）。フックや言語ルーターやロング入力やショートリストや構造化決定は対象外である（[README.md:16-17](../../../laya-java/README.md#L16-L17)）。 <!-- b_v7rn635a -->

## 公開インターフェース <!-- b_9022k8xj -->

- `Agent.predict` は型付き回答の取得に使う（[README.md:3-4](../../../laya-java/README.md#L3-L4)）。
- `Agent.predictBatch` は型付き回答の一括取得に使う（[README.md:3-4](../../../laya-java/README.md#L3-L4)）。
- `LayaSession` は fused と split のうち存在するグラフを開くために使う（[README.md:26-28](../../../laya-java/README.md#L26-L28)）。
- `SequenceBuilder` は入力系列の組立てに使う（推測）。
- `Tokenizer` は BPE 符号化に使う（推測）。
- `AgentConfig` は推論設定の保持に使う（推測）。
- `Question` は質問定義の保持に使う（推測）。
- `Answer` は回答結果の保持に使う（推測）。 <!-- b_q6jgk0td -->

## 依存関係 <!-- b_e69dcy80 -->

`com.microsoft.onnxruntime` のみに依存する（[README.md:3-4](../../../laya-java/README.md#L3-L4)）。JDK 17 以上を必要とする（[README.md:3-4](../../../laya-java/README.md#L3-L4)）。 <!-- b_rdf7j0k6 -->

## 処理の流れ <!-- b_77c3bb5d -->

1. 状態と質問をトークン化する（[README.md:3-4](../../../laya-java/README.md#L3-L4)）。
2. 質問ごとに推論用の系列を組み立てる（[README.md:3-4](../../../laya-java/README.md#L3-L4)）。
3. 同一状態への質問を単一バッチにまとめて 1 回で推論する（[README.md:8-9](../../../laya-java/README.md#L8-L9)）。
4. 型付き回答と使用量と打切り報告を返す（[README.md:13-14](../../../laya-java/README.md#L13-L14)）。 <!-- b_6t958cg4 -->

## 設定 <!-- b_7135cktw -->

- チェックポイントは `rl_agent_config.json` と `tokenizer/` を含む（[README.md:30-31](../../../laya-java/README.md#L30-L31)）。
- 予算と温度と特殊トークンは既定値で補わない（[README.md:30-31](../../../laya-java/README.md#L30-L31)）。
- 英語と多言語で長さ予算と温度と分類記号が異なる（[README.md:32-34](../../../laya-java/README.md#L32-L34)）。 <!-- b_vdfmef2p -->

> [!TIP]
> **まとめ**
> 以上が JVM 推論の概要である。公開要素と設定から詳細をたどれる。 <!-- b_ky6yfytt -->
