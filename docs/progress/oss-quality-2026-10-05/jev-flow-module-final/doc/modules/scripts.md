# 検証用脚本集 <!-- b_yyedp2rh -->

- ファイル 8 · 550 行 · 重要度 0.23
<!-- b_1kh72f7j -->

**変更の手引き**
- 使っているもの: [観測選択実行本体](jev-ultrafast.md)
- テスト: 見つかりませんでした
- 入口から: `scripts/check_guards.py`（`scripts/check_guards.py:136`）・`scripts/smoke.py`（`scripts/smoke.py:56`）
- 一緒に変わりやすいファイル（直近 3 commit）: `docs/flights-measurement.json` 2 回・`jev_ultrafast/agent.py` 2 回・`jev_ultrafast/browser.py` 2 回・`tests/test_agent.py` 2 回
- 注意: テストが無い
<!-- b_y4ef8xcv -->

> [!NOTE]
> **この章で分かること**
> - 扱う入口の種類と使い分けが分かる
> - 計測から保存までの流れが分かる
> - 失敗と並行記録の扱いが分かる <!-- b_jekaq6r6 -->

## 責務 <!-- b_5543pqkx -->

検証と計測と描画の補助入口を集めたまとまりで、回帰確認と生計測と記録化と実行例を受け持つ（[check\_guards.py:1](../../../scripts/check_guards.py#L1)、[measure\_flights.py:1](../../../scripts/measure_flights.py#L1)、[render\_demo.py:1](../../../scripts/render_demo.py#L1)、[flights.py:1](../../../examples/flights.py#L1)）。課金 API を使う明示実行と、外部依存を避ける局所確認を分けている（[smoke.py:1](../../../scripts/smoke.py#L1)、[check\_guards.py:1](../../../scripts/check_guards.py#L1)）。便の選択や購入は扱わない（[flights.py:1](../../../examples/flights.py#L1)）。 <!-- b_zak44s3e -->

## 公開インターフェース <!-- b_q4wq6skv -->

- `main` は各脚本の実行入口である（[check\_guards.py:17](../../../scripts/check_guards.py#L17)、[smoke.py:17](../../../scripts/smoke.py#L17)、[flights.py:41](../../../examples/flights.py#L41)）。
- `GOALS` は `Agent` に渡す目標列である（[flights.py:12](../../../examples/flights.py#L12)、[flights.py:48](../../../examples/flights.py#L48)）。
- `URL` は `Agent` の開始先である（[flights.py:11](../../../examples/flights.py#L11)、[flights.py:48](../../../examples/flights.py#L48)）。
- `verify` は結果頁を独立に確かめる（[flights.py:18-19](../../../examples/flights.py#L18-L19)）。 <!-- b_vw6y8tgp -->

## 依存関係 <!-- b_2a5fx2j7 -->

中核の `Agent` を使う側で、計測や記録や例示から呼ぶ（[flights.py:48](../../../examples/flights.py#L48)、[record\_flights.py:24](../../../scripts/record_flights.py#L24)、[measure\_flights.py:42](../../../scripts/measure_flights.py#L42)）。使う先は jev_ultrafast の実行部で、逆向きの利用はない（推測）。 <!-- b_4s3h4jbf -->

## データ構造 <!-- b_c1hya66s -->

- `state` は `history` と `elapsed_ms` と `status` を持つ（[flights.py:50-52](../../../examples/flights.py#L50-L52)）。
- `verification` は `verify` の判定を足した項目である（[flights.py:54-55](../../../examples/flights.py#L54-L55)）。 <!-- b_bpkwndc5 -->

## 処理の流れ <!-- b_a3mhd2gt -->

1. `main` は `--output` を受けて `folder` を作る（[flights.py:41-46](../../../examples/flights.py#L41-L46)）。
2. `Agent` に `URL` と `GOALS` を渡して `run` で回す（[flights.py:48-50](../../../examples/flights.py#L48-L50)）。
3. `snapshot` し `verify` して書出し、不通過は `SystemExit` とする（[flights.py:54-56](../../../examples/flights.py#L54-L56)、[flights.py:62-64](../../../examples/flights.py#L62-L64)）。 <!-- b_n19sa3fw -->

## 設定 <!-- b_qsx3232k -->

- `--output` は `folder` の書出先を決める（[flights.py:43-46](../../../examples/flights.py#L43-L46)）。
- `--keep-open` は終了時の `close` を省く（[flights.py:44](../../../examples/flights.py#L44)、[flights.py:60-61](../../../examples/flights.py#L60-L61)）。 <!-- b_1fvvtj1t -->

## エラー処理 <!-- b_tq3p64a6 -->

`finally` で `snapshot` を残し、不通過は `SystemExit` で知らせる（[flights.py:53-56](../../../examples/flights.py#L53-L56)、[flights.py:62-64](../../../examples/flights.py#L62-L64)）。 <!-- b_r8awwbd4 -->

## 並行性 <!-- b_yph9mgvw -->

`capture` を `daemon` の `worker` で回し、`stop` で止める（[record\_flights.py:31](../../../scripts/record_flights.py#L31)、[record\_flights.py:36](../../../scripts/record_flights.py#L36)、[record\_flights.py:52](../../../scripts/record_flights.py#L52)）。 <!-- b_gy6eczqw -->

## 落とし穴 <!-- b_ybdb28pb -->

> [!WARNING]
> **落とし穴**
> - 源の固定は外部で行い、改訂比較の前提とする（[measure\_flights.py:1](../../../scripts/measure_flights.py#L1)）。
> - 合否は `verify` で決め、模型の DONE には頼らない（[flights.py:18-19](../../../examples/flights.py#L18-L19)）。 <!-- b_4rx3nhpx -->

> [!TIP]
> **まとめ**
> 計測と確認と描画の入口集で、合否は独立検査で決める。 <!-- b_6kdt8812 -->
