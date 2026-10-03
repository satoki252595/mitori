# 開発補助スクリプト（scripts） <!-- b_cy62n35v -->

- ファイル 13 · 997 行 · 重要度 0.06
<!-- b_9fgntm35 -->

> [!NOTE]
> **この章で分かること**
> - scripts ディレクトリの役割と、含まれるスクリプトの種類
> - ベンチマーク比較の判定ルール
> - vendored アセットの検証と記録の仕組み <!-- b_m5gt1f0w -->

## 責務 <!-- b_r0ck1x5f -->

scripts は開発・CI 用の補助スクリプト群で、ベンチマーク比較、vendored アセットの整合性検証、Pierre のビルド、E2E 実行を担う（[bench-compare.py:33-36](../../../scripts/bench-compare.py#L33-L36)、[vendored-assets.mjs:8-19](../../../scripts/vendored-assets.mjs#L8-L19)、[build-pierre.mjs:119](../../../scripts/build-pierre.mjs#L119)）。製品のランタイムには含まれず、web 側のテーマ生成などから参照されるだけである（[build-pierre.mjs:21](../../../scripts/build-pierre.mjs#L21)）。 <!-- b_fzyk33xa -->

## 公開インターフェース <!-- b_hm3sjzpp -->

- `parse_threshold` は `--time-pct` の値を読み、未指定なら `TIME_THRESHOLD_PCT` を返す（[bench-compare.py:41-52](../../../scripts/bench-compare.py#L41-L52)）。
- `delta_pct` は benchstat 行の増加率を返し、`+Inf%` は無限大として扱う（[bench-compare.py:55-65](../../../scripts/bench-compare.py#L55-L65)）。
- `max_variance_pct` は行内の最大の ±N% を返す（[bench-compare.py:68-71](../../../scripts/bench-compare.py#L68-L71)）。
- `hashAsset` と `vendoredAssets` は vendored アセットのハッシュと一覧を提供する（[vendored-assets.mjs:8-19](../../../scripts/vendored-assets.mjs#L8-L19)）。
- `themePalette` はテーマからパレットを生成する（[crit-theme-palette.mjs:10](../../../scripts/crit-theme-palette.mjs#L10)）。
- `buildPierre` と `pierreFiles` は `web/pierre` 配下の成果物を作る（[build-pierre.mjs:119](../../../scripts/build-pierre.mjs#L119)、[build-pierre.mjs:167](../../../scripts/build-pierre.mjs#L167)）。 <!-- b_2c4mwgem -->

## 設定 <!-- b_x2bef7sw -->

- `bench-compare.py` は `--time-pct` で時間回帰のしきい値を変えられ、既定は 20.0 である（[bench-compare.py:33-52](../../../scripts/bench-compare.py#L33-L52)）。
- `verify-vendored-assets.mjs` は `--npm` が付くと npm 側の検証も行う（[verify-vendored-assets.mjs:16](../../../scripts/verify-vendored-assets.mjs#L16)）。 <!-- b_rf2yx9qc -->

## テスト <!-- b_xvyw7nxj -->

テストは、有意な時間回帰が失敗すること（[bench-compare\_test.py:48](../../../scripts/bench-compare_test.py#L48)）、しきい値未満が通ること（[bench-compare\_test.py:53](../../../scripts/bench-compare_test.py#L53)）、アロケーション増加や 0 から N への増加が失敗すること（[bench-compare\_test.py:61](../../../scripts/bench-compare_test.py#L61)、[bench-compare\_test.py:66](../../../scripts/bench-compare_test.py#L66)）を確認する。 <!-- b_0xpqf3vs -->

## エラー処理 <!-- b_jgadrzpf -->

`--time-pct` の値が欠落または数値でない場合、`parse_threshold` はエラーを stderr に出して終了コード 2 で終わる（[bench-compare.py:42-51](../../../scripts/bench-compare.py#L42-L51)）。 <!-- b_058yapwx -->
