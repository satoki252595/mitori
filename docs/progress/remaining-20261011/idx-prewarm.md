# 初回parse準備のlazy pool対応（2026-10-11）

`ParsePool.prewarm()` はfactory直後の `pool.size()` 本だけ準備requestを送っていた。製品と正式benchが使うplatform poolはlazy spawnで、この時点のsizeは0。S0中にWorker起動とgrammar準備を重ねる既存処理が一度も動いていなかった。loopの上限を起動予定の `Math.max(1, n)` にする1行で直す。pool上限、解析対象、空のwarm item、GC、timeout、予算は維持する。

lazy poolを再現する回帰1件は旧実装でExpected6 / Received0の失敗を確認し、修正後に予定6本と最小1本を確認した。対象pool testは6pass / 0fail / 20assertions、対象2fileのBiomeは成功。

main `d507d1e` を凍結し、同じ固定gostd・fresh process / 空home・通常6Workerでbaseline→candidate→candidate→baselineを比較した。全4runでfiles7,687 / included6,009 / filesParsed6,539 / cacheHits0 / degraded2、hash・parse・SQLカウンタと抽出3表の全行hashが一致。S1で待つWorker起動時間はbaseline9.780 / 10.956msに対しcandidate0.035 / 0.043msとなり、先行起動が実際に動くことを確認した。これは起動時間をS0と重ねる修正で、起動自体を計時から除いたものではない。

全体時間はbaseline2,073.346 / 2,591.996ms、candidate2,066.556 / 2,343.250ms。開始はquiet / AC・factor1.083876だったが、終了時はload10.208 / factor1.124994で既存基準外になった。**全体の速度改善・1,500ms合格は未証明**として保持する。前回の正式中央値1,980.097msの未達判定をこの比較で上書きしない。LLM呼出・新依存・追加費用0。[比較の全結果](idx-prewarm.json)。

後続source `df7927732c857845c34cabf99714bbdf9fbb5a23` で正式caseを試みたが、事前guardはquiet / AC・load7.787598に対しfactor1.130491で既存0.9〜1.1の範囲外だった。scanは0回で停止し、guardやreferenceを変更して再実行していない。前回の正式未達判定を保持する。同JSONの `formalGuardFollowUp` に記録した。
