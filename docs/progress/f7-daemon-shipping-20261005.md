# 出荷版デーモンのidleメモリ（2026-10-05）

最終compiled Mac binary `f49252e24acbfaa968e70870e650a9730c0b58f3c0e43ac32c1b7a062b63b3c7`（70,548,978 bytes）を使用。source実行と取り違えない。bench結果のGit SHAは未コミット作業treeのbaseであり、binaryのSHAをこの資料で固定する。

```sh
scripts/nd bun bench/runner/run.ts --id srv.rss.idleEmpty --id srv.rss.idleLoaded \
  --exact --absolute --out docs/progress/f7-daemon-shipping-20261005.json
```

既存caseの規定どおり、emptyは3回×15秒、loadedはcritの使い捨てcopyをscan後60秒。待機時間の環境上書き、run数の削減、time budget緩和はしていない。AC接続、前後load guard、Bun1.4.2 / Apple M5 Max。LLM呼び出しはない。

CR m1-117に従い、Macの判定値は`proc_pid_rusage`のphysical footprint（2^20 bytes換算）。`ps`のresident RSSも別の値として記録し、同一視しない。native取得失敗時には別metricへfallbackしない。

| ケース | physical footprint MB | resident RSS MB | 判定 |
| --- | ---: | ---: | --- |
| empty 1 | 47.7664 | 105.5313 | |
| empty 2 | 48.4539 | 106.4844 | |
| empty 3 | 48.3602 | 103.3750 | median48.3602 / p9548.4539。target30超過WARN、limit50以内 |
| loaded crit | 144.2358 | 593.4688 | target150 / limit250以内 |

[構造化結果](f7-daemon-shipping-20261005.json)。idx peakの886.86MBとは対象processと時点が異なるため合算しない。Windows/LinuxのidleメモリへこのMacの結果を転用しない。

## facts paint mark修正後の最終出荷版

初期Mapのfacts markを追加したbinary SHA `700514e4ecb5ac2b488dc65dd7ee13b69d516a468b926bb3eeea0cd5ed205de9`（bytes同一70,548,978）で規定のidle計測を再実行した。[当時の結果](shipping-performance-before-pr5-20261005.json)。empty physical footprintは48.2508 / 48.3445 / 48.1883MB、residentは105.9063 / 105.5469 / 106.0469MB。中央値48.2508、p9548.3445、target30 WARN・limit50内。loaded critはphysical146.5796MB / resident593.0156MBでtarget150・limit250内。旧f492の実測は上表と元JSONに保持する。

## PR #5修正後の出荷版

source `ed95494c69aebee054f833b1c51f9d148788465a`、compiled Mac SHA `ea86a183194c15f50d2897f3bc8ee24a03dc5b15ce76ebf67982f80f032743f2`で同じ3回×15秒 / crit60秒を再測定した。`MITORI_E2E_BINARY=compiled`でpaletteと一緒に限定実行し、14:13:54Z開始、AC・quiet判定、factor1.023824、exit0。[最新結果](shipping-performance-20261005.json)。

empty physical footprintは48.3133 / 47.8446 / 48.3758MB、residentは104.9531 / 104.7188 / 105.9531MB。中央値 **48.3133MB**、p95 **48.3758MB**、target30 WARN・limit50内。loaded critはphysical **161.0952MB** / resident **612.3281MB**、target150 WARN・limit250内。旧版の146.5796MBを最新のtarget達成として転用しない。各版は1回のloaded観測であり、この差だけでUI修正がメモリ増加の原因だとは断定しない。
