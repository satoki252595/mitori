# 選定と予測公開 <!-- b_wan6aj7s -->

- ファイル 15 · 5960 行 · 重要度 1.00
<!-- b_0xwtaxcs -->

**変更の手引き**
- 影響が及ぶ先（このモジュールを使う）: [書き出しと計測道具](laya-dotnet-tools-research-scripts.md)・[動作例とデモサーバ](examples.md)・[判定基盤と評価群](laya-research-eval-notebooks.md)・[動作例と連携見本](examples-laya-dotnet-samples-laya-ts-examples.md)・[外部連携アダプター](laya-integrations.md)・[ベンチマークと生成スクリプト](research-scripts-laya-java-scripts.md) ほか 1
- 使っているもの: [推論エージェント](laya-agent.md)・[ベンチマークと生成スクリプト](research-scripts-laya-java-scripts.md)・[判定基盤と評価群](laya-research-eval-notebooks.md)・[動作例とデモサーバ](examples.md)
- テスト: `tests/test_serve.py`（138 件）・`tests/test_mcp.py`（33 件）・`tests/test_mcp_remote.py`（26 件）・`tests/test_router_memory.py`（9 件） ほか 32
- 入口から: `POST /v1/systemone`（`laya/serve.py:1044`）・`POST /v1/systemone/batch`（`laya/serve.py:1130`）・`GET /health`（`laya/serve.py:978`）・`routes`（`research/eval/presentation_checks.py:370`）・`create_app.systemone_batch`（`laya/serve.py:1130`）
- よく使われる宣言（変えると波及する）: `Router` `laya/router.py:477`（11 ファイル）・`check_min_confidence` `laya/confidence.py:86`（8 ファイル）・`decide` `laya/structured.py:283`（6 ファイル）・`apply_confidence_gate` `laya/confidence.py:178`（4 ファイル）・`normalise_name` `laya/router.py:114`（4 ファイル）
- 一緒に変わりやすいファイル（直近 289 commit）: `laya/agent.py` 9 回・`tests/test_hooks_api.py` 8 回・`examples/server.py` 6 回・`nix/package.nix` 6 回・`pyproject.toml` 6 回
- 注意: ハブ（多くから使われ、多くを使う）・大きいファイル `laya/router.py`（1,614 行）・循環依存（[推論エージェント](laya-agent.md)・[ベンチマークと生成スクリプト](research-scripts-laya-java-scripts.md)・[動作例とデモサーバ](examples.md) ほか 2 と）
<!-- b_apwkprzq -->

**大きなファイルの中身（1,500 行を超えるファイル）**
- `laya/router.py`（1,614 行）
  - `laya/router.py:50-62` 定数・変数（3）: `BUNDLE_REPO`・`DEFAULT_MODELS`・`STANDALONE_MODELS`
  - `laya/router.py:65-76` 関数（2）: `_repo_str`・`_split`
  - `laya/router.py:79-93` 定数・変数（2）: `_ALIASES`・`_TYPED_DECISION_WORKFLOWS`
  - `laya/router.py:96-159` 関数（5）: `RouteDecision`・`normalise_name`・`resolve_model_spec`・`match_typed_decisions_workflow`
  - `laya/router.py:165-173` 定数・変数（2）: `_ENGLISH_SUBTAGS`・`_LANGUAGE_AGNOSTIC_CODES`
  - `laya/router.py:176-302` 関数（3）: `_english_from_code`・`_takes_lang`・`_ScanLong`
  - `laya/router.py:311-322` 定数・変数（2）: `_SCAN`・`_ROUTER_OWNED_AGENT_ARGS`
  - `laya/router.py:325-474` 関数（6）: `check_agent_kwargs`・`_digests_from_env`・`_revision_pin`・`_digest_entry`
  - `laya/router.py:477-1614` Router（クラス）
    - `laya/router.py:478-690` 状態（6）: `hooks_raise`・`hooks_concurrent`・`hooks_timeout`・`_hooks_lock`
    - `laya/router.py:691-931` loading — メソッド 12: `load`・`_build`・`_touch`・`_evict_locked`
    - `laya/router.py:932-1053` routing — メソッド 2: `route`・`_route`
    - `laya/router.py:1054-1613` running — メソッド 10・状態 2: `predict`・`predict_long`・`decide`・`decide_batch`
<!-- b_2hzzbgq9 -->

> [!NOTE]
> **この章で分かること**
> - `Router` の選定と予測の全体像を学ぶ
> - HTTP と MCP と CLI の公開経路の違いを学ぶ
> - 信頼度と構造化出力の扱いを学ぶ <!-- b_q8t90eap -->

## 責務 <!-- b_y7p646hn -->

`Router` は `state` と `questions` を受けて担当を選び回答を返す窓口である（[router.py:477](../../../laya/router.py#L477)、[router.py:1055-1059](../../../laya/router.py#L1055-L1059)）。HTTP 公開は `create_app` が担い、MCP と CLI は別経路で同操作を提供する（[serve.py:865](../../../laya/serve.py#L865)、[server.py:69](../../../laya/mcp/server.py#L69)、[cli.py:381](../../../laya/cli.py#L381)）。学習や推論核は持たず、`Agent` の呼び出しに専念する（[router.py:692-695](../../../laya/router.py#L692-L695)、[router.py:1140-1141](../../../laya/router.py#L1140-L1141)）。 <!-- b_43cz9nqb -->

## 公開インターフェース <!-- b_mps7n01n -->

- `Router` は選定と読み込みと予測を束ねる中心である（[router.py:477](../../../laya/router.py#L477)、[router.py:933-934](../../../laya/router.py#L933-L934)、[router.py:692-693](../../../laya/router.py#L692-L693)、[router.py:1055-1056](../../../laya/router.py#L1055-L1056)）。
- `RouteDecision` は `model` と `reason` を持つ辞書である（[router.py:96-107](../../../laya/router.py#L96-L107)）。
- `route` は `state` と `questions` から担当を決める（[router.py:933-937](../../../laya/router.py#L933-L937)）。
- `predict` は選定後に全問へ答え、`system_one` は別名である（[router.py:1055-1056](../../../laya/router.py#L1055-L1056)、[router.py:1072-1075](../../../laya/router.py#L1072-L1075)、[router.py:1281](../../../laya/router.py#L1281)）。
- `predict_batch` と `route_batch` は複数をまとめて扱う（[router.py:1283-1290](../../../laya/router.py#L1283-L1290)、[router.py:1343-1350](../../../laya/router.py#L1343-L1350)）。
- `load` と `preload` と `unload` と `attach` は常駐を操作する（[router.py:692](../../../laya/router.py#L692)、[router.py:834](../../../laya/router.py#L834)、[router.py:853](../../../laya/router.py#L853)、[router.py:820](../../../laya/router.py#L820)）。
- `create_app` は公開部を、`RemoteRouter` は遠隔形を担う（[serve.py:865](../../../laya/serve.py#L865)、[remote.py:62](../../../laya/mcp/remote.py#L62)）。 <!-- b_76mkffaq -->

## 依存関係 <!-- b_3s66vmsq -->

- `laya` の agent 系は `compile_model` らで基盤を提供する（推測）。
- `research` 系は `load_policy` らで評価を共有する（推測）。
- `examples` 系と `laya/integrations` 系は利用者である（推測）。 <!-- b_0bsgmptc -->

## データ構造 <!-- b_k4n5qtvv -->

- `RouteDecision` は `model` と `reason` を持つ（[router.py:96-107](../../../laya/router.py#L96-L107)）。
- `DecisionResult` は `values` と `confidence` と `answers` らを持つ（[structured.py:35-66](../../../laya/structured.py#L35-L66)）。
- `_Field` は `name` と `kind` と `question` を持つ（[structured.py:70-75](../../../laya/structured.py#L70-L75)）。 <!-- b_1dhzt21h -->

## 処理の流れ <!-- b_zs9hkrhg -->

1. `predict` は検証後に `compose_hooks` で束ね `PredictContext` を作る（[router.py:1055-1056](../../../laya/router.py#L1055-L1056)、[router.py:1079-1082](../../../laya/router.py#L1079-L1082)、[router.py:1084-1097](../../../laya/router.py#L1084-L1097)）。
2. `route` で決め `load` で `agent` を得て開始を知らせる（[router.py:1105-1111](../../../laya/router.py#L1105-L1111)、[router.py:1118-1119](../../../laya/router.py#L1118-L1119)）。
3. `system_one` か `scan.run` で推論し `routing` を付ける（[router.py:1130-1141](../../../laya/router.py#L1130-L1141)、[router.py:1153-1156](../../../laya/router.py#L1153-L1156)）。
4. `apply_confidence_gate` 後に終了を知らせ先頭を返す（[router.py:1172-1176](../../../laya/router.py#L1172-L1176)、[router.py:1182](../../../laya/router.py#L1182)）。 <!-- b_tqfwe113 -->

## 設定 <!-- b_thafxd53 -->

- `LAYA_HOST` と `LAYA_PORT` と `LAYA_ROOT_PATH` は位置を決める（[serve.py:1282](../../../laya/serve.py#L1282)、[serve.py:517](../../../laya/serve.py#L517)、[serve.py:954](../../../laya/serve.py#L954)）。
- `LAYA_MAX_CONCURRENT` と `LAYA_MAX_LOADED` は同時と常駐を絞る（[serve.py:272](../../../laya/serve.py#L272)、[serve.py:476](../../../laya/serve.py#L476)）。
- `LAYA_MAX_TOKEN_BUDGET` と `LAYA_MAX_BATCH_TOKENS` は予算を決める（[serve.py:299](../../../laya/serve.py#L299)、[serve.py:319](../../../laya/serve.py#L319)）。
- `LAYA_MODELS` と `LAYA_BASE_URL` と `LAYA_API_KEY` は接続を決める（[server.py:126](../../../laya/mcp/server.py#L126)、[server.py:137](../../../laya/mcp/server.py#L137)、[server.py:170](../../../laya/mcp/server.py#L170)）。
- `LAYA_IDLE_UNLOAD_SECONDS` と `LAYA_THREADS` と `HF_TOKEN` は解放と並列と認証である（[serve.py:284](../../../laya/serve.py#L284)、[serve.py:822](../../../laya/serve.py#L822)、[router.py:643](../../../laya/router.py#L643)）。 <!-- b_e8rjqytq -->

## テスト <!-- b_t044nqbk -->

`test_router_context_manager_cleanup` は解放を検証する（[test\_context\_manager.py:9](../../../tests/test_context_manager.py#L9)）。`test_batch_matches_single` と `test_mixed_language_batch_routes_and_preserves_order` は一致と順序を検証する（[test\_predict\_batch.py:88](../../../tests/test_predict_batch.py#L88)、[test\_predict\_batch.py:140](../../../tests/test_predict_batch.py#L140)）。`test_predict_posts_the_serve_body_and_returns_it_unchanged` と `test_http_errors_map_to_tool_error_codes` は転送とエラー対応を検証する（[test\_mcp\_remote.py:91](../../../tests/test_mcp_remote.py#L91)、[test\_mcp\_remote.py:122](../../../tests/test_mcp_remote.py#L122)）。`test_unparseable_values_are_rejected_by_name` は拒否を検証する（[test\_mcp\_device.py:82](../../../tests/test_mcp_device.py#L82)）。 <!-- b_essg7560 -->

## 不変条件 <!-- b_fdr387af -->

- `predict` 戻り値には常に `routing` が付く（[router.py:1055-1056](../../../laya/router.py#L1055-L1056)、[router.py:1153-1162](../../../laya/router.py#L1153-L1162)）。
- `load` は名ごとに単一実体を共有する（[router.py:692-710](../../../laya/router.py#L692-L710)）。
- `system_one` は `predict` と、`predict_many` は `predict_batch` と同一である（[router.py:1281](../../../laya/router.py#L1281)、[router.py:1578](../../../laya/router.py#L1578)）。 <!-- b_1em8fecx -->

## エラー処理 <!-- b_qmf8nrpk -->

- `predict` は不正引数に `TypeError` を送出する（[router.py:1055-1056](../../../laya/router.py#L1055-L1056)、[router.py:1079-1082](../../../laya/router.py#L1079-L1082)）。
- `load` 失敗は待機者にも伝播する（[router.py:692](../../../laya/router.py#L692)、[router.py:708-710](../../../laya/router.py#L708-L710)、[router.py:738-744](../../../laya/router.py#L738-L744)）。
- `RemoteError` と `ToolError` と `SchemaError` で区分する（[remote.py:42-45](../../../laya/mcp/remote.py#L42-L45)、[tools.py:14-17](../../../laya/mcp/tools.py#L14-L17)、[structured.py:30](../../../laya/structured.py#L30)）。 <!-- b_a5d37cv4 -->

## 並行性 <!-- b_hj9d6jth -->

`load` は `_lock` と `_build_lock` で重複を抑え `done` で合流する（[router.py:692-708](../../../laya/router.py#L692-L708)、[router.py:715-716](../../../laya/router.py#L715-L716)）。フックは解放後に発火し、`hooks_concurrent` で並行する（[router.py:746-750](../../../laya/router.py#L746-L750)、[router.py:605-607](../../../laya/router.py#L605-L607)）。 <!-- b_kj52ytjp -->

## 性能 <!-- b_ze2c6hkb -->

`Router` は `max_loaded` を上限に `_evict_locked` で追い出す（[router.py:477](../../../laya/router.py#L477)、[router.py:611-618](../../../laya/router.py#L611-L618)、[router.py:732-734](../../../laya/router.py#L732-L734)、[router.py:782](../../../laya/router.py#L782)）。HTTP 層は `MAX_QUESTIONS` らで巨大入力を拒否する（[serve.py:74-77](../../../laya/serve.py#L74-L77)）。 <!-- b_gv9fec4t -->

## 落とし穴 <!-- b_cdwkp3dy -->

> [!WARNING]
> **落とし穴**
> - `predict` は `_SCAN` を消去し再入に継承させない（[router.py:1098-1102](../../../laya/router.py#L1098-L1102)）。
> - `scan.run` は `hooks_timeout` 外で `ctx.max_len` も届かない（[router.py:1123-1130](../../../laya/router.py#L1123-L1130)）。
> - `BODY_REFUSALS` の `hooks` 系は HTTP で拒否される（[serve.py:138](../../../laya/serve.py#L138)、[serve.py:356](../../../laya/serve.py#L356)）。 <!-- b_1zvw6wt9 -->

## 深掘り <!-- b_fcxvd3hy -->

> [!NOTE]
> **深掘り**
> - 英語判定と言語推定の調整過程 <!-- b_eh5qdgnw -->

> [!TIP]
> **まとめ**
> 選定と予測と公開を束ねる層である。 <!-- b_10vhzgdy -->
