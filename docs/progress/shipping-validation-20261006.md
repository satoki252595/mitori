# 更新版の出荷物確認（2026-10-06 JST）

## 最新: Mapアクセシビリティ修正後

実build sourceは `fdf71b9be2e77217830eff1ce0764203b1543273`（production runtime `e229e4ef770366430c38a6afb39ae4ca596b53b3`、差分なし）。all-target build成功、Mac70,548,978B / Linux89,572,832B / Windows94,348,288Bは全95,000,000B hard内。Mac SHA `60fb1c0d9be1b1579a491839d0513157d3f7d16388d815bf2ff33dcd68f0e94d`。Linux/Windowsのnative実行は未実施、85MB target WARNを保持。[build/SHA](shipping-binaries-map-group-20261006.json)。Mac compiled自己検査の全6項目（pinned9、web166、6言語parse、ELK、Shiki、SQLite）が成功。[自己検査](shipping-selftest-map-group-20261006.json)。

compiled asset sizeはexit0、CLI起動中央値の表示値 **44.91ms / limit50 / target20 WARN**。asset JSONは起動samplesを含まないため、表示値と原ログSHAはbuild JSONのhostStartupに記録。[asset結果](shipping-assets-map-group-20261006.json)。gen/merge/palette chunkとprecompressed割合のadvisory target超過（hard:false）を全目標成功とは扱わない。viewer gzip59,810Bも60,000B hard内の狭い余裕である。

同compiled binaryのfresh Chromium・go-small static Map/Readerは初期JS gzip9相当 **44,355B（43.3KiB）** / 実br **40,066B**、60KiB hard内。HTML/JSON/document込みencoded total84,030 /78,085B、header込みtransfer94,530 /88,885B、未完のSSE bodyは除外。served SHA一致・4build seal前後不変・provider calls0・font/初回editing無し。[転送量](shipping-ui-map-group-20261006.json)。JSON内mockJsGzipBaseline43,792Bは過去のmock比較定数で、このsourceのmock再測定ではない。

[事前条件](shipping-readiness-map-group-20261006.json)はAC・noisy=false・load6.8618・measured factor1.003344で成功。続く同じcanonical3caseの実runはexit0、AC・noisy=false・measured factor **1.000572622**、case load5.88–6.90。[実測](shipping-performance-map-group-20261006.json)。empty physical footprint3回中央値 **48.1571MB / limit50 / target30 WARN**、loaded crit60秒 **156.5953MB / limit250 / target150 WARN**。real crit paletteは1warmup＋5round、指定統計median **30.5ms / limit33 / target16 WARN**、round間p95 **31.2ms**。residentとは区別し、旧runや改善率へ付け替えない。これらは最新出荷物の局所検証で、全CI・Windows native・Safari/実IME・Cloudflare remote deploymentとは区別する。

## 前版: source46dfcd3の記録

runtime sourceは `46dfcd30ee112aa824947608dff850e68985995f`、checker/CI guardは `fffa530`。source差分なしで `scripts/nd bun scripts/build-bin.ts --target all` を実行し、Mac70,548,978B / Linux89,572,832B / Windows94,348,288B、全95,000,000B hard内。Mac SHAは `1f8056e8e73c46016e551b4adaadc46dc562d1b46f7aaaa4539a0ed054267ef8`。[build/SHA](shipping-binaries-20261006.json)。Linux/Windowsの85MB target WARNは保持し、native実行とは扱わない。

compiled Mac `_selftest --json --elk-runs 5` は成功。pinned9 files、web166 files、6言語parse、ELK、Shiki、SQLiteを確認した。[自己検査](shipping-selftest-20261006.json)。compiled sizeの構造・hard asset budgetもexit0。最初のsize実行は `--no-startup` であり、CLI起動時間を計測した証拠ではない。後続のstartup付き実行はexit0、`--version`中央値の表示値41.30ms / limit50、target20 WARN。[後続asset結果](shipping-assets-startup-20261006.json)はassetだけを含むため、startup値と原ログhashはbuild/SHA JSONのhostStartupへ記録した。[asset構造](shipping-assets-20261006.json)。

同binaryをfresh Chromium・go-small static Map/Readerで確認し、初期JS実br40,083B / gzip9相当44,345B（43.3KiB）、60KiB hard内。HTML/JSON/document込みencoded total84,061 / 78,112B、transfer total94,561 / 88,912B。served JS/CSSのraw SHAがmanifestに一致し、4build seal前後不変・provider calls0。font/初回editing無し。[実転送量](shipping-ui-20261006.json)。以前のed95494 / ea86a183…による44,216Bは旧JSONに保持した。

既存waitForQuiet・AC・measured factor±10%の事前確認はload7.2583、factor1.063937で成功し、この時点ではbenchmark未起動だった。[開始条件](shipping-readiness-20261006.json)。続けて `MITORI_E2E_BINARY=compiled scripts/nd bun bench/runner/run.ts --id srv.rss.idleEmpty --id srv.rss.idleLoaded --id ui.palette --exact --absolute --out docs/progress/shipping-performance-20261006.json` を1回実行、exit0。実runはfactor0.993150・AC・noisy:false、各case load6.50–7.96で、上限・統計を変えていない。[実測](shipping-performance-20261006.json)。

- physical footprint empty3回中央値48.4071MB / limit50、loaded crit60秒163.2358MB / limit250。target30 / 150のWARNは保持。residentとは別の値。
- real crit paletteは1warmup＋5round、指定統計median31.6ms / limit33、round間p95 32.6ms。target16のWARNを保持。旧runの31.9 / p95 33.2msを消さず、新旧の速度改善率は主張しない。

これらは局所の出荷物検証であり、全PR CI・Windows native・Safari/実IME・Cloudflare remote deploymentの成功には数えない。PRのmergeとbranch整理は全CIの成功後に実施する。
