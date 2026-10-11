# macOS性能tierの検出（2026-10-12 JST）

基準機のsysctlはSuper 6 + Performance 12、Efficiency 0だった。旧helperはlevel0だけを数えてperfCores=6としていた。CR perf-tier-1で既知のSuper / Performanceを合算し、既存算式の最大8 Workerを適用する。Efficiencyは除外し、未知・欠落・不正なら旧level0 / nullへ戻す。同期検出の全体1秒、Worker寿命・GC・parse timeout・予算は維持する。重複した旧診断benchも共有helperへ揃えた。

構成の出典は[Apple公式発表](https://www.apple.com/uk/newsroom/2026/03/apple-debuts-m5-pro-and-m5-max-to-supercharge-the-most-demanding-pro-workflows/)（2026-03-03、2026-10-12 JST確認）。実機sysctlの結果は公式の製品構成と区別し、[JSON証跡](idx-performance-tiers.json)へ保存した。

Go固定corpusをfresh process / 空home / shadow / S0–S1でABBA比較した。変数はhardware検出だけで、旧6 Workerと新8 Workerは意図した変更である。3表の全行fingerprints、counters、files / includedは4回とも一致した。

| 版 | 2回の時間 ms | 中央値 ms | peak RSS MiB |
|---|---|---|---|
| 旧level0 | 2268.274 / 2038.615 | 2153.445 | 913.109 / 927.094 |
| 全性能tier | 1725.018 / 1744.146 | 1734.582 | 1083.438 / 1136.766 |

中央値で19.45%短縮した。較正未計測の比較であり、正式1,500ms合格とは扱わない。検出処理はscan計時より前に終わる。比較後に共通sysctl deadlineを追加しており、比較時のhardwareファイルそのもののhashは未取得。最終ファイルhashと対象回帰はJSONへ別記した。

RSSの正式対象はReactで、既存caseをwarmup1 / measured3で確認した。値は986.688 / 992.453 / 971.609 MiB、中央値986.688、上限1000以内・目標700に対してWARN。quiet / AC、factor1.190383で、メモリ上限は係数で拡大しない。GoのRSS増加も上表の通り保持する。

対象回帰は13pass / 0fail / 60 assertions。統合checkは全7項目成功（10.75秒）。正式Go hard limitの未達、Mac全suite、実IME、追加生成の費用確認、外部4クライアントでの実生成は残る。

[PR #16](https://github.com/satoki252595/mitori/pull/16)を通常merge `b8f2dca` でmainへ統合・pushし、作業branchをlocal / remoteから削除した。Ubuntu unit3,047pass / golden109pass / 0fail、全20semantic・0cached・0errorsとLinux binaryが成功。Macはfactor1.101552で開始前停止。統合後15:43 UTCの事前確認はload9.915039 / NOISY / ACで較正未実行、追加正式scan0回だった。

## 8 Workerでの正式Go検証（2026-10-12 JST）

source `a8cadad800a0b71265c5ccff5a90fcde3b01164c` の既存正式case `idx.s01.cold.7kfiles` をwarmup1 / measured5で1 invocation実行した。開始前はload6.701172 / quiet / AC、較正factor1.0033811104106738、終了後はload8.081055 / quiet / AC、factor1.0870683419986469で、前後ともreference条件内だった。

| measured | 時間 ms |
|---|---:|
| 1 | 1623.153416 |
| 2 | 1763.871375 |
| 3 | 1694.155083 |
| 4 | 1661.989375 |
| 5 | 1806.187875 |

中央値は**1,694.155083 ms**、p95は1,806.187875 ms、CVは0.043621。既存hard limit1,500msに対して**FAIL**、runner exit1だった。これは較正付きの正式結果で、先行ABBAの約19.45%短縮と区別する。旧6 Workerの正式中央値1,980.096958msは履歴として保持し、今回の結果と同条件ABBAのようには比較しない。

warmupを含む全6子プロセスで8 Worker / cacheHits0 / filesParsed6,539 / degraded2 / files7,687 / included6,009が一致した。固定corpusの検証は1 ok / 0 failed。親stdoutから計時後の元のColdResultを取得し、子プロセスや製品sourceを変更していない。全3表の全行fingerprints一致は先行ABBAの証拠であり、今回の正式invocationで再取得したものではない。GoのRSSは参考値のままで、正式RSS caseのReactと混同しない。

[JSON証跡](idx-performance-tiers.json)の`formalVerification20261012`へ結果・終了後較正・capture方式・全6子結果・13資料のSHA-256を追記した。以前のJSONキーと値は保持し、raw log本文・capture script本文・絶対ローカルpath・環境変数値は保存していない。Go hard limit1,500msの残課題は継続する。
