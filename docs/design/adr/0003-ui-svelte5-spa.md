# ADR-0003: UI — Svelte 5（runes）SPA + サーバ描画 block HTML

- 状態: 採用（2026-10-03） / 関連: 05 §4–7、07 §5、D9/D15、補遺 A9

## Context
1 万 block 級の設計書を INP p75 ≤ 100 ms、初期 JS ≤ 60KB gz（上限 150KB）で扱う。性能はフレームワークより「何を DOM にするか」で決まる（05 §4.3）。

## Decision
- **Svelte 5 SPA（Vite 8）**を daemon が配信し、バイナリに埋め込む。web は `@mitori/core`（型・純データ）と `@mitori/client` だけに依存する。
- **Markdown・ハイライト・図レイアウトはサーバ**: block HTML（markdown-it、生 HTML 無効、`HTML_CONTRACT` の class/data 属性）、Shiki（Oniguruma）、ELK（Bun Worker）。クライアントは `innerHTML` + ルート 1 か所のイベント委譲。行単位コンポーネント禁止。
- CodeMirror 6（+`@codemirror/merge`）はコード・diff を開いたときに遅延読み込み。Mermaid は repo 既存 Markdown の fence だけ遅延読み込み（mitori 自身の図は IR + ELK + SVG）。
- **Web フォント 0 byte**。和文・欧文とも OS フォントだけを使い、stack の先頭も OS 標準フォントにする（`FONT_STACKS`）。
- WYSIWYG は入れない。直接編集は block 単位の CM6 Markdown ソース編集。

## Consequences
- Svelte runtime 約 15KB gz + アプリ ≤ 45KB に収める設計が要る（ui spec が chunk 計画を示す）。
- AI エージェントの Svelte 5 runes 知識の鮮度リスク（R17）→ プロジェクト CLAUDE.md に runes 規約を書き、Solid を撤退先に残す。
- 読者レベル切替・⌘K はクライアントだけで完結させる（ネットワーク往復なし）。

## Alternatives
- React/Next: +45〜60KB gz、first paint 221 ms。
- Solid 1.9: 純性能とサイズは上だが、transition・スコープ CSS などの作り込みコストで Svelte。
- Monaco: 0.8〜1.1MB gz。Tiptap UniqueID: 5,000 block で 9.2 s。
