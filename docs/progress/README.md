# progress（検証・生成の記録）

日々の検証ログ・生成結果・測定データの置き場。最新の引き継ぎは [HANDOFF.md](../HANDOFF.md)、
検証状況のまとめは [verification-status.md](verification-status.md) を読む。

## 第三者リポジトリの生成文書

下の表のディレクトリにある設計文書・引用照合・画面写真は、mitori が第三者の公開リポジトリを
読み、出力した説明文書と短い引用である。各リポジトリのライセンスに従う。対象の依存・スクリプトは
実行していない。clone はリポジトリの外（`/private/tmp`・`~/.cache/mitori-corpus`）で行う。

| リポジトリ | 固定 SHA | ライセンス | 生成文書の置き場 |
| --- | --- | --- | --- |
| [lnkiai/m3e-canvas](https://github.com/lnkiai/m3e-canvas) | `039ec311acc33dd0c76a54cbc16af4fc8ab9b491` | MIT | `dogfood/m3e-canvas`・`dogfood2/m3e-canvas`・`oss-quality-2026-10-05/m3e-canvas` 他 |
| [browser-use/jev-ultrafast](https://github.com/browser-use/jev-ultrafast) | `1231850a0bf1a0c0341fe408ef1668dbbfdfac46` | MIT | `oss-quality-2026-10-05/jev-ultrafast` 他 |
| [NandhaKishorM/laya](https://github.com/NandhaKishorM/laya) | `8a6e1328cce2460a0e5aa348ad465bb1b5821cd2` | Apache-2.0 | `oss-quality-2026-10-05/laya` 他 |
| [tomasz-tomczyk/crit](https://github.com/tomasz-tomczyk/crit) | `406875dd31e0eacc9af33b7643d54100620e8775` | MIT | `dogfood/crit`・`dogfood2/crit` |
| [morluto/rea](https://github.com/morluto/rea) | `79156e5bed1d` | MIT | `trend-quality-20261012`（記録と画面写真。文書本体は対象外の作業場所に置いた） |
| [bilawalsidhu/gods-eye-view](https://github.com/bilawalsidhu/gods-eye-view) | `591f299d11f3` | MIT | `trend-quality-20261012`（同上） |
| [earthtojake/text-to-cad](https://github.com/earthtojake/text-to-cad) | `24573128ceaa` | MIT | `trend-quality-20261012`（同上） |

SHA の出所: m3e-canvas・jev-ultrafast・laya は
`oss-quality-2026-10-05/selection.json`、rea・gods-eye-view・text-to-cad は
`trend-quality-20261012/README.md`、crit は `bench/corpus.lock.json` の固定値
（`dogfood` の入力はその clone。使った commit の記録は `gen-report.json` に無い）。
