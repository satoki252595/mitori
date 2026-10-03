# 終了プロンプトとフック <!-- b_kr5xgq6z -->

- ファイル 23 · 2733 行 · 重要度 0.27
<!-- b_wxgrsn3w -->

> [!NOTE]
> **この章で分かること**
> - レビュー完了時のプロンプトとフックがどう解決・描画されるか
> - プロジェクト設定を信頼するかどうかの判定の仕組み
> - ストーリーの取り込みと検証の流れ <!-- b_11sq5m8c -->

## 責務 <!-- b_791by9mz -->

このモジュールは `internal/prompt`、`internal/hooks`、`internal/story` からなり、レビュー終了時のプロンプト文面の決定と描画を担う（[render.go:28](../../../internal/prompt/render.go#L28)、[render.go:140](../../../internal/prompt/render.go#L140)）。フックのシェルコマンドの解決と実行も扱う（[resolve.go:143](../../../internal/hooks/resolve.go#L143)、[run.go:49](../../../internal/hooks/run.go#L49)）。ストーリーについては、エージェントが返した内容の取り込みと検証を行う（[ingest.go:115](../../../internal/story/ingest.go#L115)、[ingest.go:175](../../../internal/story/ingest.go#L175)）。 <!-- b_er5w6vef -->

## 公開インターフェース <!-- b_ymkewv8w -->

- `RenderFinish` は終了時プロンプトを描画し `FinishResult` を返す（[render.go:140](../../../internal/prompt/render.go#L140)）。
- `RenderHook` は任意のフック名のテンプレートを描画する（[render.go:172](../../../internal/prompt/render.go#L172)）。
- `EvaluateTrust` はプロジェクト設定の信頼状態 `TrustState` を返す（[trust.go:160](../../../internal/prompt/trust.go#L160)）。
- `ResolveFinishCommand` は終了フックの実行コマンドを解決する（[resolve.go:143](../../../internal/hooks/resolve.go#L143)）。
- `Run` はフックを実行して `Output` を返す（[run.go:49](../../../internal/hooks/run.go#L49)）。
- `story.Run` は `Ingest` を受けて `Result` を返す（[ingest.go:113](../../../internal/story/ingest.go#L113)）。 <!-- b_y8cdvt9p -->

## データ構造 <!-- b_jetxjsxg -->

- `Context` は終了プロンプト用の値（`ReviewPath`、`Mode`、`UnresolvedCount` など）を持つ（[context.go:11-26](../../../internal/prompt/context.go#L11-L26)）。
- `TrustEntry` は信頼モードと `ContentHash` を保持する（[trust.go:24-27](../../../internal/prompt/trust.go#L24-L27)）。
- `HunkID` はファイルパスと `OldStart` でハンクを識別する（[ingest.go:37-40](../../../internal/story/ingest.go#L37-L40)）。 <!-- b_xyp09hq3 -->

## テスト <!-- b_77s9r4m5 -->

- フックの解決はグローバルとプロジェクトの優先順位を検証する（`internal/hooks/hooks_test.go:84`）。
- 未信頼時にプロジェクトのフックが遮断されることも確かめる（`internal/hooks/hooks_test.go:132`）。
- タイムアウトは `TestRun_Timeout` が検証する（`internal/hooks/hooks_test.go:223`）。
- 信頼判定は設定変更による無効化をテストする（`internal/prompt/prompt_test.go:177`）。 <!-- b_prysvexp -->
