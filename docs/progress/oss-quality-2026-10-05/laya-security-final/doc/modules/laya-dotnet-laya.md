# .NET 推論エンジン <!-- b_p24a85tx -->

- ファイル 24 · 3098 行 · 重要度 0.07
<!-- b_d0wfzvjr -->

**変更の手引き**
- テスト: `sdk/typescript/test/client.test.mjs`（24 件）・`tests/test_modelscope_prefetch.py`（20 件）・`tests/test_docker_entrypoint.py`（11 件）・`tests/test_verify_checkpoints.py`（6 件） ほか 18
- 一緒に変わりやすいファイル（直近 289 commit）: `examples/server.py` 2 回・`laya-dotnet/tests/Laya.Tests/LanguageDetectionTests.cs` 2 回・`laya-dotnet/tests/Laya.Tests/LayaEmailTests.cs` 2 回・`laya-dotnet/tests/Laya.Tests/LayaRouterTests.cs` 2 回・`nix/laya-serve.nix` 2 回
<!-- b_0xj5jsed -->

> [!NOTE]
> **この章で分かること**
> - .NET 移植の範囲と Python 版との対応を学ぶ
> - 質問と状態から回答が決まる流れを学ぶ
> - 実行環境とモデル調達の前提を学ぶ <!-- b_98va6wrh -->

## 責務 <!-- b_hhg0hkmn -->

このモジュールは Python 版 `laya` の推論経路を .NET に移植したものである（[README.md:3-5](../../../laya-dotnet/README.md#L3-L5)）。
`choice` と `score` と `noul` の型付き質問に 1 回の非自己回帰フォワードパスで答え、較正済み確率を返す（[README.md:10-12](../../../laya-dotnet/README.md#L10-L12)）。
テキストを生成しないため、パースや幻覚の心配がない（[README.md:12-13](../../../laya-dotnet/README.md#L12-L13)）。
実行時に Python プロセスを使わず、未移植分は v1 の対象外である（[README.md:7-8](../../../laya-dotnet/README.md#L7-L8)）。 <!-- b_td0bk32c -->

## 依存関係 <!-- b_4xwm7nq1 -->

- 実行基盤に `Microsoft.ML.OnnxRuntime` 1.30 を使い、既定は CPU である（[README.md:21](../../../laya-dotnet/README.md#L21)）。
- 字句解析に `Tokenizers.DotNet` を使い、Python と同じ Rust ライブラリに結び付ける（[README.md:22](../../../laya-dotnet/README.md#L22)）。
- ONNX モデルは `tools/export_onnx.py` で公式 PyTorch チェックポイントから書き出す（[README.md:20](../../../laya-dotnet/README.md#L20)）。 <!-- b_aznz5bdv -->

## 処理の流れ <!-- b_nsycwtg7 -->

1. 状態と型付き質問を受け付ける（[README.md:10-11](../../../laya-dotnet/README.md#L10-L11)）。
2. トークン化と系列構築で入力を作る（[README.md:5](../../../laya-dotnet/README.md#L5)）。
3. フォワードパスで推論し、較正して回答を作る（[README.md:11-12](../../../laya-dotnet/README.md#L11-L12)）。 <!-- b_zwgp3cbr -->

## 設定 <!-- b_1mxge434 -->

- 既定チェックポイントは `multilingual` である（[README.md:19](../../../laya-dotnet/README.md#L19)）。
- 実行プロバイダーは既定で CPU を使い、対応品では CUDA と DirectML を選べる（[README.md:21](../../../laya-dotnet/README.md#L21)）。 <!-- b_cg11vndd -->

## 不変条件 <!-- b_xf4r452h -->

- トークン列は Python 版と一致する（[README.md:22](../../../laya-dotnet/README.md#L22)）。
- 推論経路は `tests/Laya.Tests/golden` の黄金出力で検証される（[README.md:5-6](../../../laya-dotnet/README.md#L5-L6)）。 <!-- b_g0nhthfb -->

> [!TIP]
> **まとめ**
> 以上が .NET 移植の要点である。 <!-- b_g0apbn1f -->
