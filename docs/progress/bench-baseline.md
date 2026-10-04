# bench-baseline — 全 bench を 1 回（2026-10-04、rem/bench）

`scripts/nd bun run bench --suite all --absolute --out <file>`（`--no-wait` なし: 開始前に負荷が下がるのを 2 回待ってから走った）。
表は `bun bench/report.ts <file>` の出力で、**machine factor を掛けない生の値と、生の target / limit の比較**（この機械を基準機とみなした判定）。
runner 自身の判定は、calibration の factor 1.245（基準機の記録 `bench/runner/reference.json` は 2026-10-03）で時間 budget を「scaled・gate しない」にし、
負荷の高い case の時間 budget は「skipped」と表示した（このパスで入れた負荷判定）。exit 1 は、構造・サイズ・counter の超過（下の
**over limit / over max** のうち scale = none のもの）と `idx.freshness` の失敗による。

## 測った機械と負荷

- Apple M5 Max（18 コア、128 GB）、macOS 27.0（Darwin 27.0.0）、bun 1.4.2、node 22.23.3、Chromium 153（Playwright 同梱）、AC 電源。
- **他のエージェントと同居**。1 分ロードアベレージ（`os.loadavg()[0]`）: run 開始時 **18.7**（コア数 × 0.5 = 9 を超えて `noisy`）、
  case ごとの開始時 **9.7〜30.4**（表の `load` 列）。`uptime` は run の直前 38.3 / 57.3 / 53.4、直後 13.4 / 21.2 / 35.3（1 / 5 / 15 分）。
  静かな機械の数字ではない。時間の列は「負荷 10〜30 のときにこうだった」と読む。
- 所要 ≈ 8 分（13 ファイル・65 case）。compiled binary（`dist/mitori-darwin-arm64`、run の直前に build）を使う case: `srv.rss.*`。
- ※ の 2 行は直後の修正（commit `e1be790`）後に同じ機械で測り直した値: `idx.rss.idle`（定義を spec に合わせた。最初の版は
  in-memory の索引まで数えて 622 MB）と `idx.freshness`（最初の版はブロックのファイルの深さを無視した出典で 1 回待ち切れなかった）。

## 結果

- sha 73a2d2271ed4 · Apple M5 Max · 18 cores · 128 GB · Darwin 27.0.0 · bun 1.4.2 · node 22.23.3 · chrome 153.0.8010.12
- started 2026-10-04T08:42:51.126Z · loadavg at start 18.69 (noisy: true) · power ac · factor 1.245 (measured)

| id | unit | median | p95 | n | cv | target / limit | verdict (raw) | load |
|---|---|---:|---:|---:|---:|---|---|---:|
| `agent.firstPhase` | ms | 1.284 | 1.572 | 10 | 0.136 | 300.0 / 1000 | ok | 18.07 |
| `agent.interactiveWait` | ms | 0.002 | 0.004 | 20 | 0.423 | 50.00 / 50.00 | ok | 18.07 |
| `anchor.batch1k` | ms | 8.540 | 15.12 | 15 | 0.197 | 50.00 / 100.0 | ok · relative gate | 18.07 |
| `anchor.remap10k` | ms | 3.633 | 4.449 | 272 | 0.121 | 20.00 / 50.00 | ok · relative gate | 18.07 |
| `dev.check` | ms | 7838 | 8711 | 3 | 0.093 | 15000 / 30000 | ok | 18.07 |
| `doc.elk.1000` | ms | 433.6 | 1464 | 7 | 0.677 | 400.0 / 600.0 | over target · relative gate | 24.99 |
| `doc.elk.300` | ms | 170.8 | 617.2 | 7 | 0.799 | 100.0 / 150.0 | **over limit** · relative gate | 29.23 |
| `doc.flush.10k` | ms | 23.72 | 143.9 | 20 | 1.194 | 5.000 / 20.00 | **over limit** · relative gate | 29.23 |
| `doc.render.2000.cached` | ms | 5.169 | 6.977 | 10 | 0.180 | 100.0 / 150.0 | ok · relative gate | 27.61 |
| `doc.render.2000.cold` | ms | 218.0 | 269.0 | 5 | 0.294 | 1000 / 1500 | ok · relative gate | 27.61 |
| `doc.reopen` | ms | 19.43 | 19.75 | 3 | 0.044 | — | — (no budget) | 27.61 |
| `doc.shiki.100` | ms | 6.664 | 10.36 | 30 | 0.204 | 5.000 / 10.00 | over target · relative gate | 27.61 |
| `gen.rerun` | ms | 257.5 | 259.0 | 3 | 0.004 | — | — (no budget) | 30.36 |
| `idx.freshness` ※ | ms | 73.16 | 108.0 | 10 | 0.197 | 50.00 / 1000 | over target (p95) | 9.118 |
| `idx.leaf.loc` | count | 5605 | 5605 | 1 | 0.000 | 6000 / 9000 | ok | 26.05 |
| `idx.leiden.ms` | ms | 312.0 | 531.6 | 3 | 0.381 | 80.00 / 200.0 | **over limit** · relative gate | 25.96 |
| `idx.pack.ms` | ms | 7.443 | 9.637 | 131 | 0.149 | 20.00 / 50.00 | ok | 27.71 |
| `idx.pack.tokens` | tokens | 9935 | 9935 | 1 | 0.000 | 10000 / 12000 | ok · golden gate | 29.34 |
| `idx.persist.ms` | ms | 924.8 | 1016 | 3 | 0.108 | 300.0 / 800.0 | **over limit** · relative gate | 29.34 |
| `idx.rss.idle` ※ | MB | 0.000 | 0.000 | 1 | 0.000 | 0.000 / 5.000 | ok | 6.854 |
| `idx.rss.peak` | MB | 1116 | 1131 | 3 | 0.045 | 700.0 / 1000 | **over limit** | 21.62 |
| `idx.s01.cold.100kloc` | ms | 696.4 | 812.1 | 5 | 0.081 | 300.0 / 500.0 | **over limit** | 21.62 |
| `idx.s01.cold.7kfiles` | ms | 1921 | 3352 | 5 | 0.294 | 1200 / 1500 | **over limit** | 20.61 |
| `idx.s04.cold.100kloc` | ms | 878.6 | 1447 | 5 | 0.258 | 1000 / 2000 | ok | 20.14 |
| `idx.s04.cold.react` | ms | 2552 | 2620 | 3 | 0.018 | 1500 / 3000 | over target | 19.43 |
| `idx.s04.cold.small` | ms | 425.4 | 528.2 | 5 | 0.133 | 400.0 / 800.0 | over target | 19.43 |
| `idx.search.ms` | ms | 1.018 | 1.419 | 938 | 0.193 | 1.000 / 5.000 | over target · relative gate | 19.39 |
| `idx.module.sig.tokens` | tokens | 63181 | 63181 | 1 | 0.000 | 24000 / 32000 | **over limit** · golden gate | 16.86 |
| `idx.update.1file` | ms | 49.07 | 66.53 | 20 | 0.186 | 15.00 / 30.00 | **over limit** | 16.86 |
| `idx.warm.rescan` | ms | 209.9 | 274.5 | 15 | 0.181 | 10.00 / 25.00 | **over limit** | 16.86 |
| `idx.warm.rescan.s01` | ms | 16.02 | 19.77 | 63 | 0.129 | — | — (no budget) | 16.87 |
| `idx.warm.rescan.7k` | ms | 1618 | 1774 | 10 | 0.057 | 25.00 / 50.00 | **over limit** | 20.08 |
| `idx.warm.rescan.7k.s01` | ms | 36.20 | 46.18 | 15 | 0.086 | — | — (no budget) | 17.67 |
| `git.accept` | ms | 126.8 | 135.4 | 10 | 0.043 | 300.0 / 800.0 | ok | 16.23 |
| `loop.bundle` | ms | 0.525 | 1.089 | 100 | 0.379 | 60.00 / 100.0 | ok (p95) · relative gate | 15.33 |
| `mcp.init` | ms | 35.42 | 38.47 | 10 | 0.030 | 60.00 / 200.0 | ok · relative gate | 15.33 |
| `git.precheck` | ms | 0.751 | 2.239 | 15 | 0.619 | 50.00 / 100.0 | ok | 15.33 |
| `git.snapshotWorktree` | ms | 289.5 | 464.1 | 10 | 0.187 | 500.0 / 1000 | ok | 15.33 |
| `loop.threadCreate` | ms | 0.343 | 0.446 | 30 | 0.209 | 30.00 / 100.0 | ok · relative gate | 14.34 |
| `srv.rss.idleEmpty` | MB | 68.52 | 68.52 | 3 | 0.004 | 30.00 / 50.00 | **over limit** | 14.34 |
| `srv.rss.idleLoaded` | MB | 729.9 | 729.9 | 1 | 0.000 | 150.0 / 250.0 | **over limit** | 13.73 |
| `srv.sse.p99` | ms | 4.820 | 6.951 | 5 | 0.217 | 5.000 / 10.00 | ok · relative gate | 10.13 |
| `srv.ttfb.health` | ms | 0.126 | 0.245 | 30 | 0.320 | — | — (no budget) | 10.52 |
| `srv.ttfb.shell` | ms | 0.143 | 0.532 | 30 | 0.948 | — | — (no budget) | 10.52 |
| `ui.cls.boot` | ratio | 0.049 | 0.049 | 3 | 0.471 | 0.000 / 0.010 | **over limit** | 10.52 |
| `ui.dom.typical` | count | 945.0 | 945.0 | 3 | 0.000 | 5000 / 15000 | ok | 9.743 |
| `ui.firstUseful.100k` | ms | 1239 | 1380 | 3 | 0.066 | 3000 / 5000 | ok | 9.743 |
| `ui.floorplan.nodes` | count | 410.0 | 410.0 | 3 | 0.000 | 1500 / 1500 | ok | 9.743 |
| `ui.heap.10k` | MB | 3.624 | 3.624 | 1 | 0.000 | 100.0 / 150.0 | ok | 9.743 |
| `ui.inp` | ms | 24.00 | 32.00 | 3 | 0.333 | 100.0 / 200.0 | ok | 11.30 |
| `ui.inp.p75` | ms | 16.00 | 16.00 | 3 | 0.000 | — | — (no budget) | 10.39 |
| `ui.level` | ms | 11.35 | 12.10 | 5 | 0.138 | 50.00 / 100.0 | ok | 9.728 |
| `ui.palette` | ms | 31.70 | 33.90 | 5 | 0.042 | 16.00 / 33.00 | over target | 10.11 |
| `ui.palette.worker` | ms | 3.422 | 5.228 | 15 | 0.188 | — | — (no budget) | 10.42 |
| `ui.readerOpen` | ms | 46.10 | 46.30 | 3 | 0.109 | — | — (no budget) | 10.42 |
| `ui.section` | ms | 64.70 | 65.70 | 5 | 0.018 | 100.0 / 150.0 | ok | 10.42 |
| `ui.shellPaint` | ms | 1178 | 1315 | 3 | 0.067 | 300.0 / 500.0 | **over limit** | 12.08 |
| `ui.shortcut` | ms | 0.600 | 1.100 | 5 | 0.335 | 50.00 / 100.0 | ok | 12.08 |

| counter | value | max | verdict |
|---|---:|---:|---|
| `doc.reopen.renderCalls` | 0 | 0 | ok |
| `gen.rerun.engineCalls` | 0 | 0 | ok |
| `idx.warm.parseCalls` | 0 | 0 | ok |
| `idx.warm.filesHashed` | 0 | 0 | ok |
| `idx.warm.sqlWrites` | 0 | 0 | ok |
| `ui.fetch.levelSwitch` | 0 | 0 | ok |
| `ui.fetch.readerOpen` | 29 | 6 | **over max** |

## corpus ごとの構造（`bun bench/runners/idx-structure.ts`。表の `idx.pack.tokens` / `idx.module.sig.tokens` / `idx.leaf.loc` は最大値）

| repo | leaves | repo pack (tokens) | largest leaf sig skeleton (tokens) | that leaf (LOC) | leaf LOC p10 / median / p90 |
|---|---:|---:|---:|---|---|
| crit | 14 | 9757 | 19248 | `internal-session-session` (5850) | 2318 / 4820 / 6279 |
| m3e-canvas | 5 | 9875 | 15774 | `lib-tokens` (4799) | 3715 / 4799 / 5875 |
| flask | 3 | 9935 | 13684 | `flask` (4685) | 777 / 2410 / 4685 |
| ripgrep | 8 | 9881 | 23252 | `core-flags-defs` (7025) | 3524 / 4573 / 7025 |
| hono | 5 | 9401 | 30638 | `src` (5800) | 3506 / 3932 / 5800 |
| excalidraw | 26 | 9904 | 63181 | `excalidraw-components-app` (10842) | 2367 / 5605 / 5979 |
| fastapi | 8 | 9845 | 24644 | `docs-src-handling-errors-extra-models` (2022) | 1857 / 2913 / 5980 |
| react | 69 | 9522 | 35713 | `compiler-react-compiler-ast` (5607) | 3223 / 5325 / 5987 |

## 読み方（どれが負荷で、どれが本物か）

- **負荷が主因と見てよいもの**（cv が大きいか、負荷の低い単独実行で予算内）: `doc.elk.300`（単独・負荷 15 で 61〜83 ms、ここでは cv 0.80）、
  `doc.flush.10k`（cv 1.19）、`idx.s01.cold.*`（WP-02 の静かな機械で crit 436 ms、gostd 1.9 s）、`ui.palette`（単独で 26〜33 ms）。
  これらは時間 budget なので runner は「skipped」と表示し、gate しなかった。
- **負荷では説明できない超過**（所有トラックへの依頼は `docs/design/cr-requests/bench.md`）:
  - `idx.warm.rescan` 210 ms / `idx.warm.rescan.7k` 1.6 s（budget 10 / 25、25 / 50 ms）: 変化の無い warm scan が S2–S4 をやり直す。
    S0–S1 だけなら crit 16 ms・gostd 36 ms（`*.s01`）。
  - `idx.update.1file` 49 ms（15 / 30）: WP-02 の bench（test 用の deps）では 2.3 ms。daemon と同じ部品（platform の GitReader・
    SQLite ファイル）で 1 ファイル更新が S2–S4 の再計算込みで 20 倍。内訳は未調査（rem-bench §5）。
  - `idx.module.sig.tokens` 63k（limit 32k）: excalidraw の `excalidraw-components-app`（10,842 LOC の葉）。葉の LOC が上端（9k）を
    超えていることと同じ原因。hono 30.6k・react 35.7k も target 24k を超える。
  - `idx.rss.peak` 1,116 MB（limit 1,000）: react。監査（1,104 MB）と同じ。
  - `idx.persist.ms` 925 ms（800）・`idx.leiden.ms` 312 ms（200、S3 全体なので上限値）: react。
  - `srv.rss.idleEmpty` 68.5 MB（limit 50）: 出荷する daemon（compiled、macOS の RSS）。SRV-AT-10 の試験は軽い adapter の probe で、
    Linux で 36 MB。どちらで判定するか（RSS か footprint か、F7）は決まっていない。
  - `srv.rss.idleLoaded` 730 MB（250）: crit を開いて 60 s idle。監査の RSS 968 MB / footprint 223 MB と同じ論点。
  - `ui.shellPaint` 1.18 s（limit 500 ms）: CLI が scan の後にしか URL を出さない（構造的）。
  - `ui.cls.boot` 0.049（limit 0.01）、counter `ui.fetch.readerOpen` 29（max 6 [仮]）。
- **予算内**: agent・anchor・loop（thread / bundle / git の 3 つ / mcp）・doc の描画・`srv.sse.p99`（4.8 ms、負荷 10）・
  UI の操作（level 11 ms・section 65 ms・shortcut 0.6 ms・INP p98 24 ms）・`ui.firstUseful.100k` 1.24 s（target 3 s）・DOM 945・
  counter 7 つのうち 6 つ（warm の parse / hash / SQL 書き込み 0、reopen の再描画 0、生成の再実行のエンジン呼び出し 0、レベル切替の fetch 0）、
  `idx.rss.idle` 0 MB（60 s で parse Worker 0 本）。
- `agent.firstPhase` 1.3 ms は **mitori 側の経路だけ**（録画を speed 0 で再生、in-process の spawner）。本物の claude の起動は
  `agent.firstPhase.cold`（契約テスト）の領分。`ui.heap.10k` 3.6 MB は react の Reader 1 節（file tree は開いていない）。

## head vs base と配信バイト

`bun run bench:compare --base HEAD~1 --id anchor --id idx.search.ms --id loop.bundle --id ui.palette.worker --pairs 2 --no-absolute --no-wait`
（新しい case が base 側にもある commit 同士。exit 0）:

### bench: head `e1be7906` vs base `73a2d227` — pass

| id | unit | base | head | Δ% | cv (base / head) | status |
|---|---|---|---|---|---|---|
| anchor.batch1k | ms | 9.686 | 9.756 | +0.7 % | 0.129 / 0.102 | ok (re-measured) |
| anchor.remap10k | ms | 4.231 | 4.442 | +5.0 % | 0.148 / 0.212 | ok (re-measured) |
| idx.search.ms | ms | 0.928 | 0.894 | -3.6 % | 0.181 / 0.126 | ok |
| loop.bundle | ms | 0.518 | 0.503 | -2.9 % | 0.612 / 0.609 | noisy (cv > 25 %) — warning only (re-measured) |
| ui.palette.worker | ms | 2.652 | 2.629 | -0.8 % | 0.162 / 0.180 | ok |

`bun run size`: exit 0（chunk 7 つが limit 超で「M3 までは警告」、`asset.viewer.js` 58.76 / 60 KB、`bin.startup` 39.5 ms で target 超の警告）。

## 再現

```
scripts/nd bun run build:bin
scripts/nd bun run corpus:fetch            # gostd を含む（lock に pin 済み）
scripts/nd bun run bench --suite all --absolute --out bench/results/<sha>.json
scripts/nd bun bench/report.ts bench/results/<sha>.json
scripts/nd bun bench/runners/idx-structure.ts
```
