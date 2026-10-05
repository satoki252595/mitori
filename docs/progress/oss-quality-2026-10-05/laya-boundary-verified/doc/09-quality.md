# 9. 非機能 <!-- b_5enxz76p -->

## ホットパス <!-- b_e3tzmtqy -->

laya 配下の推論層と HTTP 層とバックエンド層にまたがり、符号化形状と推論直列化が時間を決める性質が共通する（推測）。HTTP 層では `Agent.system_one` が同期的推論として単一ワーカーで直列化される例がある（[serve.py:880-887](../../laya/serve.py#L880-L887)）。バックエンド層では `bucket_shape` による形状丸めと `FastLaya` による高速路が再コンパイルと注意計算の費用を抑える例がある（[base.py:37](../../laya/backends/base.py#L37)、[fast.py:28-29](../../laya/fast.py#L28-L29)）。符号化層では双方向符号化で頭部を使い回せないため形状がそのまま費用になる例がある（[common.py:322-326](../../laya/common.py#L322-L326)）。 <!-- b_k5hf5twy -->

## キャッシュ <!-- b_nz2g8pk3 -->

- 符号化済み質問と接頭辞と埋め込みを使い回す方針が laya 配下と laya-ts 配下にまたがり共通する（推測）。
- `_TOKENIZERS` にトークナイザーを集約し、`WARMUP_SHAPES` で事前にグラフを構築する例がある（[agent.py:162-163](../../laya/agent.py#L162-L163)、[agent.py:901-904](../../laya/agent.py#L901-L904)）。
- `_QUESTION_TOKEN_CACHE` と `_reuse_question_tokens` が質問の符号化を再利用する例がある（[common.py:28-29](../../laya/common.py#L28-L29)、[common.py:38](../../laya/common.py#L38)）。
- `cached_embed_fn` が上限付きで埋め込みを保持して絞り込みを速める例がある（[shortlist.py:183-186](../../laya/shortlist.py#L183-L186)）。
- `prefixCache` が接頭辞を再利用する例がある（[common.ts:87-89](../../laya-ts/src/common.ts#L87-L89)）。
- `cached` に写像を保持し `max_len` で切詰める例がある（[tokenizer.ts:57-58](../../laya-ts/src/tokenizer.ts#L57-L58)、[agent.ts:118-120](../../laya-ts/src/agent.ts#L118-L120)）。 <!-- b_gcdhnqzw -->

## 上限値 <!-- b_95xjw49p -->

- 入力規模と常駐量と温度に上限を設ける方針が laya 配下と laya-ts 配下と HTTP 層にまたがり共通する（推測）。
- HTTP 層は `MAX_QUESTIONS` らで巨大入力を拒否する例がある（[serve.py:74-77](../../laya/serve.py#L74-L77)）。
- `max_loaded` を上限に `_evict_locked` で追い出す例がある（[router.py:477](../../laya/router.py#L477)、[router.py:611-618](../../laya/router.py#L611-L618)、[router.py:732-734](../../laya/router.py#L732-L734)、[router.py:782](../../laya/router.py#L782)）。
- `window_budget` と `window_batch_cap` は窓数と一括量を抑えて膨張を防ぐ例がある（[common.py:272-273](../../laya/common.py#L272-L273)、[common.py:360-361](../../laya/common.py#L360-L361)）。
- `clamp_temperature` は温度を `TEMP_MIN` から `TEMP_MAX` に収める例がある（[common.py:711-715](../../laya/common.py#L711-L715)）。
- `clampTemperature` は温度を `TEMP_MIN` から `TEMP_MAX` に収める例がある（[common.ts:347-348](../../laya-ts/src/common.ts#L347-L348)）。
- `criteria` は選択では非空であり採点では非空列である例がある（[agent.ts:217-226](../../laya-ts/src/agent.ts#L217-L226)、[agent.ts:262-270](../../laya-ts/src/agent.ts#L262-L270)）。
- 同時実行枠が埋まっていると 503 と `Retry-After` の 1 で断る例があり、枠は `LAYA_MAX_CONCURRENT` で与える（[serve.py:1031-1037](../../laya/serve.py#L1031-L1037)、[serve.py:272](../../laya/serve.py#L272)）。 <!-- b_zdrfgpva -->

## セキュリティ境界 <!-- b_h5djeeba -->

- HTTP 層は `LAYA_HOST` の既定値 0.0.0.0 で待ち受ける（[serve.py:1280-1283](../../laya/serve.py#L1280-L1283)）。
- 認証は `LAYA_API_KEY` が未設定の場合に無効となり、`_authorized` が真を返して通過させ、設定時のみ `hmac.compare_digest` による照合が有効になる（[serve.py:878](../../laya/serve.py#L878)、[serve.py:967-972](../../laya/serve.py#L967-L972)）。
- 有効時の認証失敗は `_check_auth` が 401 で拒み、未認証呼び出し元には `LIVENESS_ONLY` のみを返す開放点を残す（[serve.py:974-976](../../laya/serve.py#L974-L976)、[serve.py:985-992](../../laya/serve.py#L985-L992)）。
- 呼び出し元入力の検証は laya 配下の HTTP 層の境界で完結し、`questions` の空や `_has_lone_surrogate` の真を 400 で拒む例がある（[serve.py:1054-1055](../../laya/serve.py#L1054-L1055)、[serve.py:1066-1067](../../laya/serve.py#L1066-L1067)）。
- 成果物読み込みと laya-ts 配下も各々の境界で検証し、`expected_sha256` の事前検証と `checkQuestion` の形式検査を例とする（[agent.py:513-516](../../laya/agent.py#L513-L516)、[agent.ts:169-183](../../laya-ts/src/agent.ts#L169-L183)）。 <!-- b_neajp6xz -->

## 信頼性 <!-- b_30b98nc8 -->

- 失敗の伝播と縮退と再試行を使い分ける方針が読み込み層と評価層と TypeScript 層にまたがり共通する（推測）。
- `load` 失敗は待機者にも伝播する例がある（[router.py:692](../../laya/router.py#L692)、[router.py:708-710](../../laya/router.py#L708-L710)、[router.py:738-744](../../laya/router.py#L738-L744)）。
- `predict_batch` 対応を持たない場合は `predict` を順に呼ぶ縮退路に落ちる例がある（[evals\_cli.py:78-82](../../laya/evals_cli.py#L78-L82)、[evals\_cli.py:88-89](../../laya/evals_cli.py#L88-L89)）。
- フック失敗は `hooks_raise` が真なら送出し、偽なら警告して続行する例がある（[agent.py:543-545](../../laya/agent.py#L543-L545)）。
- 利用不能なバックエンドは `BackendUnavailable` で通知される例がある（[base.py:75](../../laya/backends/base.py#L75)）。
- `from_dict` と `from_jsonl` は不正行を `EvalError` で拒む例がある（[evals.py:65-81](../../laya/evals.py#L65-L81)、[evals.py:112-113](../../laya/evals.py#L112-L113)）。
- `fetchWithRetry` は再試行し `dispatchAsync` は集約する例がある（[providers.ts:201](../../laya-ts/src/providers.ts#L201)、[hooks.ts:360-365](../../laya-ts/src/hooks.ts#L360-L365)）。
- `RemoteError` と `ToolError` と `SchemaError` で区分する例がある（[remote.py:42-45](../../laya/mcp/remote.py#L42-L45)、[tools.py:14-17](../../laya/mcp/tools.py#L14-L17)、[structured.py:30](../../laya/structured.py#L30)）。 <!-- b_26mgae85 -->

## 可観測性 <!-- b_7dfgn9pd -->

- 計測記録と警告による可視化がベンチマーク記録と推論層にまたがり共通する（推測）。
- 各 `.log` は 30 件の要求タイミングとキャッシュカウンターやメモリー、`nvidia-smi` のスナップショットを含む例がある（[README.md:12-14](../../benchmarks/results/compile-defaults/README.md#L12-L14)）。
- `cold` 実験は新規ディレクトリーで始め、`restart` は同ディレクトリーを別プロセスで使う例がある（[README.md:14-16](../../benchmarks/results/compile-defaults/README.md#L14-L16)）。
- 混雑したタイミングは観測値であり、再利用の判定は `FX` カウンターで行う例がある（[README.md:20-24](../../benchmarks/results/compile-defaults/README.md#L20-L24)）。
- `load_s` と `cold_ms` で読込費と実行費を分けて示す例がある（[17\_timing\_a\_call.py:52-61](../../examples/17_timing_a_call.py#L52-L61)）。
- `health` は常駐名やリビジョンやデバイス状態と `cpu_fallbacks` を返す（[serve.py:978-979](../../laya/serve.py#L978-L979)、[serve.py:1016-1022](../../laya/serve.py#L1016-L1022)）。
- 記録水準は `LAYA_LOG_LEVEL` の既定で決まる（[serve.py:1284](../../laya/serve.py#L1284)）。
- `LAYA_JEV_STRICT` が真なら結果を投影する例がある（[serve.py:1103-1104](../../laya/serve.py#L1103-L1104)）。 <!-- b_17q47qvz -->
