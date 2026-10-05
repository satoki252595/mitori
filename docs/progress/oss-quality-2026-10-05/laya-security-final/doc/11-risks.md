# 11. リスクと負債 <!-- b_sqh29rbg -->

## テストの穴 <!-- b_bqdz8jax -->

- examples 配下の動作例とデモサーバは確認範囲の問い合わせ対象である（推測）。
- laya-java 配下の JVM 推論と回答生成は確認範囲の問い合わせ対象である（推測）。 <!-- b_5k85vy8g -->

## ホットスポット <!-- b_f5s197g6 -->

- laya/router.py の `load` 失敗は待機者へ伝播し `predict` は `_SCAN` を消去するため並行と再入の変更が波及する（[router.py:692](../../laya/router.py#L692)、[router.py:708-710](../../laya/router.py#L708-L710)、[router.py:738-744](../../laya/router.py#L738-L744)、[router.py:1098-1102](../../laya/router.py#L1098-L1102)）。
- laya/agent.py の `compile_cache` はプロセス全体の既定に触れ `fast` が `compile` に優先するため呼出し順と指定の組合せが結果を変える（[agent.py:521-525](../../laya/agent.py#L521-L525)、[agent.py:528-529](../../laya/agent.py#L528-L529)）。
- laya/serve.py の `BODY_REFUSALS` はフック系を HTTP で拒否するため公開境界の変更になる（[serve.py:138](../../laya/serve.py#L138)、[serve.py:356](../../laya/serve.py#L356)）。
- laya/mcp/tools.py の `ToolError` は `RemoteError` や `SchemaError` と対を成すため区分の変更は連動する（[remote.py:42-45](../../laya/mcp/remote.py#L42-L45)、[tools.py:14-17](../../laya/mcp/tools.py#L14-L17)、[structured.py:30](../../laya/structured.py#L30)）。
- laya/evals.py の `from_dict` と `from_jsonl` は `EvalError` で拒み `_canonical` の順序保持は `_question_schema` と対で変わるため入出力の変更が波及する（[evals.py:65-81](../../laya/evals.py#L65-L81)、[evals.py:112-113](../../laya/evals.py#L112-L113)、[evals.py:130-136](../../laya/evals.py#L130-L136)）。 <!-- b_c3as031v -->

- examples/server.py は `_laya_serve` からの `getattr` 取得に依存し欠落時は代替実装に落ちるため両者の同時更新が要る（[server.py:188](../../examples/server.py#L188)、[server.py:201](../../examples/server.py#L201)）。
- laya/integrations/langchain.py の `_call_remote` は他統合と同一実装のため片方の修正が他方に要る（[llamaindex.py:139](../../laya/integrations/llamaindex.py#L139)、[crewai.py:143](../../laya/integrations/crewai.py#L143)、[langchain.py:154](../../laya/integrations/langchain.py#L154)）。
- laya-ts/src/router.ts の `maxLoaded` と `_touch` は更新漏れで退避がずれるため容量変更時は両方を見る（[router.ts:255-262](../../laya-ts/src/router.ts#L255-L262)、[router.ts:370](../../laya-ts/src/router.ts#L370)）。
- laya-ts/src/agent.ts の `checkQuestion` は識別子付きで拒み `toInternal` は重複鍵を落とすため入力整形の変更が波及する（[agent.ts:169-176](../../laya-ts/src/agent.ts#L169-L176)、[agent.ts:246-260](../../laya-ts/src/agent.ts#L246-L260)）。 <!-- b_dhyh50ff -->

## 壊れやすい箇所 <!-- b_kwjchqx1 -->

> [!WARNING]
> **落とし穴**
> - examples/server.py では `min_confidence` の受渡し口が単発とバッチで分かれるため誤配置は転送落ちになる（[server.py:623-627](../../examples/server.py#L623-L627)、[server.py:644-645](../../examples/server.py#L644-L645)）。
> - 再読込み時に `_CFG` の更新が届かず環境変数経由の引継ぎになる振る舞いがある（[server.py:3803-3818](../../examples/server.py#L3803-L3818)）。
> - examples/hooks/cache.py では `CACHE` と `SKIPS` の共有により先行実行が後続の判定に残る（[cache.py:15-16](../../examples/hooks/cache.py#L15-L16)、[cache.py:59-60](../../examples/hooks/cache.py#L59-L60)）。
> - research/evals/act_head_eval.py では非有限値が混ざると `allow_nan` の設定により出力が失敗する（[act\_head\_eval.py:301-304](../../research/evals/act_head_eval.py#L301-L304)）。
> - 統合層では `last_decision` を残さないと次の説明取得が前の内容を返す（[crewai.py:327](../../laya/integrations/crewai.py#L327)、[llamaindex.py:622](../../laya/integrations/llamaindex.py#L622)）。
> - examples/_common.py の `describe` は未知の型を定型の肯定否定として表示するため誤表示になる（[\_common.py:150-175](../../examples/_common.py#L150-L175)）。 <!-- b_wfx1ffk7 -->

> [!WARNING]
> **落とし穴**
> - `RemoteError` と `ToolError` と `SchemaError` の使い分けを誤ると層の誤りが混ざる（[remote.py:42-45](../../laya/mcp/remote.py#L42-L45)、[tools.py:14-17](../../laya/mcp/tools.py#L14-L17)、[structured.py:30](../../laya/structured.py#L30)）。
> - 複数統合では `_call_remote` の修正漏れで振る舞いがずれる（[llamaindex.py:139](../../laya/integrations/llamaindex.py#L139)、[crewai.py:143](../../laya/integrations/crewai.py#L143)、[langchain.py:154](../../laya/integrations/langchain.py#L154)）。
> - `_laya_serve` からの `getattr` 取得が欠けると代替実装に落ちて上限や検証がずれる（[server.py:188](../../examples/server.py#L188)、[server.py:201](../../examples/server.py#L201)）。
> - `CHECKPOINTS` の名寄せがずれると道具間で対象が食い違う（[dump\_golden.py:61](../../laya-dotnet/tools/dump_golden.py#L61)、[bench\_python.py:57](../../laya-dotnet/tools/bench_python.py#L57)、[regen\_golden.py:63](../../laya-dotnet/tools/regen_golden.py#L63)）。 <!-- b_16x60hek -->

- （検出されませんでした）
<!-- b_dnxwqj0k -->

| モジュール | パス | 行数 |
|---|---|---|
| 書き出しと計測道具 | `laya-dotnet-tools-research-scripts` | 5768 |
| ベンチマークと生成スクリプト | `research-scripts-laya-java-scripts` | 3312 |
| 測定証跡と起動準備 | `benchmarks-results-compile-defaults` | 2337 |
| 動作例とデモサーバ | `examples` | 5987 |
| JVM 推論と回答生成 | `com-convaiinnovations-laya` | 3006 |
| 動作例と連携見本 | `examples-laya-dotnet-samples-laya-ts-examples` | 2885 |
| .NET 推論エンジン | `laya-dotnet-laya` | 3098 |
| 外部連携アダプター | `laya/integrations` | 2155 |
<!-- b_asjted16 -->
