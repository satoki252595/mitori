# 未計測 UI 5件 — 2026-10-05

実 daemon と Chromium で5ケースを実装・測定した。全ケースの上限を満たし、`ui.scanSummary` は目標1000msを超える警告が残る。予算値、machine scaling、quiet 条件は変更していない。LLM への課金は0。

| ID | 3 samples の median | p95 | target / limit | 結果 |
| --- | ---: | ---: | ---: | --- |
| `ui.scanSummary` | 1413.6ms | 1502.6ms | 1000 / 2000ms | warn |
| `ui.inputRender.1000` | 13.8ms | 14.1ms | 16.7 / 50ms | green |
| `ui.dom.max` | 10,368 | 10,368 | 15,000 / 15,000 | green |
| `ui.codeLines.mounted` | 361 | 361 | 400 / 400 | green |
| `ui.reviewDiff5000.dom` | 10,368 | 10,368 | 15,000 / 15,000 | green |

入力は1 sample ごとに30回の `j` / `k` を送り、その入力から次の描画フレームで新しい focused block が描かれるまでの p95 を返す。測定中は CDP の CPU throttle を4倍に設定し、終了時に解除する。表の p95 はこの3個の p95 値の分位点。独立した Playwright 実行では入力22.7ms、scanSummary1457.4ms、Review10,370、最大画面10,368、コード361で、5試験すべて上限内だった。

## Fixture と状態

- `gen:doc-1000`: real DocStore に1000個の生成 block、全20節、開いた可視 Deep Dive、499 note thread と1 change thread を作る。Inbox の全500 thread を実APIで読み込み、DOM の測定前に500行の存在を確認する。
- `gen:large-file`: 決定的な20,000行・300,000 bytes の TypeScript comment file。先頭・5000・10000・15000・末尾の server highlight window を開き、各 window の scroll 位置を変えてマウント中の行を数える。0行の空画面は失敗とする。
- Review は既存 scripted engine が隔離された job worktree の先頭5000行を削除し、既存 shadow/gates/job pipeline から ready job と5003行の実diffを作る。lazy CM6 のマウント後に scroll して DOM を採取する。採用を送信せず、終了前にも ready 状態と元の repository の bytes が未変更であることを確認する。
- scanSummary は未生成の crit corpus copy を source CLI で cold open し、CLI spawn 時刻から StatusBar の `mitori:scan:summary` paint mark までを測る。browser 起動は計測外。

全20節を順に開いた後の最大 DOM は Review の10,368要素。独立試験の Inbox は8194要素、Deep Dive は354要素。DOM は既存 budget と同じ `getElementsByTagName("*")` の要素数であり、コード行は selector の和集合で重複を数えない。

純削除の Review は初回に15,363要素で上限違反を再現した。UI側で純削除に付く余分な changed-text span を除き、混合変更の単語強調と削除テキスト全文を維持した bundle で10,368まで減った。Inbox の200件上限も cursor を読み続ける修正後に500件を確認した。

## 環境と検証

HEAD `815957fd01fb4856b5ae8d3aa2091edd1ddd263f` + 未コミット変更。UI側が2026-10-05 11:18 JST頃に作成した `dist/.build/web.json` / web assets を測定中固定した。source CLI での実測なので、最終 compiled binary の配布検証は別工程。

Apple M5 Max / 18 cores / 128GiB、Darwin 27.0.0、Bun 1.4.2、Node 22.23.3、Chromium 153.0.8010.12。AC、開始 loadavg 6.997、quiet 閾値内、reference に対する実測 factor **1.023412**。Playwright 実行の factor は1.06。基準機の記録は上書きしていない。

raw結果: [bench.json](bench.json)、[Playwright の測定注釈](playwright-measures.json)。fresh test auth token、daemon URL、credentials はこれらの記録に含まない。

検証: generator unit **5 pass / 290 assertions**、2 fixture の golden verify 成功、追加5 perf specs **5 pass / 13.9s**、testkit/e2e/bench の targeted TypeScript と対象 Biome は成功。5つの budget の `unmeasured` だけを削除した。

```sh
scripts/nd bun fixtures/build.ts --only gen-doc-1000 --verify
scripts/nd bun fixtures/build.ts --only gen-large-file --verify
scripts/nd bun test packages/testkit/src/fixtures/generators.test.ts

MITORI_E2E_BINARY=source scripts/nd bun e2e/harness/run.ts \
  e2e/perf/scan-summary.spec.ts e2e/perf/input-render.spec.ts e2e/perf/dom.spec.ts --project=perf

MITORI_E2E_BINARY=source scripts/nd bun bench/runner/run.ts \
  --id ui.scanSummary --id ui.inputRender.1000 --id ui.dom.max \
  --id ui.codeLines.mounted --id ui.reviewDiff5000.dom --exact \
  --runs 3 --warmup 0 --absolute --no-wait --out /tmp/mitori-ui-remaining-20261005.json
```

`--no-wait` は待機だけを省き、開始時・各ケースの loadavg と noisy 判定は記録する。時間予算の警告を隠すための factor 指定は使っていない。
