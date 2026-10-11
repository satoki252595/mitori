# UI 最終統合ビルドの確認（2026-10-11）

Settings の Codex native guided setup、翻訳、初回 scan status 競合修正を含む共有 working tree を `scripts/nd bun run build:bin` で host 向けに build した。`dist/mitori-darwin-arm64` は 70,565,490 bytes、SHA-256 `67d632fa1c4fb061bb4d9630f2f5efd2d7e5f53ff08b803f7977d5a9a1e33459`。Git へ binary は追加していない。LLM 呼び出し・新依存・予算変更はない。

## 設定と型

- Codex を選ぶと model `gpt-6.1-sol`、native checked、推計上限 USD 1 が入る。
- 作成 command は `setup codex --native --max-estimated-usd '1' --model 'gpt-6.1-sol'`。native を外すと `setup codex --repo '/repo/example'` になる。
- advanced の新規 Codex 切替 option はない。既に Codex 設定済みなら disabled option と guided 設定への案内を表示し、advanced 保存を無効にする。
- 以上の browser 回帰 1 件成功（414 ms / suite 1.1 s）、browser PATCH 0。最初の試行は mock が旧 `apps/web/dist` を参照していたため最終 shipping `dist/.build/web` へ揃え、失敗した 1 件だけ再実行した。disabled option は実際の `option.disabled` property を検証した。
- 初回 summary と Reader の再検出なし回帰 2 件成功（341 / 21 ms）。provider unit 6 pass / 50 assertions、web tsc pass、Svelte 0 errors / 0 warnings、対象 8 files の Biome exit 0。

## 実配信とブラウザ

同じ compiled binary の loopback HTTP 配信を既存 `--strict --no-startup` で取得した。strict 全項目成功。

| 項目 | 実測 | 元の limit |
|---|---:|---:|
| 初期 JS gzip | 54.639 KB | 150 KB（target 60 KB も達成） |
| CSS gzip | 18.100 KB | 25 KB |
| gen chunk gzip | 6.890 KB | 6.900 KB |
| palette gzip | 4.516 KB | 4.600 KB |
| settings gzip | 6.945 KB | 9.200 KB |
| cm6 + merge | 101.277 KB | 155.000 KB |
| precompressed | 100% | 100% |

通常 Reader は実取得 **6 requests / 50.2 ms / 2,058 DOM / 8 listeners**。取得 URL は最終 perf annotation に保存した。

1. `/w/WS/doc/s8`
2. `/assets/boot-BTIj5zYu.js`
3. `/assets/rolldown-runtime-DK3Fl9T5.js`
4. `/assets/initial-CxGPntV5.css`
5. `/api/v1/ws/WS/ui`
6. `/api/v1/events`

compiled perf の対象 4 件は 11.0 s で成功。shell **274 ms**、firstUseful **2,027.9 ms**、scanSummary **1,771.5 ms**（修正前 3,312.1 ms、元の limit 2,000 ms）。標準ハーネスが実測した factor は **1.12** で基準機許容 0.9–1.1 の外なので、時間は report-only。raw 値が元の limit を下回ったことと正式な基準機合格を区別する。

TOC の最初の測定に負値 1 件があった。Playwright の actionability 待ち中に別の refresh が描画し、click より前の mark を拾った計測競合だった。その値は採用せず、実 click timestamp 以降の最初の mark を待つようハーネスを修正した。action 開始 → paint / actionability も引き続き annotation に残す。TOC 1 件だけ再実行し、**82.5 / 31.0 / 64.5 / 38.9 / 31.1 / 27.7 ms**（全 6 操作、有限・非負）で成功。factor 1.11、report-only。製品の再 build は不要なハーネス変更である。

compiled a11y は map/Reader × light/dark の axe/probes **8 pass / 8.0 s**、違反 0。詳細・以前の無効 TOC 値・最新の有効な再実行を `ui-bench-release.json` に保存した。nonce/token は保存せず workspace ID は `WS` に置き換えた。
