# Linux cold check — 既存 testkit モジュールの import 整理（2026-10-11）

既存の `testkit/home` を名前付きのテスト専用 subpath として公開し、loop の6箇所の import を home・fixtures・golden の既存モジュールへ絞った。10ファイル、13行追加・9行削除。helper の実装、元の `TestHome` 宣言、公開 root は変更していない。production から testkit を使えない境界規則も維持した。

TypeScript の前後 Program を同じ設定で組み、loop の root 147件が完全一致することを確認した。読み込む workspace source は226→161件、うち gen の source は50→0件。testkit の root 公開名は71件で一致した。gen は引き続き自身の project を含む全20プロジェクトで意味検査される。

## 調査と判断

既存の checked solution と同じ設定で indexer・doc・loop の TypeScript trace を取得した。最大の型関係は doc の `Store → DocStore` 約20msと loop テストの Bun `Server<undefined> → Server<unknown>` 約20msで、単独の巨大な型関係は見つからなかった。loop では testkit root → cassette → gen によって、別 project の gen 50ソースを早期に再検査していた。gen の checkSourceFile span 合計は約507msだった。

trace は全20 semantic builds を完了したが、他担当の編集中だった `renderer.test.ts` に型エラー1件があった。診断の削除はせず、その担当が修正した後に下記比較を行った。trace 自体を成功した check としては扱わない。

fixture 契約を分離する先の候補は全体の速度改善を実証できず不採用のまま。証拠は [cold-check.md](cold-check.md) / [cold-check.json](cold-check.json) に残した。

## 同条件の cold ABBA

既存 `scripts/linux-ci.sh` を使い、同一の frozen export・Linux arm64 コンテナ・CPU affinity 0,1・availableParallelism 2で比較した。各回の前に宣言と意味検査のキャッシュを削除。既存の較正・15/30秒基準・全7項目・全20プロジェクト・checked/noCheck のキャッシュ境界は変更していない。認証情報の mount、モデル呼び出し、新依存はない。

| 順 | 版 | wall秒 | 較正係数 | 補正後の上限秒 | 結果 |
|---|---|---:|---:|---:|---|
| 1 | baseline | 27.52 | 1.198 | 35.95 | 成功 |
| 2 | candidate | 25.44 | 1.317 | 39.52 | 成功 |
| 3 | candidate | 28.73 | 1.291 | 38.73 | 成功 |
| 4 | baseline | 29.20 | 1.240 | 37.20 | 成功 |

4回とも20 semantic builds・0 cached・0 errors、全7項目成功。wall 中央値は28.36→27.085秒（約4.50%短縮）、既存の較正係数で割った中央値は23.260→20.785秒（約10.64%短縮）。この小さな比較で改善が確認でき、対象回帰も通ったため変更を採用した。

各版2回、固定ABBA順、OS page cache未消去、外側の Docker CPU quota未設定である。両版共通の export に他担当の編集中のソースを含むため、その既知の整形と公開索引をコンテナ内だけで共通更新した。これらの内容・ハッシュと、不成功だった先行 preflight も JSON に記録した。

全回が較正後の soft target を超えた。hard limit の超過を防げた ARM 比較であり、15秒基準の目標達成や Ubuntu x64 Actions の超過解消を証明するものではない。統合した head の CI で別途確認する。

## 対象回帰

11ファイルの既存72テストを実行。最初は63成功・3既存skip・6失敗で、Codex sandbox が macOS `sandbox-exec` の入れ子実行と loopback 待受を拒否した。失敗した既存 gate ファイルだけを正規の escalation で再実行し、8成功・3 Linux限定skip・失敗0。重複を除く結果は69成功・3skip・失敗0だった。

noCheck-only cache の診断漏れ拒否と checked state の再利用、production import の拒否、home/guard、golden、gate、side repo の Git snapshot/accept/undo/PR を確認した。macOS の資格情報・ネットワーク隔離と Go `httptest` も成功。`tsc -b packages/loop` は診断0、変更10ファイルの Biome と `git diff --check` は成功した。

共有 checkout の公開索引は他担当の公開面変更で stale のため、統合担当が最後に更新する。候補の testkit 公開71名は前後一致し、ABBA は両版の同じ索引を更新して全項目を通している。

実行コマンド・数値・SHA-256・構造差・失敗と再試行は [cold-home.json](cold-home.json)。元の比較・回帰ログは `/tmp/mitori-cold-home-abba-20261011/`、trace は `/tmp/mitori-cold-types-20261011/` に保持した。
