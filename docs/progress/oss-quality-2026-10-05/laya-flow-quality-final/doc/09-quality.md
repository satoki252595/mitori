# 9. 非機能 <!-- b_5enxz76p -->

## ホットパス <!-- b_e3tzmtqy -->

laya 配下の推論層と HTTP 層とバックエンド層にまたがり符号化形状と推論直列化が時間を決める性質が共通する（推測）。`Agent.system_one` は数百ミリ秒から数秒かかる同期的推論であり単一ワーカーで直列化される（[serve.py:880-887](../../laya/serve.py#L880-L887)）。`bucket_shape` による形状丸めと `FastLaya` による高速路が再コンパイルと注意計算の費用を抑える例がある（[base.py:37](../../laya/backends/base.py#L37)、[fast.py:28-29](../../laya/fast.py#L28-L29)）。双方向符号化では頭部を使い回せないため形状がそのまま費用になる例がある（[common.py:322-326](../../laya/common.py#L322-L326)）。 <!-- b_k5hf5twy -->

## キャッシュ <!-- b_nz2g8pk3 -->

- laya 配下と laya-ts 配下にまたがり符号化済み質問と接頭辞と埋め込みを使い回す方針が共通する（推測）。
- `_QUESTION_TOKEN_CACHE` と `_reuse_question_tokens` が質問の符号化を再利用する例がある（[common.py:28-29](../../laya/common.py#L28-L29)、[common.py:38](../../laya/common.py#L38)）。
- `cached_embed_fn` が上限付きで埋め込みを保持して絞り込みを速める例がある（[shortlist.py:183-186](../../laya/shortlist.py#L183-L186)）。
- `prefixCache` が接頭辞を再利用する例がある（[common.ts:87-89](../../laya-ts/src/common.ts#L87-L89)）。
- `load` が名ごとに単一実体を共有する例がある（[router.py:692-710](../../laya/router.py#L692-L710)）。
- `cached` に写像を保持し `max_len` で切詰める例がある（[tokenizer.ts:57-58](../../laya-ts/src/tokenizer.ts#L57-L58)、[agent.ts:118-120](../../laya-ts/src/agent.ts#L118-L120)）。 <!-- b_gcdhnqzw -->

## 上限値 <!-- b_95xjw49p -->

- laya 配下と laya-ts 配下と HTTP 層にまたがり入力規模と常駐量と温度に上限を設ける方針が共通する（推測）。
- `MAX_QUESTIONS` らで巨大入力を拒否する例がある（[serve.py:74-77](../../laya/serve.py#L74-L77)）。
- `max_loaded` を上限に `_evict_locked` で追い出す例がある（[router.py:477](../../laya/router.py#L477)、[router.py:611-618](../../laya/router.py#L611-L618)、[router.py:732-734](../../laya/router.py#L732-L734)、[router.py:782](../../laya/router.py#L782)）。
- `window_budget` と `window_batch_cap` が窓数と一括量を抑えて膨張を防ぐ例がある（[common.py:272-273](../../laya/common.py#L272-L273)、[common.py:360-361](../../laya/common.py#L360-L361)）。
- `clampTemperature` が `TEMP_MIN` から `TEMP_MAX` に収める例がある（[common.ts:347-348](../../laya-ts/src/common.ts#L347-L348)）。
- `ThreadPoolExecutor` を `max_workers` 1 で直列化し超過負荷を 503 で拒否する例がある（[serve.py:887](../../laya/serve.py#L887)、[serve.py:1031-1037](../../laya/serve.py#L1031-L1037)）。
- `_resolve_port` が `LAYA_PORT` を 1 から 65535 に検証する例がある（[serve.py:515-524](../../laya/serve.py#L515-L524)）。
- `_idle_reaper` が `idle_unload_seconds` に基づき 0.05 から 5.0 秒で待機開放を巡回する例がある（[serve.py:923-924](../../laya/serve.py#L923-L924)）。 <!-- b_zdrfgpva -->

## セキュリティ境界 <!-- b_h5djeeba -->

- laya 配下と laya-ts 配下と成果物読み込みにまたがり呼び出し元を信用しない前提が共通する（推測）。
- `_check_auth` が `_authorized` 経由で `hmac.compare_digest` 照合し 401 で拒否する例がある（[serve.py:967-976](../../laya/serve.py#L967-L976)）。
- `health` が未認証呼び出しに `LIVENESS_ONLY` のみ返す例がある（[serve.py:978-979](../../laya/serve.py#L978-L979)、[serve.py:991-992](../../laya/serve.py#L991-L992)）。
- `_has_lone_surrogate` が孤立サロゲートを 400 で拒否する例がある（[serve.py:1066-1067](../../laya/serve.py#L1066-L1067)）。
- `_refuse_body_refusals` がフック系を呼び出し元に渡さない例がある（[serve.py:1148-1152](../../laya/serve.py#L1148-L1152)）。
- `expected_sha256` が重み解釈前に検証され不一致や欠落は読込みを拒否する例がある（[agent.py:513-516](../../laya/agent.py#L513-L516)）。
- `checkQuestion` が識別子の非空と 3 型を要求し不正を識別子付きで拒否する例がある（[agent.ts:169-183](../../laya-ts/src/agent.ts#L169-L183)）。 <!-- b_neajp6xz -->

## 信頼性 <!-- b_30b98nc8 -->

- 読み込み層と評価層と TypeScript 層にまたがり失敗の伝播と縮退と再試行を使い分ける方針が共通する（推測）。
- `inflight` の `error` が呼び出し元に伝わる例がある（[router.py:708-710](../../laya/router.py#L708-L710)）。
- `_loading` から除去して `error` を設定し再送出する例がある（[router.py:738-744](../../laya/router.py#L738-L744)）。
- `predict_batch` 対応を持たない場合は `predict` を順に呼ぶ縮退路に落ちる例がある（[evals\_cli.py:78-82](../../laya/evals_cli.py#L78-L82)、[evals\_cli.py:88-89](../../laya/evals_cli.py#L88-L89)）。
- `hooks_raise` が真なら送出し偽なら警告して続行する例がある（[agent.py:543-545](../../laya/agent.py#L543-L545)）。
- `fetchWithRetry` は再試行し `dispatchAsync` は集約する例がある（[providers.ts:201](../../laya-ts/src/providers.ts#L201)、[hooks.ts:360-365](../../laya-ts/src/hooks.ts#L360-L365)）。
- 利用不能なバックエンドは `BackendUnavailable` で通知される例がある（[base.py:75](../../laya/backends/base.py#L75)）。 <!-- b_26mgae85 -->

## 可観測性 <!-- b_7dfgn9pd -->

- ベンチマーク記録と推論層にまたがり計測記録と警告による可視化が共通する（推測）。
- 各 `.log` は 30 件の要求タイミングとキャッシュカウンターやメモリーや `nvidia-smi` のスナップショットを含む例がある（[README.md:12-14](../../benchmarks/results/compile-defaults/README.md#L12-L14)）。
- 混雑したタイミングは観測値であり再利用の判定は `FX` カウンターで行う例がある（[README.md:20-24](../../benchmarks/results/compile-defaults/README.md#L20-L24)）。
- `load_s` と `cold_ms` で読込費と実行費を分けて示す例がある（[17\_timing\_a\_call.py:52-61](../../examples/17_timing_a_call.py#L52-L61)）。
- ヘルス応答は `router.loaded` と `resolve_device` と `checkpoint_devices` と `fallbacks` を返す例がある（[serve.py:1016-1022](../../laya/serve.py#L1016-L1022)）。
- `_log.info` が待機開放を記録する例がある（[serve.py:919-921](../../laya/serve.py#L919-L921)）。
- `LAYA_LOG_LEVEL` でログ水準を変える例がある（[serve.py:1284](../../laya/serve.py#L1284)）。 <!-- b_17q47qvz -->
