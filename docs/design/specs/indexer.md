# indexer spec — S0〜S4 と増分更新（`@mitori/indexer`）

- 版: 1.0（2026-10-03） / 状態: **ドメイン spec**（正本は `ARCHITECTURE.md`・`contracts/core.ts`・`contracts/api.ts`。本書はその内側を決める）
- 所有: `packages/indexer`（`src/inventory/` `src/parse/` `src/lang/<id>/` `src/facts/` `src/resolve/` `src/structure/` `src/pack/` `src/search/` `src/tokens/` `src/update/`）。契約ファイルは `docs/design/contracts/indexer.ts`（本書と 1 対 1。食い違えば型は indexer.ts が正、文章は本書が正）
- 入力: `docs/research/00-synthesis.md`（Critic addendum §E 採用）、04（理解パイプライン・skeleton・token 係数）、05（parse・Worker・watch の実測）、06 §9（MBF/1 の書式）、ADR-0002、リード決定 D6/D7/D8/D9/D14
- 表記: 文章は日本語、識別子・flag・schema は英語。**[仮]** = 推定値で、併記した方法で測って `bench/budgets.json` で確定する。**[実測]** = 本 spec 作成時にこの Mac（Apple M5 Max 18 論理 core（P 6 + E 12）、Bun 1.4.2、web-tree-sitter 0.27.0、git 2.55.0）で測った値。試作スクリプトと tags query は `docs/design/specs/indexer/{proto,queries}/` に置いた（§付録 A）
- この spec の外: watcher 本体（`@mitori/platform`。§10.1 で要求仕様と計測法だけ決める）、shadow repo / GitHub clone の作成手順の実行（server の WorkspaceManager。§2.1 で argv を決める）、Diagram IR への変換（`@mitori/doc`）、生成時の予算配分（`@mitori/gen`）

---

## 改訂 R1（2026-10-03、レビュー反映） — 本節が本文より優先する

| 本文 | 変更（ID） |
|---|---|
| 付録 B CR-1〜13 | 全件を core/api に適用（`contracts/CR-LEDGER.md`）。`IndexerFs` = core `FsReader`、`SecretScanner`・`WriteQueue`・`WorkerPool`・`CalibrationSnapshot` は core、`EXCLUDE_REASON_FALLBACK` 削除。CR-13 と testing CR-5 は `ScanSummaryView.stageMs` に統合 |
| §7.6 token 推定 | `estimateTokens(text, kind, tokenizer)` は `kind:*` の chars/token 補正だけを掛ける。intent 補正（`factor(tokenizer, intent)`）は廃止し、呼び出し単位の補正は呼び出し側（gen・loop）が ledger の `call:*` で掛ける（CONS-24） |
| §7.7 `blobText` | pin store `idx_blob_text(blob PK, bytes, refcount, last_ref_at)`: dirty ファイルを hash した時点で内容を保存し、anchor が参照する blob は `pinBlobs`、外れたら `unpinBlobs`、refcount 0 で 7 日を過ぎた行を毎日 GC（CONS-13）。読み取りは 1 本の永続 `git cat-file --batch` + 64 MB LRU、stat が index と一致する clean ファイルは fs から（PT-17）。`symbolsAt(blob)`（旧 blob の symbol 範囲）を WP-02 で追加（loop の依頼） |
| §7.4 repo pack | 先頭行から digest・files・loc を除く（PT-05）。nonce は packKey から決定的（I6 合意どおり） |
| §1.1 実行モデル | S2〜S4 は Worker で実行し compact な typed-array 表を main thread に返す。`setActive(false)` から 60 s で in-memory name index を SQLite の遅延参照に切り替える（PT-14） |
| §2.1 入力 | GitHub URL の owner/repo 正規表現、ref は `git check-ref-format --branch`・先頭 `-` 禁止・`--end-of-options`、clone/fetch は `GIT_LFS_SKIP_SMUDGE=1` と protocol 制限、submodule なし（SEC-14）。$HOME・`/`・Desktop/Documents/Downloads・`~/Library` 配下や project marker の無い dir は `E_WS_NOT_PROJECT`、列挙は 2 s か 20 万件で打ち切り（UXP-23） |
| §2.3 S0 の secret | R01/R04 は core `SECRET_PATH_GLOBS`（credentials.json・service-account*.json・*.tfvars・kubeconfig・id_ecdsa・*.ppk・.docker/config.json …）を使う。`ENV_TEMPLATE_GLOBS`（.env.example 等）はキー名だけ読む（CR-11）。伏せ字は `«redacted:secret»`（core `REDACTION_TOKEN`、CONS-05）。git の env は空 + allowlist（SEC-05） |
| §5.2 facts 検出器 | **tier 化**（SC-26）。tier 1（M1）: entry.*、route.nethttp/hono/express/fastapi/flask、cli.registry/cobra/click/clap/commander、env.*、script.*、dep.*、doc.existing、todo、test.*、schema.sql。tier 2（M4）: gin、echo、chi、fastify、next、django、axum、actix、urfave、yargs、typer、argparse、prisma、drizzle、sqlalchemy、gorm、外部 actor（http_client・exec・write_sink、`specs/floorplan.md` §3）。検出器は truth と同時にだけ追加 |
| §6.2〜6.3 Leiden | **M1 は決定的順序の Louvain local move + 非連結 community の BFS 分割 + §6.3 split/merge + §6.6 照合**。Leiden refinement は M2 で modularity bench が ngraph.leiden の −0.01 以内に改善する場合だけ導入（SC-15）。IDX-AT-30 は P3 まで「同一 OS で決定的」に緩和（別マシンの ID は reps seed が担保） |
| §6.6 seed | `DocIndex.modules[]` = core `DocModuleEntry`（slug・name・summary・parent・reps）。seed と repo 設定の slug は `SLUG_RE` で検証し、不正なら再 slug 化 + `notice.slug.rewritten`（SEC-01） |
| §8 palette | href は core `HREFS`（History route、CONS-23）。`PaletteIndex.digest` = 情報源の digest（rev ではない）、変化は SSE `palette.changed`（PT-15） |
| §11 受け入れ | WP-02 の sig/full 比は **[0.12, 0.24]**（実測 0.204）、WP-03 の crit env は **17**（CONS-29）。出力形式（`PACK_FORMAT`・skeleton golden）は **WP-02 の 2 週目末に凍結**し、以後の変更は版 bump + cassette 再録 ticket（SC-09） |

---

## 0. 要約と決定事項

### 0.1 一画面要約

1. indexer は **0 token**。S0（inventory）→ S1（parse + 1 ファイル単位の facts 抽出。Worker 内で融合）→ S2（facts のリンク）→ S3（構造）→ S4（context pack）を 1 回で通し、`ScanSummaryView` と `scan.done` を出す。LLM は呼ばない。
2. **読み込みは 1 ファイル 1 回**。内容を見る判定（binary / minified / generated header）と parse と facts 抽出は同じ Worker が同じバッファで行い、`tree.delete()` してから返す。
3. キャッシュキーは **blob sha × extractor version**（parse・skeleton 断片）、**blob sha × detector set version**（facts）。branch 切替・fork・同じ内容の別 path で再利用する。
4. 構造化は import 解決 edge（1.0）+ IDF 減衰した名前参照（≤ 0.5）+ 同一 directory の弱い prior（計 0.2/ノード）→ **自前の deterministic Leiden（初期 partition = 前回の membership ∪ directory partition）**→ PageRank → Tarjan SCC。`ngraph.leiden@0.3.0` は初期 partition を受け取れないため本番に使わない（O4 の決定、§6.2）。
5. **module の同一性は設計書の安定性そのもの**。前回 membership からの warm start + LOC 加重 Jaccard ≥ 0.5 の greedy 照合 + 誕生時 anchor path から決まる決定的 ID + 生存中は変えない slug。初回マシンでは commit 済み `doc.index.json` の `modules[].reps` を seed にする（core 変更要求 CR-1）。
6. S4 は skeleton 3 段（`l0` 1 宣言 1 行 / `sig` 行番号付き / `doc` sig + doc comment）、hot bodies（module 入力の 25% 以内）、repo pack（≈10k token、`=== ` 見出し + `> ` タグ行、同じ `packKey` なら同じバイト）。gen の依頼（I1〜I5: 行プレフィックス、畳み込み書式、module 統計、flow seed、理由コメント）は §7 で受ける。
7. 増分は「保存 → stale バッジ ≤ 50 ms」を、watch 20 ms + 微小 debounce 5 ms + `update()` ≤ 15 ms + anchor ≤ 5 ms + SSE ≤ 5 ms で作る。構造（Leiden / PageRank）は 2 s の静穏後にまとめて再計算する。

### 0.2 決定事項（IDX-D）

| ID | 決定 | 根拠 |
|---|---|---|
| IDX-D1 | S0 を「path 規則（main thread）」と「内容規則（Worker）」に分け、内容規則は parse と同じ読み込みで行う | 読み込み 1 回。main thread の event loop を塞がない |
| IDX-D2 | Worker 数 `W = clamp(ceil(parseMB / 0.75), 1, min(8, cores − 2, perfCores))` [仮]。05 の `ceil(MB/2)` は query なしの Go stdlib 実測で、query 込み・小 repo では過小 | §3.1 の実測（m3e 1.3MB の S0–S1: W=1 259 ms → W=4 165 ms） |
| IDX-D3 | バッチは LPT（大きい順）動的割当て、1 バッチ ≤ 64 ファイルかつ ≤ `clamp(totalBytes/(W·8), 32KiB, 1MiB)` | 64 ファイル固定だと小 repo が 1 バッチに潰れて直列化した（§3.1） |
| IDX-D4 | tags query は言語ごとに自前（§3.5）。doc comment は Python docstring / Rust doc comment だけ query で取り、JS/TS/Go は兄弟 walk で取る | `#select-adjacent!` 等は web-tree-sitter が適用しない。量化した兄弟パターンは遅い |
| IDX-D5 | `.js/.jsx` で先頭 2 KiB に `@flow` があれば **tsx grammar** で parse（`lang` は javascript/jsx のまま） | react の Flow ファイル 1,162 本で parse error 率 JS grammar 75% → tsx 22% [実測] |
| IDX-D6 | test ファイルは `lite` profile（定義・import・call のみ。type 参照なし）で parse。fixture / snapshot / testdata は parse しない | 構造化に効かない ref を削り S1 を短縮 |
| IDX-D7 | 解析結果は S2〜S4 の間メモリに保持し、SQLite への永続化は `scan.done` の後に write queue で分割して行う | 10 万行 insert ≈ 205 ms（05）を最初の画面の critical path から外す |
| IDX-D8 | FTS5 trigram 索引は `scan.done` 後に background で構築。構築中の検索はメモリ上の palette 項目への LIKE で代替 | FTS5 trigram 10 万行構築 2.6 s（05） |
| IDX-D9 | Leiden は自前実装（local moving → refinement → aggregation、乱数なし・path 順の決定的走査、warm start と移動の hysteresis 付き）。`ngraph.leiden` は品質比較のベンチ基準としてだけ dev 依存に置く | 初期 partition API が無い（README に `fixedNodes` はあるが初期 membership の指定は無い [実測: npm readme 0.3.0]）。ID 安定性には warm start が必須 |
| IDX-D10 | module ID は `md_` + base32(xxh3(`md\|<anchorPath>\|<n>`))[0:8]（決定的）。照合で生き残った ID と slug は変えない | 別マシンでも同じ snapshot から同じ ID。slug はファイル名（`doc/modules/<slug>.md`）なので不変が必須 |
| IDX-D11 | JS/TS の import は tree-sitter query で取る。oxc（`.node` 同梱問題）は MVP で使わない | query で十分取れた（import 文: hono 1,140、excalidraw の ts + tsx 4,790 [実測]） |
| IDX-D12 | 例示コード（`examples/` `docs_src/` 等）は `scope: "example"` として parse・module 化はするが、route/cli/env の主表には出さない | fastapi は本体 0 routes、`docs_src/` に 439 routes [実測] |
| IDX-D13 | token 推定は「非 CJK 文字 / `CHARS_PER_TOKEN[tok][kind]` + CJK 文字 × `1/CHARS_PER_TOKEN[tok].markdown_ja`」に、agent が持つ EMA 係数（tokenizer × intent）を掛ける。indexer は較正値を読むだけで書かない | `use_calibration` は agent 所有（state.sqlite） |
| IDX-D14 | skeleton・hot body・repo pack の全行を `=== ` / `<数字>\|` / `⋮` / `> ` のどれかで始める（gen の DATA 行プレフィックス規則と同一。repo pack は見出し `=== ` + 項目 `> <TAG> …`）。値の改行・制御文字を潰し、secret scan を通してから出す | ARCHITECTURE §7.4/§7.5、gen spec §5.1-5・依頼 I1 |

### 0.3 この spec が守る予算（`bench/budgets.json` に登録。id は §11.3）

| 指標 | 目標 / 上限 | 備考 |
|---|---|---|
| S0–S1 cold（100k LOC ≈ 4MB） | 0.3 s / 0.5 s | crit（parse 対象 6.2MB）で 0.31〜0.33 s [実測 試作] |
| S0–S1 cold（7k files / 100MB） | 1.2 s / 1.5 s | react（parse 対象 2,423 本 22.6MB）で 0.66 s [実測 試作] |
| S0–S4（100k LOC） | 1.0 s / 2.0 s | S2–S4 合計 ≤ 0.5 s [仮] |
| warm rescan（変更なし） | 10 ms / 25 ms | `git ls-files -s` + stat のみ |
| `update()`（1 ファイル、warm Worker） | 15 ms / 30 ms | 20k 行 TS の再 parse 8.3 ms（05） |
| 保存 → `doc.freshness` | 50 ms / 1 s | 上限 1 s は Linux polling を含む |
| peak RSS（解析中） | 700 MB / 1 GB | 1 Worker ≈ +60〜70 MB [実測] |
| idle RSS への寄与 | 0 MB（60 s 無操作で Worker 0 本） | daemon idle 30 MB 目標 |
| repo pack | 10k token ±15% / 12k | `claude-v5` 推定 |
| module の sig skeleton | ≤ 24k token / 32k | leaf のサイズ条件 |
| 検索 1 query | 1 ms / 5 ms | FTS5 trigram |

---

## 1. パイプラインと実行モデル

### 1.1 段と担当スレッド

```
main thread (daemon)                          parse Worker × W
──────────────────────────────────────────    ─────────────────────────────────────────────
S0a  列挙: ls-files -s / --others / status /
     check-attr / HEAD を並行実行
     path 規則（§2.3 R00–R10, R14–R20 の path 部）
     cache 照合（blob × extractor が idx_blobs
     にあれば読まない）
     LPT 並べ替え → バッチ投入  ───────────────▶ S0b 内容規則（R11–R13）
                                                S1  parse（tree-sitter）→ tags query →
                                                    symbol / import / ref / test 名 / todo /
                                                    1 ファイル facts 候補 → tree.delete()
                         ◀───────────────────── 結果（構造化 clone）
S2   facts のリンク（mount prefix・framework 証拠・
     test → subject・env 重複除去・dependency 照合）
S3   import 解決 → graph → Leiden → PageRank → SCC
     → module ID 照合 → digest
S4   repo pack・skeleton 断片の memo
emit scan.done → write queue で永続化（分割） → FTS5 構築（background）
```

- S0a〜S4 は **write queue の外**で計算し、結果の反映（`idx_*` への書き込み）だけを write queue に積む（ARCHITECTURE §2.3）。反映前でも `Indexer` の読み取り API はメモリ上の最新 snapshot から答える。
- `scan()` は同時に 1 本。実行中に `scan()` が来たら実行中の Promise を返す（`force` 指定時は現在の scan を `AbortSignal` で止めて作り直す）。`update()` は scan 実行中なら scan 完了後にまとめて適用する（変更は失わない）。
- 進捗: `scan.progress {stage, done, total}`（server が 10 Hz に間引く）。単位は S0 = ファイル、S1 = parse 対象ファイル、S2 = detector、S3 = 段（resolve / graph / cluster / rank / ids の 5）、S4 = part（5）。

### 1.2 時間予算の内訳（100k LOC、W = 4〜6）[仮]

| 段 | 予算 | 主な中身 |
|---|---|---|
| S0a | ≤ 30 ms | `ls-files -s` 5〜10 ms（並行）、stat 全件 ≈ 10 ms / 7k files（05） |
| Worker 起動 | ≤ 20 ms（並行起動） | spawn + `Parser.init` 11〜15 ms、TS query compile 22 ms は最初の TS ファイルで払う [実測] |
| S0b + S1 | ≤ 250 ms | 1 Worker ≈ 6〜7 MB/s（parse 10〜15 MB/s + query 18〜45 MB/s）[実測] |
| S2 | ≤ 50 ms | メモリ上の結合 |
| S3 | ≤ 150 ms | 解決 ≈ 20 ms、graph ≈ 20 ms、Leiden ≤ 80 ms（γ 探索 8 回）、PageRank ≤ 20 ms [仮] |
| S4 | ≤ 50 ms | repo pack は文字列連結 |
| 合計 | ≤ 0.55 s（予算 1.0 s） | — |

### 1.3 取消しと失敗

- `ScanOptions.signal`（AbortSignal）で全段を止める。Worker 側はバッチの切れ目で `signal` を見る（バッチ内の 1 ファイルは止めない。1 ファイル ≤ 2 MiB なので最悪でも数百 ms）。
- 1 ファイルの失敗（読めない・parse 例外・timeout）は scan を失敗にしない。そのファイルは `generic` 抽出に落とし、`idx_files.note` に理由を残し、`scan.done` の summary に件数を出す。
- scan 全体の失敗（git が無い・DB 破損など）は `scan.failed {error}`。`E_GIT_FAILED` / `E_IDX_PARSE` / `E_INTERNAL`。

---

## 2. S0 inventory

### 2.1 入力源と列挙（argv は固定。すべて `GitReader` 経由、shell 不使用）

**(a) 通常の git working tree（`WorkspaceKind = "git"`）** — 以下を `Promise.all` で並行に起動する。

| 目的 | argv | 備考 |
|---|---|---|
| tracked files（Merkle leaf） | `git -c core.quotepath=off ls-files -s -z --cached` | `<mode> <blob> <stage>\t<path>\0`。mode `160000`（gitlink）・`120000`（symlink）は R00 |
| untracked（ignore 済みを除く） | `git -c core.quotepath=off ls-files -z --others --exclude-standard` | 末尾 `/` の entry は入れ子 repo → R00 |
| worktree で変更された tracked | `git status --porcelain=v2 -z --untracked-files=no --no-renames --ignore-submodules=all` | **cold 時と `.git/index` の mtime が変わった時だけ**。`1 .M …` / `1 MM …` / `u …`（unmerged）の path は「dirty」 |
| linguist 属性 | `git check-attr -z --stdin linguist-vendored linguist-generated linguist-documentation` | tracked に `.gitattributes` が 1 本も無ければ**起動しない** |
| HEAD | `git rev-parse -q --verify HEAD^{commit}`、`git rev-parse -q --verify HEAD^{tree}`、`git symbolic-ref -q --short HEAD`（`--verify` は 1 引数しか取らないので 3 回に分ける） | unborn は null（exit 1 を null と読む） |
| hash 方式 | `git rev-parse --show-object-format` | workspace load 時に 1 回 |

- blob: clean な tracked file は `ls-files -s` の blob をそのまま使う（読まない）。dirty・untracked・unmerged は Worker が内容から `gitBlob(bytes, objectFormat)` を計算する（`blob <len>\0` 枠。SHA-1 または SHA-256）。
- `RepoSnapshot.tree`: clean なら `HEAD^{tree}`、dirty なら **scan では null**（必要になったら loop の GitSafety が一時 index で作る。0.29 s かかるので scan では作らない）。
- staged だが worktree 未変更（`M.`）は index の blob が worktree と同じなので clean 扱い。

**(b) git 管理外ディレクトリ（`"shadow"`）** — server の WorkspaceManager が初回に作る。

```
GIT_DIR=~/.mitori/repos/<ws>/shadow.git  GIT_WORK_TREE=<dir>
git init --quiet --object-format=sha1                      # 1 回だけ
git config core.untrackedCache true
git config core.fsmonitor false
git config core.quotepath off
<shadow.git>/info/exclude に DEFAULT_SHADOW_EXCLUDES を書く（下記）
```

- 列挙は `git ls-files -z --others --exclude-standard`（`--cached` は空。全ファイルが untracked = dirty 扱いで Worker が hash）。ユーザーのディレクトリ内の `.gitignore` は git がそのまま尊重する。**ユーザーのディレクトリには何も書かない。**
- `DEFAULT_SHADOW_EXCLUDES`（`info/exclude`）: `.git/` `node_modules/` `.venv/` `venv/` `env/` `__pycache__/` `*.pyc` `target/` `dist/` `build/` `out/` `.next/` `.nuxt/` `.cache/` `.turbo/` `coverage/` `.DS_Store` `Thumbs.db` `*.log` `.mitori/`
- 入れ子の git repo（`--others` が `sub/` と返す）は R00 で `special` 除外し、notice「`sub/` は別 repo。個別に開けます」を出す。
- 規模ガード: 列挙が 200,000 entry を超えるか合計 5 GB を超えたら `E_PRECONDITION`（`params: {files, bytes}`、hint: `mitori init` で include を指定）[仮]。

**(c) GitHub URL（`"remote-readonly"`）** — 受け付ける形: `https://github.com/<o>/<r>[.git][/tree/<ref>[/<subpath>]]`、`git@github.com:<o>/<r>.git`、`gh:<o>/<r>`。

```
gh repo clone <o>/<r> ~/.mitori/clones/<o>/<r> -- --depth 1 --single-branch --no-tags [--branch <ref>]
# gh が無い・未ログインの公開 repo: 
git clone --depth 1 --single-branch --no-tags [--branch <ref>] https://github.com/<o>/<r>.git ~/.mitori/clones/<o>/<r>
# 明示の更新（UI「最新を取得」）だけ:
git -C <clone> fetch --depth 1 --no-tags origin <ref>   →  git -C <clone> checkout --detach --force FETCH_HEAD
```

- 失敗は `E_GIT_CLONE_FAILED`（hint: `gh auth login`）。URL に `<subpath>` があれば workspace override の `include` に `<subpath>/**` を入れる。以後の列挙は (a) と同じ。

### 2.2 Merkle と鮮度

- **leaf** = 生成入力に含まれる（`class ∈ INCLUDED_CLASSES` かつ `excluded` 無し）ファイルの `(path, blob)`。
- **`indexDigest`** = `xxh3("mitori.idx/1\n" + Σ_{path 昇順} path + "\0" + blob + "\n")`（16 hex）。分類規則や extractor の版が変わって含まれる集合が変われば digest も変わる。
- **`packKey`** = `xxh3(indexDigest + "\n" + EXTRACTOR_SET_VERSION + "\n" + settingsDigest + "\n" + PACK_FORMAT)`。`settingsDigest` は `repo.modules`・include/exclude・deny の正規化 JSON の xxh3。repo pack と module 入力のバイト同一性はこの key で保証する（§7.5）。
- **stat キャッシュ**: `idx_files(size, mtime_ns, ino)` が前回と一致し、`ls-files -s` の blob も一致すれば再読込しない（warm rescan の本体）。
- **racy 対策**: 記録時に `mtime_ns ≥ scanStartNs − 3 s` だった entry は `racy = 1` とし、次回は stat が一致しても hash し直す（git の racy-git と同じ考え方）。
- **dirty 判定の省略**: 2 回目以降の scan は `.git/index` と `.git/HEAD` の mtime が前回と同じなら `git status` を起動せず、stat 比較だけで変更を見つける（変更があったものだけ Worker で hash）。

### 2.3 分類規則（順序固定・先勝ち）

`InventoryRule` の表。**phase** = `path`（main thread、内容を読まない）/ `content`（Worker、読み込んだバッファで判定）。

| # | id | 条件 | class | excluded | 読む |
|---|---|---|---|---|---|
| R00 | `special` | mode `160000`（submodule）・`120000`（symlink）・入れ子 repo（`--others` の末尾 `/`）・読めない | `ignored` | `special`¹ | × |
| R01 | `deny` | `EffectiveSettings.denyGlobs`（`DEFAULT_DENY_GLOBS` ∪ global ∪ repo）に一致 | R04 の名前にも一致すれば `secret`、それ以外 `ignored` | `secret` / `deny_glob` | × |
| R02 | `user_exclude` | workspace override / repo の `exclude` glob に一致（`include` に一致するものは除く） | `ignored` | `user_exclude` | × |
| R03 | `include` | repo / workspace の `include` glob に一致 → **R08〜R13 と R15 を飛ばして** R16 以降で class を決める（R00〜R07 は飛ばさない: 2 MiB 超は include でも読まない） | — | — | — |
| R04 | `secret_name` | `SECRET_NAME_RE`（下記） | `secret` | `secret` | × |
| R05 | `lockfile` | basename ∈ `LOCKFILES` | `lockfile` | `lockfile` | × |
| R06 | `binary_ext` | 拡張子 ∈ `BINARY_EXTS`（SVG を含む） | `binary` | `binary` | × |
| R07 | `oversize` | size > `OVERSIZE_BYTES` = 2,097,152 | `oversize` | `oversize` | × |
| R08 | `vendored` | `linguist-vendored` が set、または（属性が unset/false でなく）path segment ∈ `VENDOR_SEGMENTS` | `vendored` | `vendored` | × |
| R09 | `generated_path` | `linguist-generated` が set、または path segment ∈ `GENERATED_SEGMENTS`、または basename が `GENERATED_NAME_RE` | `generated` | `generated` | × |
| R10 | `minified_name` | basename が `MINIFIED_NAME_RE` | `minified` | `minified` | × |
| R11 | `binary_content` | 先頭 8,000 byte に NUL、または先頭 8,000 byte の UTF-8 不正バイト率 > 30% [仮] | `binary` | `binary` | 先頭 |
| R12 | `minified_content` | docs 以外で size > 1 KiB かつ（`bytes / max(1, LF 数) > 300` または（LF ≤ 3 かつ size > 5 KiB）） | `minified` | `minified` | 全体 |
| R13 | `generated_header` | 先頭 5 行のうち**コメント行**が `GENERATED_HEADER_RES` のどれかに一致 | `generated` | `generated` | 先頭 1 KiB |
| R14 | `fixture` | path segment ∈ `FIXTURE_SEGMENTS`、または basename が `*.snap` | `test` | `fixture`¹ | × |
| R15 | `data_large` | 拡張子 ∈ `DATA_EXTS` かつ size > `DATA_LARGE_BYTES` = 51,200 かつ R17/R18 の名前に該当しない | `data_large` | `data_large` | × |
| R16 | `test` | 言語 plugin の `isTestFile(path)`、または path segment ∈ `TEST_SEGMENTS` かつ（MVP 言語 または `CODE_EXTS`） | `test` | — | ○（`lite`） |
| R17 | `docs` | 拡張子 ∈ `DOC_EXTS` または basename が `DOC_NAME_RE` | `docs` | — | ○（`text`） |
| R18 | `config` | basename が `CONFIG_NAME_RE`、または拡張子 ∈ `CONFIG_EXTS` かつ size ≤ 51,200 | `config` | — | ○（`text`。`*.config.{js,ts,…}` は `full` で parse） |
| R19 | `source` | 言語 plugin の拡張子・shebang、または `CODE_EXTS` | `source` | — | ○（`full` / generic） |
| R20 | `fallback` | 上のどれでもない text: size ≤ 51,200 なら `source`（generic）、超えたら `data_large` | — | — | ○ |

¹ `special` と `fixture` は core の `ExcludeReason` に無い（CR-2）。採用されるまでは `FileEntry.excluded` に `EXCLUDE_REASON_FALLBACK`（`special → "vendored"`、`fixture → "data_large"`）を入れ、indexer 内部（`idx_files.excluded_ext`）には正しい理由を持つ。

**集合の定義**（`indexer.ts` の `INVENTORY_SETS` と同値。golden test で一致を検査）:

- `SECRET_NAME_RE` = `(^|/)(\.env(\..*)?|\.dev\.vars|id_rsa.*|id_ed25519.*|\.npmrc|\.netrc|credentials\.json|service[-_]account[^/]*\.json)$|\.(pem|key|p12|pfx|jks|keystore|kdbx)$`（i）
- `LOCKFILES` = package-lock.json, npm-shrinkwrap.json, yarn.lock, pnpm-lock.yaml, bun.lock, bun.lockb, deno.lock, Cargo.lock, go.sum, go.work.sum, poetry.lock, Pipfile.lock, uv.lock, pdm.lock, composer.lock, Gemfile.lock, flake.lock, mix.lock, Podfile.lock, packages.lock.json, gradle.lockfile, pubspec.lock
- `BINARY_EXTS` = png jpg jpeg gif webp avif ico icns bmp tif tiff psd svg woff woff2 ttf otf eot zip gz tgz bz2 xz 7z rar zst tar mp3 mp4 m4a mov webm wav ogg flac pdf doc docx xls xlsx ppt pptx exe dll so dylib a o obj class jar war wasm pyc pyo sqlite sqlite3 db bin dat pkl npy npz parquet onnx pt ckpt
- `VENDOR_SEGMENTS` = node_modules, vendor, third_party, third-party, thirdparty, bower_components, jspm_packages, .yarn, Pods, Carthage, \_\_vendor\_\_
- `GENERATED_SEGMENTS` = dist, .next, .nuxt, .svelte-kit, .output, coverage, \_\_generated\_\_, generated（`build/` `out/` `target/` は**入れない**: Python の `build` スクリプトや Go の `build/` に実コードがある。これらは通常 `.gitignore` 済み）
- `GENERATED_NAME_RE` = `(\.pb\.go|_pb2(_grpc)?\.py|\.pb\.(ts|js)|_pb\.(js|ts|d\.ts)|\.generated\.[a-z]+|_generated\.[a-z]+|\.gen\.(go|ts|js)|\.g\.dart|\.designer\.cs|\.map)$`（i）
- `MINIFIED_NAME_RE` = `(\.min\.(js|mjs|css)|-min\.js|\.bundle\.js|\.chunk\.js)$`（i）
- `GENERATED_HEADER_RES`（コメント記号 `//` `#` `/*` `*` `<!--` `--` `;` `%` `"""` を外した本文、または行全体に対して判定）:
  1. `^// Code generated .* DO NOT EDIT\.$`（Go の公式規約。行全体）
  2. `@generated\b`
  3. `\b(this|the) (file|code) (is|was|has been) (automatically |auto-?|machine[- ])?generated\b`（i）
  4. `^(auto-?generated|automatically generated|generated) (file|code|by|from|with|using)\b`（i）
  5. `\bgenerated\b.*\bdo not (edit|modify)\b|\bdo not (edit|modify)\b.*\bgenerated\b`（i）
  - 「auto-generated」を本文中で言及するだけの行（例: ripgrep `crates/core/flags/complete/zsh.rs` の 8 行目「…ones below that are auto-generated.」）は 1〜5 のどれにも一致しない。コーパス 8 repo での一致は 3 件（crit 1、excalidraw 2）ですべて正解 [実測]。uv/pip-compile の `requirements.txt`（「This file was autogenerated by uv」）は 3 に一致する。
- `FIXTURE_SEGMENTS` = testdata, fixture, fixtures, \_\_fixtures\_\_, \_\_snapshots\_\_, snapshots
- `TEST_SEGMENTS` = test, tests, \_\_tests\_\_, spec, specs, e2e, cypress, playwright, benches, bench, benchmark, benchmarks
- `DATA_EXTS` = json jsonl ndjson csv tsv xml yaml yml geojson txt log har ipynb
- `DOC_EXTS` = md mdx markdown rst adoc asciidoc
- `DOC_NAME_RE` = `(^|/)(README|CHANGELOG|CHANGES|HISTORY|CONTRIBUTING|LICENSE|LICENCE|NOTICE|AUTHORS|SECURITY|CODE_OF_CONDUCT|CLAUDE|AGENTS)(\.[A-Za-z]+)?$`（i）
- `CONFIG_NAME_RE` = package.json, tsconfig\*.json, jsconfig.json, deno.json(c), bunfig.toml, biome.json(c), .eslintrc\*, eslint.config.\*, .prettierrc\*, wrangler.toml/json/jsonc, vercel.json, netlify.toml, Dockerfile\*, \*.dockerfile, docker-compose\*.y(a)ml, compose.y(a)ml, Procfile, Makefile, makefile, GNUmakefile, \*.mk, justfile, Justfile, Taskfile.y(a)ml, flake.nix, default.nix, shell.nix, pyproject.toml, setup.cfg, tox.ini, pytest.ini, mypy.ini, ruff.toml, .flake8, requirements\*.txt, Pipfile, environment.y(a)ml, go.mod, go.work, Cargo.toml, rust-toolchain(.toml), Gemfile, \*.gemspec, pom.xml, build.gradle(.kts), settings.gradle(.kts), .gitattributes, .gitignore, .editorconfig, .nvmrc, .node-version, .tool-versions, .python-version, .gitlab-ci.yml, `*.config.{js,cjs,mjs,ts,cts,mts}`
- `CONFIG_EXTS` = toml ini cfg conf yaml yml json jsonc json5 nix properties
- `CODE_EXTS`（generic で扱うコード）= java kt kts swift c cc cpp cxx h hh hpp cs php rb scala lua sh bash zsh fish ps1 sql css scss sass less html htm vue svelte astro ex exs erl hs ml mli clj cljs dart r jl m mm zig nim sol tf hcl proto graphql gql prisma el vim groovy pl pm
- `EXAMPLE_SEGMENTS`（scope 判定。class は変えない）= example, examples, sample, samples, demo, demos, docs_src, playground

**scope**（indexer 内部、`idx_files.scope`）: `main`（既定）/ `example`（`EXAMPLE_SEGMENTS`）/ `test`（class test）/ `tooling`（`scripts/` `tools/` `.github/`（deny 以外）・`*.config.*`）。route / cli / env の主表は `main` だけ（IDX-D12）。

### 2.4 言語判定

1. **拡張子**（小文字、複合拡張子を先に）: `.d.ts` `.d.mts` `.d.cts` → `typescript`（`decl = true`）／ `.ts` `.mts` `.cts` → `typescript` ／ `.tsx` → `tsx` ／ `.jsx` → `jsx` ／ `.js` `.mjs` `.cjs` → `javascript` ／ `.py` `.pyi` `.pyw` → `python` ／ `.go` → `go` ／ `.rs` → `rust`。
2. **shebang**（拡張子なし・未知拡張子のとき、1 行目が `#!`）: `\b(node|bun)\b` → javascript、`\b(deno|tsx|ts-node)\b` → typescript、`python[0-9.]*` → python、それ以外 → generic。
3. **特別名** → generic: Dockerfile, Makefile, Justfile, Procfile, BUILD, WORKSPACE, Jenkinsfile, Vagrantfile, Gemfile, Rakefile。
4. **grammar の切替**: `javascript` / `jsx` で先頭 2 KiB に `@flow` があれば grammar = `tsx`（IDX-D5）。`lang` は変えない。
5. **方言名**（表示用、`idx_files.dialect`）: generic のファイルには拡張子から linguist 風の名前（`java`・`c`・`shell`・`markdown`・`sql`…）を入れる。`FileEntry.lang` は core の定義どおり plugin が無ければ `generic`（Java/C#/PHP の plugin が入った版で `java` 等に変わる）。

### 2.5 docs / config / test の数え方

- **docs**: `ExistingDocFact` の対象（§5.6）。parse はせず `text` profile で見出しだけ取る（ATX `#`、setext）。翻訳ディレクトリ（`docs/<lang>/` で `docs/en/` が兄弟にある）は class docs のまま、repo pack の DOCS には主言語の 1 系統だけ入れる。
- **config**: 設定の facts（`ConfigEntry`、§5.5）と import 解決の入力（tsconfig・go.mod・pyproject・Cargo.toml・package.json）。`*.config.ts` などコードの config は `full` で parse する（plugin の export に設定値の手がかりがある）。
- **test**: test 名（`TestFact`）と subject 対応（§5.4）の入力。構造化（Leiden / PageRank）には入れず、clustering 後に subject の module に所属させる。

### 2.6 生成入力の token 数（`ScanSummaryView`）

- `tokensNaive` = binary / secret / ignored / special を除く全ファイルの推定 token 合計（kind は class と拡張子から: minified → `minified`、lockfile → `lock`、docs → `markdown_en/ja`（CJK 比率で分割）、`*.json` → `json`、`*.css` → `css`、他 → `code`）。
- `tokensFiltered` = `source` + `config` の推定 token + `test` の test 名 skeleton（1 名 ≈ 12 token）+ min(docs, 20k)。docs は repo pack の DOCS（≤ 0.8k）と prior 入力（gen が D ≤ 20k まで使う）にしか使わないため。

### 2.7 コーパスでの分類結果 [実測 試作 `proto/s0proto.mjs`]

| repo | files | MB | 主な除外 | `tokensNaive` | source+config token | 比 |
|---|---:|---:|---|---:|---:|---:|
| crit | 1,219 | 15.3 | binary 299、deny 14（`.claude/rules/*`）、fixture 13、minified 3（`*.min.js`）、oversize 1（`web/mermaid.min.js` 3.4MB）、lockfile 5 | 5.04M | 1.27M | 0.25 |
| m3e-canvas | 108 | 9.6 | binary 16、minified 1（`public/material-symbols.json`）、deny 2 | 1.47M | 0.52M | 0.35 |
| hono | 583 | 4.8 | fixture 4、lockfile 7、deny 6 | 1.63M | 0.41M | 0.25 |
| flask | 236 | 1.8 | secret 1（`tests/test_apps/.env`）、generated 1（uv の `requirements.txt`）、deny 5 | 0.74M | 0.17M | 0.23 |
| ripgrep | 237 | 3.1 | data_large 7（benchsuite の csv）、symlink 1、lockfile 2 | 1.39M | 0.89M | 0.64 |
| fastapi | 3,181 | 33.3 | binary 244、docs 1,706（翻訳含む）、deny 20 | 6.99M | 0.58M | 0.08 |
| excalidraw | 1,308 | 53.9 | binary 299（woff2 等）、secret 4（`.env.*`）、minified 5（base64 wasm を含む `.ts`）、fixture 26 | 6.83M | 2.82M | 0.41 |
| react | 7,252 | 38.8 | fixture 4,184（`fixtures/`・`__tests__/fixtures/`）、generated 70（`*.map`）、lockfile 48、deny 35（`.claude/**`） | 18.57M | 6.14M | 0.33 |

- 04 §2.2 の crit（source 1.29M）・m3e（0.50M）と ±4% で一致。path 規則だけの S0a は 7k files で ≤ 30 ms、内容規則込みで全ファイルを同期読込した試作は react で 405 ms（本番は Worker で parse と同じ読込に融合するので S0 単独のコストにはならない）。

---

## 3. S1 parse

### 3.1 Worker pool の本数と寿命

- 本数: `W = clamp(ceil(parseMB / 0.75), 1, min(8, max(1, cores − 2), perfCores))` [仮]。`parseMB` は **cache miss で実際に parse するバイト数**（warm で数ファイルなら W = 1）。`cores = os.availableParallelism()`、`perfCores` は macOS の `sysctl hw.perflevel0.logicalcpu`（取れない OS では 8）を platform が渡す。
- 計測（`proto/s1bench.mjs`、parse + 本書の tags query + 結果の構造化 clone、IDX-D3 のバッチ規則）[実測]:

| repo | parse 対象 | W=1 | W=2 | W=4 | W=6 | W=8 | 式の W | peak RSS（W=1 → 測った最大の W） |
|---|---|---:|---:|---:|---:|---:|---:|---|
| m3e-canvas | 65 本 1.3MB | 259 ms | 188 | 165 | — | — | 2 | 145 → 326 MB（W=4） |
| flask | 83 本 0.6MB | 107 | 86 | — | — | — | 1 | 139 → 184 MB（W=2） |
| ripgrep | 110 本 1.8MB | 232 | 154 | — | — | — | 3 | 146 → 206 MB（W=2） |
| hono | 454 本 2.7MB | — | 289 | 224 | — | — | 4 | 262 → 315 MB（W=2 → 4） |
| fastapi | 1,170 本 4.0MB | — | 268 | 194 | — | — | 6 | 210 → 304 MB（W=2 → 4） |
| crit | 743 本 6.2MB | — | — | 330 | 312 | 397² | 6 | 417 → 475 MB（W=4 → 6） |
| excalidraw | 700 本 8.0MB | — | — | 337 | 313 | 417² | 6 | 386 → 453 MB（W=4 → 6） |
| react | 2,423 本 22.6MB | — | — | 788² | 666 | 660 | 6 | 590 → 690 MB（W=6 → 8） |

  （値は S0a〜S1 の wall。² は 64 本固定バッチ版の値。）この Mac では P-core 6 本を超えると E-core に乗って Σparse 時間が伸び、wall が縮まない。**上限を `perfCores` で切る**のはこのため。Worker 1 本あたり +60〜70 MB。
- 起動: Worker spawn + `Parser.init` = 11〜15 ms。grammar は Worker 内で**最初にその言語のファイルが来たとき** load（`Language.load` 0.4〜1.6 ms）+ query compile（TS 21.6 ms / TSX 19.7 / Python 10.3 / JS 9.2 / Rust 6.5 / Go 1.4）[実測 `proto/loadtime.mjs`]。
- 寿命: scan 後は 1 本だけ残して他を terminate。残った 1 本（**warm Worker**）は全 MVP grammar と query を compile 済みの状態で、workspace に SSE client がいる間は保持する（`Indexer.setActive(true)`）。client が 0 になって 60 s で 0 本にする（idle RSS 寄与 0）。cold の 1 本起動は ≈ 15 ms + 該当言語の compile ≤ 22 ms。
- 再生成: 1 本の Worker が累計 50,000 ファイルまたは 512 MiB を parse したら次のバッチ境界で入れ替える [仮]（WASM の線形メモリは縮まないため。測り方: §11.2 の RSS 曲線で 10 回連続 scan の peak が単調増加しないこと）。

### 3.2 grammar の同梱と版

| SourceLang | grammar | npm 版（固定） | wasm サイズ |
|---|---|---|---:|
| typescript | tree-sitter-typescript（`typescript`） | 0.23.2 | 1.41 MB |
| tsx（+ Flow の js/jsx） | tree-sitter-typescript（`tsx`） | 0.23.2 | 1.45 MB |
| javascript / jsx | tree-sitter-javascript | 0.25.0 | 0.41 MB |
| python | tree-sitter-python | 0.25.0 | 0.46 MB |
| go | tree-sitter-go | 0.25.0 | 0.22 MB |
| rust | tree-sitter-rust | 0.24.0 | 1.10 MB |
| （runtime） | web-tree-sitter | 0.27.0 | `web-tree-sitter.wasm` |

- 同梱: `scripts/gen-assets.ts` が `import tsWasm from "…/tree-sitter-typescript.wasm" with { type: "file" }` の表を生成する（05 §3 で `--compile` 内の動作を確認済み）。server が `Bun.file(x).bytes()` で読み、Worker の init メッセージで渡す。Worker は `Parser.init({ wasmBinary })` と `Language.load(bytes)` だけを使い、**Bun API を使わない**（Node の `worker_threads` でも同じコードが動く）。合計 ≈ 5.1 MB はバイナリ予算（85 MB）に含める。
- **ExtractorVersion** = `<lang>@<grammarVer>+<q8>`。`q8` = xxh3(query 本文（`.scm` を連結した UTF-8）+ `"\n"` + `EXTRACTOR_CODE_VERSION`)の先頭 8 hex。`EXTRACTOR_CODE_VERSION` は抽出コード（qualname・signature・doc・hash の規則）を変えたら上げる整数。例: `go@0.25.0+3f9a2c1d`。
- `EXTRACTOR_SET_VERSION` = 全 plugin の ExtractorVersion を言語名順に連結した xxh3（`packKey` と manifest の `generator.extractors` に使う）。

### 3.3 Worker プロトコル

- Worker のエントリは `packages/server/src/workers/parse.ts`（Bun API を使ってよい層）で、`@mitori/indexer` の `createParseWorker(env, init)` を呼んで `onmessage` に繋ぐだけ。`env` は `{ readFile(abs): Uint8Array, gitBlob(bytes, algo): GitOid, xxh3(data): Xxh3, now(): number }`（ポートで注入。indexer は `Bun.*` を直接使わない）。
- 要求 `ParseBatchRequest { id, items: ParseItem[] }`。`ParseItem = { path, abs, size, lang, grammar, profile: "full"|"lite"|"text", knownBlob: GitOid|null, source?: Uint8Array, detectors: string[], provisionalClass, scope }`（`provisionalClass`・`scope` は path 規則の結果。内容規則で class が変わりうる）。`source` は `update()` で main thread が既に読んだときだけ付ける（transfer）。
- Worker の 1 item の処理順: 読込（`source` が無ければ `readFile`）→ `knownBlob` が null なら `gitBlob` → 内容規則 R11〜R13（該当すれば parse せず `contentClass` を返す）→ 行数・LOC・CJK 文字数 → parse（timeout 250 ms [仮]。`progressCallback` で打ち切り）→ tags query → 抽出（§3.6）→ 1 ファイル facts（§5.2）→ **`tree.delete()`** → 結果。
- 応答 `ParseBatchResponse { id, items: ParseItemResult[], ms: {read, hash, parse, query, extract} }`。結果は構造化 clone（transfer できる大きなバッファは無い）。
- 割当て: main thread は item を size 降順に並べ、§0.2 IDX-D3 の上限でバッチを切り、空いた Worker に次のバッチを渡す（pull 型）。

### 3.4 capture 規約（全言語共通）

| capture | 意味 | 抽出側の処理 |
|---|---|---|
| `@def.<kind>` + `@name` | 定義ノードと名前ノード（同じ pattern 内） | `<kind>` は `function method class interface type enum namespace module struct trait impl const var field macro package`。`package` は symbol にせずファイルの package 名にする |
| `@doc` / `@doc.module` | 構造的に決まる doc（Python docstring、Rust `///` `//!`） | 直後（Python は直前）の定義に付ける |
| `@import.source` | import 元の文字列 / パス | 引用符を外す。Python `relative_import` はドットを数える |
| `@import.name` | import した名前（binding） | 同じ import 文の source に紐付け（同じ行・同じ statement ノード） |
| `@import.dynamic` | `import("x")` / `require("x")` / `importlib.import_module("x")` | kind `dynamic` |
| `@import.mod` | Rust の `mod x;`（本体なし） | モジュールファイル解決（§4.5） |
| `@export.name` / `@export.source` | `export { a as b }` / `export * from "x"` / `__all__` の要素 | exported 判定と re-export edge |
| `@ref.call` `@ref.new` `@ref.type` `@ref.jsx` | 名前参照 | ファイル内で `(name, kind)` ごとに件数と最初の行に畳む。**定義の `@name` と同じノードは捨てる** |
| `@ref.qual.pkg` + `@ref.qual.name` | `pkg.Name`（Go の selector、Rust の `a::b`） | `pkg` がそのファイルの import alias のときだけ限定参照として扱う（Go の `x.Field` の大半はここで落ちる） |
| `@_*` | predicate 用の補助 | 無視 |

- profile: `full` は全 pattern、`lite`（test）は `@ref.type` `@ref.qual.*` を `Query.disableCapture` で無効化、`text` は query を使わない。
- predicate は `#eq?` と `#match?` だけを使う（web-tree-sitter が評価する）。`#strip!` `#select-adjacent!` `#set-adjacent!` は使わない（評価されない）。

### 3.5 tags query（全文。`docs/design/specs/indexer/queries/*.scm` と同一）

コーパスで compile と capture 数を確認済み（`proto/qtest.mjs`）。数字は「ファイル数 / def 数 / ref 数 / import 数 / parse error のあるファイル数」[実測]。

| grammar | 検証した repo | 結果 |
|---|---|---|
| typescript | hono（400 本）、excalidraw（343）、react（403）、m3e（33） | hono: def 5,272・ref 49,262・import 1,140・error 8 ／ excalidraw: 6,618・32,906・1,982・2 |
| tsx | excalidraw（318）、m3e（31）、react（122） | excalidraw: def 3,608・ref 43,381（うち jsx 3,117）・import 2,808・error 3 |
| javascript | react（3,917）、crit（158） | react: def 25,829・ref 181,343・import 9,129・**error 941（Flow。IDX-D5 で tsx に切替）** |
| python | flask（83）、fastapi（1,166） | flask: def 1,872・docstring 303・import 648・error 0 |
| go | crit（400） | def 8,188・ref 116,001（call 40,548・type 22,683・new 1,978・qual 50,792 組。qual は §3.4 で絞る）・import 2,425・error 0 |
| rust | ripgrep（110）、react の compiler（121） | ripgrep: def 5,173・doc 7,541・import 411・`mod` 89・error 0 |

#### 3.5.1 typescript.scm（tsx はこれ + 3.5.2）

```scheme
; mitori tags query — typescript (also the base of tsx). Capture contract: see docs/design/specs/indexer.md §3.4
; ---- definitions -------------------------------------------------------------
(function_declaration name: (identifier) @name) @def.function
(generator_function_declaration name: (identifier) @name) @def.function
(function_signature name: (identifier) @name) @def.function
(class_declaration name: (type_identifier) @name) @def.class
(abstract_class_declaration name: (type_identifier) @name) @def.class
(interface_declaration name: (type_identifier) @name) @def.interface
(type_alias_declaration name: (type_identifier) @name) @def.type
(enum_declaration name: (identifier) @name) @def.enum
(internal_module name: [(identifier) (nested_identifier)] @name) @def.namespace
(module name: [(identifier) (nested_identifier) (string)] @name) @def.namespace
(method_definition name: [(property_identifier) (private_property_identifier)] @name) @def.method
(method_signature name: [(property_identifier) (private_property_identifier)] @name) @def.method
(abstract_method_signature name: [(property_identifier) (private_property_identifier)] @name) @def.method
(public_field_definition name: [(property_identifier) (private_property_identifier)] @name) @def.field
(property_signature name: (property_identifier) @name) @def.field
(lexical_declaration
  (variable_declarator
    name: (identifier) @name
    value: [(arrow_function) (function_expression) (generator_function)]) @def.function)
(lexical_declaration
  (variable_declarator
    name: (identifier) @name
    value: (class) ) @def.class)
(program (lexical_declaration
  (variable_declarator
    name: (identifier) @name
    value: [(object) (array) (call_expression) (new_expression) (string) (number) (template_string) (as_expression) (satisfies_expression) (member_expression) (identifier)]) @def.const))
(program (export_statement (lexical_declaration
  (variable_declarator
    name: (identifier) @name
    value: [(object) (array) (call_expression) (new_expression) (string) (number) (template_string) (as_expression) (satisfies_expression) (member_expression) (identifier)]) @def.const)))
; ---- exports -------------------------------------------------------------------
(export_statement (export_clause (export_specifier name: (_) @export.name)))
(export_statement source: (string) @export.source)
(export_statement "default" value: (identifier) @export.name)
; ---- imports -------------------------------------------------------------------
(import_statement source: (string) @import.source)
(import_statement (import_clause (named_imports (import_specifier name: (identifier) @import.name))))
(import_statement (import_clause (identifier) @import.name))
(import_require_clause source: (string) @import.source)
(call_expression function: (import) arguments: (arguments . (string) @import.dynamic))
((call_expression function: (identifier) @_req arguments: (arguments . (string) @import.dynamic))
  (#eq? @_req "require"))
; ---- references ----------------------------------------------------------------
(call_expression function: (identifier) @ref.call)
(call_expression function: (member_expression property: (property_identifier) @ref.call))
(new_expression constructor: (identifier) @ref.new)
(type_identifier) @ref.type
(extends_clause value: (identifier) @ref.type)
(implements_clause (type_identifier) @ref.type)
```

#### 3.5.2 tsx-addendum.scm

```scheme
; tsx = typescript.scm + this addendum (JSX component references)
(jsx_opening_element name: (identifier) @ref.jsx)
(jsx_self_closing_element name: (identifier) @ref.jsx)
(jsx_opening_element name: (member_expression property: (property_identifier) @ref.jsx))
(jsx_self_closing_element name: (member_expression property: (property_identifier) @ref.jsx))
```

#### 3.5.3 javascript.scm（javascript / jsx）

```scheme
; mitori tags query — javascript / jsx (the JS grammar parses JSX natively)
; ---- definitions -------------------------------------------------------------
(function_declaration name: (identifier) @name) @def.function
(generator_function_declaration name: (identifier) @name) @def.function
(class_declaration name: (identifier) @name) @def.class
(method_definition name: [(property_identifier) (private_property_identifier)] @name) @def.method
(field_definition property: [(property_identifier) (private_property_identifier)] @name) @def.field
(lexical_declaration
  (variable_declarator
    name: (identifier) @name
    value: [(arrow_function) (function_expression) (generator_function)]) @def.function)
(variable_declaration
  (variable_declarator
    name: (identifier) @name
    value: [(arrow_function) (function_expression) (generator_function)]) @def.function)
(lexical_declaration
  (variable_declarator name: (identifier) @name value: (class)) @def.class)
(program (lexical_declaration
  (variable_declarator
    name: (identifier) @name
    value: [(object) (array) (call_expression) (new_expression) (string) (number) (template_string) (member_expression) (identifier)]) @def.const))
(program (export_statement (lexical_declaration
  (variable_declarator
    name: (identifier) @name
    value: [(object) (array) (call_expression) (new_expression) (string) (number) (template_string) (member_expression) (identifier)]) @def.const)))
; CommonJS: module.exports.foo = function () {} / exports.foo = () => {}
(assignment_expression
  left: (member_expression object: [(identifier) (member_expression)] property: (property_identifier) @name)
  right: [(arrow_function) (function_expression)]) @def.function
; ---- exports -------------------------------------------------------------------
(export_statement (export_clause (export_specifier name: (_) @export.name)))
(export_statement source: (string) @export.source)
(export_statement "default" value: (identifier) @export.name)
; ---- imports -------------------------------------------------------------------
(import_statement source: (string) @import.source)
(import_statement (import_clause (named_imports (import_specifier name: (identifier) @import.name))))
(import_statement (import_clause (identifier) @import.name))
(call_expression function: (import) arguments: (arguments . (string) @import.dynamic))
((call_expression function: (identifier) @_req arguments: (arguments . (string) @import.dynamic))
  (#eq? @_req "require"))
; ---- references ----------------------------------------------------------------
(call_expression function: (identifier) @ref.call)
(call_expression function: (member_expression property: (property_identifier) @ref.call))
(new_expression constructor: (identifier) @ref.new)
(class_heritage (identifier) @ref.type)
(jsx_opening_element name: (identifier) @ref.jsx)
(jsx_self_closing_element name: (identifier) @ref.jsx)
(jsx_opening_element name: (member_expression property: (property_identifier) @ref.jsx))
(jsx_self_closing_element name: (member_expression property: (property_identifier) @ref.jsx))
```

#### 3.5.4 python.scm

```scheme
; mitori tags query — python
; ---- definitions -------------------------------------------------------------
(function_definition name: (identifier) @name) @def.function
(class_definition name: (identifier) @name) @def.class
(module (expression_statement (assignment left: (identifier) @name) @def.const))
(class_definition body: (block (expression_statement (assignment left: (identifier) @name) @def.field)))
; docstrings (structural: first statement of module / class / function body)
(module . (expression_statement (string) @doc.module))
(function_definition body: (block . (expression_statement (string) @doc)))
(class_definition body: (block . (expression_statement (string) @doc)))
; ---- exports -------------------------------------------------------------------
((module (expression_statement (assignment left: (identifier) @_all right: (list (string) @export.name))))
  (#eq? @_all "__all__"))
; ---- imports -------------------------------------------------------------------
(import_statement name: (dotted_name) @import.source)
(import_statement name: (aliased_import name: (dotted_name) @import.source))
(import_from_statement module_name: (dotted_name) @import.source)
(import_from_statement module_name: (relative_import) @import.source)
(import_from_statement name: (dotted_name) @import.name)
(import_from_statement name: (aliased_import name: (dotted_name) @import.name))
((call function: (attribute object: (identifier) @_il attribute: (identifier) @_im) arguments: (argument_list . (string) @import.dynamic))
  (#eq? @_il "importlib") (#eq? @_im "import_module"))
; ---- references ----------------------------------------------------------------
(call function: (identifier) @ref.call)
(call function: (attribute attribute: (identifier) @ref.call))
(class_definition superclasses: (argument_list (identifier) @ref.type))
(class_definition superclasses: (argument_list (attribute attribute: (identifier) @ref.type)))
(type (identifier) @ref.type)
(decorator (identifier) @ref.call)
(decorator (attribute attribute: (identifier) @ref.call))
```

#### 3.5.5 go.scm

```scheme
; mitori tags query — go
; ---- definitions -------------------------------------------------------------
(package_clause (package_identifier) @name) @def.package
(function_declaration name: (identifier) @name) @def.function
(method_declaration name: (field_identifier) @name) @def.method
(type_declaration (type_spec name: (type_identifier) @name type: (struct_type)) @def.struct)
(type_declaration (type_spec name: (type_identifier) @name type: (interface_type)) @def.interface)
(type_declaration (type_spec name: (type_identifier) @name type: [(type_identifier) (qualified_type) (pointer_type) (map_type) (slice_type) (array_type) (function_type) (channel_type) (generic_type)]) @def.type)
(type_declaration (type_alias name: (type_identifier) @name) @def.type)
(source_file (const_declaration (const_spec name: (identifier) @name) @def.const))
(source_file (var_declaration (var_spec name: (identifier) @name) @def.var))
(field_declaration_list (field_declaration name: (field_identifier) @name) @def.field)
(interface_type (method_elem name: (field_identifier) @name) @def.method)
; ---- imports -------------------------------------------------------------------
(import_spec path: (interpreted_string_literal) @import.source)
(import_spec name: (package_identifier) @import.name path: (interpreted_string_literal))
; ---- references ----------------------------------------------------------------
(call_expression function: (identifier) @ref.call)
(call_expression function: (selector_expression field: (field_identifier) @ref.call))
(selector_expression operand: (identifier) @ref.qual.pkg field: (field_identifier) @ref.qual.name)
(qualified_type package: (package_identifier) @ref.qual.pkg name: (type_identifier) @ref.qual.name)
(type_identifier) @ref.type
(composite_literal type: (type_identifier) @ref.new)
```

#### 3.5.6 rust.scm

```scheme
; mitori tags query — rust
; ---- definitions -------------------------------------------------------------
(function_item name: (identifier) @name) @def.function
(function_signature_item name: (identifier) @name) @def.function
(struct_item name: (type_identifier) @name) @def.struct
(enum_item name: (type_identifier) @name) @def.enum
(union_item name: (type_identifier) @name) @def.struct
(type_item name: (type_identifier) @name) @def.type
(trait_item name: (type_identifier) @name) @def.trait
(impl_item type: (_) @name) @def.impl
(mod_item name: (identifier) @name) @def.module
(macro_definition name: (identifier) @name) @def.macro
(const_item name: (identifier) @name) @def.const
(static_item name: (identifier) @name) @def.var
(field_declaration_list (field_declaration name: (field_identifier) @name) @def.field)
(enum_variant_list (enum_variant name: (identifier) @name) @def.field)
; doc comments (structural: `///` and `//!` carry a doc marker child)
(line_comment (outer_doc_comment_marker)) @doc
(line_comment (inner_doc_comment_marker)) @doc.module
(block_comment (outer_doc_comment_marker)) @doc
; ---- imports -------------------------------------------------------------------
(use_declaration argument: (_) @import.source)
(extern_crate_declaration name: (identifier) @import.source)
(mod_item name: (identifier) @import.mod !body)
; ---- references ----------------------------------------------------------------
(call_expression function: (identifier) @ref.call)
(call_expression function: (scoped_identifier name: (identifier) @ref.call))
(call_expression function: (field_expression field: (field_identifier) @ref.call))
(macro_invocation macro: (identifier) @ref.call)
(impl_item trait: (type_identifier) @ref.type)
(type_identifier) @ref.type
(struct_expression name: (type_identifier) @ref.new)
(scoped_identifier path: (identifier) @ref.qual.pkg name: (identifier) @ref.qual.name)
```

### 3.6 symbol モデルと抽出規則

`SymbolDetail`（indexer.ts）= core の `SymbolEntry` + `{ ord, docStart?, docEnd?, doc?, bodyStart?, bodyEnd?, complexity, decorators? }`。core に `doc?` を足す要求は CR-3。

- **順序と ord**: 定義ノードの開始 byte 昇順。`ord` はファイル内の通し番号（0 起点）。
- **kind**: capture の `<kind>` をそのまま使い、次で補正する。`function` の親が class / impl / trait / interface → `method`。メソッド名が `constructor`（TS/JS）・`__init__`（Python）→ `constructor`。test と判定された関数（§5.4 の test case 規則）→ `test`。TS で `function_signature`（overload）の直後に同名の `function_declaration` があれば 1 つに畳む（範囲は最初の overload から本体の終わりまで、signature は本体のもの）。
- **parent**: 自分を含む最小の定義ノード（範囲の包含で決める）。Go のメソッドは receiver の型名（`*T` → `T`）を親の qualname にする（同じファイルに型定義があれば `parent` にその key を入れる）。Rust の impl 内の関数は impl の対象型名を親の qualname にし、`parent` は impl symbol。
- **qualname**: 親の qualname + `.` + name。Rust の impl symbol 自体は `Type[impl]` / `Type[impl Trait]`（Trait は最後の segment）。同じ qualname が 2 回目以降に現れたら `~2` `~3`…を付ける（source 順。Rust の `fmt` を Display と Debug の両方で実装する場合など）。行番号は qualname に入れない（行が動いても key が変わらない）。
- **範囲**: `start` = 定義ノードの開始行（Python は decorator の先頭行、TS/JS は外側の `export_statement` の開始行）、`end` = 定義ノードの終了行。`bodyStart`/`bodyEnd` = `body` field（なければ class_body / block / declaration_list / field_declaration_list）の行。
- **signature**: 開始位置から body ノードの開始直前までの原文（Python は decorator を空白区切りで前置）。空白（改行含む）の連続を 1 空白に、末尾の `{` `:` と空白を落とし、200 文字で切る（`…`）。**const / var の初期化子は入れない**（`export const API_KEY = "…"` は `export const API_KEY` まで。秘密値の漏出を避ける。skeleton の原文行は §7.5 の secret scan を通る）。
- **sigHash** = xxh3(`kind` + `\0` + `qualname` + `\0` + signature から**全空白を除いた**文字列)。空白・改行だけの変更で interface が変わったことにしない。
- **bodyHash** = xxh3(body の原文から comment ノードの範囲を除き、空白の連続を 1 空白にした文字列)。comment や整形だけの変更は body 変更にもしない。
- **exported**:
  - TS/JS: 定義（または包む `lexical_declaration`）の親が `export_statement`、または同ファイルの `export { … }` / `export default <ident>` に名前がある、または CommonJS の `module.exports = {…}` / `exports.x =` の対象。`.d.ts` は top-level をすべて exported。class member は「class が exported かつ `private`/`protected`/`#` 名でない」。
  - Python: `__all__`（リテラルの list/tuple）があればその名前だけ。無ければ module 直下で `_` 始まりでない名前。class member は class が exported かつ `_` 始まりでない（`__init__` などの dunder は exported 扱い）。
  - Go: 名前の先頭が Unicode の大文字（`unicode.IsUpper` 相当）。
  - Rust: `visibility_modifier` が `pub` または `pub(crate)`（crate 内の他 module から見える = module 境界の interface に入る）。trait impl のメソッドは impl 対象型の可視性を継ぐ。
- **doc**（JS/TS/Go の規則。Python は docstring、Rust は `///` `/** */` を query の `@doc` で取る）: 定義ノード（TS/JS は `export_statement`、Python は `decorated_definition`、Rust は先行する `attribute_item` を飛ばした位置）の**直前の兄弟が連続した comment ノード**で、最後の comment の終了行が定義の開始行 − 1 以上（空行なし）であるもの。ファイル先頭（行 1）から始まり `copyright|license|spdx` を含むブロックは license header として doc にしない。Rust の `@doc` は直後の定義（間の `attribute_item` は飛ばす）に、Python の `@doc` は docstring を含む定義に付ける。
  - 保存: `docStart`/`docEnd`（元の行）と `doc`（コメント記号 `//` `///` `/**` `*/` 行頭の `*` `#` `"""` を除いて行を `\n` で連結、trim、600 文字まで）[仮]。JSDoc のタグは残す。
- **complexity**: 1 回の TreeCursor 走査で、下の判定ノードを「それを含む最も内側の定義」に +1 する（O(ノード数)）。TS/JS: `if_statement` `for_statement` `for_in_statement` `while_statement` `do_statement` `switch_case` `catch_clause` `ternary_expression` と演算子が `&&` `||` `??` の `binary_expression`。Python: `if_statement` `elif_clause` `for_statement` `while_statement` `except_clause` `conditional_expression` `boolean_operator` `case_clause`。Go: `if_statement` `for_statement` `expression_case` `type_case` `communication_case` と `&&` `||`。Rust: `if_expression` `match_arm` `while_expression` `loop_expression` `for_expression` `try_expression` と `&&` `||`。
- **imports / refs / facts の行**: 1 起点。refs は `(name, kind, qual)` でファイル内に畳み `{count, firstLine}` を持つ（10k 件/ファイルで打ち切り [仮]）。

### 3.7 メモリ衛生と失敗処理

- `tree.delete()` は `try { … } finally { tree.delete() }` で必ず呼ぶ。Node・TreeCursor を `delete` 後に触らない（抽出結果はすべてプレーンな値にしてから返す）。Query と Parser は Worker の寿命の間 1 個ずつ使い回す。
- parse timeout（250 ms [仮]）・例外 → そのファイルは generic 抽出（§3.8）に落とし、`note: "parse_timeout" | "parse_error"`。
- parse error を含む木もそのまま使う（tree-sitter は部分木を返す）。`errors` = ERROR・MISSING ノード数。error のバイト範囲がファイルの 30% を超えたら `note: "degraded"` を付け、その defs だけ採用し refs は捨てる [仮]。
- 大きな増分: warm Worker は直近に parse した 64 KiB 超のファイルの木を LRU で 8 本保持し、`update()` では旧本文との共通 prefix/suffix から 1 個の `tree.edit()` を作って増分 parse する（20k 行 TS で 75.7 → 8.3 ms、05 §2.4）。保持中の木も LRU 追い出し時と Worker 終了時に `delete()`。

### 3.8 generic 抽出（plugin の無い言語・失敗時）

- 定義: 行頭（インデント可）が `(export\s+)?(async\s+)?(def|function|func|fn|class|struct|interface|trait|enum|type|module|sub|procedure|proc)\s+([A-Za-z_$][\w$]*)` に一致する行を `kind` 推定付きで symbol にする（範囲は次の同インデント以下の定義の前行まで）。
- Markdown（docs）: 見出しを symbol 風に持つ（search・palette 用。`kind: "module"`、qualname = 見出しの階層を ` > ` で連結）。
- import / refs は取らない（構造化には directory prior だけが効く）。

---

## 4. import 解決と名前参照

### 4.1 共通

- 解決結果 `ResolvedImport = { from: RepoPath, spec, line, kind: "static"|"dynamic"|"type"|"reexport"|"mod"|"asset", names: string[], to: RepoPath[], external?: string, stdlib?: true }`。`to` は **repo 内の included ファイルだけ**。解決できない repo 内らしき spec（相対パスなど）は `idx_unresolved` に残し、ファイル追加時に再解決する。
- 設定ファイル（tsconfig・package.json・go.mod・go.work・pyproject.toml・setup.cfg・Cargo.toml）は S1 の `text` profile で JSON/TOML/JSONC を parse し、`ImportContext.config(kind, dir)` で引ける形にキャッシュする（key = path × blob）。TOML は自前の最小 parser（table・array of tables・文字列・配列・inline table）[仮]、JSONC はコメントと末尾カンマを除去してから `JSON.parse`。
- 存在確認はメモリ上の path 集合（included + config + docs）で行う。fs は触らない。
- 結果は path × `resolverConfigDigest`（関係する設定ファイルの blob の xxh3）でメモ化する。

### 4.2 TypeScript / JavaScript

1. **spec の正規化**: `?query`・`#hash` を落とす。拡張子が asset（css scss svg png json wasm …）なら kind `asset` として graph に入れない（記録だけ）。`node:` 接頭辞・Node 組み込み名（`fs` `path` `crypto` … `NODE_BUILTINS`）→ `stdlib`。`http(s)://` `jsr:` `npm:` → external。
2. **相対**（`./` `../`）: `dir(from)` から解決して下の probe。
3. **tsconfig**: `from` から上へ最初の `tsconfig.json`（なければ `jsconfig.json`）。`extends` は repo 内の相対パスと workspace package だけ辿る（`@tsconfig/*` など外部は無視）。`compilerOptions.paths` のパターン（`*` は 1 個）を長い一致順に試し、`baseUrl` があれば基準にする（TS 5+ で `baseUrl` が無ければ tsconfig のディレクトリ）。`baseUrl` があれば bare spec を `baseUrl` 相対でも試す。
4. **package.json `imports`**（`#x`）: 最寄りの package.json の `imports` を subpath pattern 規則で展開。
5. **workspace package**: ルートの package.json `workspaces`（配列 or `{packages}`）、`pnpm-workspace.yaml` の `packages`、`lerna.json` の `packages` の glob で package.json を集め、`name → dir` の表を作る。bare spec の先頭（`@scope/name` または `name`）が表にあれば、`exports`（subpath pattern、条件の優先順 `source` `types` `import` `module` `default` `require` `node` `browser`）→ `module` → `main` → `index` の順に解決する。
6. **dist → src の読み替え**: 5 の結果が repo に無い（ビルド成果物）なら、パス中の最初の `dist|build|lib|out|esm|cjs` segment を `src` に置き換え、拡張子 `.js/.mjs/.cjs/.d.ts` を `.ts/.tsx/.mts/.cts` に読み替えて probe する（monorepo で型定義経由の import をソースに繋ぐ）。
7. **probe**: spec に拡張子が無ければ `.ts .tsx .mts .cts .d.ts .js .jsx .mjs .cjs .json` の順。TS ファイルからの `./x.js` は先に `./x.ts` `./x.tsx` を試す（TS ESM の慣習）。ディレクトリなら `package.json`（`exports["."]` → `module` → `main`）→ `index.<上の順>`。
8. 解決できない bare spec → external（package 名 = `@scope/name` か先頭 segment）。`DependencyFact` と照合して `dev` などを付ける。
- kind: `import type` / `export type … from` → `type`。`export … from` → `reexport`（re-export edge は graph で import と同じ重み。PageRank を barrel `index.ts` に集めないため、barrel → 実体の edge は 0.5 にする [仮]）。

### 4.3 Python

1. **root 集合 R**: repo ルート ∪ `pyproject.toml` / `setup.py` / `setup.cfg` のあるディレクトリ ∪ それぞれの `src/`（あれば）∪ `[tool.setuptools.package-dir]` の値 ∪ `[tool.pytest.ini_options].pythonpath` の値。深い順に並べる（より具体的な root を先に）。
2. **絶対** `import a.b.c` / `from a.b import c`: 各 r ∈ R で `r/a/b/c.py` → `r/a/b/c/__init__.py` → `r/a/b/c.pyi` → `r/a/b/c/__init__.pyi`。from 形は先に submodule `a.b.c` を試し、無ければ `a.b`（`c` はその中の名前）。namespace package（`__init__.py` の無いディレクトリ）はファイル edge を張らない。
3. **相対** `from ..x import y`: ドット数 L。基準 = `from` のパッケージディレクトリ（`__init__.py` ならそのディレクトリ、他は `dir(from)`）から L−1 段上がって 2 と同じ探索。
4. **stdlib**: Python 3.13 の `sys.stdlib_module_names`（≈ 300 名）を `PY_STDLIB` として埋め込み、先頭 segment が一致すれば stdlib。
5. **external**: 先頭 segment。依存名との照合は `-`/`_`/大小文字を正規化し、import 名と配布名が違う代表例 `PY_IMPORT_TO_DIST`（yaml→PyYAML、PIL→Pillow、cv2→opencv-python、sklearn→scikit-learn、bs4→beautifulsoup4、dateutil→python-dateutil、jwt→PyJWT、attr→attrs、google.protobuf→protobuf）[仮] を使う。
6. `if TYPE_CHECKING:` の中の import → kind `type`。`try/except ImportError` の中も通常どおり。`importlib.import_module("lit")` → `dynamic`。

### 4.4 Go

1. **module**: repo 内の全 `go.mod` の `module` 行（`dir → modulePath`）と `go.work` の `use`。`replace M => ./path` も repo 内 module として登録。ファイルの所属 module = 最寄りの祖先の go.mod。
2. import path P は、P の接頭辞になる最長の modulePath M を探し、`dir = moduleDir + P[len(M):]`。その dir の `_test.go` でない `.go` ファイルが package のファイル集合。
3. **edge の配り方**: import した alias（明示 alias か、無ければ対象 package の `package` 句の名前。取れなければ P の最後の segment）で `@ref.qual.pkg == alias` の参照を集め、`@ref.qual.name` を対象 package の symbol 表（package 内で名前は一意）で引いて**定義ファイルへ** edge を張る（重み 1.0 を参照ファイル数で割らずに各ファイルへ 1.0）。参照が 1 つも引けなければ package の全ファイルに `1/|P|`（下限 0.1）を配る。
4. stdlib = P の先頭 segment に `.` が無い。`vendor/` は R08 で除外済み。
5. **同一 package**（同じディレクトリかつ同じ `package` 名）のファイル間は import が無いので、§4.6 の「Go 同一 package の精密参照」で繋ぐ（Go では intra-package の構造がこれでしか取れない）。

### 4.5 Rust

1. **crate**: `[package]` を持つ各 `Cargo.toml` → crate 名 = `[lib].name` ?? `package.name` の `-` を `_` に。root ファイル: lib = `[lib].path` ?? `src/lib.rs`、bin = `[[bin]].path` ?? `src/main.rs`・`src/bin/*.rs`・`src/bin/*/main.rs`、`tests/*.rs` `examples/*.rs` `benches/*.rs`（それぞれ独立 crate root）。workspace は `[workspace].members` の glob。
2. **module 木**: root から `mod x;`（`@import.mod`）を辿る。ファイル F の子ディレクトリ = F が `mod.rs` / `lib.rs` / `main.rs` / crate root なら `dir(F)`、それ以外は `dir(F)/stem(F)`。子は `<子dir>/x.rs` → `<子dir>/x/mod.rs`。直前の `#[path = "p"]` は `dir(F)` 相対。inline の `mod x { … }` はファイル内スコープとして持つ。結果として `file → crate::a::b` の表ができる。
3. **use の解決**: use tree を葉の path に展開（`{a, b::c as d, *}`）。先頭が `crate` → 自 crate root、`self` → 現 module、`super` → 親 module（繰り返し可）、workspace の crate 名 → その crate root、`std|core|alloc` → stdlib、現 module で宣言された module 名 → 相対（2018 の uniform paths）、それ以外 → external crate（依存）。その後、module 表で最長一致する module ファイルへ edge（残りの segment はそのファイル内の item）。
4. 式中の `a::b::c()`（`@ref.qual.*`）も 3 と同じ規則で解決して edge にする。
5. `extern crate x` → external。

### 4.6 名前参照の edge（IDF 減衰）

import で解決できない結び付き（Go の同一 package、Python の動的コード、JS の global）を補う。**import edge と同じ (f, g) には足さない**（二重計上を避ける）。

- 記号: F = graph のファイル数（main/example scope の source、test 除く）。`D(n)` = 名前 n を定義するファイル集合（exported な定義が 1 つでもあれば exported だけ）、`R(n)` = n を参照するファイル集合、`c_f(n)` = f 内の参照回数。
- 捨てる n: 長さ ≤ 2、`GENERIC_NAMES`（言語の組み込み名 + 汎用動詞・名詞 ≈ 400 語。例: get set run main init new New String Error Close Open Read Write ReadFile WriteFile len append make map filter reduce push pop then catch log info warn error debug print Println Printf Sprintf Errorf parse Parse format id name value data key items list add remove update delete create handle handler callback next done err res req ctx options opts config props state render require exports module default test it describe expect assert self cls constructor）[仮]、f で外部・stdlib から import された alias、`|D(n)| > 20`、f 自身が n を定義している。
- `idf(n) = clamp(ln(F / |R(n)|) / ln(F), 0, 1)`（F ≥ 2）。
- 各 g ∈ D(n) \ {f} への寄与: `w = sqrt(c_f(n)) · idf(n) / |D(n)| · (|D(n)| ≥ 6 ? 0.1 : 1)`（aider の「6 箇所以上で定義なら ×0.1」を残した上で IDF を掛ける）。
- `ref(f, g) = λ_ref · min(1, Σ_n w)`、`λ_ref = 0.5` [仮]。
- **Go 同一 package の精密参照**: 同じ package 内で名前は一意なので、`w = sqrt(c_f(n))`（IDF なし）、`ref(f, g) = λ_pkg · min(1, Σ w)`、`λ_pkg = 0.8` [仮]。
- 調整の測り方（§11.4）: crit で PageRank 上位 10 に `integrations/embed.go`・`web/embed.go` が入らない（04 §2.5 の失敗の再現防止）、m3e・crit・hono で modularity と directory purity を記録し、λ を {0.25, 0.5, 0.75} で振って最良を採る。

---

## 5. S2 facts（0 token の検出器）

### 5.1 二段構成: 抽出（Worker）とリンク（main thread）

- **抽出**: `FactDetector.extract({file, text, tree})` は Worker の中で、木が生きている間に 1 ファイル分の**候補**（`FactCandidate`）を返す。候補は事実そのものと**証拠**（`evidence`: `import:<pkg>` `bind:<factory>` `recv:<name>` `path:<rule>` など）を持つ。query は「候補を広く拾う」だけで、精度は抽出コードと次のリンクで出す（JS の `cli.call` 候補は react で 15,609 件拾うが、受理されるのは commander/yargs の連鎖だけ [実測]）。
- **リンク**: `FactDetector.link(candidates, ctx)` は main thread で全ファイルの候補を見て、(1) 証拠の検査（同じファイルで framework を import している / factory で束縛した変数が receiver / 最寄りの manifest に依存がある）、(2) mount prefix の合成（`app.route('/api', sub)`・`app.use('/v1', r)`・`include_router(r, prefix=)`・`register_blueprint(bp, url_prefix=)`・`r.Group("/v1")`・axum `nest`。import binding を辿って他ファイルへ最大 3 段 [仮]）、(3) handler の `SymbolKey` 付与、(4) 重複除去、(5) scope の付与（`main` 以外は主表に出さない、IDX-D12）を行う。
- 候補は blob × detector set version でキャッシュする（`idx_fact_cands`）。リンク結果（`idx_facts`）は snapshot ごとに作り直す（≤ 50 ms）。
- **test / fixture のファイルからは route・cli・env・schema・entry を出さない**（test 名だけ）。hono の `src/**/*.test.ts` は `client.get("http://localhost/…")` を route 候補として大量に拾う [実測] が、test class なのでここで落ちる。
- 値は**決して取り込まない**: env の値、script の秘密らしい引数（secret scan を通す）、SQL のデフォルト値。

### 5.2 検出器の一覧（id は `<kind>.<name>@<ver>`）

| id | 言語 / 対象 | 候補（query / 規則） | 受理条件 | 出力 |
|---|---|---|---|---|
| `entry.go@1` | Go | `@entry.main`（`func main`）かつ `package main` | — | `entry: "main"`, label = ディレクトリ（`cmd/crit`） |
| `entry.node@1` | package.json | `bin`（文字列 / object）、`main`/`module`/`exports["."]`、`scripts.start` | — | `bin` / `main` / `script` |
| `entry.python@1` | Python / pyproject | `if __name__ == "__main__":`、`__main__.py`、`[project.scripts]`・`[tool.poetry.scripts]` | — | `main`（`__main__`）/ `script`（`[project.scripts]`・`[tool.poetry.scripts]`、label = script 名。CR m0-12） |
| `entry.rust@1` | Rust / Cargo | `fn main` が crate の bin root にある、`[[bin]]` | bin root であること | `main`（label = bin root の path）+ `bin`（`[[bin]]` の name、無ければ package 名。CR m0-12） |
| `entry.deploy@1` | Dockerfile / Procfile / wrangler / serverless | `CMD`/`ENTRYPOINT`、Procfile 行、wrangler `main =`、serverless.yml `handler:` | — | `dockerfile` / `procfile` / `worker` / `lambda` |
| `entry.testmain@1` | Go | `func TestMain(m *testing.M)` | — | `test_main` |
| `route.express@1` | TS/JS | `facts/js-routes-env.scm` の `@route`（`<recv>.<method>("<path>")`、method ∈ get post put patch delete options head all use） | recv が同ファイルで `express()` / `express.Router()` / `Router()`（from `express`）に束縛、または recv ∈ {app, router, api} かつ manifest に `express` | method（`use` は mount）、pattern |
| `route.hono@1` | TS/JS | 同上 + `on("<METHOD>", "<path>")`、`route("<prefix>", sub)`（mount）、`basePath("<p>")` | `new Hono(` / `new OpenAPIHono(` 束縛、または `hono` を import | 同上 |
| `route.fastify@1` | TS/JS | 同上 + `@route.objform`（`route({method, url})`） | `fastify(` / `Fastify(` 束縛 or import | 同上 |
| `route.next-app@1` | path | `(src/)?app/**/page.{tsx,jsx,ts,js,mdx}`（GET）、`(src/)?app/**/route.{ts,js}`（exported な `GET` `POST` `PUT` `PATCH` `DELETE` `HEAD` `OPTIONS` 関数） | 最寄り package.json に `next` | pattern = `app` 以下のディレクトリ（`(group)` と `@slot` を除き、`_private` は無視、`[id]` は書かれたまま） |
| `route.next-pages@1` | path | `(src/)?pages/**`（`_app` `_document` `_error` を除く）、`pages/api/**`（ANY） | `next` 依存 | 同上 |
| `route.fastapi@1` | Python | `facts/py-routes-env.scm` の decorator 形（method ∈ get post put patch delete options head trace api_route websocket）、`add_api_route` | recv が `FastAPI(` / `APIRouter(`（`prefix=` を prefix に）に束縛、または `fastapi` を import | handler = 装飾された関数 |
| `route.flask@1` | Python | `@<recv>.route("<p>", methods=[…])`、Flask 2 の `.get/.post…`、`add_url_rule` | recv が `Flask(` / `Blueprint(`（`url_prefix=`）に束縛、または `flask` を import | `methods=[…]` のリテラル、無ければ GET |
| `route.django@1` | Python | `urls.py` の `path()` / `re_path()` / `url()`、`include("x.urls")`（mount） | basename が `urls.py` かつ `django` 依存 | pattern は書かれたまま |
| `route.nethttp@1` | Go | `facts/go-routes-env.scm` の `@route`（`HandleFunc` / `Handle`） | recv が `http`（`net/http` の import）か `http.NewServeMux()` の束縛 | Go 1.22 の `"GET /p"` は method を分離 |
| `route.gin@1` `route.echo@1` `route.chi@1` | Go | 同上（`GET`…`Any`・`Group`、chi の `Get`…`Route`・`Mount`） | `gin.Default()/New()`、`echo.New()`、`chi.NewRouter()/NewMux()` の束縛 or module の import | `Group`/`Route` は prefix |
| `route.axum@1` | Rust | `facts/rust-routes-env.scm` の `.route("<p>", get(h).post(h2))`・`.nest("<p>", r)` | `Router::new()` の連鎖 or `use axum` | 第 2 引数の `get\|post\|…` 呼び出し列から method |
| `route.actix@1` | Rust | `#[get("<p>")]` 等の attribute、`web::resource("<p>")`、`web::scope("<p>")`、`.route("<p>", web::get().to(h))` | `use actix_web` | attribute 形は直後の fn が handler |
| `cli.commander@1` `cli.yargs@1` | TS/JS | `@cli.call`（`.command("x")` `.option("-f, --flag")`） | 連鎖の根が `program` / `new Command(` / `yargs(` で、`commander` / `yargs` を import | command path、flags |
| `cli.cobra@1` | Go | `&cobra.Command{Use: "x …"}`、`<cmd>.Flags()/PersistentFlags().<T>Var[P](&v, "long", "s", …)`、`parent.AddCommand(child)` | `github.com/spf13/cobra` を import | `Use` の先頭語が名前 |
| `cli.urfave@1` | Go | `&cli.Command{Name: "x"}`、`cli.App{Name:}` | `urfave/cli` を import | — |
| `cli.goswitch@1` | Go | `switch os.Args[1] { case "x": }` | — | — |
| `cli.registry@1` | Go / TS / JS | `{name: "x", handler: fn}` 型の表（`facts/go-routes-env.scm` 末尾の pattern。キー名 `name\|Name\|Use\|command\|cmd` と関数値キー `handler\|Run\|RunE\|Action\|run\|fn`） | 同じ表に 3 要素以上 [仮] | crit の `commandRegistry` 型（24 候補 [実測]） |
| `cli.clap@1` | Rust | derive: `#[derive(Parser)]` の struct（`#[command(name = "x")]`）、`#[arg(long)]` field → `--field-name`、`#[derive(Subcommand)]` enum の variant → 子コマンド（kebab-case）。builder: `Command::new("x")`・`Arg::new("y").long("y")` | `use clap` | ripgrep は clap を使わず自前（lexopt）→ 0 件が正解 [実測] |
| `cli.click@1` `cli.typer@1` `cli.argparse@1` | Python | `@click.command()/group()`・`@<g>.command("x")`・`@click.option("--x")`、`typer.Typer()` + `@app.command()`、`ArgumentParser(prog=)`・`add_argument("--x")`・`add_parser("x")` | それぞれの import | 名前の既定は関数名（`_` → `-`） |
| `env.js@1` | TS/JS | `process.env.X`・`process.env["X"]`・`const {A, B} = process.env`・`import.meta.env.X`・`Bun.env.X`・`Deno.env.get("X")` | 名前が `^[A-Za-z_][A-Za-z0-9_]{0,127}$` | `hasDefault` = `??` / `\|\|` の右辺がある |
| `env.python@1` | Python | `os.environ["X"]`・`os.environ.get("X", d)`・`os.getenv("X", d)` | f-string（`interpolation` を含む string）は捨てる（fastapi の `fOTEL_{signal}_…` を除外 [実測]） | 第 2 引数があれば `hasDefault` |
| `env.go@1` | Go | `os.Getenv/LookupEnv("X")` | — | `LookupEnv` は false |
| `env.rust@1` | Rust | `std::env::var/var_os("X")`・`env!("X")`・`option_env!("X")`・clap の `#[arg(env = "X")]` | — | `.unwrap_or(…)` の連鎖で `hasDefault` |
| `env.files@1` | Dockerfile / compose / wrangler | `ENV X=` `ARG X`、compose の `environment:` のキー、wrangler の `[vars]` のキー | 名前のみ。値は読まない | — |
| `schema.sql@1` | `.sql` | `CREATE TABLE [IF NOT EXISTS] <name> (` から括弧の対応で列定義を取り、各行の先頭語を field（`PRIMARY` `CONSTRAINT` `UNIQUE` `FOREIGN` `CHECK` 行は除く）。`ALTER TABLE x ADD [COLUMN] y` を合流 | — | `source: "sql"`（wrangler の d1 migrations dir 内なら `"d1"`） |
| `schema.prisma@1` | `*.prisma` | `model <Name> {` の各行の先頭語（`@@` 行を除く） | — | `prisma` |
| `schema.drizzle@1` | TS | `pgTable\|sqliteTable\|mysqlTable("<name>", { col: … })` | `drizzle-orm` を import | entity = 第 1 引数、fields = object のキー |
| `schema.sqlalchemy@1` | Python | base が `Base` / `DeclarativeBase` / `db.Model` / `Model` の class で `__tablename__` か `Column(` / `mapped_column(` を持つ | `sqlalchemy` / `flask_sqlalchemy` を import | entity = `__tablename__` ?? class 名 |
| `schema.gorm@1` | Go | `gorm.Model` を埋め込む、または tag に `gorm:"` を持つ field がある struct | `gorm.io/gorm` を import | entity = struct 名（`TableName()` がリテラルを返せばそれ） |
| `schema.django@1` | Python | `class X(models.Model)` の field 代入 | `django` 依存 | — |
| `test.*@1` | 全言語 | §5.4 | — | `TestFact` |
| `script.npm@1` `script.make@1` `script.just@1` `script.nix@1` `script.deno@1` `script.py@1` `script.task@1` | 設定ファイル | §5.5 | — | `ScriptFact` |
| `dep.npm@1` `dep.go@1` `dep.py@1` `dep.cargo@1` | manifest | §5.5 | — | `DependencyFact` |
| `doc.existing@1` | docs | §5.6 | — | `ExistingDocFact` |
| `todo.comment@1` | comment ノード / generic はコメントらしい行 | `\b(TODO\|FIXME\|HACK\|XXX)\b[:(]?` | 大文字の語のみ。repo 全体で 2,000 件まで [仮] | `TodoFact`（本文 ≤ 120 文字） |

- **pattern の妥当性**（route 共通）: `/` か `*` で始まる、または Go 1.22 の `METHOD /…`、Django は相対。`http(s)://` で始まるものは捨てる。**連結と template**: 左端がリテラルの文字列連結（`"/"+f`）・置換を含む template（`` `/api/${v}` ``）は、リテラル部分 + `{…}` を pattern にして `dynamic: true` を付ける（主表では末尾に「動的」として出す）。同じ package の string 定数（Go の `const p = "/x"`、TS の `const P = "/x"`）を第 1 引数に渡した場合は値を展開する。
- **候補 query**（`docs/design/specs/indexer/queries/facts/*.scm`）はコーパスで compile と件数を確認した（`proto/ftest.mjs`）[実測]: crit（Go、`cmd/` `internal/` の test 以外 182 本）route はリテラル 60 + 連結 2（`"/"+f`。下記の連結規則で拾う）= 62（04 §4.2 と一致）、env 名 17（test を含めると `GO_TEST_*` などで 45）、registry 型 CLI 候補 24 ／ flask `src/` route 2・env 4・click 14、`tests/` route 328（test なので捨てる）／ fastapi `docs_src/` route 439（example scope）・本体 `fastapi/` 0 ／ ripgrep env 13・clap 0 ／ excalidraw env ts 15 + tsx 9（`import.meta.env.VITE_*` を含む。`git grep` の列挙では 23 種）／ react `packages/**/src` env 54。

### 5.3 候補 query の全文

`docs/design/specs/indexer/queries/facts/` の 4 ファイルが本文（js-routes-env.scm / py-routes-env.scm / go-routes-env.scm / rust-routes-env.scm）。代表として Go を示す。

```scheme
; <recv>.<Method>("<path>", ...): net/http HandleFunc/Handle, gin/echo GET.., chi Get.., Group/Route/Mount
(call_expression
  function: (selector_expression operand: (_) @route.recv field: (field_identifier) @route.method)
  arguments: (argument_list . (interpreted_string_literal) @route.path)
  (#match? @route.method "^(HandleFunc|Handle|GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS|Any|Get|Post|Put|Patch|Delete|Head|Options|Group|Route|Mount|Method|MethodFunc)$")) @route
; env
(call_expression function: (selector_expression operand: (identifier) @_os field: (field_identifier) @_f) arguments: (argument_list . (interpreted_string_literal) @env.name)
  (#eq? @_os "os") (#match? @_f "^(Getenv|LookupEnv|Setenv|Unsetenv)$"))
; cobra: &cobra.Command{Use: "x"}
(composite_literal type: (qualified_type package: (package_identifier) @_c name: (type_identifier) @_t)
  body: (literal_value (keyed_element (literal_element (identifier) @_k) (literal_element (interpreted_string_literal) @cli.use)))
  (#eq? @_c "cobra") (#eq? @_t "Command") (#eq? @_k "Use"))
; switch os.Args[1] { case "x": }
(expression_switch_statement value: (index_expression operand: (selector_expression operand: (identifier) @_os field: (field_identifier) @_a))
  (expression_case value: (expression_list (interpreted_string_literal) @cli.case))
  (#eq? @_os "os") (#eq? @_a "Args"))
; tests
(function_declaration name: (identifier) @test.name (#match? @test.name "^(Test|Benchmark|Fuzz|Example)[A-Z_0-9]"))
; entry
(function_declaration name: (identifier) @entry.main (#eq? @entry.main "main"))
; command-registry tables: {name: "x", handler: fn} / {Name: "x", Action: fn}
(literal_value
  (keyed_element (literal_element (identifier) @_k) (literal_element (interpreted_string_literal) @cli.reg))
  (keyed_element (literal_element (identifier) @_h) (literal_element (identifier)))
  (#match? @_k "^(name|Name|Use|command|Command|cmd)$") (#match? @_h "^(handler|Handler|Run|RunE|Action|action|run|fn|Fn)$"))
```

### 5.4 test 名と subject の対応

- **test case**（`TestFact.name`）:
  - Go: `func (Test|Benchmark|Fuzz|Example)[A-Z_0-9]…`。`t.Run("sub", …)` は `親/sub`。
  - Python: `def test_*`、`class Test*` 内の `test_*` メソッド（`TestFoo::test_bar`）。
  - JS/TS: `describe` / `it` / `test`（`.only` `.skip` `.each` `.concurrent` を含む）、`Deno.test("x")`、`bench("x")` の第 1 引数の文字列リテラル。`describe` の入れ子は ` › ` で連結。
  - Rust: `#[test]` `#[tokio::test]` `#[rstest]` が付いた fn（`mod tests` の中なら `tests::name`）。
- **ファイル → subject（`TestMapping.subjects`）**、順に試して最初に当たったもの:
  1. 命名規約: `foo_test.go → foo.go`（同ディレクトリ）、`test_foo.py` / `foo_test.py → foo.py`（同ディレクトリ → 並行 src 木で basename が一意に一致するもの）、`foo.test.ts` / `foo.spec.tsx → foo.ts|tsx|js|jsx`、`__tests__/foo.test.ts → ../foo.*`、Rust の inline `mod tests` → 同じファイル、`tests/foo.rs` → crate の lib root。
  2. import 証拠: test ファイルが解決した import のうち、test/fixture でない repo ファイルを「参照した名前の数 × idf」で並べた先頭（1 位と 2 位の比が 1.5 未満なら 2 位まで）。
  3. それ以外: subject なし。
- **symbol subject（`TestFact.subject`）**: test 名から接頭辞（`Test` `Benchmark` `test_`）を外し、`_` / camel 境界で分けた候補（`TestFoo_Bar → Foo.Bar, Foo, FooBar`、`test_parse_args_empty → parse_args_empty, parse_args, parse`、`describe("Foo")` の文字列）を、subject ファイルの symbol の name / qualname と大小文字無視で完全一致させる。最長一致を採り、無ければ付けない。
- module への所属: test ファイルは subject ファイルの leaf module のメンバーにする（clustering の後）。subject が無ければ import の多数決、それも無ければ同じディレクトリの module。

### 5.5 config / script / dependency

- **`ConfigEntry`**（indexer.ts）`{ path, tool, role }`: tool ∈ `npm tsconfig deno bun biome eslint prettier vite vitest jest webpack rollup babel next nuxt svelte astro tailwind postcss wrangler vercel netlify docker compose make just task nix pyproject setuptools tox pytest mypy ruff flake8 pip pipenv conda gomod gowork cargo rust-toolchain gemfile maven gradle git editor version-pin ci other`、role ∈ `build deps lint format test typecheck deploy runtime ci editor other`。basename と内容の簡単なキーで決める（例: `vite.config.ts` → vite/build、`.nvmrc` → version-pin/runtime）。core に `config` fact を足す要求は CR-4（採用までは `Indexer.configs()` で返す）。
- **script**: `script.npm@1` = package.json `scripts`。purpose は名前で `^(build|compile|bundle)` → build、`^(start|dev|serve|preview|watch)` → run、`^(test|e2e|coverage|spec)` → test、`lint` → lint、`^(fmt|format|prettier)` → format、`^(typecheck|tsc|check-types|types)` → typecheck、他 other。`script.make@1` = `^([A-Za-z0-9][A-Za-z0-9_.\-/]*)\s*:(?![=:])`（`.PHONY`・`%` を含む pattern rule・`$(` 始まりを除く）、command = 直後の tab 行の 1 行目。`script.just@1` = インデントなしの `^@?([A-Za-z0-9_-]+)(\s+[^:=]*)?:(?!=)`（`set` `alias` `export` `import` `mod` 行を除く）。`script.nix@1` = flake.nix の `apps.<sys>.<name>`・`apps = { <name> = …`・`devShells`・`packages` の名前（command は `nix run .#<name>` / `nix develop`）。`script.deno@1` = deno.json `tasks`。`script.py@1` = `[tool.poe.tasks]`・`[tool.pdm.scripts]`・`[tool.hatch.envs.*.scripts]`。`script.task@1` = Taskfile.yml `tasks`。command は表示専用（trust 無しに実行しない、core の ScriptFact の注記どおり）。
- **dependency**: package.json の `dependencies` / `devDependencies`（dev）/ `peerDependencies` / `optionalDependencies`、go.mod の `require`（`// indirect` は除く）、pyproject `[project.dependencies]`・`[project.optional-dependencies]`（dev 扱い: `dev|test|lint|docs` グループ）・`[tool.poetry.*dependencies]`・`requirements*.txt`（`requirements-dev.txt` は dev）、Cargo の `[dependencies]` / `[dev-dependencies]`（dev）/ `[build-dependencies]`、workspace 継承（`x.workspace = true`）はルートの版を引く。`used` = その依存を import したファイル数（§4 の external 名と照合）。

### 5.6 既存ドキュメントと TODO

- role: `README*` → readme、`AGENTS.md` → agents、`CLAUDE.md` → claude（どのディレクトリでも）、`docs/adr/**`・`docs/decisions/**`・`adr/**`・`doc/adr/**` → adr、`CONTRIBUTING*` → contributing、`ARCHITECTURE*`・`docs/architecture*`・`DESIGN*` → architecture、他の docs → other。title = 最初の ATX / setext 見出し、無ければファイル名。`.claude/**` 配下（`CLAUDE.md` の派生 rule 群）は deny glob なので**読まない**。
- 見出しの一覧（≤ 30 / doc）は `idx_doc_headings` に持ち、repo pack の DOCS と検索に使う。

### 5.7 精度の目標と測り方

| kind | precision 目標 | recall 目標 | 根拠となる正解集合 |
|---|---|---|---|
| route（main scope） | ≥ 0.95 | ≥ 0.90 | crit ≥ 62（04 §4.2）。flask `examples/`、fastapi `docs_src/`（example scope の検出器単体試験として）、hono `src/**`（test を除いた本体の route 定義 0 件が正）、自作 fixture（express・hono・fastify・next app/pages・fastapi・flask・django・net/http・gin・echo・chi・axum・actix 各 10 route 以上） |
| cli | ≥ 0.95（registry 型は ≥ 0.85 [仮]） | ≥ 0.85 | crit（registry + switch）、flask の click、fixture（commander・yargs・cobra・urfave・clap derive/builder・click・typer・argparse） |
| env | ≥ 0.98 | ≥ 0.90 | crit 17（test 除く）、ripgrep 13、excalidraw 23、react 54（`packages/**/src`）を `git grep` の正規表現列挙と突き合わせて人手確認 |
| schema | ≥ 0.95 | ≥ 0.90 | fixture（sql・d1・prisma・drizzle・sqlalchemy・gorm・django） |
| entry / script / dependency | ≥ 0.98 | ≥ 0.95 | 各 repo の manifest を人手で列挙 |
| test 名 | ≥ 0.99 | ≥ 0.95 | `git grep` での列挙（`func Test`・`def test_`・`it(`/`test(`・`#[test]`） |
| test → subject（ファイル） | ≥ 0.90（出したもの） | ≥ 0.70 | crit・flask・hono・ripgrep で 50 本ずつ人手ラベル |
| generated header | ≥ 0.98 | — | コーパスの一致を全件人手確認（現状 3/3 正解 [実測]） |

- 手順（`eval/facts/`）: (1) 各 repo を `corpus.lock`（§11.1）の commit に固定、(2) 検出器を流して `fixtures/facts-golden/<repo>/<kind>.jsonl` と比較、(3) golden は初回に人手で作る: 出力が 200 件以下なら全件、超えれば seed 固定の無作為 100 件に TP/FP を付け、recall 用には `git grep -nE` の正規表現列挙（候補を広く拾う）から人手で正解集合を作る、(4) precision・recall を `bench/budgets.json` の `idx.facts.*` と比較し、目標未満は CI fail。
- 検出器の版（`@1`）を上げたら golden を再確認する（差分だけ人手で見る）。

---

## 6. S3 structure

### 6.1 graph

- **ノード** = included の `source` ファイル（scope main / example / tooling。test・docs・config は入れない。`*.config.ts` も入れない）。ノード重み `s(v) = max(1, LOC(v))`。
- **有向 edge**（PageRank・SCC・digest 用）: `import`（解決済み import 文 1 本 = 1.0。同じ (f, g) は 1 本に畳む。barrel の re-export は 0.5）、`ref`（§4.6、≤ 0.5）、Go 同一 package の `ref`（≤ 0.8）。
- **無向化**（clustering 用）: `w(u, v) = w(u→v) + w(v→u)`。
- **directory prior**（clustering 用、`same_dir`）: 同じディレクトリの兄弟ファイル間に、各ノードの prior 強度の合計が 0.2 になるよう edge を張る。兄弟 n ≤ 30 なら完全グラフで 1 本 `0.2/(n−1)`、n > 30 なら path 昇順の環で前後 2 本ずつ（計 4 本）に `0.05`。prior は graph に混ぜるが PageRank・SCC・digest には使わない。
- **edge の有効閾値**: module 間の依存（§6.5・§6.7）に使うのは module 間の合計重みが ≥ 1.0 のものだけ（名前参照の雑音を落とす）[仮]。

### 6.2 Leiden（自前、directory prior 付き。O4 の決定）

**決定**: `ngraph.leiden@0.3.0` は使わない。README（npm registry、2026-06-02 版）の options は `quality` `resolution` `directed` `randomSeed` `candidateStrategy` `allowNewCommunity` `maxCommunitySize` `refine` `fixedNodes` `preserveLabels` `linkWeight` `nodeSize` `maxLevels` `maxLocalPasses` で、**初期 membership を与える手段が無い**（`fixedNodes` は「初期 community に留める」だけで、初期 community 自体は与えられない）[実測]。directory prior は multilayer の弱い層で近似できるが、本書が要求する「前回の membership からの warm start」（§6.6 の ID 安定性の前提）が書けない。自前実装は ≈ 400 行（local moving / refinement / aggregation）で、`ngraph.leiden` は dev 依存として品質比較のベンチ（同じ graph の modularity が −0.01 以内）にだけ使う。

**目的関数**: resolution γ 付き modularity。`Q_γ = (1/2m) Σ_ij [A_ij − γ·k_i·k_j/(2m)]·δ(c_i, c_j)`。node v を community A から B に動かす利得:

```
ΔQ(v: A→B) = [ k_{v,B} − k_{v,A∖v} ] / m  −  γ · k_v · (K_B − K_{A∖v}) / (2m²)
  k_{v,X} = v と X の間の edge 重みの和、K_X = X の次数和、m = 全 edge 重みの和
```

**アルゴリズム**（乱数を使わない決定的版）:

```
input  G(V, E, w), s(v), 初期 partition P0, γ, ε(v), maxLOC = 9000
order  V を xxh3("ord|" + path) 昇順に固定（疑似乱数だが決定的）
repeat (level ≤ 10):
  P ← FastLocalMove(G, P)          # queue に V を order 順で入れる。v を取り出し、隣接 community の中で
                                   # ΔQ が最大の B へ動かす（ΔQ > ε(v) かつ LOC(B ∪ v) ≤ maxLOC のときだけ）。
                                   # 動いたら v の隣接ノードのうち新 community に属さないものを queue に戻す。
                                   # 同点は B に属するノードの最小 order。
  if P が変化しない: break
  R ← Refine(G, P)                 # P の各 community C の中で singleton から始め、order 順に v を見て
                                   # 「C の中でよく繋がっている」(k_{v,C∖v} ≥ γ·k_v·(K_C − k_v)/(2m)) v だけを、
                                   # ΔQ ≥ 0 が最大の部分 community T ⊆ C（T も well-connected）に併合。
                                   # 同点は T の最小 order。→ 各 community の連結性を保証（Louvain の欠点を避ける）
  G ← Aggregate(G, R);  P ← R の各ノードを P の community で束ねた partition（aggregate の初期 partition）
until 変化なし
return flatten(P)
```

- **初期 partition P0**: (a) 前回の scan で leaf module に属していたファイルは、その module が今も alive ならその module、(b) それ以外（新規ファイル・初回）は `DirPartition`（下記）。
- **hysteresis ε(v)**: v が P0 の community に留まっている間は `ε = 1e-4` [仮]、それ以外 0。小さな編集で membership が揺れるのを止める（§6.6 の安定性試験で調整）。
- **`DirPartition`**（初期値と、graph がほぼ空のときの代替）:

```
visit(d):
  if LOC(subtree d) ≤ 6000 or d に子ディレクトリが無い: group(subtree d のファイル全部); return
  for c in 子ディレクトリ（名前順）: visit(c)
  direct = d 直下のファイル
  if LOC(direct) ≥ 2000: group(direct)
  else if direct が空でない: direct を d の下で作った group のうち LOC 最小のものに合流（無ければ group(direct)）
visit(repo root)
```

- **γ の決め方**: `log γ ∈ [log 0.05, log 20]` で最大 8 回の二分探索。評価値 = leaf LOC の中央値。中央値 ∈ [2,000, 6,000] かつ leaf の 80% 以上が [1,000, 9,000] に入る γ のうち、`|log(中央値/4,000)|` 最小のものを採る [仮]。採った γ は `idx_meta.leiden_gamma` に保存し、次回は 1 回目にその γ を使う（制約を満たせば探索しない）。
- **計算量**: 1 回の実行は O(|E| × pass 数)。10k ノード・10 万 edge で ≤ 15 ms × 8 回 [仮]（§11.4 で測る）。
- **浮動小数の決定性**（マシン間で同じ結果にするため。IDX-AT-30）: `Math.log` `Math.exp` `Math.pow` は JS エンジン・OS 間で最後の 1 ulp が違いうる。edge 重み・idf・personalization・γ は計算直後に `q(x) = Math.round(x · 2^20) / 2^20` で量子化してから使い、ΔQ の比較は `|ΔQ_a − ΔQ_b| ≤ 1e-12` を同点として order で決める。加算の順序は常に order（または path）昇順に固定する（並列化しない）。

### 6.3 サイズ・後処理・階層

1. **分割**: leaf の LOC > 9,000（= 6k × 1.5）または sig skeleton の推定 > 24k token なら、その誘導部分 graph で γ' = 2γ の Leiden を再実行（最大 4 回）。1 ファイルで 9,000 LOC を超えるものはそれ単独の leaf にし `oversizeFile` を付ける（gen が symbol cluster 単位で分ける。04 §12-7）。
2. **併合**: leaf の LOC < 2,000 なら、`接続重み / sqrt(LOC_相手)` が最大の隣接 leaf に併合する（併合後 ≤ 9,000 のときだけ。同点は同じ親ディレクトリ → 小さい LOC → 小さい module key）。隣接が無い孤立 leaf は、dominant dir が最も近い（共通接頭辞が最長の）leaf に併合。repo 全体の LOC < 2,000 なら module は 1 つ。
3. **test ファイルの所属**: §5.4 の規則で subject の module に入れる（clustering には影響しない）。
4. **dominant dir**: member の LOC の 60% 以上を含む最も深いディレクトリ。無ければ共通接頭辞（ルートなら `.`）。
5. **crossCutting**: member の LOC が 2 つ以上の深さ 1 ディレクトリにまたがり、かつどの深さ 2 ディレクトリも LOC の 60% 未満 [仮]。
6. **階層**: leaf 数 N ≤ 10 なら親を作らない。N > 10 なら leaf を node とする module graph（leaf 間の重みの和）で、初期 partition = 「leaf の dominant dir の深さ 1 ディレクトリ」で束ねたもの、γ を「親の数 ≈ ceil(N/10)、fan-out ∈ [5, 15]」になるよう探索して親を作る。親が 10 を超えればもう 1 段（祖父）。**深さは leaf を含めて ≤ 3**（5M LOC ≈ 1,250 leaf → 125 → 13 で収まる。04 §4.1）。親の ID・slug も §6.6 と同じ照合で安定化する（照合は子 leaf の LOC 加重）。

### 6.4 PageRank

- file 単位、有向 graph（importer → importee、referrer → definer）、`α = 0.85`、反復は L1 差 < 1e-6 か 100 回。dangling（出 edge 無し）の質量は personalization に戻す。
- **personalization** p: 基本 1、`entry` の定義ファイル ×5、route の handler ファイル ×3、CLI fact のファイル ×3、exported symbol ≥ 5 のファイル ×1.5、scope example ×0.3、tooling ×0.5 を掛けて正規化 [仮]。
- module の `rank` = member の rank の和を leaf の最大値で割った [0,1]（2 桁に丸めて保存。pack のバイト安定のため）。親は子の和を同様に正規化。
- 確認項目（§11.4）: crit で上位 10 に `integrations/embed.go`・`web/embed.go` が入らない。

### 6.5 Tarjan SCC と topological order

- module 依存の有向 graph: leaf A → B（A のファイルが B のファイルに依存）で、A→B の重み和 ≥ 1.0。
- Tarjan は**反復版**（再帰しない。1,250 node でもスタック溢れなし）。SCC を縮約した DAG を「依存先が先」（bottom-up）に並べる Kahn 法、同順位は `(rank desc, slug asc)`。SCC 内は `rank desc, slug asc`。`ModuleInfo.topoOrder` = この順番（0 起点）。
- 2 つ以上の module からなる SCC は `StructureInfo.cycles` に出す（§11 リスクの素材。gen の §11「リスクと負債」用）。

### 6.6 module ID と slug の安定化（設計書の安定性の要）

**要件**: (1) 同じ snapshot と同じ前状態からは、どのマシンでも同じ membership・ID・slug、(2) 小さな変更（数ファイル）で ID・slug が変わらない、(3) slug は `doc/modules/<slug>.md` のファイル名なので**生存中の ID の slug は変えない**、(4) commit 済みの設計書を別マシンで開いたとき、前のマシンと同じ ID に戻れる。

**照合**（Leiden の結果 → 前回の alive な module）:

```
cand = { (new c, old o) : c ∩ o ≠ ∅ }
J(c, o) = LOC(c ∩ o) / LOC(c ∪ o)            # LOC 加重 Jaccard（test 以外の member で計算）
cand を (J desc, o.id asc, c.anchor asc) で並べ、greedy に 1 対 1 で確定（J ≥ 0.5 のものだけ）
確定した c は o の id・slug・name を継ぐ
```

- 照合できなかった新 community c: `id = "md_" + base32(xxh3("md|" + anchor(c) + "|" + k))[0:8]`。`anchor(c)` = c の member のうち PageRank 最大（同点は path 昇順で最小）、`k` は衝突時に 0,1,2…（alive・tombstone の両方と衝突させない）。
- 照合できなかった旧 module は **tombstone**（`alive = 0`、90 日保持 [仮]）。後の scan で J ≥ 0.5 の community が現れたら同じ ID で復活させる（振動しても設計書のファイルが入れ替わらない）。
- 分割の系譜: 旧 o と J ≥ 0.3 で重なるが別の c に o を取られた community は `lineage.splitFrom = o.id` を持つ（doc の「この章は X から分かれました」用）。
- **seed（初回マシン）**: `idx_modules` が空で、server が `ModuleSeed[]`（commit 済み `doc.index.json` の `modules[]` から: `id`, `slug`, `name`, `parent?`, `reps`（代表 path ≤ 32））を渡したとき、seed を「前回の module」とみなし、J の代わりに `hit(c, s) = |s.reps ∩ c| / |s.reps ∩ 現存 path|` で同じ greedy 照合（hit ≥ 0.5）を行う。`reps` は各 module の member を PageRank 降順に最大 32 本（path 昇順で保存）。**`DocIndex.modules[]` に `reps` を足す要求が CR-1**。
- **slug**: 誕生時に 1 回だけ決める。`base` = dominant dir の segment から `NOISE_SEGMENTS`（`src` `lib` `pkg` `packages` `crates` `app` を除く…ただし除くと空になるなら残す）を除いた末尾 3 segment を `-` で連結。dominant dir がルートなら anchor ファイルの stem。slugify = NFKC → 小文字 → `[^a-z0-9]+` を `-` → 前後の `-` を除く → 48 文字で切る。他の alive / tombstone の slug と衝突したら `-2` `-3`…。repo settings の `modules[<prefix>].slug` があればそれを優先（衝突時は設定エラーの notice）。
- **name**: `dominant dir`（crossCutting は `dirA + dirB`）。代表 symbol（module 内で fan-in 最大の exported symbol）を ` · ` で添える（例 `internal/session · Session`）。repo settings の `modules[<prefix>].name` が優先。gen は doc の中で日本語名に置き換えてよい（ID と slug は変わらない）。
- `mergeInto`（repo settings）: その prefix の全ファイルを指定 path を含む module に固定し、Leiden ではその ファイル群を 1 ノードに縮約して扱う。

### 6.7 digest（早期打ち切りの鍵）

| digest | 定義（xxh3、行は `\n` 区切りで昇順ソート） | 用途 |
|---|---|---|
| `membersDigest` | 非 test member の path | membership 変化 |
| `ifaceDigest` | `"iface/1"` + `S <path>#<qualname> <sigHash>`（member の exported symbol）+ `O <dst module id>`（有効閾値を超えた出 edge）+ `I <src module id>`（入 edge） | module ページの再生成判断（gen S9） |
| `bodyDigest` | `B <path>#<qualname> <bodyHash>`（全 symbol） | body だけの変化の検出 |
| `factsDigest` | member にある fact の正規化行（kind・detector・値。行番号は**含めない**） | overview / 表の再生成判断 |
| `testsDigest` | member の test 名 | 「テスト」節の鮮度 |

入出 edge は存在だけを入れる（重みの揺れで digest を変えない）。

### 6.8 増分時の構造の扱い

- `update()` 1 回ごと: 変更ファイルの import を再解決（`idx_unresolved` の spec も、新規ファイルが解決先になりうるので再試行）、そのファイルの edge を差し替え、**新規ファイル**は「解決済み隣接ファイルの module の重み付き多数決 → 無ければ同じディレクトリの module → 無ければ DirPartition の group」に入れ、**削除**は member から外す。触れた module の digest を再計算。PageRank と Leiden は回さない。
- **構造リフレッシュ**: 最後の `update()` から 2 s 静穏 [仮] で、PageRank と rank を再計算し、次のどれかなら Leiden を warm start で再実行して §6.6 の照合をかける: 前回の Leiden 以後に変わったファイルが全体の 10% 超、size 範囲（2k〜9k LOC）を外れた leaf がある、`scan({force})`。結果に差があれば `map.updated`。
- warm な `scan()`（起動時など）で `indexDigest` と `settingsDigest` と構造版が前回と同じなら、`idx_modules` をそのまま読み S3 を飛ばす。

---

## 7. S4 context packing

### 7.1 skeleton の 3 段（byte 単位の規則）

共通: 改行は `\n`、各ファイル block の末尾にも `\n`。**全行が `=== `・`<数字>|`・`⋮`・`> ` のどれかで始まる**（gen spec §5.1-5 の DATA 行プレフィックス規則と同じ。gen が `> ` を二重に付けずに済む: gen 依頼 I1）。行番号は `N|`（左詰め、桁揃えしない。揃えると token が増える）。元の行は**そのまま**（TAB も残す）。空行・閉じ括弧だけの行（`}` `)` `]` と末尾の `;` `,`）・コメントだけの行（`sig` のみ）は出さない。`⋮`（U+22EE、単独行、行番号なし）は**本体を省いた**位置だけに置く（行番号の飛びで省略は分かるので、それ以外の省略には置かない）。

| tier | 出すもの | 行番号 | citation に使えるか |
|---|---|---|---|
| `l0` | header `=== <path> · <lang> · <lines> lines` と、exported な top-level symbol（と exported な型のメソッド）の signature を 1 行ずつ `> <sig>`（メソッドは `>   <sig>`。120 文字で切る）。非 exported の数を `> …+<k> private` | なし | × |
| `sig` | header 行 `=== <path> · <lang> · <lines> lines[ · imports: <spec>…] ===`（import は書かれた spec を出現順・重複除去で 12 個まで、超えたら ` +<k>`）。Go は `package` 行。各 symbol を source 順に: **呼び出し可能なもの**（function / method / constructor / test）は開始行から body 開始行まで（≤ 8 行、Python は decorator を含む）を出し、body が別の行に続くなら `⋮`。**型のようなもの**（struct / interface / enum / type / trait / class の field 宣言）は全行（≤ 60 行。超えたら `⋮ +<k> lines`）。class / impl / trait は開始行から body 開始行まで出し、member を同じ規則で続ける。関数の中の定義は出さない。const / var は開始行だけ（複数行なら `⋮`） | あり | ○ |
| `doc` | `sig` に加え、各 symbol の直前に doc の行（`docStart..docEnd`、≤ 12 行、超えたら `⋮`）。Python の docstring は def 行の直後に（≤ 12 行）。ファイル先頭の module doc（Go の package コメント、Rust `//!`、Python の module docstring）は header の直後 | あり | ○ |

- **Go の単一 spec 宣言**: `type X struct {…}` のように `type_declaration` / `const_declaration` / `var_declaration` が spec を 1 個だけ持つときは、親の宣言ノードを定義ノードとして扱う（`type` キーワードと直前の doc comment を範囲に含めるため）。複数 spec の `type ( … )` は spec ごとに定義ノードにし、signature に `type ` を前置する。（試作で `l0` が `DiffEntry struct` になり doc を落とした不具合から決めた規則。）
- **範囲外の情報を出さない**: skeleton はファイルの原文の部分集合で、mitori が作った文字列は header 行・`⋮` 行・`…+k private` 行だけ。

#### 7.1.1 例（golden。`docs/design/specs/indexer/golden/crit.internal-diff-diff.go.*.txt` とバイト一致）

対象: crit `internal/diff/diff.go`（337 行・9,550 byte）。`l0` 354 byte、`sig` 1,643 byte、`doc` 3,791 byte。

`l0`:

```text
=== internal/diff/diff.go · go · 337 lines
> type DiffEntry struct
> type DiffHunk struct
> type DiffLine struct
> func ComputeLineDiff(oldContent, newContent string) []DiffEntry
> func MapOldLineToNew(entries []DiffEntry) map[int]int
> func DiffEntriesToHunks(entries []DiffEntry) []DiffHunk
> func SplitLines(content string) []string
> …+9 private
```

`sig`（全文）:

```text
=== internal/diff/diff.go · go · 337 lines · imports: fmt strings ===
1|package diff
9|type DiffEntry struct {
10|	Type    string `json:"type"`               // "unchanged", "added", or "removed"
11|	OldLine int    `json:"old_line,omitempty"` // 1-based line number in old content (0 if added)
12|	NewLine int    `json:"new_line,omitempty"` // 1-based line number in new content (0 if removed)
13|	Text    string `json:"text"`
17|type DiffHunk struct {
18|	OldStart int
19|	OldCount int
20|	NewStart int
21|	NewCount int
22|	Header   string // the @@ line text
23|	Lines    []DiffLine
27|type DiffLine struct {
28|	Type    string // "context", "add", "del"
29|	Content string
30|	OldNum  int // 0 if add
31|	NewNum  int // 0 if del
37|func ComputeLineDiff(oldContent, newContent string) []DiffEntry {
⋮
46|func hirschbergDiff(old, new []string, oldOff, newOff int) []DiffEntry {
⋮
86|func diffSingleOld(oldLine string, new []string, oldOff, newOff int) []DiffEntry {
⋮
118|func allAdded(lines []string, offset int) []DiffEntry {
⋮
127|func allRemoved(lines []string, offset int) []DiffEntry {
⋮
137|func lcsForwardRow(old, new []string) []int {
⋮
165|func lcsBackwardRow(old, new []string) []int {
⋮
192|func MapOldLineToNew(entries []DiffEntry) map[int]int {
⋮
236|func groupChangedIndices(changedIndices []int, contextLines int) [][2]int {
⋮
251|func entryToDiffLine(e DiffEntry) (DiffLine, int, int) {
⋮
264|func buildHunkFromGroup(entries []DiffEntry, gStart, gEnd, contextLines int) DiffHunk {
⋮
305|func DiffEntriesToHunks(entries []DiffEntry) []DiffHunk {
⋮
332|func SplitLines(content string) []string {
⋮
```

`doc`（先頭 30 行）:

```text
=== internal/diff/diff.go · go · 337 lines · imports: fmt strings ===
1|package diff
8|// DiffEntry represents a single line in the diff output.
9|type DiffEntry struct {
10|	Type    string `json:"type"`               // "unchanged", "added", or "removed"
11|	OldLine int    `json:"old_line,omitempty"` // 1-based line number in old content (0 if added)
12|	NewLine int    `json:"new_line,omitempty"` // 1-based line number in new content (0 if removed)
13|	Text    string `json:"text"`
16|// DiffHunk represents a single hunk in a unified diff.
17|type DiffHunk struct {
18|	OldStart int
19|	OldCount int
20|	NewStart int
21|	NewCount int
22|	Header   string // the @@ line text
23|	Lines    []DiffLine
26|// DiffLine represents a single line within a diff hunk.
27|type DiffLine struct {
28|	Type    string // "context", "add", "del"
29|	Content string
30|	OldNum  int // 0 if add
31|	NewNum  int // 0 if del
34|// ComputeLineDiff computes a line-level diff between oldContent and newContent
35|// using Hirschberg's algorithm (divide-and-conquer LCS in O(n) space).
36|// Each line is classified as "unchanged", "added", or "removed".
37|func ComputeLineDiff(oldContent, newContent string) []DiffEntry {
⋮
43|// hirschbergDiff computes the diff between old[0:len(old)] and new[0:len(new)]
44|// using Hirschberg's divide-and-conquer algorithm. oldOff and newOff are the
45|// 0-based offsets into the original arrays, used to compute 1-based line numbers.
```

#### 7.1.2 大きさ [実測 `proto/skelbatch.mjs`]

crit の Go（`cmd/` `internal/` の test 以外 182 本、1.45M 文字）: `sig` = full の **0.204**（行番号付き full 比 0.180）、`doc` = 0.398、`l0` = 0.047（≈ 21 倍圧縮、≈ 29.7k token）。04 §2.3 の sig-only 0.136（comment 除去、JS を含む全 code）より大きいのは、struct field の行と行末コメントを残すため（行末コメントを落としても 0.199 にしか下がらなかったので、原文そのままの規則を採る）。leaf（2〜6k LOC ≈ 76〜228k 文字）の `sig` は ≈ 6.6k〜20k token で、24k の上限に収まる。

### 7.2 module 入力（`moduleContext()`）

gen の S5 が 1 module の入力として使う部品を indexer が決定的に作る（prompt の組み立ては gen）。

```
ModuleContext {
  module: ModuleInfo
  skeleton: Skeleton        # tier sig（既定）。予算超過時は下の縮退
  hot: CodeSlice[]          # §7.3。hot の合計 ≤ 0.25 × (skeleton + hot + tests + facts)
  tests: string             # "T <path>: <name>; <name>; …"（1 ファイル 1 行、≤ 1.5k token）
  facts: string             # この module の fact を repo pack と同じ行形式で（≤ 1k token）
  neighbors: string         # "U <slug> <id>"（使う module）/ "B <slug> <id>"（使われる module）各 ≤ 10
  tokens: { skeleton, hot, tests, facts, neighbors, total }
  key: Xxh3                 # = xxh3(packKey + module id + tier + budget)
}
```

- **縮退**（`skeleton` が `budget × 0.75` を超えるとき、この順に止まるまで）: (1) 非 exported member の field 行を落とす、(2) 非 exported の型の field 行を落とす、(3) rank の低いファイルから順に、その block を `=== <path> (<n> declarations not shown)` の 1 行に畳む（gen 依頼 I2 の書式）。`Skeleton.perFile` にファイルごとの token 数と畳んだかどうかを返す（gen が自分で畳み直せる）。
- `hot` の予算 = `min(caller の指定, floor((skeleton + tests + facts) / 3))`（= module 入力の 25% 以内。§7.3）。

### 7.3 hot bodies の選び方

- 候補: member の非 test ファイルの function / method / constructor で、body が 2 行以上のもの。
- 点数（すべて module 内で [0,1] に正規化）:

```
score(s) = 0.30·pr(s) + 0.25·reach(s) + 0.25·fanin(s) + 0.20·cx(s)
  pr(s)    = ファイル PageRank ÷ module 内最大 × (exported ? 1.0 : 0.7)
  reach(s) = 1.0  … route / CLI の handler、main、test の subject symbol
             0.6  … 上の symbol から名前参照の call で 2 hop 以内
             0    … それ以外
  fanin(s) = log1p(s を参照する解決済みファイル数) ÷ log1p(module 内最大)
  cx(s)    = log1p(complexity) ÷ log1p(module 内最大)
```

- 選択: score 降順（同点は SymbolKey 昇順）に、行番号付きの全範囲（signature を含む `start..end`。200 行を超える body は先頭 80 行 + `⋮`）を予算に入る限り足す。入らない候補は飛ばし、連続 3 回飛ばしたら終了 [仮]。同じファイルで隣接・重複する slice は 1 つに結合。
- 出力は `CodeSlice`（`numbered: true`）。重みは [仮] で、eval の「hot あり / なしの claim S 率と citation L1」で調整する（gen spec の O2 と同じ実測で測る）。

### 7.4 repo pack（`mitori.repopack/1`）

gen が claude-cli の `--system-prompt-file`（プロセスをまたいで共有される唯一の cache 点）や API の BP2 に入れる、repo 全体の共有 prefix。**同じ `packKey` なら同じバイト**。

```text
=== mitori.repopack/1 repo=crit digest=3f9a2c1d0b7e4a55 files=287 loc=72614 langs=go:61,javascript:24,typescript:15
=== MODULES 34
> M internal-session md_k3f9a2cq loc=4120 rank=1.00 files=12 topo=17 dir=internal/session → internal-config,internal-review
> M internal-server md_9x1c0d7m loc=5810 rank=0.93 files=9 topo=21 dir=internal/server → internal-session,internal-share
>   …
=== ENTRY 4
> E main cmd/crit cmd/crit/main.go:21
=== ROUTES 40/62
> R GET /api/comments internal/server/server.go:180 h=Server.handleComments fw=net/http
> R POST /api/share internal/server/server.go:175 h=Server.handleShare fw=net/http
>   …
> R ANY /{…} internal/server/server.go:151 dynamic fw=net/http
=== CLI 24/24
> C crit review cmd/crit/cli_dispatch.go:190 fw=registry
=== ENV 17/17
> V CRIT_HOST internal/config/config.go:44
> V CRIT_PORT default internal/config/config.go:47
=== SCHEMA 0
=== SCRIPTS 6
> S build build "go build ./cmd/crit" Makefile:3
=== DEPS 12/31
> P go github.com/fsnotify/fsnotify v1.9.0 used=3
=== MAP 141/287
> F internal/diff/diff.go md_2b7k0sqe
>   type DiffEntry struct
>   func ComputeLineDiff(oldContent, newContent string) []DiffEntry
>   …+9 private
=== TERMS 40
> G Session struct internal/session/session.go refs=41
=== DOCS 5
> H README.md readme "Crit"
>   - Install
>   - How it works
> H CLAUDE.md claude "crit — Claude Code guide"
```

（上は形を示す例。値は実データではない。golden は `fixtures/golden/repopack/<repo>.txt` で持つ。）

- **全行が `=== `（見出し）か `> `（項目）で始まる**（gen spec §5.1-5 の行プレフィックス規則。gen 依頼 I1）。項目はさらに `> <大文字 1 字><空白>` のタグで種類を示し、子の行は `>   `（`> ` + 2 空白）。データ由来の値は見出し名・タグより後ろにしか来ないので、DATA fence の中でもデータ行が指示行・fence 行（`<<<`）に見えない（ARCHITECTURE §7.5）。
- **値のエスケープ**: 改行・CR・TAB は空白 1 個に、制御文字（U+0000–U+001F, U+007F, U+2028/2029）は除去、`"` を含む値は `\"`。1 値は 160 文字で切る（`…`）。
- **順序**（すべて全順序。同点の最後は文字列の昇順）: MODULES = topo 順（親があれば親の直下に子をインデント 2）、ROUTES = scope main → 非 dynamic → handler ファイルの rank 降順 → path:line、CLI = command path、ENV = 名前、SCHEMA = entity、SCRIPTS = purpose（build run test lint format typecheck other）→ 名前、DEPS = used 降順 → 名前、MAP = module topo 順 → ファイル rank 降順、TERMS = 点数降順、DOCS = role（readme agents claude architecture adr contributing other）→ path。
- **件数表示**: `## ROUTES 40/62` のように「出した数/全数」。切った分は gen が必要なら `facts()` で引ける。
- **予算**（`claude-v5` 推定、合計 10k ± 15%、上限 12k。gen の `GEN_ESTIMATE_PARAMS.repoPackMaxTokens` = 10,000 のように呼び出し側が上限を決めるときは `RepoPackOptions.maxTokens` で渡し、MAP → TERMS → DOCS の順に削って収める）:

| part | 中身 | 予算 [仮] | `RepoPack.parts` 名 |
|---|---|---:|---|
| header | 1 行 | 60 | （module_tree に含める） |
| MODULES | ≤ 60 module（超えたら親と rank 上位、残りは `… +k`） | 1,500 | `module_tree` |
| ENTRY + ROUTES + CLI + ENV + SCHEMA + SCRIPTS + DEPS | ≤ 6 / 40 / 30 / 40 / 20（field ≤ 12）/ 15 / 30 行 | 2,900 | `facts` |
| MAP | 残り（≈ 4.8〜5.5k）。ファイル単位で入る限り | 残り | `repo_map` |
| TERMS | ≤ 40（exported な型名・module 名。点数 = 参照ファイル数 × idf） | 400 | `glossary_seed` |
| DOCS | role 順に ≤ 6 doc、各 ≤ 8 見出し | 800 | `existing_docs` |

- **Haiku 4.5 で使う場合**: 最小 cache prefix が 4,096 token（04 §7.1）。10k の pack はそのまま条件を満たす。小さい repo で pack が 4,096 未満になるときは MAP を `sig` 断片で埋めて 4,096 以上にする（`minPrefixTokens` 引数。gen が model ごとに指定）。

### 7.5 決定性・データの安全

- **決定性の規則**: 時刻・乱数・絶対 path・pid を含めない。数値は固定小数（rank は 2 桁）。集合は必ず §7.4 の順序で並べる。JSON を埋め込まない。同じ `packKey` で 2 回作ってバイト一致すること、mtime だけ変えた再 scan でもバイト一致すること、を golden test で検査する（IDX-AT-43）。
- **cache key**: repo pack = `packKey`。module 入力 = `ModuleContext.key`。ファイル単位の skeleton 断片 = `blob × extractor × tier`（`idx_skeleton`）。module / repo の skeleton は断片の連結なので、断片 cache が当たれば ≤ 5 ms で組める。
- **secret scan**: `read()`・`skeleton()`・`hotBodies()`・`moduleContext()`・`repoPack()` の出力は、`settings.global.security.secretScan` が true（既定）なら `SecretScanner`（ポート。CR-6）を通し、一致を `«redacted:secret»` に置き換え、件数を `redactions` に入れる。**行数は変えない**（行番号と citation がずれないように、行の中だけを置換する）。
- **deny glob のファイル**は skeleton にも pack にも入らない（S0 で除外済み。`read()` も `E_DENY_GLOB` を返す）。
- DATA fence（`UNTRUSTED_FENCE`）で包むのは gen / loop の責任。fence の nonce を呼び出しごとの乱数にすると cache が壊れるが、gen spec §5.1-4 が「workspace の秘密 salt + 内容から導く nonce」に決めたので、同じ `packKey` の pack は同じ fence バイトになる（§13 O-IDX-9 は解決済み）。

### 7.6 token 推定と較正

- **推定式**（`estimateTokens(text, kind, tokenizer, intent?)`）:

```
cjk    = text 中の CJK 文字数（U+3000–30FF, U+3400–4DBF, U+4E00–9FFF, U+F900–FAFF, U+FF00–FFEF, U+AC00–D7AF）
others = text の UTF-16 code unit 数 − cjk
raw    = others / CHARS_PER_TOKEN[tokenizer][kind] + cjk / CHARS_PER_TOKEN[tokenizer].markdown_ja
tokens = ceil(raw × calib(tokenizer, intent))
```

  - 係数は core の `CHARS_PER_TOKEN`（claude-v5: code 2.3、markdown_en 2.87、markdown_ja 1.25 = **0.8 token/文字**。claude-v4（Haiku 4.5）: code 3.05…）。研究の「Haiku は chars/3.1」と core の 3.05 は 04 §2.1 の実測幅 2.96〜3.15 の中にあり、core の値を使う。
  - kind はファイル class と拡張子から（§2.6）。skeleton は `code`、repo pack は `code`（タグ行も code に近い比率。golden で ±10% を確認する）。
- **較正**（所有は `@mitori/agent`、`use_calibration` in `state.sqlite`）: 1 回の LLM 呼び出しの `result.usage` の入力 token 合計 T と、呼び出し前に記録した推定 E（`UsageRecord.estimate`）から、key = `tokenizer × intent`（intent = `gen.module` `gen.overview` `answer` `patch` `agent` `bundle` …）の係数を更新する:

```
r = T / E_raw                       # E_raw は calib を掛ける前の推定
f ← (n < 20 ? 0.2 : 0.1)·r + (1 − (n < 20 ? 0.2 : 0.1))·f      # EMA、初期 f = 1.0
f ← clamp(f, 0.5, 2.0);  n ← n + 1
```

- **kind 単位の係数**（`CHARS_PER_TOKEN` に掛ける `kindFactor(tokenizer, kind)`、初期 1.0）は呼び出し合計からは分離できないので、**単一 kind の text の正確な token 数**だけで更新する: anthropic-api engine の `count_tokens`（gen が見積り時に呼ぶ。gen spec §8.3）と `mitori doctor --calibrate`（04 §1 の baseline 差分法: 固定 prompt と「sample + 同じ prompt」の差。kind ごとに 1 probe、計 ≈ 60k token・haiku で ≈ $0.02 [仮]、ユーザーの明示操作でだけ動く）。式は上と同じ EMA（r = 実 token / raw 推定）。
- **書き込みの経路**: gen は `indexer.calibrate({tokenizer, kind, chars, cjk, tokens, source})` を呼ぶ（gen spec §8.3 の呼び出しをそのまま受ける）。indexer は値を検査（chars ≥ 2,000、0.25 < r < 4）して `deps.calibrationSink` に渡すだけで、**保存は agent**（`use_calibration`）。推定は `deps.calibration()`（`CalibrationSnapshot`、読み取り専用。`kindFactor` と intent の `factor`）を読む（IDX-D13）。型と `emaUpdate()` は core に置く要求（CR-7）。
- 推定の最終式: `tokens = ceil((others / (CHARS_PER_TOKEN[tok][kind] / kindFactor(tok, kind)) + cjk / (CHARS_PER_TOKEN[tok].markdown_ja / kindFactor(tok, "markdown_ja"))) × factor(tok, intent))`。

### 7.7 `read()` と `CodeSlice`

- `currentText(path)`: 現在の内容の生テキスト（secret scan なし。daemon の外に出さない anchor engine 用。`AnchorContext.currentText`）。`blobText(blob)` も同じく生テキストで、object が無ければ null（shallow clone で古い blob が無い場合など。anchor の cascade は S3 を飛ばす）。
- `read(path, range?, {blob?, numbered?})`: 現在の blob（または指定 blob。`git cat-file` 経由）から 1 起点・両端含む範囲を返す。`numbered` なら各行 `N|<原文>`。2 MiB を超える範囲は `E_PAYLOAD_TOO_LARGE`。deny glob は `E_DENY_GLOB`、除外ファイル（binary 等）は `E_UNSUPPORTED`。
- `tokens` は `code` kind の推定。`redactions` は §7.5。

### 7.8 gen への追加の供給（gen spec §17.3 の依頼 I3〜I5）

- **I3 `moduleStats(id)`**: `{ files, loc, symbols, exportedSymbols, tests, testFiles, facts: Partial<Record<FactKind, number>>, depsOut: {module, weight}[], depsIn: {module, weight}[] }`。メモリ上の集計（≤ 0.1 ms / module）。weight は §6.1 の module 間重み（有効閾値以上のみ、2 桁に丸め）。
- **I4 `flowSeeds(limit = 8)` と `flowBodies(seed, budget, tokenizer)`**: 入口（main scope の route → cli → entry の順、handler ファイルの rank 降順）から、module graph（§6.5 の有効 edge）を辿る**最短経路**（BFS、hop ≤ 6、同 hop は edge 重み降順 → slug 昇順）を求め、`FlowSeed { k, kind: "route"|"cli"|"entry", label, path, line, handler?, modules: ModuleId[], files: RepoPath[] }` を返す。`files` は経路上の各 module で「前の file から call 参照（`@ref.call` を解決したもの）で到達する file」を 1 本ずつ選んだ列（到達できなければ module の rank 最大 file）。`flowBodies` は handler の body と、経路上の各 file で前の file から呼ばれる symbol の body を、予算内で先頭から詰める（§7.3 の slice 規則と同じ）[仮]。gen の `SEEDS` 行（`> seed<k> <kind> <説明> (<path>:<line>) path: <md_a> > <md_b> …`）は gen が組む。
- **I5 理由コメント**: indexer が持つ（facts と同じく Worker で comment ノードを走査するので追加コストがほぼ無い）。`RATIONALE_COMMENT_RE`（indexer.ts。gen spec §5.2 `COMMENTS` と同じ正規表現 `because|since|so that|instead of|rather than|we (use|chose|need)|note|hack|workaround|trade-?off|rationale|why|ため|なぜ|理由|代わりに|回避`、i）に一致する comment の範囲を `ParseItemResult.rationale` で返し、`rationaleComments(limit = 60)` は file rank 降順・行昇順で `CodeSlice`（±2 行、numbered、secret scan 済み）を返す。license header（§3.6）と TODO 行は除く。


---

## 8. 検索・palette・graph の書き出し

- **FTS5**: `idx_search(kind UNINDEXED, id UNINDEXED, label, sub, body, tokenize='trigram')`。行: file（label = basename、sub = dir、body = path）、symbol（exported な top-level と exported 型の member のみ。label = name、sub = `path:line`、body = qualname + signature + doc の 1 行目）、module（label = name、sub = slug、body = dominant dir + 代表 symbol 10 個）、fact（label = route pattern / env 名 / command / entity、sub = `path:line`、body = kind + framework）。≤ 50,000 行（超えたら symbol を rank 降順で切る）。
- **構築**: `scan.done` の後、write queue で 5,000 行ずつの transaction に分けて background 構築（IDX-D8）。構築中と 1〜2 文字の query は、メモリ上の palette 項目に対する前方一致・部分一致（小文字化）で答える。順位 = `bm25(idx_search, 10, 2, 1)` − kind 補正（exported symbol −0.5、module −1.0）。`search()` 1 query ≤ 1 ms（目標）。
- **palette**（`paletteItems()`、⌘K の Worker が保持）: module 全部（`k: "m"`）、included ファイル全部（`"f"`、≤ 20,000）、symbol（`"y"`、exported のみ、rank 降順で ≤ 25,000）。合計 ≤ 45,000（doc 側の section・term・thread と合わせて 50,000 以内）。href は `#/code/<path>:<line>`・`#/doc/modules/<slug>`。
- **`findSymbols(query, limit)`**（MCP `find_symbol`、Code peek）: メモリ上の名前索引で「完全一致 > 前方一致 > camel/snake の頭文字一致 > 部分一致 > subsequence」の順に点を付け、exported +0.2、file rank × 0.3 を足す。
- **`graph(level, focus?)`**: `module` は leaf（leaf > 40 なら親）を node に、module 間の有効 edge（§6.1 の閾値以上）を重み降順で node 数 × 3 本まで。`file` は focus（module id または path）の member と 1 hop の隣接で ≤ 300 node（ELK 300 node 88 ms、05 §6）。Diagram IR への変換は `@mitori/doc`。

---

## 9. SQLite スキーマ（`idx@1`、workspace DB、WAL）

```sql
-- 版・状態（leiden_gamma、last_snapshot、structure_version、git_index_mtime など）
CREATE TABLE idx_meta (k TEXT PRIMARY KEY, v TEXT NOT NULL) WITHOUT ROWID;

-- S0: path ごとの現在の状態
CREATE TABLE idx_files (
  path        TEXT PRIMARY KEY,           -- RepoPath（NFC）
  blob        TEXT NOT NULL,              -- GitOid（worktree の内容。dirty なら計算値）
  mode        INTEGER NOT NULL,           -- 0o100644 / 0o100755 / 0o120000 / 0o160000
  size        INTEGER NOT NULL,
  mtime_ns    INTEGER NOT NULL,
  ino         INTEGER,
  racy        INTEGER NOT NULL DEFAULT 0, -- §2.2
  tracked     INTEGER NOT NULL,
  dirty       INTEGER NOT NULL,
  lang        TEXT NOT NULL,              -- SourceLang
  grammar     TEXT,                       -- 実際に使った grammar（Flow → tsx）
  dialect     TEXT,                       -- 表示用（java, shell, markdown …）
  class       TEXT NOT NULL,              -- FileClass
  excluded    TEXT,                       -- ExcludeReason（core の値）
  excluded_ext TEXT,                      -- special / fixture（CR-2 まで）
  scope       TEXT NOT NULL,              -- main | example | test | tooling
  rule        TEXT NOT NULL,              -- 分類した規則 id（R00…R20。「なぜ除外?」の説明用）
  extractor   TEXT,                       -- ExtractorVersion（parse したもの）
  module      TEXT,                       -- leaf ModuleId
  note        TEXT,                       -- parse_timeout | parse_error | degraded …
  seen        INTEGER NOT NULL            -- scan 世代（削除の掃除）
) WITHOUT ROWID;
CREATE INDEX idx_files_blob   ON idx_files(blob);
CREATE INDEX idx_files_module ON idx_files(module);
CREATE INDEX idx_files_class  ON idx_files(class, excluded);

-- S1: 内容アドレスの parse 結果（branch・fork・別 path で共有）
CREATE TABLE idx_blobs (
  blob TEXT NOT NULL, extractor TEXT NOT NULL,
  bytes INTEGER NOT NULL, lines INTEGER NOT NULL, loc INTEGER NOT NULL, cjk INTEGER NOT NULL,
  content_class TEXT,                     -- NULL | binary | minified | generated（R11–R13 の判定）
  errors INTEGER NOT NULL, parse_ms REAL NOT NULL,
  sig_digest TEXT, body_digest TEXT,      -- ファイル単位の早期打ち切り
  imports BLOB,                           -- 圧縮した ImportRecord[]（行で持たない: 挿入を軽くする）
  refs BLOB,                              -- 圧縮した RefRecord[]
  tests BLOB,                             -- test 名
  last_used INTEGER NOT NULL,             -- GC 用（unix 秒）
  PRIMARY KEY (blob, extractor)
) WITHOUT ROWID;

CREATE TABLE idx_symbols (
  blob TEXT NOT NULL, extractor TEXT NOT NULL, ord INTEGER NOT NULL,
  qualname TEXT NOT NULL, name TEXT NOT NULL, kind TEXT NOT NULL,
  start INTEGER NOT NULL, "end" INTEGER NOT NULL,
  body_start INTEGER, body_end INTEGER, doc_start INTEGER, doc_end INTEGER,
  signature TEXT NOT NULL, doc TEXT,
  sig_hash TEXT NOT NULL, body_hash TEXT NOT NULL,
  exported INTEGER NOT NULL, parent_ord INTEGER, complexity INTEGER NOT NULL,
  PRIMARY KEY (blob, extractor, ord)
) WITHOUT ROWID;
CREATE INDEX idx_symbols_name ON idx_symbols(name);
CREATE INDEX idx_symbols_qual ON idx_symbols(blob, extractor, qualname);

-- S2: facts の候補（blob × detector set）と、snapshot ごとのリンク済み facts
CREATE TABLE idx_fact_cands (
  blob TEXT NOT NULL, detectors TEXT NOT NULL,   -- detector set version（id@ver を連結した xxh3）
  data BLOB NOT NULL,                            -- 圧縮した FactCandidate[]
  PRIMARY KEY (blob, detectors)
) WITHOUT ROWID;
CREATE TABLE idx_facts (
  kind TEXT NOT NULL, path TEXT NOT NULL, line INTEGER NOT NULL, ord INTEGER NOT NULL,
  detector TEXT NOT NULL, blob TEXT NOT NULL, scope TEXT NOT NULL,
  data TEXT NOT NULL,                            -- kind 固有の field（キー整列の JSON）
  PRIMARY KEY (kind, path, line, ord)
) WITHOUT ROWID;
CREATE TABLE idx_configs (                       -- tsconfig / go.mod / pyproject / Cargo / package.json の parse 結果
  path TEXT PRIMARY KEY, blob TEXT NOT NULL, tool TEXT NOT NULL, role TEXT NOT NULL, json TEXT
) WITHOUT ROWID;
CREATE TABLE idx_doc_headings (path TEXT NOT NULL, ord INTEGER NOT NULL, level INTEGER NOT NULL, line INTEGER NOT NULL, text TEXT NOT NULL,
  PRIMARY KEY (path, ord)) WITHOUT ROWID;
CREATE TABLE idx_unresolved (path TEXT NOT NULL, spec TEXT NOT NULL, PRIMARY KEY (path, spec)) WITHOUT ROWID;

-- S3: module（同一性と履歴を持つ唯一の永続構造。graph の edge は保存しない: 再計算 ≤ 50 ms）
CREATE TABLE idx_modules (
  id TEXT PRIMARY KEY, slug TEXT NOT NULL UNIQUE, name TEXT NOT NULL,
  parent TEXT, depth INTEGER NOT NULL, alive INTEGER NOT NULL,
  loc INTEGER NOT NULL, rank REAL NOT NULL, topo INTEGER NOT NULL, cross_cutting INTEGER NOT NULL,
  dominant_dir TEXT NOT NULL, anchor TEXT NOT NULL,            -- 誕生時の anchor path（ID の種）
  members_digest TEXT NOT NULL, iface_digest TEXT NOT NULL, body_digest TEXT NOT NULL,
  facts_digest TEXT NOT NULL, tests_digest TEXT NOT NULL,
  split_from TEXT, oversize_file INTEGER NOT NULL DEFAULT 0,
  born_at TEXT NOT NULL, dead_at TEXT, updated_at TEXT NOT NULL
) WITHOUT ROWID;
CREATE TABLE idx_module_members (path TEXT PRIMARY KEY, module TEXT NOT NULL, role TEXT NOT NULL) WITHOUT ROWID;  -- role: member | test
CREATE INDEX idx_module_members_m ON idx_module_members(module);

-- S4: ファイル単位の skeleton 断片
CREATE TABLE idx_skeleton (
  blob TEXT NOT NULL, extractor TEXT NOT NULL, tier TEXT NOT NULL,
  text TEXT NOT NULL, tok_v5 INTEGER NOT NULL, tok_v4 INTEGER NOT NULL,
  PRIMARY KEY (blob, extractor, tier)
) WITHOUT ROWID;

CREATE TABLE idx_snapshots (
  id INTEGER PRIMARY KEY, "commit" TEXT, tree TEXT, branch TEXT, dirty INTEGER NOT NULL,
  index_digest TEXT NOT NULL, pack_key TEXT NOT NULL, taken_at TEXT NOT NULL,
  files INTEGER NOT NULL, loc INTEGER NOT NULL, ms INTEGER NOT NULL, timings TEXT NOT NULL
);

CREATE VIRTUAL TABLE idx_search USING fts5(kind UNINDEXED, id UNINDEXED, label, sub, body, tokenize='trigram');
```

- **cache key**: parse = `(blob, extractor)`、facts 候補 = `(blob, detectorSet)`、skeleton 断片 = `(blob, extractor, tier)`、import 解決 = path × `resolverConfigDigest`（メモリのみ）、構造 = `indexDigest × settingsDigest × STRUCTURE_VERSION`（`idx_meta`）。
- **BLOB 列の圧縮**: `imports` `refs` `tests` `data` は「行区切りテキスト → `CompressionStream("deflate-raw")`」[仮]（JSON より小さく、platform の追加依存が無い）。
- **GC**: `idx_files` から参照されず `last_used` が 14 日より古い `idx_blobs`（と同じ key の symbols・skeleton・fact_cands）を、週 1 回 idle 時に 10,000 key ずつ消す。`idx_blobs` が 200,000 key を超えたら古い順に 10% 消す [仮]。tombstone の module は `dead_at` から 90 日で消す。
- **書き込み**: すべて write queue の IMMEDIATE transaction（ARCHITECTURE §5.4）。S1 の結果は 2,000 ファイルずつの transaction（1 回 ≤ 30 ms [仮]。queue を長く塞がない）。
- **規模の目安**: react（2,423 本 parse、42k symbol）で DB ≈ 40〜60 MB [仮]（§11.2 で測る）。

---

## 10. 増分更新

### 10.1 watcher（`@mitori/platform` が実装。indexer が要求する仕様）

- 出力: `FsChange[]`（`{path, kind: "add"|"change"|"delete"}`、repo 相対 NFC path）の batch。server が受けて `indexer.update(batch)` を呼ぶ。
- **debounce**: 最初のイベントから 5 ms で 1 回目を flush（leading edge）、以後 30 ms 以内のイベントは次の batch にまとめ、最大 30 ms 待つ（max-wait）。ARCHITECTURE §4.4 の「30 ms debounce」を「leading 5 ms + max-wait 30 ms」に読み替える要求を CR-10 とする（trailing 30 ms では watch 20 ms と合わせて 50 ms 予算を使い切る）。
- **除外**: `.git/` 配下は `index` `HEAD` `refs/**` `packed-refs` 以外を捨てる。これらの変化（commit・checkout・pull・rebase）は path の batch ではなく `{kind: "git"}` として 1 回通知し、indexer は warm `scan()` を走らせる（≤ 25 ms + 変更ファイルの parse）。`<docDir>/`（`.mitori/`）は doc store の watcher に渡し、indexer には渡さない。untracked の新規 path は S0 規則で即判定できないもの（ignore 済みか不明）だけ `git check-ignore -z --stdin`（≈ 5 ms）で batch ごとに確認する。
- **macOS / Windows**: `fs.watch(root, {recursive: true})`（macOS は FSEvents。setup 2.1 ms、書込 → イベント p50 19.6 ms / p95 21.8 ms、05 §8.4 [実測]）。Windows は ReadDirectoryChangesW（P3 で測る）。
- **Linux（O3）**: 候補 A = Bun の recursive `fs.watch`（inotify。bun#34160 は macOS の per-file watcher の報告で、Linux の recursive は未測定）、候補 B = polling。B の手順: 間隔 250 ms（UI 接続中かつ直近 10 s に変更あり）/ 1 s（UI 接続中）/ 5 s（それ以外）[仮] で `git ls-files -z -m -o --exclude-standard` を実行して集合 S_t を得て、`changed = (S_t △ S_{t−1}) ∪ {p ∈ S_t ∩ S_{t−1} : stat(p) が前回と違う}`、あわせて `.git/index`・`.git/HEAD` の mtime を見る。shadow repo（index が空）は B では全ファイルが `-o` に出るので、`git ls-files` を使わず「前回の path 集合の stat 走査」（7k files ≈ 10 ms）で代える。
- **O3 の測り方**（`bench/watch.bench.ts`。05 `watch-bench.mjs` を移植）: GitHub Actions `ubuntu-24.04` と手元の Linux で、2 つの木（7,768 files / 923 dirs と 23,304 files / 2.8k dirs）について (1) setup 時間、(2) 単一ファイル書込 200 回の書込 → イベント p50/p95、(3) 2,000 ファイル一括書込の捕捉率、(4) 10 s の idle CPU、(5) RSS を A と B で測る。**採用規則**: A が setup ≤ 500 ms・p95 ≤ 100 ms・捕捉率 100%・idle CPU ≤ 1% を全部満たせば A、1 つでも外れたら B（addon を使わない。補遺 A5）。結果は `docs/specs/platform-watch.md` に記録。B の場合、Linux の「保存 → バッジ」は上限 1 s の予算で扱う。

### 10.2 `update(changes)` の手順

```
1. 正規化: 同じ path の連続イベントを畳む（add→delete は消す、delete→add は change）。
2. S0 path 規則（§2.3 path phase）。除外になった path は class だけ更新し 6 へ。
3. stat。消えていれば delete。size・mtime_ns・ino が記録と同じで racy でなければ何もしない（タッチだけの保存）。
4. warm Worker に `source` 付きで投げる（main thread で読む: 1 ファイル ≈ 0.1 ms）。Worker は blob 計算 →
   blob が記録と同じなら「内容不変」で返す（エディタの再保存）→ 違えば内容規則・parse・抽出。
   64 KiB 超で LRU に木があれば `tree.edit` で増分 parse（§3.7）。
5. 差分: 旧 symbol（idx_symbols の旧 blob）と新 symbol を qualname で突き合わせ、
   sigHash 不変・集合不変なら bodyOnly、exported の sigHash 変化・追加・削除なら iface 変化、追加・削除・sig 変化を `symbols[]` に記録。
6. import 再解決（変更ファイル + `idx_unresolved` の spec）、edge 差し替え、新規ファイルの module 割当て（§6.8）、
   触れた module の digest 再計算、facts 候補の差し替えとそのファイルに関係するリンク（mount prefix・test subject）の再計算。
7. rename 検出: 同じ batch の delete(p) と add(q) で blob が一致 → rename(p → q)。内容も変わった移動は
   indexer では検出しない（`git diff -M` は重いので使わない）。anchor engine の S2/S4（他ファイル探索）に任せる。
8. 反映（write queue、1 transaction）→ `IndexDelta` を返し、`index.changed {paths, ifaceChanged}` を emit。
9. 構造リフレッシュのタイマー（2 s）を張り直す（§6.8）。
```

### 10.3 `IndexDelta`（gen S9・anchor・loop の入力）

| field | 意味 | 使う側 |
|---|---|---|
| `snapshot` | 新しい `RepoSnapshot` | 全員 |
| `changed[]` | `{path, oldBlob, newBlob}`（null = 追加 / 削除） | anchor（行写像）、loop（thread の stale） |
| `renames[]` | `{from, to}`（同 batch の blob 一致） | anchor S0 |
| `bodyOnly[]` | sigHash も symbol 集合も不変だったファイル | gen（module ページを再生成しない） |
| `symbols[]` | `{path, added: qualname[], removed: qualname[], sigChanged: qualname[]}` | gen（leaf note・新 symbol の規則） |
| `ifaceChanged[]` | `ifaceDigest` が変わった module | gen（ページ再生成の提案）、SSE |
| `membershipChanged[]` | `membersDigest` が変わった module | gen・doc（章の構成） |
| `factsChanged` / `factKinds[]` | `factsDigest` の変化と kind | gen（overview / 表の再生成） |
| `structureRefreshed` | この delta が §6.8 のリフレッシュ（Leiden を含む）由来か | doc（`map.updated`） |

**早期打ち切りの規則**（indexer は事実だけ出し、判断は gen）: blob 不変 → 何もしない ／ bodyOnly → 該当 claim の stale 判定だけ（anchor の overlap）／ iface 変化 → その module ページの再生成を**提案** ／ membership 変化 → 章構成の更新を提案 ／ facts 変化 → overview・§4・§8 の表を更新（静的な表は自動、文章は提案）／ 新 symbol → leaf note の提案（D12: 設計書の更新は常に提案）。

### 10.4 遅延の内訳と測り方

| 区間 | 予算 | 根拠 |
|---|---:|---|
| 保存 → watch イベント（macOS） | 20 ms | p50 19.6 ms（05 §8.4） |
| debounce（leading） | 5 ms | §10.1 |
| `update()`（stat + read + blob + 増分 parse + 差分 + 反映） | ≤ 15 ms | 20k 行の再 parse 8.3 ms（05）、1 transaction ≤ 2 ms |
| anchor `reanchor`（変更 1 ファイル、≤ 100 anchor） | ≤ 5 ms | loop spec §1 |
| SSE 配信 | ≤ 5 ms | p99 4.6 ms（05 §8.1） |
| **合計（保存 → `doc.freshness` 受信）** | **≤ 50 ms** | — |

- 測り方（`bench/freshness.bench.ts`）: fixture repo（crit の複製）に対して daemon を起動し、SSE client を張った状態で、引用されている関数の本体を 1 行書き換えるのを 100 回（間隔 300 ms）。`t0 = write() 直前の performance.timeOrigin + now()`、`t1 = doc.freshness 受信時刻`（同一プロセスの clock）。p50 ≤ 50 ms・p95 ≤ 80 ms を目標、p95 ≤ 1 s を上限とする。各区間は `idx.update` などの span を NDJSON ログ（`ms` field）から集計する。

---

## 11. 性能予算と計測方法

### 11.1 コーパス（`bench/corpus.lock` に commit を固定）

| id | 取得 | 特徴（試作の S0 / S1 結果） |
|---|---|---|
| crit | `refs/crit`（406875d） | Go + JS + TS、vendored minified、62 routes。1,219 files / 15.3 MB、parse 743 本 6.2 MB |
| m3e | `refs/m3e-canvas`（de2d97a） | TS/TSX の layer 型（directory 分割の modularity −0.221） |
| hono | `honojs/hono` shallow | TS ライブラリ、test が多い。583 / 4.8 MB、parse 454 本 2.7 MB |
| flask | `pallets/flask` shallow | Python、docs（rst）が多い。236 / 1.8 MB |
| ripgrep | `BurntSushi/ripgrep` shallow | Rust workspace、自前 CLI。237 / 3.1 MB、symlink 1 |
| fastapi | `fastapi/fastapi` shallow | Python + 翻訳 docs 1,706。3,181 / 33.3 MB |
| excalidraw | `excalidraw/excalidraw` shallow | TSX の大きな app + monorepo。1,308 / 53.9 MB（woff2 等） |
| react | `facebook/react` shallow | JS（Flow）+ TS + Rust、fixture 4,184。7,252 / 38.8 MB、parse 2,423 本 22.6 MB |
| gostd | `$(nix shell nixpkgs#go -c go env GOROOT)/src`（**git 管理外**、shadow 経路の試験を兼ねる） | 6.8k files / 85.6 MB（05 の基準） |

`bench/corpus.lock` は `{id, url, commit}`。CI は shallow clone を cache し、無ければ取得する（取得は CI の既存 job の範囲。費用 0）。

### 11.2 計測ハーネス（`bench/indexer.bench.ts`）

- 1 repo につき: (1) **cold** = 新しい DB・新しい Worker pool で `scan()`、(2) **warm** = 変化なしの `scan()` を 5 回（中央値）、(3) **1 ファイル編集** = 中央付近の source ファイルの関数本体に 1 行足して `update()` を 20 回（中央値・p95）、(4) **branch 切替** = `git checkout HEAD~10` → warm scan（blob cache の再利用率を記録）。
- 記録: `ScanTimings`（S0a・Worker 起動・S0b+S1・S2・S3・S4・永続化・FTS、parse 本数、cache hit 数、W、Σparse/Σquery/Σread）、peak RSS（10 ms ごとの `process.memoryUsage().rss` の最大）、DB サイズ。出力は `bench/results/indexer-<git sha>.jsonl`。
- 判定: `bench/budgets.json` の絶対値（下表）と、head vs base（中央値 20% 劣化で fail、分散 25% 超の項目は警告のみ。ARCHITECTURE §10.1）。マシン差を吸収するため、CI では「同じ runner 上の base の値」との比だけを強制し、絶対値は maintainer の M 系 Mac と Linux x64 の基準機で週 1 回検査する。
- Worker 本数の掃引（`bench/indexer-workers.bench.ts`）: W ∈ {1, 2, 4, 6, 8, 12} × 全 repo の cold S0–S1 を 3 回ずつ。§3.1 の式の係数（0.75 MB/worker と上限）をこの結果で確定する。

### 11.3 予算表（`bench/budgets.json` の id。目標 / 上限。M5 Max 基準）

| id | 指標 | 目標 | 上限 |
|---|---|---:|---:|
| `idx.s01.cold.100kloc` | S0–S1 cold、crit | 0.30 s | 0.50 s |
| `idx.s01.cold.7kfiles` | S0–S1 cold、gostd（shadow） | 1.20 s | 1.50 s |
| `idx.s04.cold.100kloc` | S0–S4 cold、crit | 1.0 s | 2.0 s |
| `idx.s04.cold.react` | S0–S4 cold、react | 1.5 s | 3.0 s |
| `idx.s04.cold.small` | S0–S4 cold、m3e / flask / ripgrep | 0.4 s | 0.8 s |
| `idx.warm.rescan` | warm rescan、crit | 10 ms | 25 ms |
| `idx.warm.rescan.7k` | warm rescan、gostd | 25 ms | 50 ms |
| `idx.update.1file` | `update()` 1 ファイル（warm Worker） | 15 ms | 30 ms |
| `idx.freshness` | 保存 → `doc.freshness`（macOS） | 50 ms | 1,000 ms |
| `idx.rss.peak` | peak RSS（react） | 700 MB | 1,000 MB |
| `idx.rss.idle` | 60 s 無操作後の indexer 由来 RSS | 0 MB | 5 MB |
| `idx.pack.tokens` | repo pack（全 repo） | 10k ± 15% | 12k |
| `idx.pack.ms` | repo pack 生成（cache miss） | 20 ms | 50 ms |
| `idx.module.sig.tokens` | leaf の sig skeleton | ≤ 24k | 32k |
| `idx.leaf.loc` | leaf LOC（中央値・80% の範囲） | 中央値 2k〜6k | 80% が 1k〜9k |
| `idx.search.ms` | `search()` 1 query | 1 ms | 5 ms |
| `idx.leiden.ms` | Leiden（γ 探索込み）、react | 80 ms | 200 ms |
| `idx.persist.ms` | 永続化（scan.done 後、background）、react | 300 ms | 800 ms |

### 11.4 構造の品質指標（同じハーネスで記録）

- modularity（γ = 1 で計算した値）、directory partition の modularity、directory purity、leaf 数と LOC 分布、PageRank 上位 10 ファイル、`cycles` の数。
- 安定性: 同じ snapshot で 2 回 → membership・ID 完全一致。crit の直近 40 commit を順に適用（`git checkout` → warm scan）したときの「commit あたり ID が変わった leaf の割合」と slug の変化数。
- 名前参照の λ 掃引（λ_ref ∈ {0.25, 0.5, 0.75}、λ_pkg ∈ {0.5, 0.8, 1.0}）の結果をこの表に残し、既定値を決める。

---

## 12. 受け入れ試験（IDX-AT）

すべて CI で自動実行する（`packages/indexer/test`、`bench/`、`eval/facts/`）。WP-02 / WP-03 の受け入れ試験（MILESTONES）はこの表に含まれる。

### 12.1 S0

| # | 試験 | 合格条件 |
|---|---|---|
| IDX-AT-01 | 分類の golden（`fixtures/inventory/` の 1 ファイル 1 規則の合成 repo、R00〜R20 の境界値を含む: 2,097,152 / 2,097,153 byte、avg 300 / 301、50 KiB ちょうど、NUL を 8,000 byte 目 / 8,001 byte 目に置いたもの） | 全ファイルの `(class, excluded, rule)` が期待値と一致 |
| IDX-AT-02 | コーパスの除外 | crit の `web/mermaid.min.js` が oversize、`web/*.min.js` が minified、`cmd/crit/integration_hashes_gen.go` が generated、`.claude/**` が deny。ripgrep の `crates/core/flags/complete/zsh.rs` は generated に**ならない**。excalidraw の `harfbuzz-wasm.ts` は minified か generated。react の `fixtures/**` が fixture |
| IDX-AT-03 | `tokensFiltered / tokensNaive` | crit 0.25 ± 0.05、m3e 0.35 ± 0.05（04 §2.2 と整合） |
| IDX-AT-04 | 秘密を読まない | deny / secret の path に対して fs の `read` が 1 回も呼ばれない（fs ポートのフェイクで計数） |
| IDX-AT-05 | shadow | git 管理外の fixture ディレクトリ（`.gitignore` と入れ子 repo を含む）を開き、ユーザーのディレクトリに新しいファイルが 0、`.gitignore` 対象と `DEFAULT_SHADOW_EXCLUDES` が列挙されない、入れ子 repo が `special` |
| IDX-AT-06 | GitHub URL | `https://github.com/o/r/tree/main/sub` の解析で clone 先・`--branch main`・include `sub/**` が期待どおり（argv を記録する Spawner フェイク） |
| IDX-AT-07 | indexDigest | 同じ内容の 2 つの clone（別 path・別 mtime）で digest 一致。1 ファイル変更で変化。除外ファイルの変更では不変 |
| IDX-AT-08 | racy | 記録と同じ秒に書き換えた（mtime 同一・size 同一）ファイルを次の scan で検出する |

### 12.2 S1

| # | 試験 | 合格条件 |
|---|---|---|
| IDX-AT-10 | query の compile | 6 grammar すべてで `.scm` が compile でき、`Query.captureNames` が §3.4 の規約の部分集合 |
| IDX-AT-11 | symbol golden（`fixtures/lang/<lang>/`、言語ごとに 1 repo: class・関数・メソッド・overload・decorator・Go receiver・Rust impl / trait impl の重名・`pub(crate)`・Python `__all__`・CommonJS） | `(qualname, kind, start, end, exported, parent, signature, sigHash)` が期待値と完全一致。重名に `~2` |
| IDX-AT-12 | hash の頑健性 | 空白・改行・comment だけを変えたファイルで sigHash・bodyHash が不変。引数名を変えると sigHash が変わる |
| IDX-AT-13 | Flow | react の `@flow` 付き `.js` を tsx grammar で parse し、parse error のあるファイル率 ≤ 25%（JS grammar 75%） |
| IDX-AT-14 | メモリ | 同じ Worker で crit を 10 回連続 cold parse し、peak RSS が単調増加しない（10 回目 ≤ 1 回目 × 1.1）。`tree.delete()` 漏れ検出（delete 呼び出し数 = parse 数） |
| IDX-AT-15 | 失敗の局所化 | 壊れたファイル・250 ms を超える病的ファイル（深い入れ子 10 万段）を混ぜても scan は成功し、そのファイルだけ `note` 付き generic |
| IDX-AT-16 | cache | 2 回目の cold scan（DB は残し Worker だけ新規）で parse 本数 0。`git checkout HEAD~10` 後の warm scan で parse 本数 = 実際に blob が変わったファイル数 |

### 12.3 import 解決・facts

| # | 試験 | 合格条件 |
|---|---|---|
| IDX-AT-20 | TS 解決（fixture: tsconfig `paths`+`baseUrl`+`extends`、workspace の `exports` パターン、`#imports`、dist→src、`.js`→`.ts`、index、Node 組み込み） | 全 spec の `to` / `external` / `stdlib` が期待値と一致 |
| IDX-AT-21 | Python 解決（src layout、相対 3 段、namespace package、`TYPE_CHECKING`、stdlib、PIL→Pillow） | 同上 |
| IDX-AT-22 | Go 解決（複数 go.mod、`replace`、alias、selector による定義ファイル特定） | 同上。crit の `internal/*` import の解決率 100% |
| IDX-AT-23 | Rust 解決（workspace、`mod` の 3 形、`#[path]`、`use crate::/super::/self::`、別 crate） | 同上。ripgrep の `crates/*` の `use crate::` 解決率 ≥ 98% |
| IDX-AT-24 | route | crit ≥ 62（リテラル 60 + 連結 2）。§5.7 の fixture で precision ≥ 0.95・recall ≥ 0.90。hono の test 由来 route が主表に 0 件 |
| IDX-AT-25 | env / cli / schema / entry / script / dependency / test | §5.7 の表の precision・recall を満たす。crit env 17、ripgrep の clap 由来 CLI 0 |
| IDX-AT-26 | 値を取り込まない | env の値・SQL のデフォルト値・const の初期化子が facts と signature に現れない（fixture に canary 文字列を置いて全出力を grep） |

### 12.4 S3

| # | 試験 | 合格条件 |
|---|---|---|
| IDX-AT-30 | 決定性 | 同じ snapshot・同じ前状態で 2 回 → membership・ID・slug・rank・topo・repo pack のバイトが完全一致。プロセス・マシン（macOS / Linux）を変えても一致 |
| IDX-AT-31 | modularity | m3e で directory partition より高く、かつ同じグラフでの Louvain 50 順序の最良値 × 0.9 以上（CR m1-36。≥ 0.2 は import 解決込みのグラフでは到達不能、最良 0.191）。crit で ≥ 0.45 [仮]（実測 0.356、ディレクトリ整合を優先して 0.35 を下限にした）|
| IDX-AT-32 | サイズ | 全コーパスで leaf の LOC 中央値が 2k〜6k（repo 全体が小さい m3e・flask は例外として leaf 数 ≥ 3 [仮]）、sig skeleton > 32k token の leaf 0 |
| IDX-AT-33 | ID の安定 | crit 40 commit の replay で、ID が変わる leaf の割合が commit あたり ≤ 5%、40 commit 通しで ≥ 90% の leaf が ID を保つ、生存 ID の slug 変化 0 [仮] |
| IDX-AT-34 | seed | DB を消し、`doc.index.json` の `modules[].reps` だけを seed にして再 scan → 元の ID と一致する leaf ≥ 95% |
| IDX-AT-35 | 小さな変更 | 任意の 1 ファイルの body 変更（100 回、無作為）で membership 不変・ID 不変 |
| IDX-AT-36 | PageRank の健全性 | crit の上位 10 に `integrations/embed.go`・`web/embed.go` が無い |
| IDX-AT-37 | SCC | 循環を含む fixture で `cycles` が正しく、topoOrder が「依存先が先」を満たす（SCC 内を除く全 edge で `topo(dst) < topo(src)`） |

### 12.5 S4

| # | 試験 | 合格条件 |
|---|---|---|
| IDX-AT-40 | skeleton golden | `golden/crit.internal-diff-diff.go.{l0,sig,doc}.txt` とバイト一致。各言語の fixture に golden を持つ |
| IDX-AT-41 | skeleton の大きさ | crit Go の `sig` / full ∈ [0.12, 0.24]（実測 0.204）、`l0` / full ≤ 0.06（実測 0.047） |
| IDX-AT-42 | citation 可能性 | `sig` / `doc` / hot の全 `N\|` 行について、原文の N 行目と一致（redaction を除く） |
| IDX-AT-43 | repo pack | 全コーパスで 10k ± 15%（上限 12k）、同じ `packKey` で 2 回生成してバイト一致、mtime だけ変えた再 scan でバイト一致、全行が `=== ` か `> ` で始まり `<<<` を含む行が 0、`maxTokens` 指定時はその値以下 |
| IDX-AT-44 | hot bodies | 予算を守る（Σ tokens ≤ budget）、hot ≤ module 入力の 25%、同じ入力で同じ選択 |
| IDX-AT-45 | secret | fixture の `const AWS_SECRET = "AKIA…"` が skeleton・hot・pack・read のどれにも原文で出ず、行数が変わらない |
| IDX-AT-46 | token 推定 | `fixtures/tokens/` の実測済み sample（04 §2.1 の表の 10 種）で、推定 / 実測 が ±10% 以内（初期係数）。CJK を含む混在文で ±15% |
| IDX-AT-47 | 行プレフィックス（gen I1） | skeleton（3 tier）・hot・rationale の全行が `=== ` / `<数字>\|` / `⋮` / `> ` のどれかで始まる（全コーパス） |
| IDX-AT-48 | flow seed（gen I4） | crit で seed ≥ 5、各 seed の `modules` が module graph 上の連続した経路（隣り合う module 間に有効 edge がある）。fixture（route → handler → service → store の 4 module）で経路が期待どおり |
| IDX-AT-49 | 理由コメント（gen I5） | fixture の「〜のため」「because …」コメントを全件拾い、license header・TODO を拾わない。±2 行の範囲・行番号が原文と一致 |

### 12.6 増分・性能

| # | 試験 | 合格条件 |
|---|---|---|
| IDX-AT-50 | 予算 | §11.3 の全 id が上限以内（CI は head vs base 20%、基準機で絶対値） |
| IDX-AT-51 | 保存 → バッジ | macOS で p50 ≤ 50 ms・p95 ≤ 80 ms（`bench/freshness.bench.ts`） |
| IDX-AT-52 | IndexDelta | 合成した 8 種の変更（body のみ・sig 変更・symbol 追加 / 削除・rename・新規ファイル・削除・facts 変更）で各 field が期待どおり |
| IDX-AT-53 | 取りこぼし 0 | 2,000 ファイル一括書込（`git checkout` 相当）の後、warm scan と増分の結果が cold scan と一致 |
| IDX-AT-54 | Linux watch | §10.1 の採用規則で選んだ方式で、2,000 ファイル一括の捕捉率 100%、保存 → バッジ p95 ≤ 1 s |
| IDX-AT-55 | idle | workspace の SSE client が 0 になって 60 s 後、parse Worker が 0 本 |

---

## 13. 未決事項と [仮] の値

| # | 項目 | 現在値 | 測り方・決め方 | 期限 |
|---|---|---|---|---|
| O-IDX-1 | Worker 本数の式（0.75 MB/worker、上限 perfCores） | §3.1 | `indexer-workers.bench`（M 系 Mac・Linux x64 8 core・Windows）で cold S0–S1 最小の W を各 repo で求め、式の係数を最小二乗で合わせる | P0 |
| O-IDX-2 | 名前参照の λ_ref = 0.5、λ_pkg = 0.8、`GENERIC_NAMES` | §4.6 | §11.4 の掃引（modularity・purity・PageRank 上位） | P0 |
| O-IDX-3 | Leiden の hysteresis ε = 1e-4、γ 探索の窓 | §6.2 | IDX-AT-33/35 の安定性と modularity 低下（≤ 0.01）の両立点 | P0 |
| O-IDX-4 | leaf サイズ 2k〜6k LOC・上限 9k、親の fan-out 5〜15 | §6.3 | gen の S5 実測（module ページ 1 枚の入力・品質）と合わせて見直す | P1 |
| O-IDX-5 | hot bodies の重み（0.30/0.25/0.25/0.20） | §7.3 | eval: hot あり / なし / 重み 3 種で claim S 率・citation L1 | P1 |
| O-IDX-6 | repo pack の part 予算 | §7.4 | gen の Pass 1 実測（O2）で overview の品質と token を見て調整 | P1 |
| O-IDX-7 | parse timeout 250 ms、degraded 30%、refs 打ち切り 10k | §3.6–3.7 | コーパス全ファイルの parse 時間分布の p99.9 × 10 | P0 |
| O-IDX-8 | Linux の watcher（O3） | §10.1 | 同節の採用規則 | P0 |
| O-IDX-9 | repo pack を system prompt に置くときの fence nonce | §7.5 | **解決**: gen spec §5.1-4 の内容導出 nonce（salt 付き）。確認は gen の cache 健全性テスト（2 回目の `cache_read_input_tokens > 0`） | — |
| O-IDX-10 | 構造リフレッシュの静穏 2 s、Leiden 再実行の閾値 10% | §6.8 | 編集中の CPU 使用と map の鮮度の体感（dogfooding） | P1 |
| O-IDX-11 | TOML の自前最小 parser で足りるか | §4.1 | コーパス + 主要 OSS 50 repo の `Cargo.toml`・`pyproject.toml` を全部読めるか | P0 |
| O-IDX-12 | BLOB 列の圧縮方式（deflate-raw） | §9 | react の DB サイズと warm load 時間 | P0 |
| O-IDX-13 | Java / C# / PHP plugin（D8 の次段） | — | tree-sitter 0.27 の公式 wasm で query を本書と同じ規約で書く。P2 以降 | P2 |
| O-IDX-14 | `cli.registry@1` の精度 | §5.2 | §5.7 の手順。0.85 未満なら既定 off | P1 |
| O-IDX-15 | `.env.example` の名前だけの抽出（deny glob の例外） | CR-11 | architect 判断 | P1 |
| O-IDX-16 | flow seed の経路探索（BFS hop ≤ 6、call 参照で file を選ぶ）と `flowBodies` の詰め方 | §7.8 | gen の `gen.flows` 出力の人手評価（入口から正しい順に module を辿っているか）を crit・hono・fastapi（example scope）で | P1 |
| O-IDX-17 | gen の `repoPackMaxTokens`（10,000）と indexer の目標（10k ± 15%、上限 12k）の整合 | §7.4 | gen spec と合意: gen が `maxTokens` を渡すなら indexer は上限として守る。既定値をどちらに置くか | P0 |

---

## 付録 A. 試作・query・golden の置き場所

`docs/design/specs/indexer/`:

| path | 中身 |
|---|---|
| `queries/{typescript,tsx-addendum,javascript,python,go,rust}.scm` | §3.5 の tags query（本文と同一。実装は `packages/indexer/src/lang/<id>/tags.scm` にこれを移す） |
| `queries/facts/{js,py,go,rust}-routes-env.scm` | §5.3 の facts 候補 query |
| `golden/crit.internal-diff-diff.go.{l0,sig,doc}.txt` | §7.1.1 の skeleton golden |
| `proto/qtest.mjs` | query の compile と capture 数（§3.5 の表） |
| `proto/s0proto.mjs` | §2.3 の分類規則の試作（§2.7 の表） |
| `proto/s1worker.mjs` `proto/s1bench.mjs` | Worker pool の S0–S1 試作（§3.1 の表） |
| `proto/loadtime.mjs` | grammar load と query compile の時間 |
| `proto/flowtest.mjs` | Flow ファイルの grammar 比較（IDX-D5） |
| `proto/genhdr.mjs` | generated header の判定（R13） |
| `proto/ftest.mjs` | facts 候補 query（§5.2 の件数） |
| `proto/skelproto.mjs` `proto/skelfn.mjs` `proto/skelbatch.mjs` | skeleton の試作（Go。§7.1 の golden と §7.1.2 の比） |

試作は scratchpad のコーパス（`refs/crit` `refs/m3e-canvas` `corpus/{flask,ripgrep,hono,excalidraw,fastapi,react}`）と `bench-stack/node_modules`（web-tree-sitter 0.27.0 と grammar）を絶対 path で参照する。実行: `nix develop --command bun <script> <args>`。本番コードではない（品質・型の保証なし）。

## 付録 B. core / api / ARCHITECTURE への変更要求（CR）

| CR | 対象 | 内容 | 理由 |
|---|---|---|---|
| CR-1 | core `DocIndex.modules[]` | `reps: RepoPath[]`（≤ 32、PageRank 降順に選び path 昇順で保存）、`slug: string`、`parent?: ModuleId` を追加 | 別マシン・DB 消失時に module ID を復元する seed（§6.6、IDX-AT-34） |
| CR-2 | core `ExcludeReason` | `"fixture"`（testdata・snapshot）と `"special"`（submodule・symlink・入れ子 repo・読めない）を追加 | coverage 表示の正直さ。現状は fallback で別の理由に化ける |
| CR-3 | core `SymbolEntry` | `doc?: string`（doc の先頭段落 ≤ 200 文字）を追加 | palette・hover・MCP `find_symbol` の説明 |
| CR-4 | core `FactKind` / `Fact` | `"config"` と `ConfigFact { tool, role }` を追加 | §4「動かしてみる」と設定の一覧。採用までは `Indexer.configs()` |
| CR-5 | core `GitReader` | `checkAttr(paths, attrs)`、`headTree()`、`lsOthers({directories: true})`（入れ子 repo を `dir/` で返す）、`statusDirty()`（porcelain v2 の dirty 判定済み path 集合）、`gitDir()`（`index`・`HEAD` の mtime を見るため）、`lsFiles()` に `stage` を追加 | §2.1 の argv を port で表すため |
| CR-6 | core（純関数） | `SecretScanner { scan(text): {text, redactions} }` の型と既定実装（正規表現 + 高エントロピー）を core に置き、indexer・loop・doc で共有 | 現状は scanner の所在が未定義（ARCHITECTURE §7.4 は「掛ける」とだけ書く） |
| CR-7 | core §5 | `CalibrationKey`（`${TokenizerId}:${intent}`）、`CalibrationSnapshot`、`emaUpdate(prev, sample)`（§7.6 の式）を追加 | agent が書き indexer / gen が読む。同じ式を 2 か所に書かない |
| CR-8 | core §18 | `FsReader { stat(abs), read(abs), readHead(abs, n), realpath(abs) }` ポートを追加 | indexer は `node:fs` を直接使えない（ARCHITECTURE §3.3 規則 2）。現状は indexer.ts のローカル定義 `IndexerFs` |
| CR-9 | core `RouteFact` / `FactBase` | `RouteFact.dynamic?: boolean`、`FactBase.scope?: "main" \| "example"` | 連結・template の route と例示コードの区別（§5.2、IDX-D12） |
| CR-10 | ARCHITECTURE §2.4・§4.4 | parse pool の式を §3.1 に、watcher の「30 ms debounce」を「leading 5 ms + max-wait 30 ms」に | 実測と 50 ms 予算 |
| CR-11 | core `DEFAULT_DENY_GLOBS` | `.env.example` `.env.sample` `.env.template` を「キー名だけ読んでよい」例外リスト（`ENV_TEMPLATE_GLOBS`）として別定義 | env の表の網羅性。値は読まない |
| CR-12 | core `RepoSnapshot.tree` | 注記を「clean なら `HEAD^{tree}`、dirty なら scan では null（GitSafety が必要時に作る）」に | 0.29 s の一時 index 作成を scan から外す |
| CR-13 | api `ScanSummaryView` | `stages?: Partial<Record<ScanStage, number>>`（ms）と `notes?: { parseErrors: number; degraded: number; timeouts: number }` を追加 | 進捗 UI と「読めなかったファイル」の正直な表示 |

## 付録 C. `GENERIC_NAMES` の初期値（言語共通部分。言語別の組み込み名は plugin が足す）[仮]

```
get set has add put run main init new New String Error Close Open Read Write Flush Reset Len Less Swap
ReadFile WriteFile len append make copy delete map filter reduce forEach find some every push pop shift
then catch finally resolve reject log info warn error debug trace print printf println Println Printf
Sprintf Fprintf Errorf format parse Parse toString valueOf toJSON id name value data key keys values items
list item index count size length type kind path url uri file dir src dst out in err res req resp ctx cfg
config options opts args argv props state store render setState useState useEffect useMemo useCallback
useRef useContext require exports module default test it describe expect assert before after beforeEach
afterEach self cls this super constructor handle handler callback cb fn next done start stop open close
create update remove load save fetch send emit on off apply call bind wrap unwrap clone equals hash
compare sort merge join split trim replace match test exec lower upper min max sum abs floor ceil round
```
