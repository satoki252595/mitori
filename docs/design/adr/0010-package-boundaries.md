# ADR-0010: パッケージ境界 — ports & adapters、gen ⟂ loop、契約先行

- 状態: 採用（2026-10-03） / 関連: ARCHITECTURE §3

## Context
6〜8 人の実装者が並列に作る。境界が曖昧だと結合時に手戻りが出る。Bun 依存を薄く保って npm 撤退先を残したい。

## Decision
- 13 パッケージ / 3 アプリ（`PACKAGE_DEPS` を正本とし `scripts/check-boundaries.ts` が CI で検査）。
- **`@mitori/core` = 型 + 純データ + 純関数**（API 型・SSE 型・状態遷移表・価格表・エラー表・HTML 契約を含む）。isomorphic。
- **`@mitori/platform` だけが Bun/Node の API を使う**（server と cli は composition のために例外）。ドメインはポート（`SqlDb`, `Spawner`, `WorkerPool`, `Hasher`, `GitReader`, `Logger`, `Clock`, `EventSink`）を受け取る。
- **`gen` と `loop` は互いに依存しない**。両方が `indexer` / `doc` / `anchor` / `agent` に依存し、相互作用は server がイベントで配線する。
- 公開面は `src/index.ts` の `createXxx(deps)` + 型 + migration 配列のみ。deep import 禁止。
- SQLite のテーブルは所有パッケージの接頭辞（`idx_` `doc_` `gen_` `rev_` `job_` `use_` `srv_`）。migration はパッケージごとの連番。
- 契約（`docs/design/contracts/`）を WP-00 で `packages/*` に移し、以後の変更は architect レビュー。

## Consequences
- 各 WP はフェイク（in-memory SQLite、録画 stream の Spawner、固定 Clock）で単独に進められる。
- 境界をまたぐ機能（例: accept 後の設計書更新提案）は server の配線コードに現れるので、そこに結合テストを集中させる。

## Alternatives
- 少数の大きなパッケージ（core / server / web）: 並列作業で衝突し、Bun 依存がドメインに漏れる。
- gen と loop を 1 パッケージ: 生成とレビューの変更が互いに波及する。

## 改訂 R1（2026-10-03、レビュー反映: CR test-4・CONS-26・CONS-02）

- `@mitori/testkit`（test 専用）を `PACKAGE_DEPS` に追加。全 package に依存してよく、どの production package からも依存されない。各 package は test 専用の subpath `@mitori/<pkg>/testing`（`src/testing.ts`）を export してよい（`test/**`・`e2e/**`・`bench/**`・`eval/**`・testkit からのみ import 可）。
- `@mitori/doc` の重い処理（ELK・Shiki）は factory に `WorkerPool` を注入して行う（`createBlockRenderer` / `createDiagramLayouter` / `createHtmlExporter`）。doc は Bun API もファイル読みも直接使わない。
- composition root と配線は `contracts/server.ts`（`createServer`・`DOMAIN_WIRING`）が正本。

## 改訂 R2（2026-10-06、CR test-7）

- test codeからは既存helperだけを公開する `@mitori/testkit/fixtures` / `@mitori/testkit/golden` も使用できる。全barrel経由の不要な型検査を避けるための完全一致2subpathに限り、productionからのtestkit importとその他のdeep importは禁止を維持する。
