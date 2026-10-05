# 出荷版のpalette応答（2026-10-05）

対象はreal compiled daemonとChromium、critの最大sectionのReader。既存caseは1 warmup＋5 rounds、各round6 keysのinput timestamp→`mitori:palette:results` paintをp95にし、5round中央値を判定する。worker単体と別の入力render budgetとは区別する。

```sh
MITORI_E2E_BINARY=compiled scripts/nd bun bench/runner/run.ts --id ui.palette \
  --exact --absolute --out docs/progress/f15-palette-shipping-20261005.json
```

最初のcompiled実行はpaletteまで到達せず、setupの`mitori:facts:painted`待ち30秒で失敗。[失敗結果](f15-palette-shipping-before-20261005.json)。SSRではMapPageのclient `$effect`が走らず、native bootでfacts paint markだけ漏れていた。Map route・表示済みDOM・scan summaryを条件に既存`markAfterPaint`へ接続した。3browserで実寸と非空のfactsがmark時点で存在し、Readerではmark無しを確認。必須mark、待機上限、key-to-paintの計測と予算は変更していない。

binary SHA`700514e4ecb5ac2b488dc65dd7ee13b69d516a468b926bb3eeea0cd5ed205de9`で成功。[当時の結果](shipping-performance-before-pr5-20261005.json)。1warmup＋5roundの各round p95は32.0 / 32.1 / 32.1 / 32.4 / 31.7ms、中央値 **32.1ms**、round間p95 **32.4ms**、CV0.00783。quiet判定・AC、Bun1.4.2、Chrome153。factor1.19369でtarget19.10 / limit39.39msとなりWARN・hard内。raw32.1msは元のunscaled33ms limitも下回るが、16ms targetは未達として残す。失敗を0ms応答として扱わない。

これはcrit実コーパスのキー→既存results paint markであり、5万件のsynthetic worker matchingの値ではない。共有controllerにはworker往復と次rAFのmarkがある。各phaseの寄与や16ms目標達成をこの総遅延から断定しない。

## PR #5修正後の出荷版

source `ed95494c69aebee054f833b1c51f9d148788465a`、compiled Mac SHA `ea86a183194c15f50d2897f3bc8ee24a03dc5b15ce76ebf67982f80f032743f2`で規定どおり再計測した。[最新結果](shipping-performance-20261005.json)。各round p95は **32.2 / 33.2 / 31.0 / 31.9 / 31.0ms**、その中央値 **31.9ms**、round間p95 **33.2ms**、CV0.02890。factor1.023824は既存reference許容±0.1内のため、元target16 / limit33msで判定した。予算の指定統計`median`はlimit内・target WARN。round間p95は33msを0.2ms超え、全sampleが33ms以内とは主張しない。AC・quiet、待機・mark・budget統計の変更なし、exit0。
