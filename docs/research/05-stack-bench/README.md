# 05-stack-bench: 再現用スクリプトと生データ

`../05-stack-benchmarks.md` の数値を出したスクリプト一式 (node_modules / dist / コーパスは含まない)。

- 実行: `cd /Users/satoki252595/work/20261002_aiAgentTool && nix develop --command bash -c "cd <このディレクトリのコピー> && bun add <deps> && bun parse-bench.mjs wts crit-go,crit-ts 5 extract"`
- コーパス一覧 (`corpus/*.txt`) は `find` で生成する (parse: `refs/crit`, `refs/m3e-canvas`, `refs/hono` (honojs/hono shallow clone), Go stdlib `src/` (testdata 除外))。
- `results/*.jsonl` が生データ (parse.jsonl = 5 parser x 2 runtime x 3 corpus x 2 mode, workers.jsonl = Worker 並列)。
- Browser 計測 (fe/ cv/ dg/ ed/) は `bunx vite build` 後に静的サーバ + Chrome 154 の `window.__bench / __t` を呼ぶ。
- 依存の主なバージョン: bun 1.4.2, node 22.23.3, web-tree-sitter 0.27.0 (+0.25.10), tree-sitter 0.25.1, @ast-grep/napi 0.45.3, oxc-parser 0.152.0, typescript 5.9.3, svelte 5.57.1, solid-js 1.9.15, react 19.3.0, preact 11.0.0, vite 8.3.2, codemirror 6 (view 6.43.13), monaco-editor 0.57.0, shiki 4.5.0, mermaid 12.1.0, elkjs 0.12.0, @dagrejs/dagre 3.1.1, @terrastruct/d2 0.1.33, lexical 0.52.0, @tiptap/* 3.31.4, @milkdown/kit 7.22.2, prosemirror-*。
