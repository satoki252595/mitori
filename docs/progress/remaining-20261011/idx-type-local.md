# Go 抽出時の同一ノード種類の再取得削減（2026-10-11）

全 corpus の抽出結果が一致し、同条件 ABBA で中央値が **2,232.14→1,994.58ms（10.64%短縮）**したため採用する。**1,500ms 目標は未達**。正式caseの既定5回測定の合格とは扱わない。[全4runと較正](idx-type-local.json)。

`web-tree-sitter` 0.27.0 の使用中のソース `node_modules/web-tree-sitter/web-tree-sitter.js` では、`Node.type`（719 行付近）は `Node.typeId` を通じ、取得のたびに `marshalNode(this)` と `_ts_node_symbol_wasm(this.tree[0])` を実行する。`parse/extract.ts:newDef` の Go 分岐は、同じノードを比較する条件で通常の function / method / field でもこの取得を 4 回行い、type / const / var の sibling filter でも子ごとに元ノードの種類を取得していた。

変更は Go のノード種類を関数内の `goType` に一度だけ取得し、spec 分岐内でのみ親種類 `parentType` を取得する。抽出中の tree は変更されず、比較する文字列・順序・子の列挙・既存 memo の key / 内容は同じ。Go 以外には getter を追加しない。query、解析対象、診断、hash、抽出バージョン、永続 cache、Worker 数、GC、parse timeout、較正、予算は変更していない。

共有 checkout の基点は `6af11b8c27394435e860132cf87179c4198356a9`。候補 `packages/indexer/src/parse/extract.ts` の SHA-256 は `6a4b395430744e45a6182de7a5d13631697370af8df5e4c16f134b266d2fd9be`。

実行済みは `scripts/nd bun test packages/indexer/src/parse/extract.test.ts --test-name-pattern 'IDX-AT-11 Go'`（3 pass、0 fail、13 assertions）と `scripts/nd bunx --no-install biome check packages/indexer/src/parse/extract.ts`（1 file pass）。既存回帰は単独 / grouped specs、receiver、公開性、package、test / subtest、qualified refs を含む。

## 同条件の結果

2026-10-11T06:25:38Zに共有source3,944ファイルを別の一時treeへ凍結した（SHA-256 `5cb4f3b598e3c26eb4cf2abf783890a629148b68ffaa9eb21fdb7654f0f2f929`）。workspace依存も凍結treeへ向け、他担当の編集から分離した。baselineとcandidateで差し替えたのは上の1ファイルだけ。baseline SHA-256は `168380de19a620cc471cee438556177357d45a87c4d50206a0b894dbe943af2d`。既存の固定gostd corpus / daemonと同じbenchIndexer / S0〜S1 / shadow、毎回fresh process・空homeで実行した。OS page cacheは消していない。

| 順序 | 版 | ms | peak RSS MiB |
|---|---|---:|---:|
| 1 | baseline | 2,202.45 | 961.53 |
| 2 | candidate | 1,934.18 | 915.44 |
| 3 | candidate | 2,054.99 | 953.05 |
| 4 | baseline | 2,261.84 | 969.50 |

通常Macはquiet / AC、start load7.4243、全run load7.42〜8.08、終了7.9971。較正はbefore1.010186 / after1.076654で、いずれも既存reference範囲内だった。4runともfiles7,687 / included6,009 / filesParsed6,539 / cacheHits0 / 6Worker / degraded2、hash6,539 / parse5,907 / SQL writes36が一致した。

時間依存列を除く `idx_blobs`6,490行、`idx_symbols`133,602行、`idx_skeleton`11,997行の順序付き全行hashも全4runで一致し、先行比較のhashとも一致した。速度とRSSを下げた小さな変更として採用するが、候補2runとも1,500msを超えている。過去の不採用batch / 参照解除案との比較を混ぜず、上限やWorker規則は維持する。
