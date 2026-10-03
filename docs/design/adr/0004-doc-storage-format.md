# ADR-0004: 設計書の保存形式 — Markdown 正本 + 末尾 ID コメント + 決定的 sidecar

- 状態: 採用（2026-10-03） / 関連: D1/D2/D5/D18、synthesis §3.4, §4.2–4.3、05 §7.4

## Context
設計書は人が読み、git で版管理し、GitHub でもそのまま読め、再生成しても人の編集と確認が失われない必要がある。block には安定 ID が要り、ID の付与をエディタに任せると崩壊する（Tiptap UniqueID）。

## Decision
- 置き場所は `<repo>/.mitori/`（`docDir` で変更可）。**既定は `.mitori/.gitignore` = `*` の自己 ignore**で、`mitori init --commit` が commit を opt-in にする（`cache/` `tmp/` だけ ignore、`.gitattributes` に `linguist-generated`）。非 git ディレクトリでは `~/.mitori/repos/<ws>/doc/` が既定。
- **Markdown が本文の正本**: 固定目次（`DOC_TEMPLATE`）の節ごとに 1 ファイル、§6 は module ごとに `doc/modules/<slug>.md`。block ID は **block 末尾の HTML コメント `<!-- b_xxxxxxxx -->`**（fence・表・図は直後の行。`BLOCK_ID_PLACEMENT`）。citation は repo 相対リンク + `#Lx-Ly`。図は IR から生成した ```` ```mermaid ```` fence（GitHub 表示用）。
- **`doc.index.json` がメタデータの正本**（depth・kind・audience・origin・freshness・lock・claims・cites・diagram IR・glossary・reading paths）。キー整列・決定的 serialize。`mitori.json`（manifest）は版・snapshot・prompt/extractor 版・coverage・使用量。
- 決定的 block（facts 表・見出し）の ID は ~~`hash(module|section + slot)`~~（R1-2: core `staticBlockId(docId, slot)`）、自由文の ID は生成時に払い出す。再生成は既存 ID への update/new/delete/keep だけを出させる。
- 人が外部エディタで直した block は hash 不一致で `human-edited` として取り込み、以後の再生成は提案になる。thread はローカル（D18）、resolved から昇格した決定だけ `decisions/` に commit。
- 生成は主言語だけ eager。他言語は block 単位の遅延翻訳をローカルにキャッシュ（D5）。

## Consequences
- GitHub 上で設計書が出典リンクごと読める（無料の共有手段）。
- serialize を決定的に保つ規律が要る（開いて保存しただけで diff が出たらバグ）。golden テストで守る。
- `.mitori/**` は agent の deny glob。設計書の更新は `docUpdate` 出力 → 提案 → 人の accept の経路だけ。

## Alternatives
- sidecar だけ（内容 hash で対応付け）: 編集で対応が切れやすい。
- `{#id}` 属性記法: GitHub で表示が汚れる。
- WYSIWYG の文書モデル: IME と性能のリスク。

## 改訂 R1（2026-10-03、レビュー反映） — 本節が上の Decision より優先

1. **永続形の確定（CONS-01）**: `doc.index.json` の block meta に `aspect?: BlockAspect`（`BlockAspect` は core 所有）。`modules[]` は `DocModuleEntry {id, section, ifaceDigest, slug, name, summary?, parent?, reps}`（`reps` = PageRank 上位 ≤ 32 path を path 順で保存）。別マシン・DB 消失時はこの行から module ID と slug を復元する（indexer §6.6）。
2. **docId と静的 ID（CONS-11）**: docId は最初の `applyStatic` か `mitori init` で発行し、manifest の雛形（`effort: null`, `generatedAt: null`, `models: []`）を書く。決定的 block の ID は core `staticBlockId(hasher, docId, slot) = "b_" + base32(xxh3(docId + "\0" + slot))[:8]`（上の `hash(module|section + slot)` を置き換える唯一の式）。
3. **cite の永続（PT-11）**: 再アンカー後の**現在位置**は `index.sqlite` の `doc_cites`。commit される `doc.index.json` と Markdown のリンクは「最後の cite flush」の位置。cite だけの移動の書き出しは、ファイルが 10 s 静止し生成が走っていないとき（または明示 flush・accept・auto-commit）まで遅らせる。flush は block 断片の memo で O(変更)、serialize は write queue の外、rename だけ中。分割（shard）は 10k block bench が 5 ms を超えたら採用（REVIEW-LOG R1-O6）。
4. **書き込みの安全（SEC-01・SEC-02）**: docDir の全書き込みは platform `SafeWriter`（kind `doc`、ADR-0014）。slug は `SLUG_RE` で検証し、seed・repo 設定から来た不正な slug は再生成。永続化された `file` は path として使わず毎回再計算。docDir の発見は (1) workspace override (2) `<root>/.mitori/mitori.json` だけ（`git ls-files '*mitori.json'` は廃止。別の場所の manifest は同じ docId が登録済みのときだけ）。repo root は docDir にできない。所有台帳 `doc_files(rel, sha256_last_written)` と異なるファイルは上書きしない（md は §10.4 の取り込み、その他は notice）。
5. **deny（SEC-02）**: resolver は既定以外の docDir に対しても `<docDir>/**` を deny に加える。
6. **和欧間の空白（UXP-24 / SC-19、方針を凍結）**: 原稿の Markdown は CJK↔英数の境界に ASCII 空白を 1 つ置く（GitHub・エディタ・agent で読みやすい）。mitori の renderer はその空白を code span・link の外で決定的に除去し、UI は `text-autospace: normal`。ANCHOR_TEXT_RULES も同じ除去を行い TextQuote の offset を一致させる。
