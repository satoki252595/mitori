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
