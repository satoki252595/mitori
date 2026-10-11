# Go 7k cold scan — 原因調査と不採用候補（2026-10-11）

`idx.s01.cold.7kfiles` の1,500ms上限は未解決。今回、indexer / server の製品コードは変更していない。バッチを256 KiBへ制限する案は速度悪化で不採用。Workerが返信済みデータをGC前に参照解除する案は通常Mac条件で約4.93%短縮したものの、目標達成と安定した改善を証明できず採用していない。上限、較正、診断、抽出内容、タイムアウト、GC間隔、Worker数の規則は維持した。

## 同じソース・同じ結果での比較

統合中の共有ソースの影響を避け、Windows対応のファイル名修正を含む3,918ファイルを `/tmp/mitori-idx-cold-20261011/tree` へ凍結した。Git metadata は含めず、依存は既存プロジェクトのNixとnode_modulesを再利用。凍結内容のSHA-256は `18782d181f2b0684fb5697e40e86175a85d2b97c7c0f98dff66ec9a9a57156c8`。

対象は [Goの固定commit](https://github.com/golang/go/tree/862c888e612ac346c7c4d99c9392bdfd265f33b0/src) の既存gostd corpus（`bench/corpus.lock.json`）。content hash `f21c254a8a653ec14936cd32ed622e0bc059991af174edf0952f62c4a9c14a2a` の一致を確認した。今回の列挙は7,687ファイル、included 6,009、parse candidates 6,539。過去資料のファイル数を今回の実測として流用していない。

daemonと同じ `benchIndexer` で、毎回新しいBun process・空のhome・shadow workspaceを作り、S0〜S1だけを計時した。背景永続化を待った後、保存された全行を順序付きでhashした。全12回で次が完全一致した。時間依存の `idx_blobs.parse_ms` / `last_used` は比較から除外した。

| 表 | 行数 | SHA-256 |
|---|---:|---|
| idx_blobs | 6,490 | `32bb8499b50e176ceb3b17150d544e7911511a34b3b3378360394e9dfc133907` |
| idx_symbols | 133,602 | `f34b4c5102b245c785f1d6e02bcc04a22aff8545440bc1c9100d83f069497145` |
| idx_skeleton | 11,997 | `b950738db0b42945aab5d5411558d363301c60d1bc8bae3da15fd22a7dee1fd5` |

MacはApple M5 Max、18 cores / 128 GiB、AC電源、Bun 1.4.2 / Node 22.23.3。開発コマンドは `scripts/nd bun`。sandbox内では高性能コア数を読む `sysctl` が `Operation not permitted` で失敗し、既存fallbackによってWorkerが8本になった。正規escalation後の `hardwareInfo()` は `{cores:18,perfCores:6}` で、通常起動は6本。8本と6本は別の比較として扱う。

## 原因を絞る計測

1-threadの診断profileでは、現行pinned WASMのexportを読み取って関数IDを特定した。`ts_parser_parse_wasm` が45.7% / 4.46秒、query matchesが17.3% / 1.69秒。progress callbackは16.5msで、タイムアウト保護を変える根拠はなかった。このprofileはWorker / clone / GCのない診断用であり、製品のcold wall値ではない。

製品と同じ8 Workerの一時traceでは、128 batchのhandler合計10.82秒、返信post合計0.37秒、返信後full GC合計1.25秒。1 MiB級batch直後に76〜90msのGC停止が複数Workerで重なった。mainからの128 batch送信を直接計時した合計は11.98msで、CPU profileのnative `postMessage` 帰属1.4秒を実際の送信コストと解釈してはいけない。mainの結果適用も小さく、現時点の主因はparse / queryとWorker内のGCにある。traceは測定後に完全復元した。

## ABBAの結果と判断

各比較は baseline → candidate → candidate → baseline。表は各版2回の中央値。表の各行は独立した比較で、行をまたいだbefore / afterではない。

| 候補・条件 | baseline ms | candidate ms | 変化 | RSS中央値 MiB | 判断 |
|---|---:|---:|---:|---|---|
| batch上限256 KiB、sandbox 8 Worker | 1,765.85 | 2,004.87 | +13.54% | 1,112.70 → 997.38 | 速度悪化で不採用 |
| 返信resultをGC前に参照解除、sandbox 8 Worker | 1,605.75 | 1,596.24 | −0.59% | 1,120.37 → 1,103.66 | 改善の根拠不足 |
| 同じ参照解除、通常Mac 6 Worker | 2,270.98 | 2,159.04 | −4.93% | 1,005.37 → 1,008.98 | 1,500ms達成未証明、未採用 |

全回で抽出結果・hash / parse / writeカウンタが一致し、degradedは2件。候補のソース差分も一時ファイルに保存し、凍結コピーと共有ソースのbaseline復元hash一致を確認した。製品コードを変更していないため、新しい製品回帰テストは追加・実行していない。

OS page cacheは削除していない。各process / homeのcoldであり、ディスクcacheのcoldではない。今回の各runは既存のquiet閾値（load 9）を超え、較正係数も未計測なので、未変更のabsolute gateで成功したとは主張しない。旧1,880msとの直接比較による改善判断もしていない。

## 既存正式caseの後続実行

通常Mac / Nixの正規escalation経路で、既存 `idx.s01.cold.7kfiles` を**1 invocationだけ**実行した。共有統合headは `3f401b31a0298fa398537f8bc079cc0d9991ff40`、2026-10-11T05:01:32Z開始。既定のdiscarded warmup1回＋measured5回、毎回fresh process / 空home、S0〜S1 / shadow、quiet待機30秒×2、自動factor、通常6 Workerを維持した。親processの一時preloadで、scan計時後に出る既存child JSONをteeしてRSS / files / timingsも保存した。製品・benchソース、予算、reference、Worker規則は変更していない。

```sh
scripts/nd bun --preload /tmp/mitori-idx-formal-capture-20261011.ts bench/runner/run.ts \
  --id idx.s01.cold.7kfiles --exact --absolute \
  --out /tmp/mitori-idx-formal-20261011/result.json
```

既存guardの待機後もstart load16.55 / case load17.38で閾値9を超え、AC電源だがNOISY。自動factorは**1.902929**で許容0.9〜1.1の外だった。中央値**3,872.33ms**、p95 **4,776.41ms**、CV0.20748。raw上限1,500msとscaled上限2,854.39msの両方を超え、既存判定は **FAIL / gating:false**。process exit0はreference条件外のreport-onlyによるもので、正式合格とは扱わない。以前のABBAや旧1,880msとの直接比較もしない。

6 childrenすべてfiles7,687 / included6,009 / filesParsed6,539 / cacheHits0 / Worker6 / degraded2が一致。measured5回のpeak RSS中央値は**985.14MiB**（966.92〜988.31MiB）。この正式caseが抽出表のhashを返す仕様ではないため、先行ABBAの全行一致と今回のcoverage確認を区別する。候補は未適用、追加の正式測定は行わず終了した。元result、全6 child JSON、自動較正、guard、判定とhashは [idx-formal.json](idx-formal.json)。

引き続きquiet / reference条件を満たした値は未取得で、1,500ms上限は未解決。さらなるparse / query改善案には、今回と同じ全行一致・診断維持と同条件比較が必要。Worker増加、fallback条件の採用、1,500ms上限や較正規則の緩和で代替しない。

各run、環境、失敗、profileの限界は [idx-cold.json](idx-cold.json)。一時driver・raw log・不採用候補は `/tmp/mitori-idx-cold-20261011/` に保持した。新依存、モデル呼び出し、継続費用はない。

## 追加候補の確認（main ecf20d0、12:36〜12:49 UTC）

最新の正式未達値は [idx-formal.json](idx-formal.json) のquiet / AC・中央値1,980.097msであり、上の先行NOISY値とは区別する。追加2案も製品へ採用していない。

- CJK判定のASCII早期終了は、固定Go corpusの6,817ファイル・88,311,633 UTF-16単位を使った純粋helper診断だけを実施。全BMP単位と境界例は元実装と一致し、ABBAはbaseline58.885 / 58.201ms、候補27.417 / 27.842msだった。合計CPU約31msの削減だけでは6Worker scan全体の改善根拠にならない。
- 正常Goのrefsを同じquery結果から先にfoldして保持期間を短くする2pass案は、凍結source・fresh process / 空home・6WorkerでABBAを実施。3表の全行hash、coverage、診断、countersは一致し、対象extract / workerも33pass・100assertions。baseline2,450.030 / 2,131.280ms、候補2,180.880 / 2,196.621ms、中央値の差は4.45%。候補値はbaselineの範囲内で、query CPUとRSSも低下していない。前後ともNOISY、factor1.157972 / 1.120645で基準外のため速度改善は未証明。

候補のためにGo専用経路・generatorを製品へ増やす根拠は得られなかった。予算・対象・抽出仕様・Worker数は維持し、最新正式1,500ms未達を保持する。全値は同JSONの `additionalCandidates20261011`。追加LLM・依存・費用0。

## 抽出phaseの追加診断（main 85aabcf、12:58〜13:05 UTC）

同headの凍結コピーだけに計時を追加し、既存corpusをfresh process / 空home・通常6Workerで2回走査した。共有sourceと共有node_modulesは変更していない。両回とも3表の全行hash・coverage・counters・degraded2が一致した。

1回目の抽出phase合計では `query.matches` が2,131.402ms、定義capture382.030ms、symbol構築334.080ms、refs261.695ms、docs194.178msだった。`newDef` 207.890msは定義captureの内数であり、重複加算しない。2回目は既存pinned web-tree-sitterのprivateコピーだけを計時し、queryのWASM処理1,892.182ms・JS復元190.557ms（5,585calls / raw1,612,733matches）と分かった。query内の約91%はWASM側で、JSのmatch保持期間だけを減らす案では大幅短縮を裏づけられない。

これらはWorker間の累積計時で、scan wallや正確なCPU時間ではない。wallは2,479.800 / 1,998.311msだが、計時追加・異なる負荷・較正未確認の診断であり、before / after比較や正式合格には使わない。最新正式中央値1,980.097ms・上限1,500ms未達を保持する。新依存・製品変更・LLM呼出・追加費用は0。機械可読値は同JSONの `extractionPhases20261011`、private driver / rawは `/private/tmp/mitori-idx-go-phases-20261011.7a9DCy/`。

## pool全phaseの追加診断（main a791b77、13:25 UTC）

同headのcleanな凍結コピーで、private `parse/pool.ts`だけに計時を追加し、既存driverを1回実行した。Nix / Bun 1.4.2、fresh process / 空index home、通常6Worker・128batch。共有source・node_modules、GC周期・batch上限・timeout・予算は変更していない。3表の全行hash・coverage・countersが一致し、degraded2 / cacheHits0を維持した。source・計時差分・driverのhashと主要値は [idx-cold.json](idx-cold.json) の `poolPhases20261011`。

scan wallは2,278.814ms、S1は2,040.788ms、pool全体は2,006.829ms。Worker間の累計phaseはread1,032.597 / hash39.361 / parse5,113.592 / query3,488.723 / extract808.860msだった。以前省略していたhash + extractは6Worker平均141.370msで、全5phase平均は1,747.189ms。pool wallとの差259.640msにはqueue・GC・転送・未計時の処理等が含まれ、純粋な終端待ちとは解釈しない。最後に完了したbatchのphase合計は12.129msで、enqueueから応答までの30.954msとは区別する。大きな終端stragglerを示す証拠は得られなかった。

loadavgは7.5625 / 8.2959 / 9.1880。較正未測定・計時追加ありの1回診断で、速度比較や正式合格には使わない。この診断時点の正式中央値1,980.097ms・上限1,500ms未達を履歴として保持する。新依存・製品変更・LLM呼出・追加費用は0。

同一languageの `setLanguage` 再設定省略も不採用。main由来 `63e23b0`・Nix / Bun 1.4.2で、既存WASM / Go languageへのAPI呼出だけをprivate probeで1回確認した。warmup各1,000後の各8,000回は通常0.381750ms / language-property guard0.016916msで、6,490ファイルへ直列換算しても差0.295972ms。不足480.096958msに対して小さすぎるため製品変更・再計測は行わない。これは実scan・正式試験ではなく、1,500ms未達を維持する。source HEAD・probe / WASM hash・条件は同JSONの `setLanguageProbe20261011`。新依存・LLM呼出・追加費用0。

## 追加screening（2026-10-12 JST、main 349d241）

このscreening時点の正式値は [idx-performance-tiers.json](idx-performance-tiers.json) の `formalVerification20261012`：quiet / AC・factor1.003381、8Worker・中央値**1,694.155ms**。上限1,500msは**FAIL**、不足194.155msだった。以下2案は製品へ採用していない。後続の正式値は次節に記録する。

- `endIndex`の重複getterをlocalへ置き換える案は、小さな固定ASTだけでscreeningした。各267,204回のgetterは7.846 / 2.883ms、localは0.421 / 0.369ms、checksumは全回一致。回数はsymbol数×2という仮定で、実scanのcall数や厳密な上限ではない。JIT差もあり、数msの差から全体の改善は証明できないため見送った。
- pinned runtime / Go WASMをBinaryen132の`-O3 -g`（既存命令に必要なbulk-memory-opt / nontrapping-float-to-intを許可）でprivate生成した。sorted import / export形状と`dylink.0`は一致。6言語×byte / shared×元 / 候補の24 loader sampleは、全ParseItemResultが一致しerrors0。全corpus互換性の証明ではない。

既存のquiet / AC / factor0.9〜1.1 guardを維持した全体ABBAは、較正1.104886 / 1.202757で**2回とも開始前に停止（scan0）**。条件を緩めた再実行は行っていない。

候補を採用する根拠があるか調べるため、固定Go4ファイルだけをメモリから読むhandler直呼びをfresh process ABBAで実行した。sourceを渡さず、毎回parse数とdelete数の一致（各process36件）をassertし、LRU incremental parseを防いだ。各process初回1回＋反復8回、入力・全ParseItemResult hash・statsは一致。反復の平均経過時間は元61.609 / 候補59.720ms（**3.07%**差）、process CPU平均は76.971 / 74.317msだった。load11.251はquiet閾値9を超えている。

これは選択4入力・単threadの診断で、cold scan、Worker転送、SQL、本番の返信後256KiB明示GCを含まない。phaseのparse / queryは経過時間、queryは`extract()`全体であり、WASM単体のCPU時間ではない。process CPUはhandler以外のruntime / background処理も含む。初回のsource付きincremental経路の結果はprivateに保持し、この比較から除外した。全corpusの3表hashも未取得なので、正式性能・互換性の合格とは扱わない。

全体で再現する改善や不足194msの解消を裏づける結果ではないため、派生WASM配布・恒久依存・asset lock変更は追加しない。Binaryenはproject-pinned nixpkgsの一時Nix環境で使用し、直接install・flake変更・追加LLM・追加費用は0。値・hash・guard・制限は [idx-cold.json](idx-cold.json) の `screening20261012`。正式1,500ms未達を保持する。

## 全体ABBAによる後続確認（2026-10-12 JST、main 4adaff2）

解析Workerのroot importを既存parse/index.tsへの公開entryに絞る案も確認した。依存入力は127→61（workspace120→54）、8Workerの起動診断は平均38.363→32.581ms、出力hash一致。ただし起動はS0と重なる。全Go ABBAでは前後quiet / AC・factor1.076753 / 1.079409、元1,473.451 / 1,483.238ms、候補1,453.795 / 1,529.364msで、中央値1,478.345→1,491.580ms（候補0.895%遅い）。3表全行hash・counters・coverageは一致したが、scan速度・peak RSSの改善は確認できず**不採用**。候補の公開entry・境界例外・テストは復元し、未pushの作業branchを削除した。候補だけの境界回帰は12pass / 73assertionsだった。

このbaselineが上限付近まで下がったという新しい証拠から、clean mainで既存正式caseを1 invocation実施した。最新正式中央値は**1,554.114125ms**で、hard1,500msに対して**FAIL / exit1**、不足54.114125ms。前後quiet / AC・reference範囲内で、元の製品コードと予算を維持した。前回1,694.155083msとの時間差を製品改善とは主張しない。[正式値と制限](idx-performance-tiers.md)。

reference条件が戻ったため、上記WASM -O3候補も同じGo全体で1 ABBAだけ実行できた。元1,455.436 / 1,515.840ms、候補1,458.731 / 1,497.880ms、中央値1,485.638→1,478.305ms（0.494%差）。3表全行hash・coverage・counters・degraded2は全回一致し、先行の「全corpus hash未取得」はこの後続で確認できた。ただしafter factor**1.147960**は基準外で、candidateのquery累積時間も減っていない。小差から再現する改善・正式合格は主張できず**不採用**を維持する。派生WASM・恒久依存・asset lock変更0。

値・driver / raw hash・各候補の判断は [idx-cold.json](idx-cold.json) の `fullScanFollowup20261012`。hashは各比較内で同じ直列化を使い、初期driverと直列化が異なるidx_blobs digestは横断比較しない。追加LLM・追加費用0。製品の変更を残さず、最新正式hard未達を保持する。

## 空globのS0確認（main 5925579）

`compileGlobs([])`は空Set検索とbasename切り出しを行うため、即falseを返す案を確認した。既存Go corpusを読み取り専用で再帰列挙した7,762ファイルに各3照合、各variantを100反復・事前warmup後ABBAで診断した。1列挙相当の元matcherは0.622598 / 0.606442ms、即falseは0.031283 / 0.031364msで、全回match0だった。列挙は本番の7,687件と同じではなく、これはmatcherだけの単thread診断で、S0全体・正式scan・較正付きの測定ではない。

照合だけの差は約0.58msで、不足54.114msを解消する根拠はない。製品変更・全体再計測は行わず、最新正式FAILを維持する。追加LLM・依存・費用0。

## 保存準備と所有権の確認（main f357bee）

`storeSymbols`の全callerと保存先を独立reviewした。parentなしsymbolのobject-restコピーを省く案は、WorkerPool契約にresponseの所有権移譲・以後不変の保証がなく、保持されたresponseの変更がParsed cache・背景保存へ波及し得るため不採用。batch到着時の逐次applyも、失敗・cancel時に部分適用を残すため採用しない。現行のコピーと全lane成功後適用を維持する。

qualname→ord Mapだけを最初のparent付きsymbolまで作らない案は、安全性とは別に効果量を診断した。先行ABBAの保存済みDBをreadonlyで開き、133,602symbol / 5,193content groupの名前・ord・parent有無だけを使用。parentを持つgroupは2,460、parentなしgroupのsymbolは26,270件だった。Map構築だけの単thread・warmup後ABBA各20反復では、1 corpus相当で元1.960300 / 1.934956ms、lazy1.614079 / 1.518198ms。平均差0.381490msで、scan全体・較正付き・正式gateの測定ではない。コピーやparent解決を省略した上限評価でもなく、Map構築だけの診断と区別する。

不足54.114msの解消を裏づけないため、製品変更・全体再試行は行わない。private `result.json` SHA-256は `12803862f1a746d7467e01db064179b3e591e414aa9b4d0b026b843451bbd27f`。GCの既存cadenceと同期full GC、抽出結果、所有権、予算を維持し、正式FAILは未解決。追加LLM・依存・費用0。
