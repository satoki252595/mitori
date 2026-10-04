# Muse / max — 標準生成の45分計測

public corpusは [crit](https://github.com/tomasz-tomczyk/crit/tree/406875dd31e0eacc9af33b7643d54100620e8775)、commit `406875dd31e0eacc9af33b7643d54100620e8775`。`git clone --no-hardlinks` した専用scratchを使い、元corpusは変更していない。Muse native `1.4.2-R4684.1`、configured model `muse-spark-1.3-contributor`、要求effort `max`、C=2、各turn600秒、run45分、記録値cap USD0.30。

20/24タスクを完了し、runの壁時計2702.4秒で停止した。失敗0、生成319blocks、22calls（停止した2callを含む）。子プロセスは最大2、停止時と5秒後は0。記録値USD0.156396は本文byteからのusage推計で、実請求額ではない。

生成プロトコルの内部retryは0%、L1は99.5%、first AI block178.6秒。L1は引用内の識別子一致の検査であり、全文の意味が正しいことを保証しない。識別子のない主張はvacuousとして別計上する。

未完了はs3/s11/s12/s13。元の記録値上限から残額USD0.1436を設定し、この4節だけを別runで続行した。完了後の結果は `../gen-muse/`。45分内の一括完走は達成していない。

`report.json` と `doc/` はこの停止時の保存結果。`uncited-legacy-modules.txt` は親要約完了前に静的文も含めた旧方式の診断で、AI品質の比較基準には使わない。`uncited-ai-modules.txt` は親要約完了後にAI originだけを数えた記録。検証済みindexを使った最終の再現用測定は続行runの出力先に保存する。

保存文書は `.mitori/doc/` からそのままコピーしたため、codeの相対リンクは元scratch用のまま。出典の確認には上の固定commitを使う。生のprovider JSONLはrepo外の0700/0600の記録に置き、認証内容をGitへ保存しない。
