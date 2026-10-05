# 実行見本集 <!-- b_30ht8kat -->

- ファイル 33 · 2885 行 · 重要度 0.07
<!-- b_cttqp3hk -->

**変更の手引き**
- 使っているもの: [選定と予測公開](laya-router.md)・[外部連携アダプター](laya-integrations.md)・[TypeScript 推論基盤](laya-ts.md)・[推論エージェント](laya-agent.md)
- テスト: `research/benchmarks/zh_short_commands/tests/test_audit.py`（38 件）・`research/benchmarks/feishu_zh/tests/test_audit.py`（6 件）
- 一緒に変わりやすいファイル（直近 289 commit）: なし
<!-- b_pkfn2bxq -->

> [!NOTE]
> **この章で分かること**
> - 典型的な呼び出し順序と表示の流れが分かる。
> - 言語切替や確信度による選別の扱いが分かる。
> - フックや外部連携の組み立て方が分かる。 <!-- b_amnsry55 -->

## 責務 <!-- b_n9t7zx87 -->

番号付きスクリプト群は `load` から `predict` までの基本操作を再現する（[\_common.py:111-118](../../../examples/_common.py#L111-L118)、[15\_truncation\_basics.py:64](../../../examples/15_truncation_basics.py#L64)）。`route` や `max_loaded` の切替、多言語の扱いも同じ枠組みで示す（[24\_preload\_and\_memory.py:46-57](../../../examples/24_preload_and_memory.py#L46-L57)）。判定器自体は実装せず、本体の使い方だけを説明する（推測）。`timed` による計測や表示も見本の範囲に含む（[\_common.py:126](../../../examples/_common.py#L126)）。 <!-- b_t5kxg263 -->

## 公開インターフェース <!-- b_jp454jwr -->

- `load` はローカルか Hub から検査対象を開き、`device` 省略時は自動選択に任せる（[\_common.py:111-118](../../../examples/_common.py#L111-L118)）。
- `router` は振り分け器を見本用に用意する（[\_common.py:121](../../../examples/_common.py#L121)）。
- `describe` は `choice` と `score` と `noul` を `confidence` 付きで 1 行表示する（[\_common.py:150-175](../../../examples/_common.py#L150-L175)）。
- `scrub` と `redact` は `EMAIL` と `PHONE` を伏せ字化する（[redact.py:11-25](../../../examples/hooks/redact.py#L11-L25)）。
- `cache_read` と `cache_write` は推論結果を再利用する（[cache.py:33-40](../../../examples/hooks/cache.py#L33-L40)、[cache.py:59-60](../../../examples/hooks/cache.py#L59-L60)）。
- `banner` は番号と表題で例の頭を出力する（[\_common.py:101-108](../../../examples/_common.py#L101-L108)）。
- `top` は確率上位を抜き出して表示を助ける（[\_common.py:138](../../../examples/_common.py#L138)）。
- `on_predict_end` は予測終了時に監査記録を残す（[audit.py:15-43](../../../examples/hooks/audit.py#L15-L43)）。 <!-- b_jdx3kepc -->

## 依存関係 <!-- b_xt0mj7a4 -->

laya ディレクトリの振り分けと提供機能に依存し、`PRESETS` などの定義を使う（推測）。laya/integrations の連携部品と laya-ts/src の型や判定部品を呼び出す側である（推測）。外部から呼ばれる部品ではなく、実行起点である（推測）。 <!-- b_xd46yvz6 -->

## データ構造 <!-- b_3nj80ycm -->

- `QUESTIONS` は名前から定義への辞書で 1 回に束ねる（[15\_truncation\_basics.py:53-64](../../../examples/15_truncation_basics.py#L53-L64)）。
- 選択回答は `choice` と `probabilities` と 2 種の確信度で返す（[llamaindex\_quickstart.py:39-48](../../../examples/llamaindex_quickstart.py#L39-L48)）。
- 肯否回答は `noul` を 0 から 1 の値で返す（[crewai\_quickstart.py:29-36](../../../examples/crewai_quickstart.py#L29-L36)）。
- `usage` は入力規模の内訳を返す（[15\_truncation\_basics.py:73-76](../../../examples/15_truncation_basics.py#L73-L76)）。 <!-- b_fwr0sf0d -->

## 処理の流れ <!-- b_nd9kczpe -->

1. `load` で検査対象を開く（[\_common.py:111-118](../../../examples/_common.py#L111-L118)）。
2. 状態と `QUESTIONS` を `predict` に渡す（[15\_truncation\_basics.py:53-64](../../../examples/15_truncation_basics.py#L53-L64)）。
3. 多言語時は `route` で振り分け先を決める（[21\_routing\_without\_running.py:49-57](../../../examples/21_routing_without_running.py#L49-L57)）。
4. `describe` で回答を 1 行ずつ確認する（[\_common.py:150-159](../../../examples/_common.py#L150-L159)）。 <!-- b_y2enkqfv -->

## 設定 <!-- b_6t2s5tee -->

- `--model` でモデルの場所を指定する（[snake.mjs:11-12](../../../laya-ts/examples/snake.mjs#L11-L12)）。
- `--tick` と `--width` と `--height` と `--ticks` で表示と実行を調整する（[snake.mjs:18-21](../../../laya-ts/examples/snake.mjs#L18-L21)）。 <!-- b_dzj6cnzd -->

## 性能 <!-- b_c3mx4e3s -->

`load_s` と `cold_ms` で読込費と実行費を分けて示す（[17\_timing\_a\_call.py:52-61](../../../examples/17_timing_a_call.py#L52-L61)）。質問束ねによる `input_tokens` 節約と `CACHE` による再利用を例示する（[16\_many\_questions\_one\_pass.py:73-74](../../../examples/16_many_questions_one_pass.py#L73-L74)、[cache.py:59-60](../../../examples/hooks/cache.py#L59-L60)）。 <!-- b_4acpvy9c -->

## 落とし穴 <!-- b_4z6m2c46 -->

> [!WARNING]
> **落とし穴**
> - `CACHE` と `SKIPS` はモジュール全体で共有されるため、実行順が結果に影響する（[cache.py:15-16](../../../examples/hooks/cache.py#L15-L16)、[cache.py:59-60](../../../examples/hooks/cache.py#L59-L60)）。
> - `describe` は `choice` と `score` 以外を `noul` 扱いするため、未知の型で誤表示する（[\_common.py:150-175](../../../examples/_common.py#L150-L175)）。
> - `load` はローカル有無で取得先を変えるため、環境で挙動が変わる（[\_common.py:111-118](../../../examples/_common.py#L111-L118)）。
> - `max_loaded` を絞ると言語切替で追い出しが起きる（[22\_route\_and\_predict\_multilingual.py:53](../../../examples/22_route_and_predict_multilingual.py#L53)）。 <!-- b_8b7xe76w -->

## 深掘り <!-- b_c5cm8v0r -->

> [!NOTE]
> **深掘り**
> laya-dotnet/samples と laya-ts/examples/web の表示例の対応関係。 <!-- b_dxbnesyr -->

> [!NOTE]
> **深掘り**
> examples/server の FastAPI 見本と本体提供の関係。 <!-- b_7kh38z8n -->

> [!TIP]
> **まとめ**
> 見本を順に実行すれば、基本操作から連携までの使い方が掴める。 <!-- b_5y2fx0cr -->
