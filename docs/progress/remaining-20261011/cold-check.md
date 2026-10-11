# Linux cold check 調査 — 2026-10-11

fixture の型定義を agent から独立させる候補は、速度改善を実証できなかったため採用しない。候補と一時測定コードは取り除き、型検査・testkit・自動生成公開索引の実装を元へ戻した。

既存の `scripts/linux-ci.sh` を使用し、同一の Linux arm64 コンテナ内で子プロセスを CPU 0,1 に制限して ABBA 順に比較した。各回で宣言・意味検査キャッシュを削除し、`GITHUB_ACTIONS=true` で既存の較正、15/30秒基準、全7項目をそのまま実行した。モデル呼び出し・認証情報のマウント・新依存はない。

| 順 | 版 | wall秒 | 較正係数 | 補正上限秒 | 結果 |
|---|---|---:|---:|---:|---|
| 1 | baseline | 21.53 | 1.161 | 34.84 | 成功 |
| 2 | candidate | 26.36 | 1.239 | 37.16 | 成功 |
| 3 | candidate | 21.17 | 1.054 | 31.62 | 成功 |
| 4 | baseline | 23.32 | 1.197 | 35.91 | 成功 |

全4回とも20プロジェクト・20 semantic builds・0 cached・0 errors、全7項目成功。中央値は baseline 22.425秒、候補23.765秒で約6%悪化。較正係数で割った中央値も約9%悪化した。2回目は Svelte・Biome・境界検査も一様に遅く、候補の変更だけを悪化原因と断定はできない。

構造上は indexer の直接 Program で agent の早期ソース読み込みが35→0件、総ファイル数が495→461件へ減った。移した `TEST_FORMATS` と5つの fixture 型はコメントを除いた TypeScript AST の出力が一致し、公開 export 総数も同一だった。しかし、この構造差から実行時間の改善は主張できない。

候補の対象回帰は74成功・既存todo 4・失敗0、415 assertions。noCheck-onlyキャッシュを拒否して checked state を再利用する既存回帰、fixture生成・真値採点・indexer・export・境界検査を含む。触れた契約3モジュールの意味診断は0件、Biome・公開索引も成功した。

制約は各版2回、固定ABBA順、OS page cache未消去、Docker CPU quota未設定（子の affinity と availableParallelism は2）、arm64環境であること。以前の Ubuntu x64 Actions の速度超過を解消した証拠にはならない。新しい統合コミットの CI で cold 20プロジェクトと速度ゲートの結果を別途確認する必要がある。

数値・ハッシュ・実行コマンドは [cold-check.json](cold-check.json)。元ログと不採用候補は `/tmp/mitori-cold-fixture-20261011/` および `/tmp/mitori-cold-fixture-rejected-source-20261011.json` に保持した。公開資料に認証情報や利用者のホームパスは含めていない。
