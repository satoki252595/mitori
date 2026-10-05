# 9. 非機能 <!-- b_5enxz76p -->

## ホットパス <!-- b_e3tzmtqy -->

laya 配下と examples 配下にまたがり窓走査と符号化の形状自体が時間を決める性質が共通する（推測）。例えば双方向の符号化では頭部を使い回せないため形状がそのまま費用になる（[common.py:322-326](../../laya/common.py#L322-L326)）。形状丸めの `bucket_shape` と高速路の `FastLaya` は再コンパイルと注意計算を抑える例である（[base.py:37](../../laya/backends/base.py#L37)、[fast.py:28-29](../../laya/fast.py#L28-L29)）。計測例では `load_s` と `cold_ms` を分けて読み込み費と実行費を切り分ける（[17\_timing\_a\_call.py:52-61](../../examples/17_timing_a_call.py#L52-L61)）。 <!-- b_k5hf5twy -->

## キャッシュ <!-- b_nz2g8pk3 -->

- laya 配下と laya-ts 配下にまたがり符号化済み質問と接頭辞と埋め込みを使い回す方針が共通する（推測）。
- 例えば `_TOKENIZERS` に集約し `WARMUP_SHAPES` で事前に構築する例がある（[agent.py:162-163](../../laya/agent.py#L162-L163)、[agent.py:901-904](../../laya/agent.py#L901-L904)）。
- 質問符号化の再利用は `_QUESTION_TOKEN_CACHE` が担う例がある（[common.py:28-29](../../laya/common.py#L28-L29)、[common.py:38](../../laya/common.py#L38)）。
- 絞り込み用の埋め込みは `cached_embed_fn` が上限付きで保持する（[shortlist.py:183-186](../../laya/shortlist.py#L183-L186)）。
- TypeScript 側では接頭辞を `prefixCache` で再利用する（[common.ts:87-89](../../laya-ts/src/common.ts#L87-L89)）。
- 常駐モデルは `max_loaded` を超える場合に `_evict_locked` で減らす（[router.py:477](../../laya/router.py#L477)、[router.py:611-618](../../laya/router.py#L611-L618)、[router.py:732-734](../../laya/router.py#L732-L734)、[router.py:782](../../laya/router.py#L782)）。 <!-- b_gcdhnqzw -->

## 上限値 <!-- b_95xjw49p -->

- laya 配下と laya-ts 配下と HTTP 層にまたがり入力規模と常駐量と温度に上限を設ける方針が共通する（推測）。
- 例えば HTTP 入り口では `MAX_QUESTIONS` による規模制限で過大な要求を退ける（[serve.py:74-77](../../laya/serve.py#L74-L77)）。
- 例えば `window_budget` と `window_batch_cap` が窓と一括の膨張を抑える（[common.py:272-273](../../laya/common.py#L272-L273)、[common.py:360-361](../../laya/common.py#L360-L361)）。
- `LAYA_MAX_CONCURRENT` と `LAYA_MAX_TOKEN_BUDGET` と `LAYA_MAX_BATCH_TOKENS` と `LAYA_MAX_LOADED` が参照される（[serve.py:272](../../laya/serve.py#L272)、[serve.py:299](../../laya/serve.py#L299)、[serve.py:319](../../laya/serve.py#L319)、[serve.py:476](../../laya/serve.py#L476)）。
- 温度は `clamp_temperature` で下限から上限に収める（[common.py:711-715](../../laya/common.py#L711-L715)）。
- TypeScript 側では `clampTemperature` が同じ役割を担う（[common.ts:347-348](../../laya-ts/src/common.ts#L347-L348)）。
- `LAYA_REMOTE_TIMEOUT` と `LAYA_IDLE_UNLOAD_SECONDS` が参照される（[remote.py:52](../../laya/mcp/remote.py#L52)、[serve.py:284](../../laya/serve.py#L284)）。 <!-- b_zdrfgpva -->

## セキュリティ境界 <!-- b_h5djeeba -->

- laya 配下と laya-ts 配下と成果物読み込みにまたがり呼び出し元を信用しない前提が共通する（推測）。
- 例えば `lang` の記録と処理量に上限を設けて外部入力を扱う（[router.py:275-278](../../laya/router.py#L275-L278)）。
- 例えば表示用文字列は `str` の場合のみ 32 文字に切り詰め他は定数扱いとする（[router.py:277-281](../../laya/router.py#L277-L281)）。
- 例えば `expected_sha256` の照合を重み解釈より先に行い不備があれば読み込みを拒否する（[agent.py:513-516](../../laya/agent.py#L513-L516)）。
- 例えば `render_options` では `noul` 以外の質問に `labels` を渡すと拒否される（[common.py:107-111](../../laya/common.py#L107-L111)）。
- 例えば `checkQuestion` は空でない識別子と 3 種の型を必須とする（[agent.ts:169-183](../../laya-ts/src/agent.ts#L169-L183)）。
- `LAYA_API_KEY` と `HF_TOKEN` が環境変数として参照される（[server.py:170](../../laya/mcp/server.py#L170)、[agent.py:585](../../laya/agent.py#L585)）。 <!-- b_neajp6xz -->

## 信頼性 <!-- b_30b98nc8 -->

- 読み込み層と評価層と TypeScript 層にまたがり失敗の伝播と縮退と再試行を使い分ける方針が共通する（推測）。
- 例えば `load` 時の失敗は待っている呼び出し元にも届く（[router.py:692](../../laya/router.py#L692)、[router.py:708-710](../../laya/router.py#L708-L710)、[router.py:738-744](../../laya/router.py#L738-L744)）。
- 例えば競合時には登録済みを `_touch` して使い回し二重化を避ける（[router.py:716-724](../../laya/router.py#L716-L724)、[router.py:727-729](../../laya/router.py#L727-L729)）。
- 例えば `hooks_raise` の値でフック失敗を送出するか警告継続するかを切り替える（[agent.py:543-545](../../laya/agent.py#L543-L545)）。
- 例えば `predict_batch` が無い場合は `predict` の順次呼びに縮退する（[evals\_cli.py:78-82](../../laya/evals_cli.py#L78-L82)、[evals\_cli.py:88-89](../../laya/evals_cli.py#L88-L89)）。
- 例えば `fetchWithRetry` による再試行と `dispatchAsync` による集約がある（[providers.ts:201](../../laya-ts/src/providers.ts#L201)、[hooks.ts:360-365](../../laya-ts/src/hooks.ts#L360-L365)）。
- 例えば層の誤りは `RemoteError` と `ToolError` と `SchemaError` で区分される（[remote.py:42-45](../../laya/mcp/remote.py#L42-L45)、[tools.py:14-17](../../laya/mcp/tools.py#L14-L17)、[structured.py:30](../../laya/structured.py#L30)）。 <!-- b_26mgae85 -->

## 可観測性 <!-- b_7dfgn9pd -->

- ベンチマーク記録と推論層にまたがり計測記録と警告による可視化が共通する（推測）。
- 例えば記録は 30 件の要求タイミングとキャッシュ計数やメモリーと `nvidia-smi` の取得を含む（[README.md:12-14](../../benchmarks/results/compile-defaults/README.md#L12-L14)）。
- 例えば cold 系は新規場所で開始し restart 系は同一場所を別プロセスで使う（[README.md:14-16](../../benchmarks/results/compile-defaults/README.md#L14-L16)）。
- 例えば窓の縮小に伴う走査費が見積りの 2 倍を超えると警告が出る（[common.py:262-266](../../laya/common.py#L262-L266)）。
- `LAYA_LOG_LEVEL` が参照される（[serve.py:1284](../../laya/serve.py#L1284)）。 <!-- b_17q47qvz -->
