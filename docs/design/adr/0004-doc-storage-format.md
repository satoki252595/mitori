# ADR-0004: 設計書の保存形式 — Markdown 正本 + 末尾 ID コメント + 決定的 sidecar

- 状態: 採用（2026-10-03） / 関連: D1/D2/D5/D18、synthesis §3.4, §4.2–4.3、05 §7.4

## Context
設計書は人が読み、git で版管理し、GitHub でもそのまま読め、再生成しても人の編集と確認が失われない必要がある。block には安定 ID が要り、ID の付与をエディタに任せると崩壊する（Tiptap UniqueID）。

## Decision
- 置き場所は `<repo>/.mitori/`（`docDir` で変更可）。**既定は `.mitori/.gitignore` = `*` の自己 ignore**で、`mitori init --commit` が commit を opt-in にする（`cache/` `tmp/` だけ ignore、`.gitattributes` に `linguist-generated`）。非 git ディレクトリでは `~/.mitori/repos/<ws>/doc/` が既定。
- **Markdown が本文の正本**: 固定目次（`DOC_TEMPLATE`）の節ごとに 1 ファイル、§6 は module ごとに `doc/modules/<slug>.md`。block ID は **block 末尾の HTML コメント `<!-- b_xxxxxxxx -->`**（fence・表・図は直後の行。`BLOCK_ID_PLACEMENT`）。citation は repo 相対リンク + `#Lx-Ly`。図は IR から生成した ```` ```mermaid ```` fence（GitHub 表示用）。
- **`doc.index.json` がメタデータの正本**（depth・kind・audience・origin・freshness・lock・claims・cites・diagram IR・glossary・reading paths）。キー整列・決定的 serialize。`mitori.json`（manifest）は版・snapshot・prompt/extractor 版・coverage・使用量。
- 決定的 block（facts 表・見出し）の ID は `hash(module|section + slot)`、自由文の ID は生成時に払い出す。再生成は既存 ID への update/new/delete/keep だけを出させる。
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
