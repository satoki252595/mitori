# 更新版の出荷物確認（2026-10-06 JST）

runtime sourceは `46dfcd30ee112aa824947608dff850e68985995f`、checker/CI guardは `fffa530`。source差分なしで `scripts/nd bun scripts/build-bin.ts --target all` を実行し、Mac70,548,978B / Linux89,572,832B / Windows94,348,288B、全95,000,000B hard内。Mac SHAは `1f8056e8e73c46016e551b4adaadc46dc562d1b46f7aaaa4539a0ed054267ef8`。[build/SHA](shipping-binaries-20261006.json)。Linux/Windowsの85MB target WARNは保持し、native実行とは扱わない。

compiled Mac `_selftest --json --elk-runs 5` は成功。pinned9 files、web166 files、6言語parse、ELK、Shiki、SQLiteを確認した。[自己検査](shipping-selftest-20261006.json)。compiled sizeの構造・hard asset budgetもexit0。最初のsize実行は `--no-startup` であり、CLI起動時間を計測した証拠ではない。後続のstartup付き実行はexit0、`--version`中央値の表示値41.30ms / limit50、target20 WARN。[後続asset結果](shipping-assets-startup-20261006.json)はassetだけを含むため、startup値と原ログhashはbuild/SHA JSONのhostStartupへ記録した。[asset構造](shipping-assets-20261006.json)。

同binaryをfresh Chromium・go-small static Map/Readerで確認し、初期JS実br40,083B / gzip9相当44,345B（43.3KiB）、60KiB hard内。HTML/JSON/document込みencoded total84,061 / 78,112B、transfer total94,561 / 88,912B。served JS/CSSのraw SHAがmanifestに一致し、4build seal前後不変・provider calls0。font/初回editing無し。[実転送量](shipping-ui-20261006.json)。以前のed95494 / ea86a183…による44,216Bは旧JSONに保持した。

既存waitForQuiet・AC・measured factor±10%の事前確認はload7.2583、factor1.063937で成功し、この時点ではbenchmark未起動だった。[開始条件](shipping-readiness-20261006.json)。続けて `MITORI_E2E_BINARY=compiled scripts/nd bun bench/runner/run.ts --id srv.rss.idleEmpty --id srv.rss.idleLoaded --id ui.palette --exact --absolute --out docs/progress/shipping-performance-20261006.json` を1回実行、exit0。実runはfactor0.993150・AC・noisy:false、各case load6.50–7.96で、上限・統計を変えていない。[実測](shipping-performance-20261006.json)。

- physical footprint empty3回中央値48.4071MB / limit50、loaded crit60秒163.2358MB / limit250。target30 / 150のWARNは保持。residentとは別の値。
- real crit paletteは1warmup＋5round、指定統計median31.6ms / limit33、round間p95 32.6ms。target16のWARNを保持。旧runの31.9 / p95 33.2msを消さず、新旧の速度改善率は主張しない。

これらは局所の出荷物検証であり、全PR CI・Windows native・Safari/実IME・Cloudflare remote deploymentの成功には数えない。PRのmergeとbranch整理は全CIの成功後に実施する。
