# 外部連携アダプター（laya/integrations） <!-- b_77a2hmb3 -->

- ファイル 7 · 2155 行 · 重要度 0.05
<!-- b_ss7dyked -->

**変更の手引き**
- 影響が及ぶ先（このモジュールを使う）: [動作例と連携見本](examples-laya-dotnet-samples-laya-ts-examples.md)
- 使っているもの: [選定と予測公開](laya-router.md)
- テスト: `tests/test_audit_regressions.py`（12 件）・`tests/test_crewai.py`・`tests/test_hooks_api.py`・`tests/test_langchain.py` ほか 2
- よく使われる宣言（変えると波及する）: `budget_kwargs` `laya/integrations/_controls.py:35`（3 ファイル）・`decision_kwargs` `laya/integrations/_controls.py:47`（3 ファイル）・`predict_kwargs` `laya/integrations/_controls.py:61`（3 ファイル）・`hook_kwargs` `laya/integrations/_controls.py:73`（3 ファイル）・`reject_remote_hooks` `laya/integrations/_controls.py:88`（3 ファイル）
- 一緒に変わりやすいファイル（直近 289 commit）: `laya/agent.py` 5 回・`tests/test_hooks.py` 5 回・`benchmarks/bench_compile_defaults.py` 3 回・`laya/mcp/remote.py` 3 回・`tests/test_compile.py` 3 回
<!-- b_99yq24q1 -->

> [!NOTE]
> **この章で分かること**
> - 各フレームワークに対応する選択コンポーネントの使い分けがわかる。
> - ローカル判定と HTTP 委譲の切り替えがわかる。
> - 信頼度不足時の分岐と例外がわかる。 <!-- b_j1gw6fqf -->

## 責務 <!-- b_zthxbnkw -->

laya/integrations は LangChain と CrewAI と LlamaIndex 向けのアダプターであり、フレームワーク固有の選択要求を `choice` 質問に変換して共通判定に渡す（[langchain.py:390](../../../laya/integrations/langchain.py#L390)、[crewai.py:244](../../../laya/integrations/crewai.py#L244)、[llamaindex.py:240](../../../laya/integrations/llamaindex.py#L240)、[crewai.py:302-304](../../../laya/integrations/crewai.py#L302-L304)）。推論自体は持たず、`agent` 指定のローカル実行と `base_url` 指定の HTTP 委譲を使い分ける（[langchain.py:220-224](../../../laya/integrations/langchain.py#L220-L224)、[crewai.py:143-144](../../../laya/integrations/crewai.py#L143-L144)）。判定本体や言語処理は laya 本体に任せ、ここでは変換と後処理に徹する（推測）。 <!-- b_phw8x9p3 -->

## 公開インターフェース <!-- b_f4hap77s -->

- `LayaRouter` は `criteria` から経路名を選ぶ LangChain 用コンポーネントである（[langchain.py:390](../../../laya/integrations/langchain.py#L390)、[langchain.py:398](../../../laya/integrations/langchain.py#L398)）。
- `LayaGuardrail` と `LayaTaskGuard` は検査し、違反時の扱いを選べる（[langchain.py:543](../../../laya/integrations/langchain.py#L543)、[langchain.py:558-559](../../../laya/integrations/langchain.py#L558-L559)、[crewai.py:425](../../../laya/integrations/crewai.py#L425)、[crewai.py:435](../../../laya/integrations/crewai.py#L435)）。
- `LayaDecision` は `decision_schema` 形状の決定を返す（[langchain.py:1034](../../../laya/integrations/langchain.py#L1034)、[langchain.py:1046](../../../laya/integrations/langchain.py#L1046)）。
- `LayaCrewRouter` はタスクを担当者に割り当て、`CrewRouteDecision` を返す（[crewai.py:244](../../../laya/integrations/crewai.py#L244)、[crewai.py:290-294](../../../laya/integrations/crewai.py#L290-L294)）。
- `LayaSingleSelector` と `LayaMultiSelector` はツール選択を担う（[llamaindex.py:240-250](../../../laya/integrations/llamaindex.py#L240-L250)、[llamaindex.py:387-397](../../../laya/integrations/llamaindex.py#L387-L397)）。
- `LayaQueryRouter` はクエリ先のキーを選ぶ（[llamaindex.py:541](../../../laya/integrations/llamaindex.py#L541)、[llamaindex.py:589-590](../../../laya/integrations/llamaindex.py#L589-L590)）。 <!-- b_prk8sarz -->

## 依存関係 <!-- b_dkerdbcs -->

判定実行は directory laya の `PRESETS` などに委ねる（推測）。`LayaRouter` は `RunnableSerializable` を継承し、フレームワーク型に適合する（[langchain.py:390](../../../laya/integrations/langchain.py#L390)）。リポジトリ直下の examples は `agent` を含み、こちらを利用する（推測）。 <!-- b_esjrvc2h -->

## データ構造 <!-- b_gwn76pzr -->

- `CrewRouteDecision` は `agent` と `agent_index` と `role` と `confidence` と `reason` と `raw_decision` を持つ（[crewai.py:68-76](../../../laya/integrations/crewai.py#L68-L76)）。
- `SelectorResult` は `selections` を持ち、`ToolSelection` は `index` と `reason` を持つ（[llamaindex.py:47-53](../../../laya/integrations/llamaindex.py#L47-L53)）。
- `criteria` は候補名から説明文への写像である（[langchain.py:398](../../../laya/integrations/langchain.py#L398)）。 <!-- b_79dw572c -->

## 処理の流れ <!-- b_6pps4vj3 -->

1. `_extract_task_str` でタスク文を整え、`criteria` を作る（[crewai.py:299-300](../../../laya/integrations/crewai.py#L299-L300)）。
2. `choice` 質問を組み立て、`_execute_decision` に渡す（[crewai.py:304-310](../../../laya/integrations/crewai.py#L304-L310)）。
3. `last_decision` に保存し、`answers` から `choice` を読む（[crewai.py:327-330](../../../laya/integrations/crewai.py#L327-L330)）。
4. `confidence_threshold` 未満は `fallback_agent_index` か例外へ分岐する（[crewai.py:350-351](../../../laya/integrations/crewai.py#L350-L351)、[crewai.py:367](../../../laya/integrations/crewai.py#L367)）。 <!-- b_sgacqccv -->

## エラー処理 <!-- b_weaq8dwb -->

`LayaLowConfidenceError` は信頼度不足を、`LayaTaskGuardError` と `LayaGuardrailError` は遮断内容を運ぶ（[\_errors.py:5-8](../../../laya/integrations/_errors.py#L5-L8)、[crewai.py:45-48](../../../laya/integrations/crewai.py#L45-L48)、[langchain.py:40-43](../../../laya/integrations/langchain.py#L40-L43)）。候補不在時は `ValueError` を送出し、低信頼度時は既定担当者か例外を選べる（[crewai.py:296-297](../../../laya/integrations/crewai.py#L296-L297)、[crewai.py:350-351](../../../laya/integrations/crewai.py#L350-L351)、[crewai.py:367](../../../laya/integrations/crewai.py#L367)）。 <!-- b_ttz5cxy7 -->

## 並行性 <!-- b_agfzx66z -->

`_DEFAULT_ROUTER` を `_DEFAULT_ROUTER_LOCK` で遅延初期化して共有する（[langchain.py:206-210](../../../laya/integrations/langchain.py#L206-L210)）。選択と委譲に `async` 版を備え、同期的判定を非同期フレームワークから呼べる（[crewai.py:402](../../../laya/integrations/crewai.py#L402)、[langchain.py:369](../../../laya/integrations/langchain.py#L369)）。 <!-- b_ehskctnm -->

## 落とし穴 <!-- b_6zb9e3my -->

> [!WARNING]
> **落とし穴**
> - `_call_remote` は 3 ファイルで重複し、修正は連動する（[llamaindex.py:139](../../../laya/integrations/llamaindex.py#L139)、[crewai.py:143](../../../laya/integrations/crewai.py#L143)、[langchain.py:154](../../../laya/integrations/langchain.py#L154)）。
> - `last_decision` への保存を忘れると直後の説明取得がずれる（[crewai.py:327](../../../laya/integrations/crewai.py#L327)、[llamaindex.py:622](../../../laya/integrations/llamaindex.py#L622)）。 <!-- b_613112xh -->

> [!TIP]
> **まとめ**
> フレームワーク別の選択要求を共通判定に寄せ、信頼度で分岐するアダプターである。 <!-- b_sfm81tfz -->
