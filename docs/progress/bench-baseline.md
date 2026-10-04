# bench-baseline — 全 bench を 1 回（2026-10-04、rem/bench）

> **検証パスで直したもの（この表を読む前に）**: 下の最初の表の `git.precheck` 0.751 ms は**測定の不具合**（case が promise を待たず、
> 呼び出しの開始だけを計っていた）。正しい値は 87〜114 ms（負荷 14〜15、末尾の「検証パスの再計測」）。`ui.heap.10k` 3.6 MB は main thread
> だけ・palette の索引なしの値で、定義を spec に寄せた再計測は 13.9 MB。`ui.card.optimistic`・`ui.listeners.reader`・`ui.staleBadge`・
> `bin.health` は検証パスで初めて測った。全 suite の再計測（負荷 9〜20）は末尾にある。

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

## 検証パスの再計測（2026-10-04 18:36〜18:44 JST、rem/bench `d872876`）

敵対的検証パスで、同じ機械・同じ手順（`scripts/nd bun run bench --suite all --absolute --out <file>`、`bun bench/report.ts <file>`）で
全 suite をもう一度走らせた。**負荷**: run 開始時の 1 分ロードアベレージ 10.07（`noisy`）、case ごとの開始時 10.2〜19.5（表の `load`）、
30 秒ごとの `sysctl vm.loadavg` は 9.1〜19.6（他のエージェントと同居）。calibration factor 1.317（measured）。所要 ≈ 8 分、66 case。
compiled binary（`dist/mitori-darwin-arm64`、同じ tree から 18:20 に build）を `srv.rss.*`・`mcp.init` が使った。
この run の後で 2 つ直した（commit `084a7c0`）ので、`git.precheck`（待たない promise の修正）と新しい `bin.health` は直後に単独で
測り直した値を 2 つ目の表に置く（1 つ目の表の `git.precheck` 行は修正前の誤った値のまま残してある）。

- sha d872876e2040 · Apple M5 Max · 18 cores · 128 GB · Darwin 27.0.0 · bun 1.4.2 · node 22.23.3 · chrome 153.0.8010.12
- started 2026-10-04T09:36:13.140Z · loadavg at start 10.07 (noisy: true) · power ac · factor 1.317 (measured)

| id | unit | median | p95 | n | cv | target / limit | verdict (raw) | load |
|---|---|---:|---:|---:|---:|---|---|---:|
| `agent.firstPhase` | ms | 1.372 | 3.055 | 10 | 0.377 | 300.0 / 1000 | ok | 10.15 |
| `agent.interactiveWait` | ms | 0.002 | 0.007 | 20 | 0.707 | 50.00 / 50.00 | ok | 10.15 |
| `anchor.batch1k` | ms | 9.950 | 15.84 | 15 | 0.216 | 50.00 / 100.0 | ok · relative gate | 10.15 |
| `anchor.remap10k` | ms | 3.655 | 6.442 | 243 | 0.300 | 20.00 / 50.00 | ok · relative gate | 10.15 |
| `dev.check` | ms | 4652 | 4778 | 3 | 0.066 | 15000 / 30000 | ok | 10.15 |
| `doc.elk.1000` | ms | 261.7 | 290.4 | 7 | 0.069 | 400.0 / 600.0 | ok · relative gate | 16.09 |
| `doc.elk.300` | ms | 85.81 | 109.4 | 7 | 0.142 | 100.0 / 150.0 | ok · relative gate | 15.20 |
| `doc.flush.10k` | ms | 14.37 | 19.97 | 20 | 0.227 | 5.000 / 20.00 | over target · relative gate | 15.20 |
| `doc.render.2000.cached` | ms | 4.772 | 9.432 | 10 | 0.460 | 100.0 / 150.0 | ok · relative gate | 15.20 |
| `doc.render.2000.cold` | ms | 146.2 | 164.5 | 5 | 0.077 | 1000 / 1500 | ok · relative gate | 15.20 |
| `doc.reopen` | ms | 18.93 | 26.77 | 3 | 0.249 | — | — (no budget) | 15.20 |
| `doc.shiki.100` | ms | 5.605 | 9.981 | 30 | 0.287 | 5.000 / 10.00 | over target · relative gate | 15.20 |
| `gen.rerun` | ms | 256.9 | 257.6 | 3 | 0.005 | — | — (no budget) | 14.46 |
| `idx.freshness` | ms | 90.45 | 218.6 | 10 | 0.430 | 50.00 / 1000 | over target (p95) | 14.46 |
| `idx.leaf.loc` | count | 5605 | 5605 | 1 | 0.000 | 6000 / 9000 | ok | 14.10 |
| `idx.leiden.ms` | ms | 299.8 | 304.3 | 3 | 0.063 | 80.00 / 200.0 | **over limit** · relative gate | 14.18 |
| `idx.pack.ms` | ms | 7.699 | 12.05 | 124 | 0.229 | 20.00 / 50.00 | ok | 15.62 |
| `idx.pack.tokens` | tokens | 9935 | 9935 | 1 | 0.000 | 10000 / 12000 | ok · golden gate | 15.62 |
| `idx.persist.ms` | ms | 838.5 | 937.3 | 3 | 0.086 | 300.0 / 800.0 | **over limit** · relative gate | 15.62 |
| `idx.rss.idle` | MB | 0.000 | 0.000 | 1 | 0.000 | 0.000 / 5.000 | ok | 15.62 |
| `idx.rss.peak` | MB | 1145 | 1160 | 3 | 0.014 | 700.0 / 1000 | **over limit** | 13.21 |
| `idx.s01.cold.100kloc` | ms | 750.3 | 794.0 | 5 | 0.029 | 300.0 / 500.0 | **over limit** | 13.21 |
| `idx.s01.cold.7kfiles` | ms | 2211 | 2335 | 5 | 0.031 | 1200 / 1500 | **over limit** | 12.87 |
| `idx.s04.cold.100kloc` | ms | 973.8 | 1041 | 5 | 0.062 | 1000 / 2000 | ok | 13.74 |
| `idx.s04.cold.react` | ms | 1941 | 1959 | 3 | 0.007 | 1500 / 3000 | over target | 14.72 |
| `idx.s04.cold.small` | ms | 440.6 | 459.0 | 5 | 0.028 | 400.0 / 800.0 | over target | 14.72 |
| `idx.search.ms` | ms | 1.175 | 1.488 | 840 | 0.147 | 1.000 / 5.000 | over target · relative gate | 13.00 |
| `idx.module.sig.tokens` | tokens | 63181 | 63181 | 1 | 0.000 | 24000 / 32000 | **over limit** · golden gate | 11.84 |
| `idx.update.1file` | ms | 46.43 | 57.11 | 20 | 0.122 | 15.00 / 30.00 | **over limit** | 11.84 |
| `idx.warm.rescan` | ms | 237.2 | 268.2 | 15 | 0.083 | 10.00 / 25.00 | **over limit** | 11.84 |
| `idx.warm.rescan.s01` | ms | 16.46 | 22.69 | 59 | 0.158 | — | — (no budget) | 12.33 |
| `idx.warm.rescan.7k` | ms | 1917 | 2433 | 10 | 0.121 | 25.00 / 50.00 | **over limit** | 12.79 |
| `idx.warm.rescan.7k.s01` | ms | 50.30 | 64.81 | 15 | 0.151 | — | — (no budget) | 14.43 |
| `git.accept` | ms | 183.2 | 197.3 | 10 | 0.061 | 300.0 / 800.0 | ok | 16.88 |
| `loop.bundle` | ms | 0.586 | 1.794 | 100 | 0.553 | 60.00 / 100.0 | ok (p95) · relative gate | 17.68 |
| `mcp.init` | ms | 41.41 | 47.93 | 10 | 0.078 | 60.00 / 200.0 | ok · relative gate | 17.68 |
| `git.precheck` | ms | 1.162 | 3.971 | 15 | 0.713 | 50.00 / 100.0 | ok | 17.68 |
| `git.snapshotWorktree` | ms | 406.1 | 417.9 | 10 | 0.043 | 500.0 / 1000 | ok | 17.68 |
| `loop.threadCreate` | ms | 0.710 | 1.755 | 30 | 0.511 | 30.00 / 100.0 | ok · relative gate | 17.14 |
| `srv.rss.idleEmpty` | MB | 69.30 | 69.56 | 3 | 0.005 | 30.00 / 50.00 | **over limit** | 17.14 |
| `srv.rss.idleLoaded` | MB | 718.4 | 718.4 | 1 | 0.000 | 150.0 / 250.0 | **over limit** | 19.53 |
| `srv.sse.p99` | ms | 4.389 | 4.594 | 5 | 0.037 | 5.000 / 10.00 | ok · relative gate | 15.16 |
| `srv.ttfb.health` | ms | 0.098 | 0.384 | 30 | 0.673 | — | — (no budget) | 15.16 |
| `srv.ttfb.shell` | ms | 0.109 | 0.298 | 30 | 0.582 | — | — (no budget) | 15.16 |
| `ui.card.optimistic` | ms | 9.650 | 18.60 | 8 | 0.686 | 100.0 / 150.0 | ok | 15.16 |
| `ui.cls.boot` | ratio | 0.018 | 0.032 | 3 | 0.382 | 0.000 / 0.010 | **over limit** | 16.24 |
| `ui.dom.typical` | count | 945.0 | 945.0 | 3 | 0.000 | 5000 / 15000 | ok | 15.54 |
| `ui.firstUseful.100k` | ms | 1527 | 1588 | 3 | 0.035 | 3000 / 5000 | ok | 15.54 |
| `ui.floorplan.nodes` | count | 410.0 | 410.0 | 3 | 0.000 | 1500 / 1500 | ok | 15.54 |
| `ui.heap.10k` | MB | 13.91 | 13.91 | 1 | 0.000 | 100.0 / 150.0 | ok | 15.54 |
| `ui.inp` | ms | 24.00 | 40.00 | 3 | 0.458 | 100.0 / 200.0 | ok | 16.95 |
| `ui.inp.p75` | ms | 16.00 | 16.00 | 3 | 0.000 | — | — (no budget) | 14.71 |
| `ui.level` | ms | 7.050 | 14.75 | 5 | 0.504 | 50.00 / 100.0 | ok | 13.22 |
| `ui.listeners.reader` | count | 9.000 | 9.000 | 3 | 0.000 | 10.00 / 10.00 | ok | 13.04 |
| `ui.palette` | ms | 31.50 | 32.90 | 5 | 0.031 | 16.00 / 33.00 | over target | 13.04 |
| `ui.palette.worker` | ms | 4.517 | 6.720 | 15 | 0.167 | — | — (no budget) | 13.68 |
| `ui.readerOpen` | ms | 50.90 | 127.4 | 3 | 0.630 | — | — (no budget) | 12.90 |
| `ui.section` | ms | 64.50 | 66.70 | 5 | 0.016 | 100.0 / 150.0 | ok | 12.90 |
| `ui.shellPaint` | ms | 1463 | 1519 | 3 | 0.035 | 300.0 / 500.0 | **over limit** | 17.11 |
| `ui.shortcut` | ms | 0.700 | 0.800 | 5 | 0.173 | 50.00 / 100.0 | ok | 17.11 |
| `ui.staleBadge` | ms | — | — | 0 | — | 50.00 / 1000 ms | ERROR: no stale badge in the Reader 10 s after the save (the daemon has the block stale; a reload shows it): the web stores doc | 17.11 |

| counter | value | max | verdict |
|---|---:|---:|---|
| `doc.reopen.renderCalls` | 0 | 0 | ok |
| `gen.rerun.engineCalls` | 0 | 0 | ok |
| `idx.warm.parseCalls` | 0 | 0 | ok |
| `idx.warm.filesHashed` | 0 | 0 | ok |
| `idx.warm.sqlWrites` | 0 | 0 | ok |
| `ui.fetch.levelSwitch` | 0 | 0 | ok |
| `ui.fetch.readerOpen` | 29 | 6 | **over max** |

修正後の単独 run（`--id git.precheck --id bin.health --exact --absolute`、`084a7c0` になった working tree。2 回目の値）:

- sha 28c5c59f88c1 · Apple M5 Max · 18 cores · 128 GB · Darwin 27.0.0 · bun 1.4.2 · node 22.23.3 · chrome 153.0.8010.12
- started 2026-10-04T09:45:32.542Z · loadavg at start 13.85 (noisy: true) · power ac · factor 1.250 (measured)

| id | unit | median | p95 | n | cv | target / limit | verdict (raw) | load |
|---|---|---:|---:|---:|---:|---|---|---:|
| `git.precheck` | ms | 113.6 | 125.2 | 15 | 0.050 | 50.00 / 100.0 | **over limit** | 13.78 |
| `bin.health` | ms | 102.7 | 110.6 | 5 | 0.063 | 1000 / 1000 | ok | 13.78 |

1 回目の単独 run（負荷 15.2、factor 1.262）は `git.precheck` 87.1 / 103.2 ms（median / p95）、`bin.health` 106.1 / 115.1 ms。

### 最初の baseline との違い（どれが測り方の変化で、どれが負荷か）

| id | 最初 | 再計測 | 読み方 |
|---|---:|---:|---|
| `git.precheck` | 0.751 ms | **87〜114 ms** | 最初の値は不具合（`run: () => void precheck()`）。runner が「待たれなかった rejection」を case の error にするようにした（BENCH-U-12）。budget 50 / 100 に対して負荷下で target 超〜limit 超（cr-requests/bench.md #12） |
| `ui.heap.10k` | 3.62 MB | **13.9 MB** | 定義の修正: Reader だけ・main thread だけ → Reader + palette の索引（⌘K で読み込み）、main + Worker（CDP auto-attach）。spec の「file tree」は shell に存在しない |
| `ui.card.optimistic` | 未計測 | 9.7 / 18.6 ms | 新規。in-process daemon + scripted claude（トークン 0） |
| `ui.listeners.reader` | 未計測 | 9 | 新規。CDP で Reader の root 以下すべて（max 10） |
| `ui.staleBadge` | 未計測 | **ERROR** | 新規。保存しても Reader に「古い」が出ない（再読み込みまで）。cr-requests/bench.md #11 |
| `bin.health` | （budget なし） | 103〜106 ms | 新規 budget。SKEL-AT-01 の「起動 → health ≤ 1 s」を時間として測る（test は 15 s の緩い期限だけ） |
| `doc.elk.300` | 170.8 ms | 85.8 ms | 負荷の差（最初は case 開始時 29、今回 15）。cv 0.80 → 0.14 |
| `ui.cls.boot` | 0.049 | 0.018（e2e では 0.037） | どちらも limit 0.01 超。run ごとに 0.02〜0.05 で揺れる |
| `idx.s04.cold.react` | 2,552 ms | 1,941 ms | 負荷の差（19 → 15） |
| その他 | | | 同じ判定（over limit の構造・メモリ・warm rescan・update・RSS は再現した） |

counter 7 つの判定は同じ（`ui.fetch.readerOpen` 29 > 6 だけ超過）。`bench:compare --base HEAD~1`（anchor・`idx.search.ms`・
`loop.bundle`・`ui.palette.worker`・`agent.interactiveWait`、2 pairs）は pass、`bun run size` は exit 0（`bin.startup` 46 ms が target 超の警告）。
