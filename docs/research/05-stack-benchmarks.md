# 05-stack: 技術スタック評価と実測ベンチマーク (mitori / 見取り図)

- 調査日: 2026-10-03 / 担当トラック: 05-stack
- 方針: 「推測より実測」。解析・配布・サーバ・フロントの主要候補を **この Mac 上で実際に動かして** 数値化し、公開ベンチ・公式ドキュメントで裏取りした。
- 再現スクリプトと生データ: `docs/research/05-stack-bench/` (README.md 参照)。作業ディレクトリは scratchpad の `bench-stack/` (node_modules・コーパスを含むためリポジトリには入れていない)。

---

## 0. TL;DR (推奨スタックと決定根拠)

| 領域 | 推奨 | 決め手 (実測) | 次点 / 撤退先 |
|---|---|---|---|
| ランタイム/配布 | **Bun 1.4 + `bun build --compile` の単一バイナリ** (UI は同梱) | hello 62.2MB・起動 **6.0ms** (Node は 22.5ms)。sqlite+wasm tree-sitter+ast-grep+oxc 込み 71.8MB・起動 10.5ms。UI 16MB 同梱でも 78.7MB・初回応答 9.7ms。macOS/Linux x64,arm64/Windows に cross-compile 可 (1.8s)。idle RSS 13MB | npm 配布 (Node>=22)。コードは `node:*` API 中心にして Bun 依存を薄く保つ |
| 構文解析 | **web-tree-sitter (WASM) + Worker プール + 内容ハッシュキャッシュ** | 1 スレッド 9〜12MB/s、Worker 8 本で Go stdlib 6.8k ファイル/85.6MB を **1.19s**、E2E (git ls-files→hash→parse→SQLite) 同 **1.1〜1.3s cold / 22ms warm**。crit リポ(750 files)は **229〜271ms cold / 7ms warm** | native tree-sitter (最大 1.4× 速いが `.node` 同梱が厄介) / ast-grep napi は検索用途に限定 |
| JS/TS 補助 | oxc-parser `module` 情報 (import グラフ) を Bun 上でも 93MB/s で取得。型情報が要るときだけ `typescript@5.9` API | oxc raw/lazy (82〜207MB/s) は **Node 専用** (Bun 非対応)。**TypeScript 7 の npm 版は programmatic API 無し** (7.1 待ち) | tsc 5.9 API は 31MB/s と意外に速い |
| フロント FW | **Svelte 5 + Vite 8 (静的 SPA)** | 公式 krausest(Chrome152) weighted geomean: Solid 1.13 / **Svelte 1.17** / Preact 1.59 / React 1.58。brotli: Solid 4.5KB / **Svelte 9.7KB** / Preact 5.7KB / React 51.4KB。仮想化した長文書では 5 FW とも 1 スクロールステップ **0.2〜0.4ms** で差が出ない | Solid 1.9 (純性能最良)。React 19 は +45〜60KB gz・初回描画が重いので避ける |
| ドキュメント描画 | **サーバで Markdown→ブロック別 HTML (markdown-it, `token.map` で行範囲取得) をハッシュキャッシュし、クライアントは `innerHTML` + 必要箇所だけコンポーネント** | 10k 行の非仮想化 DOM 生成は 207〜306ms、仮想化なら 60 行/step で 0.3ms。markdown-it 13〜30MB/s (20k ブロック 100ms)。`Bun.markdown.html` は 90MB/s だが source position なし・脚注なし | — |
| コードビューア/エディタ | **CodeMirror 6** (+ `@codemirror/merge`)。静的スニペットは **Shiki** | CM6: 20k 行 (589KB) 6〜18ms で初回描画、DOM 225〜259 ノード、1000 件の行デコ+ウィジェット適用 5〜6ms、gz **125KB** (+merge 10KB)。Monaco は gz **約 0.8〜1.1MB** (+TS worker 1.48MB gz)。Shiki は 20k 行一括だと **1.3〜1.6s/3.5MB HTML/9.3 万 DOM** → 200 行チャンク (10〜15ms) 前提 | Monaco は不採用 |
| 図 | **自前 Diagram IR (JSON) → サーバ側 ELK (Bun Worker) でレイアウト → クライアントは SVG 描画のみ**。Mermaid は fence のみ遅延ロード | ELK Worker: 20/100/300/1000 ノード = **11/31/88/378ms**、クライアント側レイアウトコード 0 byte。Mermaid 12 の flowchart 経路は **652KB gz** (うち ELK 447KB)、render 134〜522ms。D2 は browser 8.2MB JS / node 25MB pkg で重い | dagre (16KB gz, <150 ノードなら十分) |
| リッチテキスト | **v1 は WYSIWYG を入れない**: 読み取りビュー + ブロック単位の CM6 ソース編集 + コメント/サジェスションは外部レコード (block id + 引用 + ハッシュで anchor) | Tiptap 公式 UniqueID は **5000 ブロックで初期化 9.2s** (ID 無しなら 103ms)、Tracked Changes は **有償 (custom pricing)**。Lexical/PM/CM6 いずれも日本語 IME の既知バグ履歴あり → 編集面積を最小化 | 将来 WYSIWYG が要れば ProseMirror 直 + 自前 ID plugin + `@handlewithcare/prosemirror-suggest-changes` (MIT) |
| ローカルサーバ | **Bun.serve + SSE (サーバ→UI) + HTTP POST (UI→サーバ) + bun:sqlite (WAL, FTS5 trigram) + `fs.watch({recursive})` (macOS/Windows) / @parcel/watcher (Linux 要検証)** | JSON 26k req/s、SSE p99 4.6ms (200 clients)、WS p99 6.7ms。SQLite 10 万行 insert 205ms、FTS5 trigram 検索 0.05ms/query、point get 3.5µs。fs.watch 事象検知 p50 19.6ms | node:sqlite (Node 22.23 でも動く: insert 254ms) |
| 共有 (任意) | **Cloudflare Workers + Static Assets + R2 + D1 (+ Durable Object は live review 時のみ)、名前は `mitori-*`** | Free: Workers 100k req/日・静的アセット無制限・D1 5M read/100k write/日・R2 10GB・DO(SQLite) 100k req/日。**月額 0 円で収まる設計**が可能 (Paid は $5/月) | 完全オフライン共有: 自己完結 HTML エクスポート (サーバ不要) |

**最重要の発見 (設計に直結)**
1. **構文解析速度は律速ではない**。全量でも 1 秒前後、再実行は 7〜22ms。律速は LLM のトークン/レイテンシ → 解析層は「速く・堅く・多言語」に振り、浮いた予算を **トークン削減 (signature skeleton で 13〜30× 圧縮、§2.7)** に使う。
2. **UI の性能は FW ではなく「何を DOM にするか」で決まる**。仮想化 + ブロック HTML キャッシュなら FW 差は 0.1ms オーダー。FW は **バンドル/起動/DX** で選ぶ。
3. **Bun 単一バイナリは成立する**が、`oxc-parser` の `.node` 自動同梱不可、native addon が共有ライブラリを伴うと展開問題 (bun#44063)、`fs.watch` の per-watcher O(n²) (bun#34160)、oxc raw transfer 非対応、の 4 つの罠がある (§3, §8.4)。
4. **日本語 IME**: 全エディタ候補で IME 既知不具合の履歴がある。「Enter 確定で送信される」系は **`isComposing`/keyCode 229 ガード**で自前 UI 側から防げるので、コメント入力は必ずガード (§7.3)。

---

## 1. 計測環境と方法論

| 項目 | 内容 |
|---|---|
| マシン | Apple **M5 Max** (6 P-core + 12 E-core = 18 論理), 128GB RAM, macOS 27.0 (arm64) |
| ランタイム | Bun **1.4.2**, Node **22.23.3** (nix devShell: `/Users/satoki252595/work/20261002_aiAgentTool/flake.nix`) |
| ブラウザ | Chrome **154** (devtools MCP 経由・ディスプレイ 120Hz のため `rAF+setTimeout` 待ちの下限は **約 8.3ms** — 「typing 8.3ms」は 1 フレームの床で、実処理は <1〜2ms) |
| コーパス | `crit` (Go 445 + JS 162 + TS 143, 他 [crit リポ](https://github.com/tomasz-tomczyk/crit)), `m3e-canvas` (TS/TSX 64), `hono` (TS 427, honojs/hono shallow clone), **Go stdlib `src/` 6,823 files / 85.6MB** (testdata 除外) |
| 統計 | 解析: 全 pass 5 回 (cold = 1 回目, warm = 2〜5 回目の median)。ブラウザ: 9 reps × 3 round の median。ばらつきは概ね ±5% |
| 注意 | 1 台・1 回の環境。**相対比較と桁感**を信用し、絶対値は他 OS で再測定すること。IME は自動化できないため **実機未検証** |

crit のコードに「ベンダー済み minified (`web/mermaid.min.js` 3.4MB, 1 行平均 >300 文字)」が混ざっていた。これ 1 ファイルの解析が wasm tree-sitter で **472ms** (Bun; native 330ms, oxc 230ms, tsc 119ms) かかるのに、得られるトップレベルシンボルは **1 件**。混在コーパス全体 (814 files, 1,245ms) の約 38% を占める → 実運用の解析器は **minified / generated / 巨大ファイルを平均行長ヒューリスティクス (avg line > 300 chars) と size 上限 (2MB) で除外**すべき (E2E ベンチでも採用)。

---

## 2. Q1: 構文解析 (Bun/TypeScript で大量ファイルを速く)

### 2.1 比較対象と実装
同一アダプタ (`05-stack-bench/parsers.mjs`) で「パース → トップレベルシンボル (kind/name/line) 抽出」を行い、**全実装でシンボル数が一致するか**を検証した (一致: tree-sitter 系 3 実装は TS 2802 / Go 323,391(±18)。oxc 2859・tsc 2862 は grammar 差で ±2%)。

| 実装 | 説明 |
|---|---|
| (a) web-tree-sitter 0.27.0 (WASM) | 公式 per-language wasm (`tree-sitter-go` 等) |
| (b) @ast-grep/napi 0.45.3 | Rust + tree-sitter、napi |
| (c) native `tree-sitter` 0.25.1 (node bindings) | **Bun でも動作確認 (✓)** |
| (d) oxc-parser 0.152.0 | JS/TS 専用 Rust。default / `experimentalRawTransfer` / `experimentalLazy` |
| (d') TypeScript compiler API 5.9.3 | `createSourceFile` |

### 2.2 単一スレッド結果 (warm median, extract モード)

**TS corpus (634 files, 4.9MB; crit-ts + m3e + hono)**

| 実装 | Bun ms | Bun files/s | Bun MB/s | Node ms | Node MB/s |
|---|---:|---:|---:|---:|---:|
| web-tree-sitter (wasm) | 501 | 1,266 | 9.9 | 567 | 8.7 |
| native tree-sitter | 370 | 1,712 | 13.3 | 382 | 12.9 |
| @ast-grep/napi | 352 | 1,802 | 14.1 | 357 | 13.9 |
| oxc-parser (default, 全 AST を JSON→JS) | 196 | 3,234 | 25.2 | 312 | 15.8 |
| oxc **raw transfer** | 非対応 | — | — | **56〜60** | **82〜88** |
| oxc **lazy** (必要な枝のみ deserialize) | 非対応 | — | — | **24〜33** | **152〜207** |
| TypeScript 5.9 compiler API | **160** | 3,959 | 30.9 | 158 | 31.3 |

**Go corpus (crit 445 files, 3.8MB)**: wts 424ms (9.0MB/s) / native 322ms (11.9) / ast-grep 373ms (10.3) [Bun]。Node は wts 616 / native 347 / ast-grep 365ms。
**Go stdlib (6,823 files, 85.6MB)**: Bun — wts **7,203ms** (11.9MB/s, 947 f/s), native **5,356ms** (16.0MB/s, 1,274 f/s), ast-grep 6,375ms (13.4MB/s)。Node — wts 9,473ms, native 6,431ms, ast-grep 6,584ms。
**パースのみ (シンボル抽出なし)**: Go stdlib Bun で wts 7,062 / native 5,553 / ast-grep 5,514ms → **抽出コストは 0〜2%、律速は tree-sitter 本体のパース**。
**oxc の内訳 (Bun, 4.9MB)**: `parseSync` のみ (AST 未参照) 48ms=**102MB/s**、`+module` (static import/export) 53ms=**93MB/s**、全 AST 参照 156ms=31MB/s → **JS/TS の import グラフは Bun 上でも 100MB/s 級で取れる**。

### 2.3 Worker 並列 (Go stdlib 85.6MB, LPT で size 均衡, Worker 内で read+parse+extract)

| Workers | web-tree-sitter (Bun) ms | native tree-sitter (Bun) ms | ast-grep napi (Bun) ms |
|---:|---:|---:|---:|
| 1 | 7,154 | 5,339 | 6,048 |
| 2 | 3,770 | 3,993 | 4,345 |
| 4 | 1,908 | 2,144 | 2,426 |
| 8 | **1,189** | 1,003 | 1,927 |
| 12 | 1,190 | 737 | 1,878 |
| 16 | 1,413 | **617** (11.1k files/s) | 1,771 (頭打ち) |

- wasm は **8 本で 6.0× 速**、以降は E-core 混在で頭打ち (6P+12E)。1 Worker あたり wasm インスタンス ~60〜80MB (16 本で RSS 1.36GB)。
- native tree-sitter は 16 本で 8.7× だが **解放が GC 任せ**: Worker プールの RSS は 2.7GB 前後。単一スレッドの 85MB 走査では RSS が **7〜10GB** に膨らむ (木が GC されるまで native メモリを保持。pass ごとに `Bun.gc(true)` すると 1000 files 周回で RSS 730MB に安定 — `leak2.mjs`)。wasm は `tree.delete()` を呼べば 130MB 程度で平坦。
- ast-grep の napi 経由は Worker では頭打ち (3.8k files/s)。一方 **Rust 側スレッド `findInFiles`** は Go stdlib の関数/メソッド/型 11.6 万件を **0.83〜0.93s** (Bun/Node 同等) で返す → 「構造検索」用途には最適。
- Node 上 wasm 12 本: 1,314ms、native 12 本: 890ms。**ランタイム差は小さい** (Bun が wasm で 1.2〜1.3× 優位)。

### 2.4 E2E パイプライン (git ls-files → stat → SQLite キャッシュ照合 → xxHash3 → Worker で parse → SQLite 書込)
`05-stack-bench/pipeline.mjs`。`workers` は 8、web-tree-sitter、minified 除外あり。

| リポ | files | **cold** 合計 | (Worker wall / Σread+hash / Σparse) | **warm (無変更)** | warm (1 file 変更) |
|---|---:|---:|---|---:|---:|
| m3e-canvas (TS) | 65 | 124ms | 116 / 16 / 702ms | **6.1ms** | 23ms |
| hono (TS) | 456 | 184ms | 174 / 50 / 1,188ms | **6.9ms** | 6.8ms |
| crit (Go+JS+TS) | 750 | 271ms (4 本: **229ms**) | 258 / 91 / 1,629ms | **6.9ms** | 6.8ms |
| Go stdlib | 6,827 | **1,298ms** (8 本) / 1,103ms (12 本) | 1,230 / 932 / 8,240ms | **21.8ms** | 22.2ms |

- **小さいリポでは Worker 数を絞る方が速い** (crit: 4 本 229ms < 8 本 253ms < 12 本 357ms; wasm 初期化+メモリ)。→ `workers = clamp(ceil(totalMB / 2), 1, min(8, cores-2))`。Worker 初期化は 8 本で 24〜25ms。
- Peak RSS: crit 400〜625MB (4〜12 本), Go stdlib 650〜1000MB。
- 変更検知は `stat (size,mtime)` → 変化分のみ `xxHash3` → ハッシュ一致なら parse 省略。**warm rescan は 7,000 ファイルでも 22ms**。
- 周辺プリミティブ (7,768 files / 108MB, Bun): `git ls-files` **5.8ms**, `git status --porcelain` 込み 38.7ms, `rg --files` 15.1ms, 手書き walk 14.5ms, `Bun.Glob` 15.2ms, `readdir(recursive)` 24.8ms (Node 47.8ms), `stat` 全件 9.6ms, 全読み込み 121.7ms。ハッシュ 108MB: **`Bun.hash.xxHash3` 3.2ms**, wyhash 3.4ms, xxHash64 4.7ms, sha256 36.4ms (Bun の `CryptoHasher('blake3')` は未対応), md5 131ms。→ **内容アドレスは xxHash3、署名・共有には sha256**。
- 増分 (tree-sitter `tree.edit` + 再パース, 20k 行/574KB TS): 初回 75.7ms → **編集後 8.3ms (p95 9.0ms)**。ライブ編集中の個別ファイル更新は 10ms 以内。

### 2.5 多言語カバレッジ (実際に `Language.load` して確認)
- **web-tree-sitter 0.27.0 + 公式 per-language npm の wasm** で全て load 成功: Go, Python, JavaScript, TypeScript, TSX, Rust, Java, C, C++, C#, Ruby, PHP(+php_only), Bash, HTML, CSS, JSON, Scala、`@vscode/tree-sitter-wasm` で PowerShell/INI/Regex 追加。load は 0〜3ms/言語 (遅延コンパイル)。ABI は 14/15 混在 (0.27 は両対応)。
- **罠**: `tree-sitter-wasms@0.1.13` (36 言語) は **0.27 では `Error` で load 不可** (dylink メタデータ形式差)。**`web-tree-sitter@0.25.10` に固定すれば 36 言語すべて load 成功** (Kotlin, Swift, Lua, Zig, YAML, TOML, Vue, Dart, Elixir, OCaml, Elm, ObjC, ReScript, Solidity …; 速度は 0.27 と同等 12.5MB/s)。
- 公式 npm に wasm が無い: Markdown, SQL, Kotlin/Swift/Lua/Zig/YAML/TOML (0.27 系)。必要なら `tree-sitter build --wasm` で自作、または 0.25.10 + legacy パックを併用。
- ast-grep: 内蔵 5 言語 (Html, JavaScript, Tsx, Css, TypeScript) + `@ast-grep/lang-*` 20 言語 (bash c cpp csharp dart elixir go java json kotlin lua markdown php python ruby rust scala sql swift yaml) は **プラットフォーム別 dylib を postinstall で取得し、パス指定でロード** → 単一バイナリへの同梱は未検証 (リスク)。
- oxc / tsc は JS/TS のみ。

### 2.6 結論 (Q1)
1. **コア解析層 = web-tree-sitter (WASM) を Bun Worker プールで**。理由: (i) ランタイム非依存・`.node` 同梱問題なし・Cloudflare Workers/ブラウザでも同じコードが動く (共有ビューでの再解析も可)、(ii) 実測 native 比 1.2〜1.4× 遅いだけ、(iii) メモリが決定的 (`delete()`)、(iv) 36〜17 言語を同一 API で、(v) 増分パース。
2. native tree-sitter は **採用しない** (`GC` 依存の RSS 爆発、`bun --compile` で prebuild 同梱は動いたが保守負担、速度利得 1.4×)。
3. `@ast-grep/napi` は解析の主軸ではなく、**エージェント向け構造検索ツール** (`findInFiles`: 7k ファイル 0.9s) として任意同梱。
4. JS/TS は oxc の `module` 情報 (import/export, 93MB/s) を Bun で併用可。**oxc raw/lazy (最大 207MB/s) は Node 限定** (`supported.js` が Bun を明示除外、`ArrayBuffer>4GiB` 非対応) → 当面使わない。型情報が必要な TS 深掘りは **`typescript@5.9`** (TS 7.0.2 の npm 版は `exports["."]` が `./lib/version.cjs` (= `createSourceFile` 等は無い) で、API は `typescript/unstable/*` のみ、[InfoQ](https://www.infoq.com/news/2026/08/typescript-7-released/) も「7.0 に安定 API 無し、7.1 予定」と記載)。
5. 速度目標 (SLO 案): 1,000 files/10MB の cold index ≤ 0.5s、100MB/7k files ≤ 1.5s、warm rescan ≤ 25ms、単一ファイル更新 ≤ 15ms、peak RSS ≤ 1GB。いずれも実測で達成済み。

### 2.7 トークン経済 (AI 時代の NFR と直結)
`gpt-tokenizer` (o200k_base) 実測 — **Claude の tokenizer ではない**ため絶対値は ±20〜30% の目安 (要キャリブレーション):

| 内容 | bytes/token | chars/token | encode 速度 (Bun) |
|---|---:|---:|---:|
| Go ソース | 3.55 | 3.54 | 41MB/s |
| TypeScript | 3.97 | 3.97 | 53MB/s |
| 英語 Markdown | 4.01 | 3.99 | 55MB/s |
| 日本語散文 | 3.90 | **1.38** | — |

→ 「bytes/4」ヒューリスティクスは概ね ±12% (コード 3.5〜4.0)。**日本語は 1 文字 ≈ 0.72 token** なので UI/設計書の日本語本文は英語の約 2.8× のトークン/文字。

**Signature skeleton** (トップレベル宣言ごとに 1 行 + ファイルパス; `skeleton-bench.mjs`):

| リポ | 生ソース tokens | skeleton tokens | 圧縮率 |
|---|---:|---:|---:|
| crit (Go, テスト含む 445 files) | 1,149,656 | 86,018 | **13.4×** |
| hono (TS 427) | 741,070 | 24,782 | **29.9×** |
| m3e-canvas (TS/TSX 64) | 384,508 | 14,535 | **26.5×** |
| Go stdlib net 系 531 files | 1,869,606 | 124,238 | **15.0×** |

生成時間は 137〜629ms (native)。つまり「リポ全体の見取り図」(L0) は 15k〜125k tokens、1M〜2M tokens 級のリポを **1 回のコンテキストに収まる粒度**へ落とせる。L1 以降 (関数本体・docstring) は参照したブロックのみ遅延取得する設計が妥当。

---

## 3. Q2: 単一バイナリ配布 (`bun build --compile`)

実バイナリを作り、**node_modules の無い別ディレクトリにコピーして** selftest (`/compile/iso`)。起動は `hyperfine -N --warmup 5 --runs 30`。

| 構成 | サイズ | 起動 (mean) | 備考 |
|---|---:|---:|---|
| hello | 62.2MB | **6.0ms** | Bun runtime 本体 (gzip 25.7MB / zstd-19 19.5MB) |
| `Bun.serve` + `bun:sqlite` | 62.2MB | 6.2ms | selftest ✓ |
| + web-tree-sitter + wasm (go,ts) | 64.2MB | 7.1ms (selftest 15.9ms) | wasm は `import x from "./f.wasm" with {type:"file"}` → `Bun.file(x).arrayBuffer()` → `Parser.init({wasmBinary})` / `Language.load(bytes)` ✓ |
| + @ast-grep/napi (TS 内蔵のみ) | 69.5MB | 9.0ms | `.node` は自動で `$bunfs` に同梱 ✓ |
| + native tree-sitter + tree-sitter-go prebuild | 63.1MB | 9.9ms | ✓ |
| + oxc-parser | 62.2→**64.0MB** | 8.6ms | **自動同梱されない** (loader が `createRequire` 経由)。回避: `.node` を `with {type:"file"}` で import し `process.env.NAPI_RS_NATIVE_LIBRARY_PATH = path` を **oxc import 前に**設定 → ✓ |
| **all** (sqlite + wts + ast-grep + oxc) | **71.8MB** | **10.5ms** (selftest 18.8〜20ms) | selftest peak RSS 56MB |
| all + `--bytecode --format=cjs` | 74.1MB | 9.8ms (selftest 17.2ms, -16%) | bytecode は CJS 必須 (top-level await 不可) |
| UI (16MB / 111 files) を import 同梱 + `Bun.serve` | 78.7MB | **9.7ms で初回応答** | `assets.gen.ts` に `import f from "./dist/x" with {type:"file"}` を生成。idle RSS **13MB** |
| Worker プール (`main.ts worker.ts` を entrypoint 指定) | 62.7MB | 12 本 ready 22ms, 解析 90ms | ✓ (`new Worker(new URL("./worker.ts", import.meta.url))`) |
| cross-compile | linux-x64 81.3MB / linux-arm64 81.3MB / windows-x64 86.1MB | — | `--target=bun-linux-x64` 等で各 1.8〜2.0s (ランタイム DL 込み) |

比較: `node -e 0` = 22.5ms、`bun -e 0` = 5.9ms。

**罠・リスク**
- oxc-parser の `.node` 同梱は上記ワークアラウンド必須。ast-grep の **dynamic lang (`@ast-grep/lang-*`) は dylib パス指定ロード**のため同梱の可否は未検証 → wasm 路線なら無関係。
- native addon が隣接共有ライブラリを持つ場合、`.node` 単体が temp に展開され `@loader_path` 解決に失敗 ([bun#44063](https://github.com/oven-sh/bun/issues/44063), open, macOS arm64 / Bun 1.4.2 で報告)。→ 純 wasm + 単体 `.node` に限定。
- バイナリは 62MB が床 (Bun runtime)。配布は gzip で ~29MB、`zstd -19` で ~22MB。**GitHub Releases / Homebrew tap / `npx`(Node 版) の 3 本立て**が現実的。
- 自己更新・署名 (macOS notarization) は未検証。

---

## 4. Q3: フロントエンド FW (巨大ドキュメントを速く)

### 4.1 公式 js-framework-benchmark (Chrome **152**, MacBook Pro 14 / M4, 2026 年)
出典: <https://krausest.github.io/js-framework-benchmark/2026/chrome152.html> (keyed, weighted geometric mean = 速度の相対値、1.00=最速)

| 実装 | weighted geomean | brotli size | run memory (1k 行) | first paint |
|---|---:|---:|---:|---:|
| vanillajs | 1.04 | 2.5KB | 1.86MB | 52.7ms |
| **solid 1.9.3** | **1.13** | **4.5KB** | 2.68MB | 47.3ms |
| **svelte 5.42.1** | **1.17** | **9.7KB** | 2.87MB | 58.4ms |
| vue 3.5.39 | 1.31 | 23.3KB | 3.93MB | 93.9ms |
| preact-hooks 10.29.8 | 1.59 | 5.7KB | 3.30MB | 51.1ms |
| react-hooks 19.2.0 | 1.58 | 51.4KB | 4.44MB | 221.4ms |
| react-compiler-hooks | 1.64 | 50.0KB | 4.60MB | 207.3ms |

個別: swap rows 4× CPU 低速化で react 89.9ms vs solid/svelte 12.6ms、select row preact 12.8ms vs solid 3.3ms。**React は replace all 1.25× / clear 1.7× / swap 7.1× (vs solid)**。

### 4.2 自前ベンチ (同一 DOM 構造・同一ブロック行; Svelte 5.57.1 / Solid 1.9.15 / React 19.3.0 / Preact 11.0.0 / vanilla; Vite 8)
バンドル (gz, ベンチ harness 約 1.5KB 込み): vanilla 2.0KB, **Solid 5.8〜6.1KB**, Preact(compat) 8.7〜9.0KB, **Svelte 14.3〜14.7KB** ($state の deep proxy を含む), **React 70.1〜70.4KB**。

| 操作 (ms, median) | vanilla-DOM | Solid | Preact | React (flushSync) | Svelte ($state) |
|---|---:|---:|---:|---:|---:|
| create 1k | 26.7 | 26.2 | 26.0 | 25.7 | 26.3 |
| replace all 1k | 18.5 | 18.9 | 21.4 | 20.5 | 21.1 |
| update every 10th | 2.2 | 2.2 | 2.6 | 2.7 | 2.5 |
| create **10k** (非仮想化) | **207** | 211 | 213 | 290 | **306** |
| コメント+1 (10k 行中 1 行) | 7.1 | 7.6 | 9.6 | 8.5 | 8.6 |
| 10k 行 heap | 25.5MB | 50.3 | 36.4 | 29.0 | 52.6 |
| **仮想化 (10k 中 60 行窓) 1 スクロール script 時間 p50 / p99** | 0.2/0.4 | **0.2/0.4** | 0.4/0.5 | 0.3/0.5 | 0.3/0.5 |

(DOM 40,008 ノード。vanilla `innerHTML` 全再描画は「コメント+1」が **174ms** と致命的 → 部分更新が必須。React の初回計測は `setState` が rAF 後に flush され過小評価したため `flushSync` 化して再測定。Svelte の create10k が遅いのは deep `$state` Proxy 化コスト — `$state.raw` で緩和可能、未測定。)

### 4.3 結論 (Q3)
- 実処理は **「仮想化しない 1 万ブロック DOM」が 200〜300ms、仮想化すれば 0.3ms/step** で FW 差は誤差。**設計書は必ず仮想化 (または content-visibility:auto) + ブロック HTML キャッシュ**。
- 選定: **Svelte 5**。理由: (1) バンドル 15KB gz で React の 1/5、(2) krausest で Solid と並ぶ上位 (1.17)、(3) `transition:`/`animate:flip`/スコープ CSS が標準で、UX 作り込みコストが低い、(4) rune ベースのシグナルは「アンカー/コメントの細粒度更新」に向く、(5) CodeMirror/Shiki/ELK は FW 非依存で相互運用が容易。
- **Solid** は純性能 (1.13) とバンドル (5.8KB) で上、JSX なので LLM 記述に馴染む。Svelte のリスク = **AI エージェントの Svelte 5 (runes) 知識の鮮度**。→ プロジェクト `CLAUDE.md` に runes ルールを書く / 公式の llms.txt を参照 (要確認)。React は m3e-canvas (Next 16 / React 19.2) の資産流用が利く点以外は不利 (+55KB gz, first paint 221ms)。
- 仮想化は `@tanstack/virtual-core` 3.17 (FW 非依存) もしくはブロック高さを測る自前実装 (動的高さ + 変更のあったブロックだけ再測定)。

---

## 5. Q4: コードビューア (CodeMirror 6 vs Monaco vs Shiki)

### 5.1 サイズ (Vite 8 ビルド, gz。同梱される全チャンクの合計)
| 構成 | raw | gzip | brotli |
|---|---:|---:|---:|
| **CodeMirror 6** (view+state+language+lezer JS/TS+defaultHighlight) | 372KB | **125KB** | 107KB |
| + `@codemirror/merge` | +29KB | **+10KB** | — |
| CM6 + `lang-markdown` (HTML 言語を連れてくる) | 499KB | 171KB | 146KB |
| **Monaco 0.57** `editor.api` のみ (core) | 2.74MB + worker 304KB + css 99KB | ≈ 696+92+14 = **約 0.8MB** | 551KB(core のみ) |
| Monaco `editor.main` (全 monarch 言語) | +1.25MB | **約 1.1MB** | — |
| Monaco TS language worker (遅延) | 6.93MB | **+1.48MB** | 1.04MB |
| **Shiki 4.5** core + JS regex engine + `typescript` + 1 theme | 362KB | **≈ 74KB** (55+16+2.5) | — |
| Shiki + Oniguruma WASM engine | +622KB | **+230KB** | 149KB |

(参考: crit のアセット予算 `refs/crit/asset-budget.json` — `pierre-diffs.js.gz` 200KB + worker 128KB (+Shiki 文法チャンク), `mermaid.min.js` gz 1.18MB = 出荷 JS の約 70%。)

### 5.2 ランタイム (Chrome 154, 20,000 行 / 589KB の TS, アンカー 1000 件)
| 指標 | CM6 | Monaco (editor.main, `java` monarch*) | Shiki 静的 HTML (JS engine) |
|---|---:|---:|---:|
| 作成→初回 paint | **6.3〜17.8ms** | 22〜75ms | highlight **1,323〜1,588ms** + 挿入 130〜158ms |
| 追加 heap | 8.3〜8.9MB | 24.8MB (初回) | — (HTML 3.5MB) |
| DOM ノード | **225〜259** | 338〜424 | **92,752** |
| 1000 行デコ + 1000 インラインウィジェット適用 | **5〜6ms** | 2.6〜16ms (decorations collection) | — |
| 打鍵→paint p50 / p95 | 8.3 / 10.4 | 8.3 / 10.7〜13.6 | — |
| ランダムスクロール p95 | 10.7〜11.2 | 9.8〜10.8 | 8.9〜9.0 (単なる DOM スクロール) |
| アンカーへジャンプ (中央寄せ) p50 | 8.3 | 8.2〜8.3 | — |
| 200 行チャンクを highlight | — | — | **13.7〜14.9ms** (Oniguruma WASM: 10.5ms) |

\* Monaco は TS 言語サービス worker 抜きのため monarch の `java` を使用 (同程度のトークナイズ負荷)。
**どちらの editor も 1 フレーム内で動く**。差は (1) 出荷サイズ 10×、(2) アンカー/コメントを `StateField + RangeSet` で変更に追従して持てる拡張性 (CM6)、(3) Monaco は view zone 等が強力だが重い。

**Shiki のサーバ側 (Bun)**: 100 行スニペット = **JS engine 7.8ms (0.36MB/s) / Oniguruma 3.7ms (0.76MB/s)**。Node は 13.1 / 4.6ms。→ **サーバ (生成時) は Oniguruma、ブラウザ遅延ハイライトは JS engine (-230KB gz) で 200 行チャンク**。20k 行の一括 `codeToHtml` は不可 (9.3 万 DOM)。

### 5.3 Diff 表示 (`@codemirror/merge`)
| 構成 | 作成→paint | DOM | 打鍵 p50 / p95 |
|---|---:|---:|---:|
| side-by-side `MergeView` 5,000 行 / 100 hunk | 38ms | 837 | 8.3 / 23.5ms |
| 同 20,000 行 / 1,000 hunk | 13.5ms | 839 | 8.3 / 23.9ms |
| **unified** 5,000 行 / 100 hunk | 50.5ms | **14,873** | 26.2 / 34.8ms |
| **unified** 20,000 行 / 1,000 hunk | 118ms | **59,963** | **98.9 / 121.8ms** |

→ side-by-side は仮想化されて安定。**unified は削除チャンクが widget 化され DOM が爆発**するため、サジェスション (数 hunk) 用途のみ。大規模 diff は自前仮想リスト (行数 ≥ 500 hunks)。

### 5.4 結論 (Q4)
**CodeMirror 6 を標準ビューア/編集器、Shiki を設計書内の静的コードブロック**に。Monaco は不採用 (サイズ、TS worker、view zone 以外の利点が薄い)。コメントの行アンカーは CM6 の `StateField<DecorationSet>` + `gutter()` + `Decoration.widget` で実装でき、`RangeSet.map(changes)` で人の編集にも追従する。

---

## 6. Q5: 図 (Mermaid vs ELK/dagre + SVG vs D2)

| 候補 | クライアント JS (gz) | レイアウト時間 (20 / 100 / 300 / 1000 ノード) | 備考 |
|---|---:|---|---|
| **Mermaid 12.1** flowchart (ELK 既定, 遅延チャンク込み) | **652KB** (raw 2.24MB; ELK 単体 447KB) | **render 134 / 160 / 522ms** (1000 は未測定) | SVG 61 / 208 / 643KB。全 101 チャンク計 6.5MB raw (flowchart 以外の図種は個別チャンク) |
| **ELK.js 0.12** (クライアント直, bundled) | **434〜447KB** | 19 / 28 / 78 / **430ms** (+SVG 構築 2〜11ms) | compound/ports/orthogonal routing |
| **ELK in Bun Worker (サーバ側)** | **0KB** | **11 / 31 / 88 / 378ms** | Bun では `elk.bundled.js` が `self` を誤判定し失敗 → `elk-api.js` + `workerFactory: u => new Worker(u)` で動作 |
| **dagre 3.1 (@dagrejs)** | **16KB** | 6 / 22 / 127 / 1,444ms (Bun: 3 / 19 / 120 / 1,203ms) | 300 ノード超で ELK に負ける。compound 弱い |
| **D2 0.1.33 (WASM)** | browser 8.2MB JS / node pkg 25MB | Bun: dagre/elk 20=36〜60ms, 100=85〜92ms, 300=232〜254ms (初回 +60〜240ms) | SVG 27 / 98 / 270KB。LLM の習熟度が Mermaid より低い |

**判断**
- 「ノードクリックで該当セクションにジャンプ」は **自前 SVG が圧倒的に容易** (各 `<g data-ref=…>` に委譲ハンドラ 1 つ) で、Mermaid は `securityLevel:'loose'` + `click` 構文かポスト処理が必要。
- **推奨パイプライン**: LLM (または解析器) が **Diagram IR** (`{nodes:[{id, label, ref:{block|symbol|path}, group}], edges:[{from,to,kind}]}`) を出力 → サーバで ELK layered (Bun Worker) → 座標付き JSON を **内容ハッシュでキャッシュ** → クライアントは 3KB 級の SVG コンポーネントで描画。クライアントのレイアウトコードは 0 byte、300 ノードでも 88ms、再レイアウトは編集時のみ。
- Mermaid は repo 内 Markdown の ```mermaid fence を **遅延ロード**で描画する互換機能に限定 (描画に 130〜520ms・650KB gz の対価を払うのは明示的に開いたときだけ)。D2 は不採用。
- 注意: dagre は 1,000 ノードで 1.2〜1.4s → サーバ ELK なら 380ms (Worker で UI を塞がない)。

---

## 7. Q6: Markdown / リッチテキスト編集

### 7.1 サイズと初期化 (Chrome 154; 日英混在の Markdown N ブロック = 見出し/段落/箇条書き/コード)
| エディタ | gz (全チャンク) | 500 | 2,000 | **5,000** ブロック初期化→paint | DOM (5k) | 打鍵 p95 (全て 1 フレーム) |
|---|---:|---:|---:|---:|---:|---:|
| **CodeMirror 6 + lang-markdown** (ソース編集) | 171KB | 23ms | 8ms | **8ms** | 108 | 10.5ms |
| ProseMirror 直 (prosemirror-markdown + history) | 117KB | 20ms | 27ms | 51ms | 8,501 | 9.1ms |
| Tiptap 3.31 (StarterKit + Markdown) | 142KB | 40ms | 38ms | 103ms | 8,501 | 10.5ms |
| **Tiptap + 公式 `UniqueID`** | (上と同じビルドに含む) | 181ms | **1,975ms** | **9,199ms** (heap 356MB) | 8,501 | 9.5ms |
| Lexical 0.52 (rich-text/list/code/markdown/history) | **87KB** | 34ms | 59ms | 103ms | 12,501 | 8.8ms |
| Milkdown 7.22 (commonmark + history) | 114KB | 60ms | 115ms | 228ms | 8,502 | 8.7ms |

- **ブロック ID の付与を編集エンジンに任せると O(n^1.5〜2) で崩壊** (Tiptap UniqueID: 2k で 2s、5k で 9s)。→ **ID は生成時 (サーバ) に確定し、ソースに持たせる**(§7.4)。
- 打鍵は全て 1 フレーム。性能で足切りになるのは UniqueID のみ。CM6 だけは仮想化されるので DOM が定数。

### 7.2 サジェスション / 変更履歴 (track changes)
| 方式 | ライセンス/状況 |
|---|---|
| Tiptap "Tracked Changes" | **有償アドオン (custom pricing / contact sales)** — [tiptap.dev/pricing](https://tiptap.dev/pricing)。コアは MIT |
| ProseMirror: `@handlewithcare/prosemirror-suggest-changes` | **MIT**。insertion/deletion/modification/block-boundary の 4 mark。collab/IME は README 上言及なし ([GitHub](https://github.com/handlewithcarecollective/prosemirror-suggest-changes)) |
| ProseMirror: `prosemirror-suggestion-mode` (davefowler), `prosemirror-changeset` (公式) | OSS。changeset は diff 分解の基礎 |
| Lexical | 公式の suggestions 無し (`@lexical/mark` はコメント範囲用) |
| CM6 | `@codemirror/merge` で accept/reject UI (gz +10KB)。Marks でなく **外部の提案レコード**を扱うのに向く |

### 7.3 日本語 IME (調査ベース、実機未検証)
- Lexical: IME 中に別段落をクリックすると書式が継承される ([#8098](https://github.com/facebook/lexical/issues/8098))。0.47.0 以降 **TextNode サブクラスへの IME 確定で型・key・state が失われる** ([#9289](https://github.com/facebook/lexical/issues/9289), 修正 PR #9291 で closed)。
- ProseMirror: Safari で mark 適用後に Japanese IME の composition が再開し続ける ([prosemirror#935](https://github.com/ProseMirror/prosemirror/issues/935))、Chrome の Korean IME 退行 ([#1484](https://github.com/ProseMirror/prosemirror/issues/1484))。
- CM6: Google 日本語 IME の候補ウィンドウが新規行で (0,0) に出る ([discuss.CodeMirror](https://discuss.codemirror.net/t/issue-with-google-japanese-ime-cursor-position-in-v6/8810))。
- 他ツール (Codex/Kiro/orca 等) で **「IME 確定の Enter で送信/保存される」**不具合が多発 → mitori の入力欄は **`keydown` で `e.isComposing || e.keyCode === 229` なら無視、送信は Cmd/Ctrl+Enter 既定** とする (自前 UI で確実に防げる)。
- 結論: どのエンジンも「IME 完全無罪」ではない。**IME 敏感な編集面積 (contenteditable の WYSIWYG) を最小化**する構成が最も安全。

### 7.4 結論 (Q6) — 設計書の編集モデル
1. 設計書は **Markdown (+ 安定ブロック ID)** が正本。ID は生成時に `<!-- mitori:id=b_xxxx -->` 相当、または見出しスラグ/`{#id}` で付与し、エディタには計算させない。ブロック境界は `markdown-it` の `token.map` (行範囲) で得る。
2. **読む/コメントする** UX = サーバ生成のブロック HTML (キャッシュ) + 選択範囲→コメントのアンカー (block id + 引用テキスト + 前後文脈ハッシュ + 文字オフセット; ズレたら引用でリアンカー)。
3. **直接編集** = 対象ブロックだけを **CM6 の Markdown ソース編集** (plain textarea でも可) でインライン展開。IME は CM6/ブラウザ標準経路で、decoration は変換中に触らない。
4. **サジェスション** = 外部レコード `{block_id, base_hash, patch(unified diff)}` として保存し、`@codemirror/merge` (side-by-side) で差分表示 → accept で Markdown に反映し、AI 修正指示を発行。WYSIWYG の mark に埋め込まない。
5. WYSIWYG が要件化した場合のみ、ProseMirror 直 (117KB gz) + 自前 ID plugin + MIT の suggest-changes を後付け (Tiptap の UniqueID は不可)。

---

## 8. Q7: ローカルサーバ (Bun.serve / SQLite / watch)

### 8.1 HTTP / WebSocket / SSE (同一マシン, 別プロセスクライアント; `srv.mjs` / `cli.mjs`)
| 指標 | 結果 |
|---|---|
| 起動→listen | 0〜1ms (コンパイル版 + 16MB 同梱でも初回応答 9.7ms) |
| `GET /json` (20KB) | **26,030 req/s** (ab -c64 -k, ab 側が律速)、p99 4ms |
| `GET /static` (500KB) | 9,622 req/s (4.7GB/s) |
| WS broadcast 1KB × 20Hz → 200 clients | p50 **3.5ms** / p95 5.7 / p99 6.7 / max 7.4ms (欠落 0) |
| SSE 同条件 (200 clients) | p50 **1.4ms** / p95 3.2 / p99 4.6 / max 7.4ms |
| WS 1,000 clients | p50 6.3 / p99 14.3ms (受信 98,000/100,000 = 2% 欠落。原因未調査: クライアント側の接続確立待ちの可能性) |

→ **サーバ→UI は SSE (EventSource, 自動再接続, プロキシ/CF 互換)、UI→サーバは fetch POST**。WS は Cloudflare Durable Object の live review や双方向カーソル共有が要るときだけ。

### 8.2 SQLite (`bun:sqlite` / `node:sqlite`, WAL + synchronous=NORMAL, 10 万 block 行 ≈ 136MB)
| 操作 | Bun 1.4.2 | Node 22.23 (`node:sqlite`) |
|---|---:|---:|
| open | 0.9ms | 0.2ms |
| 100k INSERT (1 tx) | **205ms** | 254ms |
| FTS5 trigram index 構築 (100k) | 2,605ms | 2,905ms |
| point get ×100k | 352ms (**3.5µs**/件) | 230ms |
| 範囲/複合 index クエリ ×20k | 57ms | 33ms |
| FTS5 クエリ ×2,000 (LIMIT 20) | **98ms (0.05ms/件)** | 66ms |
| autocommit UPDATE ×2,000 | 20ms (10µs) | 13ms |

FTS5 の `trigram` tokenizer は日本語の部分一致検索 (3 文字以上のクエリ) に使える。1〜2 文字は LIKE にフォールバック。`node:sqlite` は Node 22 で ExperimentalWarning だが API 互換 → 薄い adapter で撤退可能。

### 8.3 Markdown レンダリング (サーバ)
| 実装 (Bun) | 実文書 89KB | 2,000 ブロック | 20,000 ブロック | MB/s |
|---|---:|---:|---:|---:|
| `Bun.markdown.html` (Zig 内蔵) | **0.5ms** | **1.5ms** | **14.7ms** | 90〜184 |
| markdown-it 15 | 2.9ms | 9.4ms | 100ms | 13〜30 |
| marked 18 | 3.6ms | 8.8ms | 87ms | 15〜24 |
| micromark+gfm | 24.5ms | 72ms | 984ms | 1.4〜3.5 |
| remark→rehype | 29.5ms | 97ms | 1,794ms | 0.7〜3.0 |

`Bun.markdown` は GFM table/task/打消しは可、**source position (meta) 無し・脚注非対応**、`render` コールバックは heading の level 程度の meta。→ **ブロック行範囲が必要な設計書本体は markdown-it (`token.map`)、コメント本文・一時プレビューは `Bun.markdown.html`**。いずれも 1 回の全量変換が 100ms 以下でキャッシュ前提なら無視できる。

### 8.4 ファイル監視 (macOS, 7,768 files / 923 dirs と 23,304 files / 2.8k dirs の 2 ツリー)
| 実装 | setup | 書込→イベント p50 / p95 | 2,000 ファイル一括 | idle CPU (2s) | RSS |
|---|---:|---:|---:|---:|---:|
| `fs.watch({recursive:true})` Bun | **2.1〜2.2ms** | **19.6 / 21.3〜21.8ms** | 2000/2000 を 189〜228ms | 6ms | 33MB |
| 同 Node | 0.3ms | 19.4〜19.5 / 21.0〜21.4ms | 2000/2000 163〜174ms | 3ms | 44MB |
| `@parcel/watcher` (Bun) | 5〜63ms | 69.4〜70.8 / 73.6〜73.9ms | 2000/2000 223〜238ms | 6〜7ms | 39MB |
| 同 Node | 4.6〜4.7ms | 68.6〜69.7 / 74ms | 2000/2000 219〜233ms | 3ms | 48MB |

- macOS では **ネイティブ recursive `fs.watch` (FSEvents) で十分**。ツリー規模に依存せず setup ≈ 2ms。parcel は coalesce で ~70ms 遅いが取りこぼしがない設計。
- **Linux は要検証**: Bun の `fs.watch` は watcher 登録コストが超線形 (5,000 watcher で Bun 74s vs Node 58ms, [bun#34160](https://github.com/oven-sh/bun/issues/34160), open)。recursive の挙動は Linux で未測定。→ Linux は `@parcel/watcher` (inotify 1 本化) を既定にする案。
- 検知後は §2.4 のとおり stat→hash→再パース (10ms) → SSE 配信 (p99 5ms) で、**保存から UI 更新まで概ね 50ms 以内**。

---

## 9. Q8: Cloudflare (任意の共有機能) — 2026-10 時点 公式ドキュメント

| サービス | Free プラン上限 | Paid (参考) |
|---|---|---|
| **Workers** ([pricing](https://developers.cloudflare.com/workers/platform/pricing/), [limits](https://developers.cloudflare.com/workers/platform/limits/)) | **100,000 req/日**, CPU **10ms/呼出**, **Static Assets の配信は無料・無制限**, subrequest 50/req, Worker 100 個/アカウント, Logs 200k/日(保持3日), startup 1s, Worker サイズ 64MiB | 10M req/月込み + $0.30/M, CPU 30M ms/月込み + $0.02/M, 5 分まで |
| **Static Assets** | 20,000 files/version, **25MiB/file** | 100,000 files |
| **D1** ([pricing](https://developers.cloudflare.com/d1/platform/pricing/), [limits](https://developers.cloudflare.com/d1/platform/limits/)) | **5M rows read/日, 100k rows written/日, 5GB 合計**, DB あたり **500MB**, 10 DB, 50 queries/呼出, 1 行/BLOB 最大 2MB, bound param 100 | 25B read/月込み, 50M write/月込み, $0.75/GB-月, DB 10GB, 5万 DB |
| **R2** ([pricing](https://developers.cloudflare.com/r2/pricing/)) | **10GB-月, Class A 1M/月, Class B 10M/月, egress 無料** | $0.015/GB-月, A $4.50/M, B $0.36/M |
| **Durable Objects** ([pricing](https://developers.cloudflare.com/durable-objects/platform/pricing/), [limits](https://developers.cloudflare.com/durable-objects/platform/limits/)) | **SQLite-backed のみ**, 100k req/日, **13,000 GB-s/日**, SQLite 5M read/日・100k write/日・5GB 合計, 1 DO あたり 1GB, 100 クラス, WS メッセージ受信は **20:1** で課金換算, 1 DO 1,000 req/s (soft), WS メッセージ 32MiB | 1M req/月 + $0.15/M, 400k GB-s + $12.5/M GB-s, 10GB/DO |

### 9.1 mitori への当てはめ (全リソース名は `mitori-` で開始: `mitori-share` (Worker), `mitori-snapshots` (R2), `mitori-meta` (D1), `mitori-room` (DO class))
1. **スナップショット共有 (読み取り中心)**: ローカルの設計書 JSON (圧縮 100KB〜数 MB) + ビューア SPA (同一ビルド, 静的アセット) を `PUT /s/:id` で R2 に保存 → Worker が署名付きの非推測 ID で配信。Static Assets は無制限なので SPA 配信は 0 円。R2 10GB で 2MB/件なら **約 5,000 件**。D1 にはメタ (id, 期限, view 数) のみ。
2. **共有上のコメント**: D1 (100k write/日 = 1 日 10 万コメント書込) で十分。リアルタイム反映が要る "live review" のみ DO + WebSocket Hibernation (受信 20:1 課金、duration は hibernation で削減)。
3. **Worker の CPU 10ms 制約**: Markdown 変換・ハイライト・レイアウトを Worker でやらない (ローカル生成物を保存するだけ)。→ Free で成立。
4. **コスト**: Free のみで月 0 円。Paid へ上げる場合は $5/月 (為替次第で約 ¥750 前後) で、CLAUDE.md の承認閾値 (月 1,000 円増) に近いので事前承認を取る。推論はユーザのローカル Claude Code/Codex を使い、Cloudflare AI は使わない。
5. **サーバ不要の代替**: ビューア + データを **自己完結 1 HTML** に書き出す (m3e-canvas 的な静的運用)。Svelte ~15KB gz + 設計書 JSON のみ。コメントは `localStorage` / JSON エクスポート。

(注: 一部ブログに「DO Free 制限が 2026-09 に変更」との記述があったが、公式ページでは Free で SQLite-backed DO を提供と確認済み。Zero Trust/Access の無料枠 (Access 経由の共有認証) は今回未確認 — 要調査。)

---

## 10. 推奨アーキテクチャ (要約図)

```
mitori (単一バイナリ: Bun --compile, ~72MB + UI 16MB, 起動 10ms)
├─ CLI: mitori scan | open | share | apply …            (node:* 中心, Bun 依存は薄く)
├─ Indexer (Bun Worker pool, N = clamp(MB/2, 1, min(8, cores-2)))
│    git ls-files → stat → xxHash3 → web-tree-sitter(+tags queries) → SQLite(files, symbols, edges)
│    minified/generated 除外, 20-36 言語 (wasm 同梱), 増分 tree.edit
├─ Context packer: L0 skeleton (13〜30× 圧縮) → L1 module summaries → L2 on-demand 本体
├─ Doc store: Markdown + 安定 block id、ブロック HTML キャッシュ (markdown-it, token.map)
├─ Diagram: IR → ELK (Bun Worker) → 座標 JSON キャッシュ
├─ Server: Bun.serve  (HTTP + SSE)  /  bun:sqlite (WAL, FTS5 trigram)  /  fs.watch(recursive)
├─ Agent bridge: claude -p / codex exec を spawn、block anchor → 修正指示 (別トラック)
└─ UI (Svelte 5 SPA, 初期 JS ≤ 60KB gz 目標)
     仮想化ドキュメント / CM6 (遅延 125KB) / @codemirror/merge / Shiki(遅延, JS engine) / SVG 図
     Mermaid は fence 検出時のみ遅延 (652KB gz)
任意: Cloudflare mitori-share (Workers + Static Assets + R2 + D1 [+ DO])  ← 無料枠内
```

初期ロード予算 (gz): Svelte シェル 15KB + アプリ 30〜45KB = **≤ 60KB**、CM6 125KB (初回編集/コード表示で遅延)、Shiki 74KB (遅延)、Mermaid 652KB (fence 検出時のみ)、日本語 Web フォント **0 byte** (下記)。

### UI/UX 実装メモ (日本語主言語)
- フォント: Web フォントを配信せず `font-family: ui-sans-serif, system-ui, "Hiragino Sans", "Hiragino Kaku Gothic ProN", "Yu Gothic UI", Meiryo, sans-serif` (Noto Sans JP は 1 ウェイト数 MB)。コードは `ui-monospace, "SF Mono", Menlo, "Cascadia Mono", monospace`。
- 日本語改行: `word-break: auto-phrase` (BudouX 由来、**Chrome/Edge 119+ 対応**、Safari はフラグ、Firefox 未対応 — [Chrome Developers](https://developer.chrome.com/blog/css-i18n-features)) を `@supports` で適用し、`line-break: strict` + `overflow-wrap: anywhere` をフォールバックに。
- IME: コメント/検索/コマンドパレットの Enter ハンドラは必ず composition ガード (§7.3)。i18n は ICU 不要の軽量メッセージカタログ (ja/en の 2 ファイル, <5KB) で十分。
- 仮想化リストは `content-visibility: auto` + `contain-intrinsic-size` と併用し、ページ内検索 (Ctrl+F) を保つ工夫が必要 (要プロトタイプ)。

---

## 11. 未検証・リスク・次にやるべき測定

1. **日本語 IME の実機検証** (macOS ことえり/Google 日本語入力、Windows MS-IME): CM6 ブロック編集、コメント欄、検索窓。変換中のデコレーション更新・SSE による再描画が composition を壊さないか。
2. **Linux / Windows**: `fs.watch` recursive、`bun build --compile` した wasm/Worker/sqlite、glibc/musl 差。Linux で @parcel/watcher を既定にする根拠の実測。
3. **Claude tokenizer でのキャリブレーション** (本稿のトークン数は o200k)。`count_tokens` で skeleton と本文の係数を 1 回測り、bytes/token 係数を言語別に持つ。
4. `@ast-grep/lang-*` (dylib) の単一バイナリ同梱、macOS 署名/notarization、自己更新。
5. Svelte `$state.raw` 版、React Compiler 版の自前ベンチ (公式ベンチでは React Compiler は 1.64 で効果なし)。
6. 仮想化 + 動的高さ + ページ内検索/アンカージャンプの UX プロトタイプ (`content-visibility`, スクロール復元)。
7. Cloudflare Access (共有リンクの認証) の無料枠、D1 の 1 リクエスト 50 クエリ制限に対するバッチ設計。
8. Markdown→ブロック ID の持ち方 (HTML コメント vs 属性記法 vs サイドカー) を別トラック (設計書フォーマット) と確定。

## 12. 参照 (一次情報)
- js-framework-benchmark Chrome 152: <https://krausest.github.io/js-framework-benchmark/2026/chrome152.html>
- Cloudflare docs: Workers / D1 / R2 / Durable Objects の pricing・limits (§9 のリンク)
- TypeScript 7.0 GA と API 状況: <https://www.infoq.com/news/2026/08/typescript-7-released/> / npm `typescript@7.0.2` の `exports`
- Bun: [#34160 fs.watch O(n²)](https://github.com/oven-sh/bun/issues/34160), [#44063 embedded addon 展開](https://github.com/oven-sh/bun/issues/44063)
- oxc-parser raw transfer 条件: `node_modules/oxc-parser/src-js/raw-transfer/supported.js` (Bun 除外・Node>=22)
- Tiptap pricing: <https://tiptap.dev/pricing> / suggest-changes: <https://github.com/handlewithcarecollective/prosemirror-suggest-changes>
- Lexical IME: [#8098](https://github.com/facebook/lexical/issues/8098), [#9289](https://github.com/facebook/lexical/issues/9289) / ProseMirror IME: [#935](https://github.com/ProseMirror/prosemirror/issues/935), [#1484](https://github.com/ProseMirror/prosemirror/issues/1484)
- Shiki best practices: <https://shiki.style/guide/best-performance>
- word-break:auto-phrase: <https://developer.chrome.com/blog/css-i18n-features>
- 参考実装: `refs/crit` (Go 単一バイナリ + vanilla JS, `asset-budget.json`), `refs/m3e-canvas` (Next 16 / React 19.2 静的出力)
