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

## 改訂 R1（2026-10-03、レビュー反映: UXP-20・SC-18・SC-21・SEC-06）

- doc の直接編集は block 単位の CM6 Markdown ソース編集（初回編集時に lazy load、失敗時だけ textarea）。cite link は原子的な widget として描き、保存で claim が外れるなら確認する。
- UI の試験: 純 TS のロジックは `bun test`、component の振る舞いは Playwright（`e2e/component/`）。happy-dom と bun-plugin-svelte（0.0.6）は使わない。
- 初期 JS の hard gate は M3 まで 150KB（60KB は警告）、CSS 25KB、Web フォント 0、Review 前に CM6 を要求しない、の 4 つ。chunk ごとの値は M3 で確定。
- 認証は header（`Mitori-Session`）と `localStorage`。SSE は fetch stream（EventSource は header を送れない）。

## 改訂 R2（2026-10-05、初期JS目標と初回操作）

- 初期Map / Readerは同じSvelte componentをdaemonで描画し、認証済み`GET /ws/:ws/ui`でHTMLとredacted DTOを返す。大きなJSONは既存sectionと同じ8KiB閾値・br/gzip negotiationで配信する。任意HTMLの入力やinline executable scriptは受け付けない。
- 初期JSはnative controllerでMapの選択・移動、Readerのlevel / hash / j,k / TOC / 引用popoverを扱う。Composer・Review・Paletteなどを初めて必要とした時に既存Svelte UIを読み、選択・focus・scroll・費用見積りを引き渡す。Readerの窓取得・SSE・Undo・人の同意は維持する。
- effort切替は3種のdry estimateと非活性のSSR variantsを初回に受け取り、追加fetchなしで切り替える。同じGenEstimateCardのvisible clockと明示クリック条件を使い、費用・data同意を描画だけで成立させない。
- M3の初期JS hard gateを60KiB gzipへ進めた。通常buildの初期facts paint mark修正後S1は43,792 bytes（42.8KiB）、shipping実daemonのstatic Map/Readerは43,798 bytes gzip相当で確認済み。CSS / fonts / CM6条件も維持し、HTML・SVG・JSON込みの転送量はJSとは別に記録する。fixtureと圧縮条件、最終CIの証跡はprogressに保存する。
