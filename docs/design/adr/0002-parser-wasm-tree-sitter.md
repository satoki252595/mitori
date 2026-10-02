# ADR-0002: 解析器 — web-tree-sitter 0.27 WASM の Worker pool（自前 index）

- 状態: 採用（2026-10-03） / 関連: 05 §2、04 §3–4、D6/D7/D8、補遺 A6/A7

## Context
最初の画面を 0 token・3 秒以内に出すには、全ファイルの parse・symbol・import・facts を 1〜2 秒で終える必要がある。対象言語は MVP で TS/JS/TSX/JSX、Python、Go、Rust、それ以外は行ベースの generic。

## Decision
- **web-tree-sitter 0.27 + 公式 per-language wasm** を Bun Worker pool（`clamp(ceil(MB/2), 1, min(8, cores−2))`）で動かす。応答前に `tree.delete()`。
- キャッシュキーは **blob sha × extractor version**（branch・fork を跨いで再利用）。変更検知は stat → xxHash3 → 一致なら parse 省略。
- import 解決は言語 plugin が持つ（tsconfig paths / go.mod / pyproject / Cargo）。JS/TS の import 一覧は必要なら oxc の `module` 情報で補う（Bun 上 93MB/s）。型情報が要るときだけ `typescript6@npm:typescript@6.0.3` を使う。
- 構造化は import 解決 edge + IDF 減衰した名前参照 + 同 dir の弱い edge → **directory を prior にした Leiden** → PageRank → Tarjan SCC。Leiden 実装（`ngraph.leiden` か自前 refine）は P0 で決める。
- SCIP（precise mode）は v1 以降の optional。

## Consequences
- 実測: crit 750 files 229〜271 ms cold / 7 ms warm、Go stdlib 85.6MB 1.1〜1.3 s。native より 1.2〜1.4 倍遅いがメモリが決定的。
- minified・generated・2MB 超は S0 で除外しないと 1 ファイルで 472 ms 消える。
- 0.27 で load できない言語（Kotlin/Swift/…）は将来 0.25.10 + legacy pack の別 pool で扱う。

## Alternatives
- native tree-sitter: RSS 7〜10GB、`.node` 同梱の保守。
- ast-grep napi を主軸: Worker で頭打ち。構造検索用の optional にとどめる。
- CodeGraph / CodeWiki を backend に: 依存と license（GitNexus は PolyForm NC）の問題、データモデルを握れない。
