# 更新版の出荷物確認（2026-10-06 JST）

統合CIの第7回（source a663a459、checkout24a342e8）はLinux x64 build/`--version`で`mitori 0.0.0 (api 1)`を実行成功した。以下のlocal出荷SHAとは別buildで、CIのbinary SHAは未収集。CI startup96.34msは50ms limit超過だがfactor2.284の非基準機規則でnon-gating、成功性能へ丸めない。[統合CI照合](pr5-publication-20261006.json)。

## 最新: 品質説明の数値範囲修正後

実build sourceは `7f774191172bb3017a571ebea6cae5eea91291f1`、productionの変更は `8f7176c` のquality prompt/versionだけ。README・検証/意思決定資料は未コミットだったが、production sourceとlocksはコミット済み。all-target build成功、Mac70,548,978B / Linux89,572,832B / Windows94,348,288Bは全95MB hard内。Mac SHA `1e170b95c33275db828901a297995b7111487df8ea4a02e744701d1b82328910`。Mac自己検査全6項目とcompiled asset hard gateも成功。起動表示中央値48.39ms / limit50 / target20 WARN。[build/SHA/起動](shipping-binaries-quality-scope-20261006.json)、[自己検査](shipping-selftest-quality-scope-20261006.json)、[assets](shipping-assets-quality-scope-20261006.json)。Linux/Windowsの85MB target WARNとnative未実行は維持する。

packaging manifest・initial renderer・web manifestの3SHAは以下のMap版実測と一致した。初期UIの配信物は不変だが、binary SHAは異なる。F7/F15は実行経路が変わらないprompt修正のため再測定せず、以下の元source/binaryの記録として保持する。新binaryの実測値へ付け替えない。

## 前版: Mapアクセシビリティ修正後

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
