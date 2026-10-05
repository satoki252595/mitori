# 5. コードの地図 <!-- b_k31x2rvw -->

**読む順番（コードの入口から 4 か所）**
1. 入口: `research/scripts/make_plots.py:41-152` — `main`
2. 基盤の型: `laya/router.py:96` — `RouteDecision` L96・`Router` L477
3. ハブ（多くをつなぐ）: `laya/mcp/tools.py:644-798` — `laya_shortlist`
4. 機能の芯: `laya/structured.py:323-386` — `decide_batch`
<!-- b_x4mv8pv1 -->

| ディレクトリ | モジュール | 要約 | 行数 |
|---|---|---|---|
| `examples` | 動作例とデモサーバ | laya 呼び出し例と検証用 API デモ | 5987 |
| `laya` | 推論エージェント | 単一チェックポイントの予測と較正を担う | 4713 |
| `laya/integrations` | 外部連携アダプター | LangChain など向け選択と検査の提供 | 2155 |
| `（ルート）` | 測定証跡と起動準備 | compile 既定値の測定ログと Docker 準備・評価補助の集まり | 2337 |
| `（ルート）` | JVM 推論と回答生成 | ONNX Runtime 上で型付き質問に答える Java 推論実装である | 3006 |
| `（ルート）` | 動作例と連携見本 | 番号付き例と他言語見本で基本操作と連携を示す。 | 2885 |
| `（ルート）` | .NET 推論エンジン | ONNX Runtime で型付き判断を行う .NET 移植版 | 3098 |
| `（ルート）` | 書き出しと計測道具 | ONNX 書き出しと golden 再生成と計測を担う道具群 | 5768 |
| `（ルート）` | 判定基盤と評価群 | 型付き判定の共通部品と多言語評価ハーネスを束ねる | 5854 |
| `（ルート）` | 選定と予測公開 | 担当選定と予測実行と HTTP 提供を担う | 5960 |
| `（ルート）` | TypeScript 推論基盤 | 質問応答と振分と構造化出力を担う TS 実装である。 | 5068 |
| `（ルート）` | ベンチマークと生成スクリプト | 評価実行と作図、Java 用生成と ONNX 出力をまとめる | 3312 |
<!-- b_ttzebxse -->

- `laya/cli.py`（laya/cli.py）
- `laya/mcp/server.py`（laya/mcp/server.py）
- `laya/serve.py`（laya/serve.py）
- `research/evals/massive_route_comparison.py`（research/evals/massive_route_comparison.py）
- `laya/evals_cli.py`（laya/evals_cli.py）
- `notebooks/laya_finetune_typed_decisions_mps.py`（notebooks/laya_finetune_typed_decisions_mps.py）
- `research/eval/laya_eval.py`（research/eval/laya_eval.py）
- `research/eval/metamorphic.py`（research/eval/metamorphic.py）
- `research/eval/presentation_checks.py`（research/eval/presentation_checks.py）
- `research/evals/check_regression.py`（research/evals/check_regression.py）
<!-- b_9pejjw9z -->

| 除外理由 | 件数 |
|---|---|
| バイナリ | 21 |
| 大きなデータ | 20 |
| 除外パターン | 11 |
| テスト用データ | 7 |
| 生成物 | 3 |
| ロックファイル | 3 |
| 圧縮済み | 1 |
<!-- b_0qwacymz -->
