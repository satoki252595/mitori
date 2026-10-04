# 開発支援スクリプト群（scripts） <!-- b_eadc39e7 -->

- ファイル 13 · 997 行 · 重要度 0.06
<!-- b_cxgjh9hj -->

**変更の手引き**
- 影響が及ぶ先（このモジュールを使う）: [埋め込み資産と agent 注入](web-style-live.md)
- テスト: `scripts/bench-compare_test.py`（18 件） · 実行: `make test`
- 入口から: `scripts/bench-compare.py`（`scripts/bench-compare.py:169`）
- 一緒に変わりやすいファイル: 履歴を読めません（浅いクローンか git の外）
<!-- b_bzf8azfz -->

> [!NOTE]
> **この章で分かること**
> - ベンチマーク差分の合否判定の考え方
> - ベンダ資産の来歴記録と検証の役割分担
> - テーマ色生成と `pierre` 成果物ビルドの位置づけ <!-- b_snkqf0fv -->

## 責務 <!-- b_z1mpx302 -->

このディレクトリは開発と CI を支える作業スクリプト置き場である（推測）。計測比較や資産管理、表示資産の生成、結合試験の実行を受け持つ（推測）。本体の実行時機能は持たず、利用者向けの振る舞いは定義しない（推測）。 <!-- b_nzh5vdeh -->

## 公開インターフェース <!-- b_y7kys07n -->

- `parse_threshold` は引数列から閾値を読む（[bench-compare.py:41-52](../../../scripts/bench-compare.py#L41-L52)）。
- `delta_pct` は benchstat 行から増加率を取り出す（[bench-compare.py:55-65](../../../scripts/bench-compare.py#L55-L65)）。
- `max_variance_pct` は行中の最大分散を返す（[bench-compare.py:68-71](../../../scripts/bench-compare.py#L68-L71)）。
- `hashAsset` はパスを受け取る公開関数である（[vendored-assets.mjs:8](../../../scripts/vendored-assets.mjs#L8)）。
- `vendoredAssets` は公開定数である（[vendored-assets.mjs:19](../../../scripts/vendored-assets.mjs#L19)）。
- `themePalette` はテーマを受け取る公開関数である（[crit-theme-palette.mjs:10](../../../scripts/crit-theme-palette.mjs#L10)）。
- `buildPierre` と `pierreFiles` は公開関数である（[build-pierre.mjs:119](../../../scripts/build-pierre.mjs#L119)、[build-pierre.mjs:167](../../../scripts/build-pierre.mjs#L167)）。 <!-- b_h28b9ham -->

## 依存関係 <!-- b_b1her9p4 -->

受け手は `web` ディレクトリであり、主な公開物は `FS` と `trackTag` である（推測）。`PIERRE_DIR` がその出力先を定める（[build-pierre.mjs:21](../../../scripts/build-pierre.mjs#L21)）。 <!-- b_cdgreq4h -->

## 設定 <!-- b_t3rn71c1 -->

- `--time-pct` は既定の閾値を上書きする（[bench-compare.py:41-52](../../../scripts/bench-compare.py#L41-L52)）。
- `--npm` の有無が `checkNpm` に反映される（[verify-vendored-assets.mjs:16](../../../scripts/verify-vendored-assets.mjs#L16)）。 <!-- b_1q4e8bgt -->

## テスト <!-- b_18t4dff9 -->

`test_significant_time_regression_fails` と `test_subthreshold_time_passes` は時間差分の閾値判定を確かめる（[bench-compare\_test.py:48](../../../scripts/bench-compare_test.py#L48)、[bench-compare\_test.py:53](../../../scripts/bench-compare_test.py#L53)）。`test_alloc_increase_fails` と `test_alloc_zero_to_n_fails` と `test_alloc_stable_passes` は割当量変化の扱いを確かめる（[bench-compare\_test.py:61](../../../scripts/bench-compare_test.py#L61)、[bench-compare\_test.py:66](../../../scripts/bench-compare_test.py#L66)、[bench-compare\_test.py:72](../../../scripts/bench-compare_test.py#L72)）。`test_insignificant_row_passes` は無視すべき行の通過を確かめる（[bench-compare\_test.py:57](../../../scripts/bench-compare_test.py#L57)）。 <!-- b_q5jedfnz -->

## エラー処理 <!-- b_rz5p4stm -->

引数の不足や不正値は標準エラー出力への表示と終了符号 2 で報告される（[bench-compare.py:44-51](../../../scripts/bench-compare.py#L44-L51)）。0 件からの増加は無限大として扱い、見逃さない（[bench-compare.py:63-64](../../../scripts/bench-compare.py#L63-L64)）。 <!-- b_0sw93sba -->

## 落とし穴 <!-- b_ryb7e733 -->

> [!WARNING]
> **落とし穴**
> - `manifestPath` の指す来歴ファイルは記録側と検査側で一致させる（[record-vendored-assets.mjs:8](../../../scripts/record-vendored-assets.mjs#L8)、[verify-vendored-assets.mjs:13](../../../scripts/verify-vendored-assets.mjs#L13)）。 <!-- b_3g59bn32 -->

> [!TIP]
> **まとめ**
> 要は、計測と資産と生成物を支える裏方集である。 <!-- b_fxegj3yb -->
