# ADR-0001: ランタイムと配布 — Bun 1.4 単一バイナリ + npm 撤退先

- 状態: 採用（2026-10-03） / 関連: 05 §3, §8.1、synthesis §3.2、D9

## Context
mitori は `mitori` と打って 0.3 秒でブラウザが開くことを体験の核にしている。UI・Worker・SQLite・WASM パーサを 1 つの配布物にまとめ、macOS / Linux / Windows に配りたい。Cloudflare の共有ビューとも同じ TypeScript とパーサを共有したい。

## Decision
- **Bun 1.4 + `bun build --compile` の単一バイナリ**を主配布にする。web の `dist/` は `import … with { type: "file" }` で埋め込み、brotli/gzip を事前圧縮する。
- Bun 固有 API（`Bun.*`, `bun:sqlite`, `Bun.hash`, `Bun.spawn`）は `@mitori/platform` に閉じ込め、Node ≥ 22 のアダプタ（`node:sqlite`, `node:worker_threads`, wasm xxhash）を同じポートで用意する。これが **npm 版（`npx mitori`）の撤退先**になる。
- native addon は持たない（純 WASM）。`.node` 同梱問題（bun#44063）と oxc の手動同梱を避ける。

## Consequences
- 起動 6〜10 ms、UI 同梱 78.7MB・初回応答 9.7 ms・idle RSS 13MB（実測）。バイナリ予算は 85MB 目標 / 95MB 上限。
- 62MB は Bun runtime の床。圧縮配布（gzip 約 29MB）で緩和する。
- macOS の署名・notarization、自己更新は未検証（P3）。
- Linux の Bun `fs.watch` の挙動は P0 で実測して watcher 実装を決める（ADR ではなく O3）。

## Alternatives
- Go 単一バイナリ（crit 方式, 20.8MB）: サイズで勝るが、tree-sitter WASM・UI・Workers と TS を共有できない。
- Node 単体: 起動 22.5 ms、単一バイナリ化が弱い。
- Agent SDK 同梱: platform binary 221MB。stream-json driver（約 300 行）を自前で持つ方が軽い。

## 改訂 R1（2026-10-03、レビュー反映: SC-04・SC-08・SC-13・SC-25・SEC-16）

- このプロジェクトセッションで作るバイナリは **darwin-arm64 と linux-x64 の 2 つ**。macOS x64・Linux arm64・Windows x64・Node 22 版（npm 撤退先）は範囲外（MILESTONES §6）。Node adapter は port の形だけ保ち、dual-green は要求しない。
- 単一バイナリの結合は最後ではなく最初に行う（WP-11a walking skeleton）。ELK は `elk-api.js` + 埋め込みの `elk-worker.min.js`（`with {type:"file"}`）で専用 Worker に置く（既定の elkjs entry と `elk.bundled.js` は Bun の compile 後に `new _Worker(url)` で失敗、実証済み）。Shiki は fine-grained import のみ（convenience bundle は +9.3MB）。サイズ gate は 85MB 目標 / 95MB 上限を初日から。
- TypeScript は workspace 全体で 6.0.3 に固定（svelte-check の peer を満たす）。
- 供給網: `bun install --frozen-lockfile`、`trustedDependencies` 空、wasm/grammar の sha256 を `assets.lock.json` で build 時に検証、release に SHA256SUMS + minisign 署名、SBOM。self-update（P3）は署名検証必須。
