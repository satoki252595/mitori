# PR5 browser profile（2026-10-06 JST）

既存ログだけを要約した[JSON証跡](pr5-browser-profile-20261006.json)。追加のbuild・browser実行・provider呼び出しは行っていない。checkoutは `ad4fa817f614ff5babafc93038e4810545b512db`、runtime sourceは `ed95494`。同CI checkout/assets、`SKIP_BUILD=1`、Chromium 1worker、mock port4395、traceはretain-on-failure。原ログ・raw traceはprivateのままで、この資料には値・集計とログhashだけを残す。

## 全Chromiumの局所診断

116件中 **114 pass / 2 fail、1.6分**。時間予算3caseは成功したが、全suiteは失敗。trusted input timestampから既存paint markまでの26sampleは次の通り。sample数が少ないため既存nearest-rank p95は各最大値と一致する。

| 操作 | sample数 | 最大 / p95 | 既存上限 | このrunの結果 |
| --- | ---: | ---: | ---: | --- |
| room→card | 5 | 65.1ms | max100ms | pass |
| Enter→Reader | 5 | 34.5ms | p95 100ms | pass |
| level切替 | 6 | 16.6ms | p95 50ms | pass |
| TOC→section | 10 | 68.9ms | p95 100ms | pass |

ただしsample時のhost loadは **43.18–56.78**。18cores × 0.5 = **9**という既存quiet条件を超えており、quietな基準計測やCI成功の証拠として扱わない。時間予算内だったことは、この局所runの観測としてのみ残す。第3回CIの3failを取り消したり、速度改善・高負荷原因を確定したりする根拠にはならない。

一時helperは入力のeventEnd、最初のanimation frame、入力後の同名markすべて、resource timingを記録した。full runのevent handler区間は0–0.1ms、handler→first frame最大51.4ms、UI resource最大5.5msだった。handler→markは待機・network・renderingを含み、JavaScript実行時間だけを示さない。resource名はpathnameだけを使用し、query・auth・headers・bodyは保存していない。一時helperは完全に復元され、operatorによるdiff検査exit0を確認した。

機能の2failは、いずれも引用focus直後の `o` でcontextがcodeへ切り替わらずmarginのままだった。

- `e2e/web/code-column.pw.ts:9`、assertion17。index.changed後の再読込・版違い表示には未到達。
- `e2e/web/reader.pw.ts:246`、assertion254。pin URL・Escape復帰には未到達。

cold enhancementへのfocus/pin操作の引き継ぎは別途調査・修正中。このrunに後続修正の成功を付け替えない。

## LaunchAgent ProcessType比較

同じ3時間caseをStandard / Interactiveで診断したが、両方とも **0 pass / 3 fail、exit1**。開始時からquiet条件を満たしていないため、有効な性能比較や遅延の根因の証拠にはならない。

| ProcessType | 開始load1m | sample時load | card最大 | open p95 | level p95 | TOC p95 |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| Standard | 18.4775 | 19.02–19.40 | 237.9ms | 225.2ms | 105.6ms | 261.4ms |
| Interactive | 19.0176 | 19.66–21.71 | 260.5ms | 216.2ms | 102.3ms | 229.8ms |

一時LaunchAgent jobsはbootout済み。具体的な他app名は公開証跡に含めない。CI globalSetupへの既存waitForQuiet・calibration・machine information再利用、strict AC power / caffeinate、2つのartifact directoryの修正は別途の後続変更であり、build後のquiet確認を追加した。次のCIで検証するまで有効な結果はpendingのままとする。

関連：[第3回CIの失敗と検証範囲](pr5-ci-20261005.md#第3回ci2026-10-06-jst失敗を保持)。

## 後続quiet probe：browser起動前の拒否

別ログ `mitori-quiet-launch-agent-perf-probe.log` の最初のrecordはStandard / guard。Apple M5 Max 18cores / 128GB、Darwin27.0.0、Bun1.4.2、Node22.23.3、Chrome153.0.8010.12、AC電源、load1m **8.234375**、noisy:false、待機0だった。measured calibration factor **1.1841370715954895** が既存referenceの±10%範囲外だったため、guardが **exit1** で拒否した。

browserも3caseも未起動、一時job作成0、旧ad4 checkoutのruntimeも未実行。有限factorと既存isReferenceMachineの条件をquiet/AC条件に加えた後続guardの失敗条件を確認したもので、正のbenchmarkやA/B成功・CI greenではない。上記noisy runのcounter・sampleを上書きせず、JSONの `followUpGuardProbe` にmachine metadataとログSHAだけを別記録した。traceback・raw認証情報は含めない。

## quiet/reference条件を満たした後続A/B

さらに別runでquiet/reference条件を満たして3時間caseを比較した。同CI checkout `ad4fa817` / runtime `ed95494` / assets、SKIP_BUILD=1、CI=true、MOCK_PORT4401、Chromium 1worker。両方をcaffeinateで動かし、意図した差分はLaunchAgentのProcessTypeだけ。順序は **Standard→Interactive固定、各1回**。

| ProcessType | sample時load1m | measured factor | 時間case結果 |
| --- | ---: | ---: | --- |
| Standard | 5.99–6.29 | 1.0378879559649494 | 0 pass / 3 fail、exit1 |
| Interactive | 6.43–6.79 | 0.9818483562745433 | 3 pass / 0 fail、5.2秒、exit0 |

両方AC / noisy:false / 待機0、load9未満、factorは既存±10%範囲内。Standardの失敗assertはcard最大242.2ms / limit100、level p95 122.8ms / limit50、TOC p95 224.5ms / limit100だった。card側で先に失敗するためopenのassertは未到達。Interactiveでは3case内の既存assertすべてが成功した。JSONの `validConditionsComparison` に別recordとして、guard metadata・26sampleずつの既存丸め済み出力・3つのログSHAを保存した。以前のnoisy A/Bとguard拒否は変更していない。

受理された条件下でProcessTypeの影響を支持する局所結果だが、固定順序で各1回、時間case3件だけ、旧runtimeである。全browser suiteや現在sourceのCI成功は未確認。rootはrunner install scriptのProcessTypeをInteractiveにしてserviceを再登録し、次CIで全suiteを確認する予定。一時jobsはbootout済み、port4401は終了後空。raw auth・traceは公開資料へ含めない。
