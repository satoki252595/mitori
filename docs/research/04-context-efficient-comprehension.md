# 04 — Context/Token 効率の良い Whole-Repository Comprehension（mitori 設計書生成パイプライン）

> 調査日: 2026-10-03 / 対象: mitori（見取り図）の「リポジトリを一度読み込み、人が読める設計書を作る」部分
> 計測に使ったスクリプトと生データ: `scratchpad/measure/`, `scratchpad/cal/`, `scratchpad/exp/`（パスは付録 A）

---

## 0. TL;DR

1. **`chars/4` は Claude には使えない**: Claude Code CLI で実測したところ、Claude Sonnet 5.5（Opus 5.5 も同じ新 tokenizer）は Go/JS/TSX で **2.2〜2.4 chars/token**、Haiku 4.5（旧 tokenizer）は **3.0〜3.2 chars/token**、日本語 Markdown は **1.25〜1.33 chars/token** だった。crit 全体の token 数を `chars/4` で出すと **1.95 倍の過小評価**になる（2.90M と出るが実際は 5.65M）。mitori は tokenizer 別・ファイル種別ごとの補正係数を持ち、各呼び出しの `usage` を使ってオンラインで再補正するべき。
2. **naive dump は 50k LOC の時点でもう破綻する**: crit（Go+JS、ソース 72.6k LOC）は追跡中の全テキストが **5.65M Sonnet tokens** で、1M context に収まらない。そのうち 39% が vendored/minified（`web/mermaid.min.js` だけで 3.57MB）、32% が tests。LLM を使わない inventory/filter だけで **77% 削減**（ソースのみ 1.29M）でき、m3e-canvas も **66% 削減**（1.45M → 0.50M）できた。
3. **静的解析はほぼタダで速い**: tree-sitter の tags 抽出、reference graph、PageRank、Louvain、行番号付き skeleton 生成をまとめても、crit 280 ファイルで **2.1 秒**、m3e で **1.3 秒**だった（単スレッドの Python）。最初の画面（ファイルツリー、モジュール図、HTTP routes 62 件、env vars 12 件、entry points）は **0 token・数秒**で描画できる。
4. **入力の粒度（実測、crit の Go 3 ファイル、Sonnet 5.5）**: full body を入れると fully-supported な claim が 75%、doc-skeleton（signature + doc comment）で 68%、signature のみで 65%。入力 token は full を 1 とすると 0.49 / 0.32。unsupported はどの条件でも 0〜2.8% に収まった。**行番号付き入力なら citation range の妥当率は 97〜100%** だった。結論は、アーキテクチャの説明は skeleton で十分で、アルゴリズムや edge case の説明には body が要る、というもの。
5. **インクリメンタル更新が効く**: crit の直近 40 commit を見ると、1 commit で変わるソースは平均 3.1 ファイル（全体の 1.1%）。変更ファイルの **55% は body だけの変更**で signature skeleton は変わらず、**35% の commit は interface 変更を含まない**。だから上位（module/overview）は early cutoff で再生成しなくて済むことが多い。RepoDoc（arXiv 2604.26523）も、全再生成と比べて token −77%、時間 −73% を報告している。
6. **推奨パイプライン**: 静的な S0〜S4 → Pass 1 で module ページ（Sonnet 5.5、sig-skeleton + hot bodies、入力 ≈ 0.20·S）→ overview（Opus 5.5）→ 検証（大半は LLM 不要）→ Pass 2 の深掘り（Batch API と Haiku 4.5、もしくは閲覧/コメント時に lazy 生成）→ Merkle（= git object hash）+ claim 単位 citation による差分更新。
7. **見積り（§10）**: 50k LOC は Pass 1 で約 $1.3・約 3 分（naive map-reduce は $5.4）。500k LOC は $7.7・4〜8 分（naive $52）。5M LOC は eager なら $71・16〜56 分、lazy（上位 40 module だけ先に作る）なら **$10・約 4 分**（naive $516）。全深度まで作っても合計 input は naive の約 0.55 倍で、1 commit あたりの更新は $0.2〜7。
8. **Claude Code サブスクで backend にする場合**: `claude -p` の default は **呼び出しごとに約 27.2k tokens の overhead** がかかる（実測。system prompt と tools 分）。`--system-prompt-file … --tools "" --strict-mcp-config` を付けると **約 1.0〜1.5k** に落ち（18〜27 倍の削減）、system prompt は 1h TTL で自動的に cache される（2 回目の call で 6.4k/8.1k が cache read になるのを確認）。`--json-schema` を使うと structured output が取れるが、その分 1 turn 増える。

---

## 1. 計測方法と注意点

| 項目 | 方法 |
|---|---|
| 対象 | `refs/crit`（commit 406875d, 2026-10-02）、`refs/m3e-canvas`（de2d97a, 2026-09-27） |
| LOC / 言語 | `scc 3.7.0`（nixpkgs）。crit: Go 107,670 / JS 34,991 / TS 16,213 code lines（全 929 files, 11.37MB）。m3e: TS 27,059（91 files, 2.75MB） |
| 分類 | 自作の `measure.py`。binary / lockfile / vendored_minified（`.min.`、平均行長 >300、vendor/ dist/）/ test / docs / data_large（50KB 超の JSON）/ source |
| token の実測 | API key が無いので **`claude -p --output-format json` の `usage` を差分で取った**。baseline（固定の短い prompt）と「sample + 同じ prompt」の total input の差を sample の token 数とみなす。モデルは `haiku` = Haiku 4.5、`sonnet` = Sonnet 5.5（`cal/calibrate.sh`） |
| skeleton | (a) universal-ctags 6.2.1 JSON。(b) `repomix 1.14.0 --compress`（tree-sitter で signature + comment を残す）。(c) 自作の tree-sitter skeleton（`skeleton.py`。行番号付きで doc/sig の 2 tier）。(d) aider 0.86.1 の `--show-repo-map` |
| 静的解析 | aider の `RepoMap.get_tags_raw`（tree-sitter-language-pack 1.4.1）+ networkx 3.6.1 の PageRank / Louvain（`analyze.py`） |
| 粒度の実験 | crit の `internal/diff/diff.go`（9.5KB）、`internal/config/config.go`（28.7KB）、`internal/share/share.go`（40.9KB）。入力は full / doc / sig の 3 種、モデルは Sonnet 5.5 と Haiku 4.5、`--json-schema` で claim + 行範囲を出させた。検証は静的チェックと Sonnet 5.5 judge（`exp/run_exp.py`） |

注意:
- **n が小さい**。粒度実験は 3 ファイル × 1 run、judge は 1 モデルだけで、人手評価はしていない。傾向を見るための数字として扱うこと。
- `claude -p` の Haiku は thinking 付きで動いたらしく、output が Sonnet の約 2 倍になった。API で thinking を切った場合の Haiku は、output token も latency もこれより小さくなるはず。
- `chars` は Python の `len(str)`（code point）。日本語ファイルは bytes と chars がずれる。

---

## 2. 実測結果

### 2.1 Tokenizer の補正表（最重要）

| sample（実ファイル） | chars | Haiku 4.5 tok | chars/tok | Sonnet 5.5 tok | chars/tok | Sonnet/Haiku |
|---|---:|---:|---:|---:|---:|---:|
| Go（`internal/server/server.go` 先頭 60KB） | 59,951 | 20,073 | **2.99** | 26,584 | **2.26** | 1.32 |
| JS（`web/app.js` 先頭） | 59,940 | 19,008 | 3.15 | 24,715 | 2.43 | 1.30 |
| TSX（m3e `app/Editor.tsx` 先頭） | 60,000 | 20,247 | 2.96 | 25,919 | 2.31 | 1.28 |
| CSS（`web/style.css`） | 39,986 | 15,416 | 2.59 | 18,203 | 2.20 | 1.18 |
| Markdown 英語（crit README） | 36,187 | 9,436 | 3.84 | 12,612 | 2.87 | 1.34 |
| Markdown 日本語（SKILL.md 群） | 19,685 | 14,788 | **1.33** | 15,772 | **1.25** | 1.07 |
| ctags skeleton | 60,000 | 18,836 | 3.19 | 24,156 | 2.48 | 1.28 |
| aider repo map | 57,042 | 20,292 | 2.81 | 25,450 | 2.24 | 1.25 |
| minified JS（mermaid.min.js） | 40,000 | 18,942 | 2.11 | 23,718 | 1.69 | 1.25 |
| go.sum | 1,951 | 1,417 | 1.38 | 1,540 | 1.27 | — |
| 生成された JSON（日本語の claim、§2.6） | 2,863 | — | — | 1,813 out | 1.58 | — |

読み取れること:
- 新 tokenizer（Opus 4.7 以降、Sonnet 5.x、Opus 5.x）は、旧 tokenizer（Haiku 4.5、Sonnet 4.6 以前）より **+25〜34%** 多くの token を消費する。公式の pricing ページにある「約 30% 多い」という記述と合っている（https://platform.claude.com/docs/en/about-claude/pricing）。
- 実効単価（同じ文字量あたり）を Sonnet 5.5 input $2/MTok × 1.0 と比べると、Haiku 4.5 は $1 × 0.76 で **約 0.38 倍**。Batch API ならさらに半分になる。
- 日本語の出力は 1 文字 ≒ 0.8 token。日本語の設計書 100k 文字は output ≒ 80k token になり、Sonnet で $0.8、Opus で $1.6 かかる。日本語は 1 文字あたりの情報量が英語の 2〜3 倍あるので、「同じ内容」で比べれば token 差は 1.0〜1.2 倍程度と推定している（未計測）。
- **mitori の実装方針**: `tokens ≈ chars / k[tokenizer][kind]` という表を持つ。kind は code / markdown_en / markdown_ja / minified / lock。API mode では `count_tokens`（model 別。tiktoken は Claude を 15〜20% 以上過小評価する。claude-api skill `shared/token-counting.md`）で preflight し、サブスク mode では各 call の `usage` から係数を指数移動平均で更新する。

### 2.2 naive dump と filter（Sonnet 5.5 換算、補正表を適用）

| repo / category | files | chars | chars/4 による推定 | **Sonnet 実換算** | Haiku 実換算 |
|---|---:|---:|---:|---:|---:|
| **crit 全テキスト** | 949 | 11.60M | 2.90M | **5.65M** | 4.42M |
| ├ source（code + css/json/yaml） | 311 | 2.96M | 0.74M | 1.29M | 0.99M |
| ├ test | 520 | 4.12M | 1.03M | 1.79M | 1.37M |
| ├ vendored/minified | 4 | 3.73M | 0.93M | 2.21M | 1.76M |
| ├ docs | 80 | 0.57M | 0.14M | 0.20M | 0.15M |
| └ lockfile | 5 | 0.17M | 0.04M | 0.14M | 0.13M |
| **m3e 全テキスト** | 96 | 2.79M | 0.70M | **1.45M** | 1.15M |
| ├ source | 59 | 1.15M | 0.29M | 0.50M | 0.38M |
| ├ vendored/data（`public/material-symbols.json`） | 1 | 1.29M | 0.32M | 0.76M | 0.61M |
| └ test / lock / docs | 31 | 0.35M | 0.09M | 0.19M | 0.16M |

- repomix の default（o200k_base で数えたもの）は crit が 3.46M、m3e が 0.63M。OpenAI 系の tokenizer で数えると、Claude の新 tokenizer に比べて約 0.4〜0.6 倍の値になる。
- 1M context に入るかどうか: crit は全テキストでもソースだけでも入らない。m3e はソースだけなら入る（0.50M）。
- **filter のルール**（効果の大きい順）: ① `.min.*`、平均行長 >300、`vendor/` や `dist/`、`.gitattributes` の `linguist-vendored` / `linguist-generated` ② 50KB 超のデータ JSON ③ lockfile ④ binary（NUL byte）⑤ tests は捨てずに **test 名だけの skeleton** にする（`TestDiff_EmptyOld` のような名前は振る舞いの仕様としてとても情報量が多い）。

### 2.3 Skeleton と repo map のサイズ（ソースのうち code だけを対象）

| 表現 | crit chars | crit Sonnet tok | 対 full | m3e chars | m3e Sonnet tok | 対 full |
|---|---:|---:|---:|---:|---:|---:|
| full body（code のみ、crit 272 / m3e 43 files） | 2,622,898 | 1.14M | 1.00 | 1,126,989 | 0.49M | 1.00 |
| full + 行番号 `N\|` | +12〜14% | — | 1.13 | — | — | 1.13 |
| doc-skeleton（repomix compress、dedup 後） | 914,380 | 0.40M | **0.35** | 223,580 | 0.10M | **0.20** |
| sig-only（comment を除く） | 357,221 | 0.14M | **0.136** | 75,846 | 0.03M | **0.067** |
| 自作 tree-sitter doc-skeleton（行番号付き、3 ファイル、対 full+行番号） | 40,072 | — | 0.46 | — | — | — |
| 自作 tree-sitter sig-skeleton（行番号付き、3 ファイル、対 full+行番号） | 19,278 | — | 0.22 | — | — | — |
| aider TreeContext 全 def | 1,176,493 | — | 0.44 | 146,927 | — | 0.13 |
| aider repo map 1k / 4k / 8k / 16k / 32k budget | 4.1k / 14.7k / 29.3k / 61.9k / 135k | ≈ budget | — | 3.0k / 13.5k / 26.1k / 54.7k / 106k | | — |
| （aider map のファイル被覆数） | 12 / 34 / 55 / 94 / 163 files | | | 6 / 13 / 28 / 34 / 47 files | | |

- comment の比率は repo によってかなり違う。crit はよく文書化された Go なので doc-skeleton が sig-only の 2.6 倍になり、m3e の TS では 2.9 倍になった。**doc-skeleton は sig-only の 2〜3 倍のコストがかかる**ので、tier 分けは必須。
- repomix `--compress` は field の重複や inner comment を含み、行番号も消えるため、そのまま citation には使えない。**mitori は自前の skeleton を持つべき**で、元の行番号を保持し、body は `⋮` で省略し、struct field は保持し、上限を 60 行にする。
- aider の TreeContext は「lines of interest の周辺を見せる」ための表示なので、関数冒頭の body も混ざる。最小の skeleton としては非効率。

### 2.4 静的解析の速度と graph の性質

| 指標 | crit | m3e |
|---|---:|---:|
| 解析対象の code files | 280 | 44 |
| tree-sitter tags（def / ref） | 4,637 / 30,617 | 498 / 1,393 |
| file graph の edge 数（無向、単純） | 1,889 | 61 |
| 孤立ファイル | 23 | 4 |
| tags 抽出時間 | **1.15 s** | 0.55 s |
| PageRank | 0.29 s | 0.27 s |
| Louvain | 0.01 s | 0.00 s |
| skeleton 描画 | 0.62 s | 0.43 s |
| **合計（Python 単スレッド）** | **2.1 s** | **1.3 s** |
| content hash（blake2b） | 0.01 s | 0.01 s |
| `git ls-files -s`（blob SHA = Merkle の leaf） | 0.013 s（1,219 files） | — |
| aider `--show-repo-map` の初回（1,217 files、tags cache なし） | 21.9 s wall / 8.1 s user | — |
| aider 2 回目以降（diskcache あり） | 4.6〜5.8 s | 2.3〜2.7 s |

### 2.5 Clustering（directory と graph community の比較）

| 指標 | crit | m3e |
|---|---|---|
| Louvain（seed 42）の community 数 / modularity | 32 / **0.517** | 10 / **0.262** |
| directory partition（深さ 2）/ modularity | 33 / 0.316 | 4 / **−0.221** |
| Louvain の directory に対する purity | 0.557 | 0.682 |
| 代表的な community | `internal/session` 25 + `internal/server` 12 + `internal/share` 4（59 files）、`web/` 50、`internal/daemon` + `session` + `config`、`internal/github` + `gitlab` + `forge`（forge 抽象）、`cmd/crit` + `internal/prompt` | `components` 16 + `lib` 6（23 files）。layer 型の directory（components/lib）と機能が直交している |
| networkx の `leiden_communities` | backend が必要で実行できず。TS 側では `graphology-communities-leiden`、`leiden-ts`、`ngraph.leiden` が使える | — |

解釈:
- **directory だけで分割すると設計書の章立てを誤る**（m3e では modularity が負）。Next.js のような layer 型の構成では、機能（feature）単位で章を立てるべき。RepoSummary（arXiv 2510.11039）も、directory tree に沿った要約では feature → method の traceability が取れないと指摘している。
- ただし graph community だけだと、人間の mental model（directory）から外れる（crit の purity 0.56）。**推奨は「directory を prior にした Leiden」**。初期 partition を directory にして refine し、community が directory を跨ぐ場合だけ「横断機能」として別章にする。
- Louvain は最悪 25% の community が badly connected、16% が disconnected になりうると報告されている（Traag et al. 2019, Sci. Rep.）。connectivity が保証される **Leiden を使う**。

PageRank の欠点（観測）: crit の上位 2 件は `integrations/embed.go` と `web/embed.go` だった。`ReadFile` や `Open` のような汎用名が名前だけで照合され、偽の edge が大量にできたのが原因。aider の「6 箇所以上で定義された名前は ×0.1」という補正だけでは足りない。**import 解決を通した edge**（Go は import path → package、TS は tsconfig paths / module specifier）、汎用名への IDF 的な減衰、stdlib や外部依存名の除外が必要。精密にやるなら SCIP（後述）を使う。

### 2.6 粒度の実験（leaf note、行番号付き入力、JSON の claim + citation）

| 条件（3 files 合計） | input tok（1 call あたり約 1.8k の overhead を含む） | output tok | 秒/call | claims | 範囲が妥当 | judge S / P / U | **S 率** | symbol が範囲内 |
|---|---:|---:|---:|---:|---:|---:|---:|---:|
| full / Sonnet 5.5 | 45,262 | 5,922 | 17.3 | 40 | 40 | 30 / 9 / 1 | **75%** | 35/36 |
| doc / Sonnet 5.5 | 21,953 | 5,843 | 16.8 | 38 | 37 | 26 / 11 / 1 | 68% | 36/36 |
| sig / Sonnet 5.5 | 14,501 | 5,570 | 16.3 | 37 | 37 | 24 / 13 / 0 | 65% | 36/36 |
| full / Haiku 4.5 | 36,720 | 11,508* | 37.6* | 36 | 36 | 26 / 9 / 1 | 72% | 36/36 |
| doc / Haiku 4.5 | 18,153 | 10,655* | 36.4* | 36 | 36 | 20 / 15 / 1 | 56% | 32/36 |

\* `claude -p` の Haiku は thinking を含む。S = 引用した範囲だけで完全に裏付けられる / P = 部分的 / U = 裏付けなし。

質的な違い（diff.go の例）:
- full: `hirschbergDiff` について「分割点は前半の順方向 LCS 行と後半の逆方向 LCS 行で topRow[k]+botRow[n-k] が最大になる k。同点時は最小の k（厳密な > 比較）」と書けた。edge case まで掘れている。
- doc: 「Hirschberg 法と明記されている。本体は省略されているため詳細は不明」。**推測で埋めず、不確実性を自己申告した**。
- sig: struct field と型の説明が中心になる。

結論:
- **Sonnet は skeleton からでもでっち上げない**（U はどの条件でも 0〜1 件）。違いは深さ（P が増える）に出る。
- **Haiku は full body なら Sonnet に近い品質**（72% 対 75%）だが、**skeleton からの推論は弱い**（56%、symbol の範囲外れ 4 件）。モデルの使い分けは「Haiku には full body、Sonnet には skeleton」が筋。
- 行番号を `N|` の形で入れれば、範囲の妥当率は 97〜100%。行番号の付与には +12〜14% の token がかかるが、citation の検証と anchor の維持（§8）に必須なので払う価値がある。
- 1 ファイルあたり、Sonnet で output 約 1.9k token・約 17 秒（≒ 120〜130 tok/s。prefill を含む）。

### 2.7 変更の局所性（crit、直近 40 commit）

| 指標 | 値 |
|---|---:|
| commit あたりの変更ソースファイル数（test/md/min を除く） | 平均 3.1 / 中央値 2 / p90 8 / 最大 22（272 files 中） |
| 変更ソースファイルの延べ数 | 125 |
| body のみの変更（sig-skeleton の hash が不変、行番号のずれは無視） | **69（55%）** |
| interface の変更 | 40（32%） |
| 追加 / 削除 | 16（13%） |
| interface 変更が 0 だった commit | **14 / 40（35%）** |

---

## 3. LLM を使わない静的抽出

| 手段 | 得られるもの | 速度 / コスト | 精度 | mitori での位置づけ |
|---|---|---|---|---|
| **tree-sitter + `tags.scm`**（aider と同じ queries） | def / ref と範囲、import、AST の範囲（skeleton 生成） | 280 files で 1.15 s（Python）。WASM の `web-tree-sitter` は native の 1.75〜2.5 倍遅い（nickb.dev のベンチ）が許容範囲 | ref は名前ベースで、偽 edge がある | **既定のエンジン**。bun からは native binding か `@ast-grep/napi`（Rust、多言語、高速）を使う。WASM は fallback |
| universal-ctags 6.2.1 | def + signature + scope。100 以上の言語 | 速い | ref が取れない | tree-sitter に tags query が無い言語の fallback |
| import graph | module 依存（Go の package、TS の module） | ms 単位 | 高い（解決できれば） | clustering と topological order の主軸 |
| call graph | 関数レベルの依存 | 中 | 動的 dispatch は欠ける | flow の追跡（entry → handler → store） |
| **SCIP / LSIF** | 正確な定義、参照、実装 | scip-typescript は 1k〜5k LOC/s（Sourcegraph）。LSIF は SCIP より gzip 後で約 4 倍大きい | 型解決込みで高精度 | 「precise mode」として background で動かし、tree-sitter の edge を置き換える。scip-go、scip-typescript、scip-python、rust-analyzer などがある |
| LSP（gopls、tsserver） | on-demand で精密 | 起動が重い | 高い | AI 修正の段階で局所的な参照を確認するのに使う |

### 3.1 aider repo-map の詳細（`aider/repomap.py` v0.86.1 を直接読んだ）

- **tags**: tree-sitter query の `name.definition.*` を def、`name.reference.*` を ref とする。def しか取れない言語では **Pygments の `Token.Name` を ref として代用**する（line = −1）。
- **graph**: `MultiDiGraph`。node はファイル、edge は「参照する側 → 定義する側」。edge の weight は `mul × sqrt(num_refs)` で、`mul` の初期値は 1.0。
  - 会話中で言及された identifier なら ×10。
  - snake / kebab / camel で長さ 8 以上なら ×10。
  - `_` で始まるなら ×0.1。
  - **6 箇所以上で定義されているなら ×0.1**。
  - 参照元が chat に入っているファイルなら ×50。
  - 参照されない def には weight 0.1 の self-edge を張る。
- **personalization**: `100/len(fnames)` を基準に、chat に入っているファイル、言及されたファイル、言及された identifier を path に含むファイルへ加算する。これを `personalization` と `dangling` の両方に渡して `nx.pagerank(G, weight="weight")` を呼ぶ。
- **def の rank**: 各 node の rank を out-edge の weight に比例して配分し、`(file, ident)` ごとに足し合わせる → 降順に並べる。
- **budget fitting**: `middle = min(max_map_tokens // 25, num_tags)` から binary search する。誤差 **15%**（`ok_err = 0.15`）以内なら採用。token 数は 100 行ごとに 1 行を sampling して外挿する。各行は 100 文字で切る。
- **既定の budget**: `max_input_tokens/8` を [1024, 4096] に clamp。chat にファイルが無いときは **×8（`map_mul_no_files`）**、ただし `context − 4096` が上限。
- **出力**: `grep_ast.TreeContext`（line_number なし、`⋮` で省略）。
- **cache**: `.aider.tags.cache.v3/v4`（diskcache、key は mtime）。refresh モードは `auto`（処理が 1 秒を超えたら cache を使う）、`always`、`files`、`manual`。

mitori への教訓: 「token budget を引数にとる関数で map を生成する」設計はそのまま採用する。ただし、①名前ベースの ref 照合は import 解決と IDF 減衰で補正する、② mtime ではなく **content hash を key** にする（branch を切り替えても再利用できる）、③ personalization のベクトルを用途に応じて変える（overview 用は entry points と routes、AI 修正用はコメントが付いた symbol を起点にする）。

---

## 4. 構造化: module 分割、entry point、framework 検出

### 4.1 module の階層（推奨アルゴリズム）
1. file graph の edge = import edge（weight 1.0）+ 解決済み reference edge（`sqrt(n)`、IDF 減衰）+ 同一 directory の弱い edge（0.2、directory prior）。
2. **Leiden**（resolution を二分探索）で、leaf module のサイズを「2〜6k LOC かつ skeleton ≤ 24k token」に収める。CodeWiki は leaf module の上限を 32,768 tokens、委譲の深さを最大 3 にしており、RepoDoc は top で K=5、sub で K=3、閾値 4,096 tokens を使っている。
3. 階層は fan-out 10 前後で深さ 3 以内にする。50k LOC なら 13 leaf、500k なら 125 leaf + 13 親、5M なら 1,250 leaf + 125 + 13。
4. module 間の DAG は **Tarjan SCC で縮約**し（DocAgent）、topological order（bottom-up）で処理する。DocAgent の ablation では、random order にすると helpfulness が 3.88 → 3.44、truthfulness（existence ratio）が 94.64% → 86.75% に落ちた。
5. 名前付けは LLM に任せず、まず「最頻の directory + 代表 symbol」で仮名を付ける。LLM は Pass 1 の中で日本語名に置き換えるだけにする。

### 4.2 entry point と framework detector（LLM 不要。ここで集めた事実が設計書の「表」になる）
| 種別 | 検出パターンの例 |
|---|---|
| entry point | Go の `func main()`（crit では `cmd/crit/main.go` ほか）、`package.json` の `bin`/`main`/`scripts`、`cmd/*`、Dockerfile の `CMD`/`ENTRYPOINT`、Procfile、`wrangler.toml` の `main` |
| HTTP routes | Go `HandleFunc("…")`（**crit で 62 件**、`/api/comments` など）/ chi / gin / echo、Express / Hono `app.get`、Next.js `app/**/page.tsx` と `route.ts`、FastAPI のデコレータ、Django `urls.py`、Rails `routes.rb` |
| CLI | cobra の `Use:`、urfave/cli、commander / yargs、click / typer、argparse、`switch os.Args[1]` |
| DB / schema | SQL migrations、Prisma、Drizzle、GORM の struct tag、SQLAlchemy、D1 migrations |
| config / env | `os.Getenv`（**crit で 12 件**: `CRIT_HOST`、`CRIT_PORT`…）、`process.env`、`.env.example`、`wrangler.*` |
| 既存ドキュメント | README、**CLAUDE.md / AGENTS.md**、`docs/*.md`、ADR。crit の CLAUDE.md には「Key architecture decisions」が 16 項目あり、ほぼ設計書の要約になっている。→ **prior として最初に読み込む**（安い上に信号が強い）。ただし事実ごとに code と照合し、stale なら UI で警告する |
| tests | test 名の一覧（振る舞いの仕様）、fixtures |

UX 上の効果: S0〜S4 は数秒で終わるので、**LLM が動き始める前にファイルツリー、module 図、API 表、env 表、entry points を描画できる**（zero-token first paint）。

---

## 5. 階層的・bottom-up な要約（文献と粒度）

| 手法 | 要点 | 数字 |
|---|---|---|
| **RepoAgent**（arXiv 2402.16667） | AST + Jedi で caller/callee を取り DAG にする（循環は無視）。bottom-up の topological 順で object ごとに doc を作る。git pre-commit hook で差分更新する | Python のみ |
| **DocAgent**（Meta, ACL 2025 demo, arXiv 2504.08725） | Tarjan で縮約した DAG を依存先から順に処理。Reader / Searcher / Writer / Verifier / Orchestrator の役割分担 | existence ratio: DocAgent（GPT-4o-mini）**95.74%**、chat baseline 61.10%。random order にすると −7.9pt |
| **CodeWiki**（arXiv 2510.24428） | tree-sitter で依存を取る。leaf module ≤ **32,768 tokens**、深さ ≤ 3。leaf には完全なソースを渡し、親は子の doc から合成する。Claude Sonnet 4 を使用 | CodeWikiBench で **68.79%**、DeepWiki は 64.06%。scripting 言語 79.14%、system 言語 53.24%。対象は 86K〜1.4M LOC |
| **RepoDoc**（arXiv 2604.26523） | 7 種の relation を持つ KG。clustering は K=5/3、閾値 4,096 tokens。bottom-up。**incremental**: AST diff → 双方向の影響伝播 → 選択的に再生成 → 検証 | CodeWiki 比で **token 85% 減（780K 対 5,311K/repo）**、$0.39 対 $2.66（DeepSeek V3.2）、3 倍高速。incremental は −77% token / −73% 時間 |
| **RepoSummary**（arXiv 2510.11039） | method を「機能 feature」に階層 clustering し、directory ではなく feature 単位で文書を組む | traceability が向上 |
| **MemDocAgent**（arXiv 2605.14563, NeurIPS 2026） | 依存と粒度に沿って走査順を事前に決め、共有の RepoMemory（read / write / verify）で文書間の一貫性を保つ | — |
| **LongCodeZip**（ASE 2025, arXiv 2510.00446） | 関数単位で conditional perplexity による粗い選択 → block 単位の細かい選択を adaptive budget で行う | 品質を落とさず**最大 5.6 倍圧縮** |
| **SWEzze / OCD**（arXiv 2603.28119） | oracle で蒸留したデータで学習した小型の圧縮モデル | 約 6 倍圧縮、token −51.8〜71.3%、SWE-bench Verified の resolve 率 +5.0〜9.2% |
| 圧縮の実証研究（arXiv 2604.13725） | 8 手法、3 系統（discrete / latent / visual） | 4 倍圧縮で latent 系が full context を BLEU で最大 +28.3%、latency 最大 −50%（latent は model の内部に触れる必要があり、Claude API では使えない） |
| Anthropic「Effective context engineering」 | 事前取得と just-in-time 取得を組み合わせる hybrid。Claude Code は CLAUDE.md を先に入れ、残りは glob/grep で取りに行く | — |

**mitori の粒度方針**（§2.6 の実測と文献を合わせたもの）:
- leaf module の入力は **sig-skeleton（行番号付き）+ hot bodies + test 名 + facts**。hot bodies は PageRank の上位、entry point から到達できる経路、fan-in の大きいもの、複雑度の高いものから選び、module 入力の 25% 以内に収める。これは LongCodeZip を構造ヒューリスティクスで近似したもので、perplexity 用の local LM は不要。
- **小さい repo（ソース ≤ 約 150k tokens ≈ 9k LOC）は full source を cache 付きの prefix に置き、section ごとに cache read する**方が品質が良い。Sonnet 5.5 なら 150k × $4（1h write）= $0.6、その後は 1 section あたり $0.03（0.1×）。Opus 5.5 は read が 0.05× なのでさらに有利。
- 一番細かい粒度（symbol や関数の詳細）は **lazy に作る**。閲覧されたとき、コメントされたとき、または background の Batch で生成する。

---

## 6. インクリメンタル更新

### 6.1 Merkle tree
- **Cursor**: tree-sitter で AST を約 500 tokens の chunk に分け、file hash を leaf にした Merkle tree を作る。root hash を比べ、違う branch だけ辿って変わった leaf だけ再 embed する（engineerscodex、ByteByteGo の解説記事）。
- **git はそれ自体が Merkle tree**: `git ls-files -s`（blob SHA-1、1,219 files で 13ms）と `git ls-tree HEAD dir/`（tree SHA = directory の Merkle node）がほぼ無料で手に入る。dirty なファイル（`git status --porcelain`）だけ blake3 で hash すればよい。git 管理でない project だけ自前で Merkle tree を作る。
- cache の key は **blob hash × 抽出器のバージョン × prompt のバージョン × model**。branch を切り替えても、同じ blob を持つ fork や他 repo でも再利用できる。

### 6.2 依存を考慮した無効化（early cutoff）
1. blob が変わる → そのファイルを再 parse する（ms 単位）→ **symbol ごとに `sig_hash` と `body_hash`** を取る。
2. **claim 単位の無効化**: 各 claim は `(path, start, end, snippet_hash)` を持つ。git diff の hunk に重なる claim だけを stale にする。重ならない claim は diff を使って行番号だけ remap する（crit の round-to-round の再 anchor と同じ問題）。
3. leaf note の再生成は、その file の stale な claim が一定数以上ある場合か、新しい symbol が追加された場合だけ行う。
4. module ページは、**module の interface digest**（`sig_hash` の集合 + module 間 edge）が変わったときか、stale な claim が 20% を超えたときだけ再生成する。それ以外は該当する段落だけ patch する。
5. overview は、module 間の関係、entry points、routes、schema のいずれかが変わったときだけ再生成する。
6. 実測（§2.7）では、変更ファイルの 55% が body だけの変更、35% の commit が interface 変更なしだった。だから上位の再生成は多くの commit で不要になる。RepoDoc も −77% token / −73% 時間を報告している。

実行のきっかけ: post-commit hook、`mitori watch`（fs events）、PR 単位。UI は「この設計書は HEAD から N commit 遅れている / stale な claim が K 件ある」と表示する。

---

## 7. LLM 側の効率（Claude API とサブスク backend）

### 7.1 Prompt caching の正確なルール（claude-api skill `shared/prompt-caching.md` と公式 pricing）
- cache は **prefix の完全一致**で効く。rendering の順は `tools → system → messages`。prefix のどこかで 1 byte でも変わると、それ以降はすべて無効になる。
- breakpoint は最大 **4 個**。lookback は 20 position。
- **cache できる最小 prefix**: Opus 5.5 / Sonnet 5.5 は **512 tokens**、**Haiku 4.5 は 4,096 tokens**。Haiku に渡す共有 prefix は 4,096 以上にしないと、何も言われずに cache されない。
- **TTL と倍率**: 5 分の write は 1.25 倍、1 時間の write は 2 倍。read は 0.1 倍、**ただし Opus 5.5 は 0.05 倍（$0.20/MTok）**。損益分岐は、5 分 TTL なら 2 回、1h なら 3 回の利用。read は timer を無料で延長する。
- **並列実行の注意**: cache entry は最初の response が streaming を始めてからでないと読めない。fan-out するときは 1 本だけ投げて最初の token を待ち、それから残りを投げる。
- 無効化の階層: model を変えると全部無効（cache は model 単位）。system prompt を変えると system 以降が無効。`tool_choice` の変更は messages 以降だけ無効になる。thinking や effort の変更は messages を無効にするので、route ごとに固定する。
- 知らないうちに無効化する要因: timestamp、UUID、key 順が不定な JSON、set の iteration 順、ユーザーごとに変わる tools。prefix 生成コードには **CI で「同じ request を 2 回送ったら 2 回目の `cache_read_input_tokens > 0`」を確認するテスト**を入れる。
- 長い context に追加料金はない（1M でも単価は同じ）。

### 7.2 Batch API
- **全 token が 50% 引き**で、cache の read/write 割引と重ねがけできる。大半の batch は **1 時間以内**に終わる（期限は 24h）。1 batch あたり 100,000 requests か 256MB まで。結果は 29 日間保持される。
- batch 内の cache hit は best-effort で **30〜98%**。**1h TTL を推奨**。
- tool loop は使えない。入力を事前に揃えて単発 request にする。`output-300k-2026-03-24` beta で Sonnet 5.5 / Opus 5.5 の max_tokens を 300k まで上げられる。

### 7.3 Model routing（価格は per MTok で in / 5m write / 1h write / read / out）
| 段階 | model | 価格 | 理由 |
|---|---|---|---|
| leaf note（full body、小さいファイル） | **Haiku 4.5** | $1 / 1.25 / 2 / 0.10 / 5（batch で半額） | 旧 tokenizer なので実効 0.38 倍。full body なら品質は Sonnet とほぼ同じ（72% 対 75%） |
| leaf（skeleton、大きいファイル）、module ページ、親 module の合成 | **Sonnet 5.5**（effort low〜medium） | $2 / 2.50 / 4 / 0.20 / 10 | skeleton からの推論に強い。U ≈ 0 |
| overview、architecture、新人向けツアー、批判的レビュー | **Opus 5.5**（effort medium） | $4 / 5 / 8 / **0.20（0.05×）** / 20 | 出力は少ないが最上位の判断が要る。cache read が安い |
| citation の LLM 判定（サンプル） | Haiku 4.5（batch） | — | 安い。判定対象は短い |

Opus 5.5 と Sonnet 5.5 は forced `tool_choice` を指定すると 400 になる。**structured outputs（`output_config.format`）で JSON を強制する**。cache は model 単位なので、repo prefix は使う model ごとに 1 回ずつ write される（約 10k × 2〜3 model 分。誤差の範囲）。

### 7.4 Backend 別の overhead（実測）
| backend | 1 call あたりの overhead | 備考 |
|---|---:|---|
| `claude -p`（default） | **約 27,214 tokens**（Haiku。1h cache write） | Claude Code の system prompt と tools 分 |
| `claude -p --system-prompt-file X --tools "" --strict-mcp-config` | **約 1.0k（Haiku）/ 1.2〜1.5k（Sonnet）** | system prompt は自動で 1h TTL の cache になる。2 回目の call では 6,428 / 8,139 が read（実測） |
| 上記に `--json-schema` を追加 | 約 1.75k + **1 turn 追加** | 結果は `structured_output` に入る |
| `--bare` | — | ANTHROPIC_API_KEY が必須（OAuth を読まない）ので、サブスクでは使えない |
| `codex exec --output-schema FILE` | 未計測 | OpenAI tokenizer なので token 数自体は少ない。adapter を用意する |
| Claude API 直接 | system + schema のみ | `count_tokens`、Batch、明示的な breakpoint、5m TTL をすべて自分で制御できる |

→ mitori の LLM adapter は **「API key mode（Batch と精密な cache 制御が可能）」と「Subscription mode（`claude -p` / `codex exec`。overhead を最小にする flag で、呼び出し回数を減らすため 20k 前後にまとめて投げる）」**の 2 系統にする。サブスクには金額はかからないが usage 上限があるので、実行前に「約 X M input / Y k output token を使います」と表示する。

---

## 8. Grounding と anti-hallucination

1. **入力に元の行番号を付ける**（`37|func ...`）。skeleton でも元の行番号を保つ。
2. **出力 schema**: claim は `{id, text, cites:[{path, start, end}], kind: architecture|behavior|edge_case|risk, confidence}`。text 内の identifier は backtick で囲む。
3. **自動検証の段階**:
   - **L0（構文）**: 範囲が `1 ≤ start ≤ end ≤ nlines` か、path が存在するか。実測では 97〜100% が通った。
   - **L1（symbol / identifier）**: key symbol の名前と、claim の backtick に入った identifier が、引用範囲 ±2 行に出現するか。DocAgent の existence ratio を一般化したもの。実測で 89〜100%。
   - **L2（anchor）**: `(blob_sha, symbol_id, start, end, snippet_hash)` を保存し、code が変わったら stale を判定して再 anchor する（§6.2）。
   - **L3（意味）**: L1 で落ちた claim の全件と、残りの 10% サンプルを Haiku の batch で S/P/U 判定する。U なら該当 section だけ再生成し、P ならその claim の引用範囲を広げて再判定する。
4. 生成 prompt で「本体が見えないものは推測しない、不確実なら明記する」と指示する。実測でも doc / sig 条件の Sonnet は「本体は省略」と自己申告した。
5. **UI**: どの claim も hover すると引用コードが展開される。stale は黄色、U 判定は赤で示す。レビューのコメントは claim ID に付ける → AI 修正の段階では claim の citation がそのまま「最小のコード context」になる（SWEzze が示す「蒸留した context の方が修正率が上がる」という結果と同じ方向）。

---

## 9. 推奨パイプライン（mitori v1）

```
S0 Inventory+Merkle ─┐  (0 tok, <0.1s/100k LOC)
S1 Parse/Index ──────┤  (0 tok, ~1-3s/100k LOC, 並列化で 5M LOC ≈ 10-20s)
S2 Facts/Detectors ──┤  (0 tok)            → ★即時描画: tree / module図 / routes / env / entry
S3 Structure(Leiden+PageRank+SCC) ┤ (0 tok)
S4 Context pack (repo map 等) ────┘ (0 tok) → cache prefix
S5 Module pages      [Pass1, Sonnet 5.5, sync, streaming]   α·S
S6 Parent/Overview   [Pass1, Sonnet→Opus 5.5]
S7 Verify            [L0-L2 static, L3 Haiku batch sample]
S8 Deepen            [Pass2, Haiku/Sonnet, Batch API or lazy on-view/on-comment]
S9 Incremental       [git hook/watch → claim/symbol/module 単位 early cutoff]
```

| stage | 入力 | 出力 | model | cache の layout | 見込み token |
|---|---|---|---|---|---|
| S0 | `git ls-files -s`、`.gitattributes`、サイズ、行長 | inventory（kind、blob SHA） | — | — | 0。naive 比 −66〜77% |
| S1 | source の blob | symbols（範囲、sig/body hash）、imports、refs、skeleton の 2 tier（SQLite） | — | blob SHA を key に永続化 | 0 |
| S2 | AST と設定ファイル | facts（routes、CLI、schema、env、entry、test 名、既存 doc） | — | 同上 | 0 |
| S3 | graph | module の階層（深さ ≤ 3）、hot symbols、topological order | — | — | 0 |
| S4 | S1〜S3 | repo context pack: repo map 6〜8k + module tree + glossary の種 + facts の要約 ≈ **10k** | — | **BP2**（決定論的に serialize） | 0 |
| S5 | module ごとに sig-skeleton（行番号付き）+ hot bodies（≤25%）+ test 名 + facts | module JSON（概要、責務、主要 flow、データモデル、claims + citations、未解決の問い）+ 日本語/英語の本文 ≈ 2k | Sonnet 5.5 | `[system 3k: BP1] [repo pack 10k: BP2] [module 入力: なし]` | 入力 **0.20·S** + N·13k（read 0.1×）、出力 2k × N |
| S6 | 子の JSON（10 × 2k）または上位 module 全部 + repo map + 既存 doc（≤20k）+ facts（≤5k） | 親ページ / overview（全体像、アーキテクチャ図（静的 graph から決定論的に作る Mermaid に LLM がラベルを付ける）、主要 flow、新人ツアー、用語集）≈ 10k | Sonnet（親）、Opus 5.5（overview） | 同じ prefix | 入力 約 50〜120k、出力 約 10k |
| S7 | claims + 元のコード | 検証結果、修復対象 | 静的チェック + Haiku | — | 判定 1 件あたり 400 in / 10 out |
| S8 | ファイル / symbol の doc-skeleton + body（≤20k / call に束ねる） | leaf note（ファイルと symbol の詳細、claims） | Haiku 4.5（full body）/ Sonnet（大きいもの）、**Batch** | `[BP1][BP2: repo pack][BP3: module skeleton, 5m]` → leaf。同じ module の leaf は同じ lane で順に流す | 入力 **0.55·S_h**、出力 0.1×入力 + 150/file |
| S9 | git diff | stale になった claim、再生成キュー | 該当 stage の model | 同じ | **Δ ≈ 1〜3% / commit** |

**cache layout の不変条件**: tools は使わない（structured outputs で代替）→ system（mitori の指示、version で固定）→ repo pack（repo snapshot ID で固定、sort 済み）→ module context → unit。thinking と effort は stage ごとに固定。fan-out は「1 本投げて最初の token を待ってから残り」。batch は 1h TTL。

### 9.1 Token budget の式

記号: `LOC` = ソース（test/vendored を除く）の行数。`S = 16.5·LOC`（Sonnet / Opus 5.x tokenizer。38 chars/LOC ÷ 2.3）。`S_h = 12.7·LOC`（Haiku 4.5）。`P = 13k`（cache される prefix）。`O_m = 2k`（module ページ）。`O_ov = 10k`。`N_mod = ⌈LOC/4000⌉`。`N_par = Σ ⌈N/10⌉`（N ≤ 40 になるまで繰り返す）。`N_f = ⌈LOC/300⌉`。

```
Pass1_in  = α·S + (N_mod+N_par)·P·[read] + N_par·10·O_m + (min(N_top,40)·O_m + M + D + X)
Pass1_out = (N_mod+N_par)·O_m + O_ov
Pass2_in  = β·S_h + N_call·P_h·[read] + (γ·β·S_h + 150·N_f)            # 最後の項は refine の入力
Pass2_out = γ·β·S_h + 150·N_f + N_mod·O_m
Verify_in = 0.1·N_claims·400,  N_claims ≈ 8·N_f + 15·N_mod
Update    ≈ Δf·(Pass2 の file 分) + Δm·(Pass1 の module 分) + p_iface·(overview 分)
α=0.20 (sig+hot bodies), β=0.55 (doc-skeleton+bodies), γ=0.10, M=8k (repo map), D≤20k (既存doc), X≤5k (facts)
$ = Σ_stage b·( U·p_in + W·p_in·w + R·p_in·r + O·p_out ),  w∈{1.25(5m),2(1h)}, r=0.1 (Opus5.5: 0.05), b=0.5 if Batch
```

wall time ≈ `T_static + ⌈N_mod/C⌉·(3 + O_m/130) + Σ_levels ⌈N_l/C⌉·(…) + (3 + O_ov/70)` 秒。C は同時実行数。Sonnet が約 130 tok/s（実測 120〜130）、Opus は約 70 tok/s（仮定）。

---

## 10. 規模別の見積り（`scratchpad/measure/estimate.py`）

| | **50k LOC** | **500k LOC** | **5M LOC** |
|---|---:|---:|---:|
| ソース token（Sonnet）S | 0.83M | 8.25M | 82.5M |
| naive の全テキスト（×2.5。crit の実測は 4.4、m3e は 2.4） | 2.06M（1M context に入らない） | 20.6M | 206M |
| naive map-reduce（全テキストを読んで 5% のメモ + 最終 doc）Sonnet / Opus | **$5.4 / $10.7** | **$52 / $104** | **$516 / $1,032** |
| **Pass 1（eager、全 module ページ + overview）** 入力（うち uncached） | 0.40M（0.23M） | 3.77M（1.97M） | 37.4M（19.3M） |
| Pass 1 の出力 | 36k | 286k | 2.79M |
| **Pass 1 の費用** | **$1.31** | **$7.69** | **$71.3** |
| Pass 1 の wall time（C=8 / C=32） | 3.1 / 2.8 分 | 8.0 / 4.0 分 | 56 / 16 分 |
| **Pass 1 lazy**（上位 ≤40 module を L1 skeleton から + overview。下位は閲覧時に作る） | $1.15・3.2 分 | $2.91・4.3 分 | **$10.3・4.3 分** |
| on-demand の module ページ 1 枚 / ファイル 1 本の深掘り | $0.049 / $0.034 | 同じ | 同じ |
| **Pass 2**（全ファイルの leaf note、Batch。Haiku の leaf + Sonnet の refine + 検証） | $0.68 | $6.68 | $66.7 |
| 合計（Pass 1 eager + Pass 2）の入力 / naive 比 | 1.15M / **0.56** | 11.2M / **0.55** | 112M / **0.54** |
| 合計の費用 | $1.99 | $14.4 | $138 |
| **更新 1 回（2% のファイル、8% の module、30% の確率で overview）** | $0.22 | $0.88 | $7.4 |
| 静的解析（S0〜S4） | 約 1.5 秒 | 約 1.5 秒（10 並列） | 約 8 秒（18 並列） |

最初の結果が出るまでの時間: どの規模でも、静的な画面は 1〜10 秒で出る。最初の module ページは約 20 秒で streaming が始まる。overview は Opus の 10k 出力が律速で約 2.4 分かかるので、overview の前半（全体像）だけ先に Sonnet で出す手もある。

参照用の実 repo:
- **crit**（code 72.6k LOC、S = 1.13M）: Pass 1 は約 $1.3〜1.6・約 3 分。naive は 5.65M token で入らず、map-reduce なら約 $14。
- **m3e**（26k LOC、S = 0.49M）: ソースだけなら 1M context に入るが、§5 の閾値（150k）は超える。既定は Pass 1（約 $0.8・約 3 分、7 module）。品質優先 mode として full-source を cache prefix に置く方式も選べる（write 0.49M × $4 = $2.0 + section 10 枚分の read が計 $1.0、合計約 $3。Opus 5.5 なら read は 0.05×）。

相場との比較: CodeWiki は 1 repo あたり約 5.3M token、RepoDoc は約 0.78M token（いずれも 86k〜1.4M LOC 級。arXiv 2604.26523）。mitori の Pass 1 は 50k〜500k LOC で 0.4〜3.8M なので、同じオーダーで、しかも citation 付きになる。

---

## 11. 実装メモ（bun/TS）

- parser は `@ast-grep/napi`（Rust、言語を動的に追加できる）か、`tree-sitter` の native binding。WASM の `web-tree-sitter` は fallback（1.75〜2.5 倍遅い）。tags query は aider / tree-sitter 本家の `tags.scm` を流用する（MIT / Apache）。
- graph は `graphology` に Leiden（`graphology-communities-leiden` / `leiden-ts` / `ngraph.leiden`）を組み合わせ、PageRank には `graphology-metrics` を使う。
- 永続化は `bun:sqlite`（WAL）。テーブルは `blobs(sha, kind, tokens_by_tokenizer)`、`symbols(blob_sha, id, kind, name, start, end, sig_hash, body_hash)`、`edges`、`modules(snapshot, id, parent, members_digest, iface_digest)`、`notes(target_id, prompt_ver, model, json, claims)`、`claims(id, note_id, path, start, end, snippet_hash, verdict)`。
- 並列化: S1 は file 単位で Worker に分ける（18 cores）。LLM は lane ごとに同じ prefix を共有し、同一 module の要求を連続させる。
- 決定論: JSON は sort 済みで serialize する。repo pack は snapshot ID ごとに byte 単位で同一にする。prompt にはバージョンを付ける。
- 計測: `usage` 4 種（input / cache_creation / cache_read / output）を stage と model 別に SQLite に記録し、UI に「この設計書の生成コスト」を表示する（ユーザーへの透明性にもなる）。

---

## 12. 未解決の問いとリスク

1. 品質評価のデータ: 3 ファイル × 1 run の judge だけでは足りない。CodeWikiBench 型の rubric と人手評価を、5 repo × 数言語で回す eval が必要。
2. Haiku 4.5 を API で thinking なしで動かしたときの、品質・output 量・速度（今回はサブスク経由で thinking ありだった）。
3. Leiden の resolution と directory prior の重み付け、人間が章を手で並べ替えたときにそれをどう学習・固定するか。
4. 名前ベースの ref を import 解決でどこまで補正できるか、SCIP を必須にするかどうか（言語ごとに indexer の可用性が違う）。
5. サブスク mode の rate / usage 上限の中での最適な並列度。上限は Claude 側が公開しておらず、実行時の 429 や `rate_limit` を見て適応的に制御するしかない。
6. 日本語と英語の両方を出す場合の費用（両方 eager に作るか、片方は表示時に翻訳するか）。日本語の出力単価は約 0.8 tok/char。
7. 巨大なファイル（`web/app.js` 462KB ≈ 190k Sonnet token）の扱い: symbol の cluster 単位で分けて合成する手順を決める。
8. claim の行 remap の精度（rename や大きな移動）と、crit の review の再 anchor をどう共通化するか。

---

## 付録 A: 生データとスクリプト（scratchpad = `/private/tmp/claude-501/-Users-satoki252595-work-20261002-aiAgentTool/99463a6e-6928-41bd-851e-ed1a1028dc52/scratchpad`）
- `measure/measure.py`（分類と ctags skeleton）→ `measure/crit.json`, `measure/m3e.json`
- `measure/analyze.py`（tree-sitter tags、PageRank、Louvain、skeleton、時間計測）→ `measure/*.analyze.json`
- `measure/skeleton.py`（行番号付きの doc / sig skeleton）、`measure/cutoff.py`（early cutoff）、`measure/estimate.py`（§10 の式）
- `measure/aider_*_{1024..32768}.txt`（aider の map）、`measure/*.src.{full,compress}.txt`（repomix）
- `cal/calibrate.sh`, `cal/result.tsv`（tokenizer の補正）
- `exp/run_exp.py`, `exp/results.json`（粒度と citation の実験）

## 付録 B: 出典
- aider repo map: https://aider.chat/2023/10/22/repomap.html ／ source `aider/repomap.py` v0.86.1（nixpkgs `aider-chat`）
- RepoAgent: https://arxiv.org/abs/2402.16667
- DocAgent: https://arxiv.org/abs/2504.08725 （ACL 2025 demo）
- CodeWiki: https://arxiv.org/abs/2510.24428 ／ https://fsoft-ai4code.github.io/CodeWiki/
- RepoDoc: https://arxiv.org/html/2604.26523v1
- RepoSummary: https://arxiv.org/abs/2510.11039
- MemDocAgent: https://arxiv.org/abs/2605.14563
- LongCodeZip: https://arxiv.org/abs/2510.00446 ／ https://github.com/YerbaPage/LongCodeZip
- Code context compression for issue resolution（SWEzze）: https://arxiv.org/abs/2603.28119
- Context compression for repo-level tasks: https://arxiv.org/abs/2604.13725
- RepoAtlas: https://arxiv.org/abs/2609.16936
- Cursor indexing: https://read.engineerscodex.com/p/how-cursor-indexes-codebases-fast ／ https://blog.bytebytego.com/p/how-cursor-serves-billions-of-ai
- GitNexus（Leiden による機能 community + process）: https://www.npmjs.com/package/gitnexus ／ https://www.marktechpost.com/2026/04/24/meet-gitnexus-an-open-source-mcp-native-knowledge-graph-engine-that-gives-claude-code-and-cursor-full-codebase-structural-awareness/
- Leiden: Traag, Waltman, van Eck (2019) "From Louvain to Leiden" https://scholarlypublications.universiteitleiden.nl/handle/1887/78029
- JS Leiden: https://github.com/aflsolutions/graphology-communities-leiden ／ https://github.com/anvaka/ngraph.leiden
- SCIP: https://sourcegraph.com/blog/announcing-scip ／ https://sourcegraph.com/blog/announcing-scip-typescript
- WASM と native の速度差: https://nickb.dev/blog/wasm-and-native-node-module-performance-comparison/
- Anthropic context engineering: https://www.anthropic.com/engineering/effective-context-engineering-for-ai-agents
- Claude pricing: https://platform.claude.com/docs/en/about-claude/pricing ／ Batch: https://platform.claude.com/docs/en/build-with-claude/batch-processing
- claude-api skill: `shared/prompt-caching.md`, `shared/token-counting.md`, `shared/models.md`, `shared/cost-optimization.md`（bundled 2.1.286）
