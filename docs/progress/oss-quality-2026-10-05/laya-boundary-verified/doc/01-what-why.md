# 1. これは何か・誰のためか・なぜあるか <!-- b_cf21y6r3 -->

## 解決する課題 <!-- b_x1g4epgs -->

多言語入力に対する選択や評価を自己回帰生成の遅延なしに得ることが課題である（[README.md:8](../../README.md#L8)）。生成テキストのパースや幻覚を避けつつ、単一フォワードパスで較正済みの答えを返す必要がある（[README.md:10-13](../../laya-dotnet/README.md#L10-L13)）。 <!-- b_crgj2t5t -->

## 利用者 <!-- b_bw5wpk0b -->

- Python アプリ開発者が `laya` で分類や選択の型付き判定を行う（[README.md:27](../../README.md#L27)、[README.md:10-12](../../laya-dotnet/README.md#L10-L12)）。
- TypeScript 開発者が Node.js とブラウザーで推論を行う（[README.md:3](../../laya-ts/README.md#L3)）。
- JVM と .NET 開発者が ONNX Runtime 上で判定を行う（[README.md:3-4](../../laya-java/README.md#L3-L4)、[README.md:7-8](../../laya-dotnet/README.md#L7-L8)）。
- 評価用途で精度や較正の測定を行う（[README.md:12-18](../../benchmarks/results/compile-defaults/README.md#L12-L18)）。
- 5 分で試すには `python -m pip install laya` で導入し、`npm install laya-ts` と `Agent.load` の例を開いて動かす（[README.md:27](../../README.md#L27)、[README.md:34](../../README.md#L34)、[README.md:16-24](../../laya-ts/README.md#L16-L24)）。 <!-- b_re2n8v5r -->

## 範囲 <!-- b_7fw459ne -->

- 100 以上の言語で型付き判定を 1 回のフォワードパスで返す（[README.md:8](../../README.md#L8)）。
- `choice` と `score` と `noul` の質問形式を扱う（[README.md:10-11](../../laya-dotnet/README.md#L10-L11)）。
- 担当チェックポイントの選定と HTTP 公開と MCP 提供を行う（[README.md:8](../../README.md#L8)、[serve.py:865](../../laya/serve.py#L865)、[server.py:69](../../laya/mcp/server.py#L69)）。
- テキスト生成やパースを要する処理は行わない（[README.md:12-13](../../laya-dotnet/README.md#L12-L13)）。
- Java 移植ではフックや言語 `Router` などは対象外である（[README.md:16-17](../../laya-java/README.md#L16-L17)）。 <!-- b_vsdjfs6n -->

## 制約 <!-- b_jxg5sfbt -->

- Python 3.10 以降で動作する（[README.md:32](../../README.md#L32)）。
- .NET 10 と JDK 17 以上を対象とする（[README.md:18](../../laya-dotnet/README.md#L18)、[README.md:3-4](../../laya-java/README.md#L3-L4)）。
- ONNX Runtime 上で実行する移植がある（[README.md:7-8](../../laya-dotnet/README.md#L7-L8)、[README.md:3-4](../../laya-java/README.md#L3-L4)）。
- 長文は `max_len=8192` で最大 8,192 トークンまで読む（[README.md:36](../../README.md#L36)）。
- チェックポイントは `convaiinnovations/laya` の取得物を使う（[README.md:9-10](../../benchmarks/results/compile-defaults/README.md#L9-L10)）。 <!-- b_51ht4sc8 -->
