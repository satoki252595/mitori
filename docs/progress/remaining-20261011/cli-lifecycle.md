# F14: CLIの案内とexport終了処理（2026-10-11）

全体helpを既存の日本語・英語 `overview` へ遅延接続し、主要コマンドと操作を表示する。`--version` の軽い起動経路は維持する。

exportは自身が実際に起動したchildが存命で、検証済みhealth / registryのPIDと一致する場合だけ終了対象にする。既存daemonは別versionでもexportのために再起動しない。接続後からworkspaceを開く処理・取得・保存をfinallyで保護し、終了時も同じregistryのPIDとtokenを確認する。

後から別画面が接続した場合も止めないよう、shutdownのoptional `onlyIfIdle` を加えた。サーバーは既存idle monitorのbusy判定を共用し、同期確認から停止開始までawaitを挟まない。SSE接続・workspace作業・waiter等があれば409で維持する。明示stopは従来通り。終了拒否や通信失敗は待機せず、exportの成功結果や元エラーを保持する。

対象検証は次の通り。実LLM呼出・新依存・追加費用0。

- 旧実装でhelpとcleanupの回帰失敗を確認。変更後main / export / daemon-client / commandsの初回4fileは43pass。
- onlyIfIdle追加後の最終export / daemon-client / commandsは42pass / 173assertions。export単独は15pass / 58assertions。成功、workspace・取得・保存先失敗、既存daemon、競合PID、終了済みchild、409と通信失敗時の結果保持・待機なしを確認。
- server shutdown対象2tests / 17assertionsが成功。新規回帰は旧実装で失敗し、後接続SSE中は拒否、切断後は停止することを確認。既存の明示shutdown回帰も成功。
- CLI型検査、対象Biome、diff checkが成功。統合 `scripts/nd bun run check` は全7step成功（5.76秒、warm）。

childとdaemon PIDの同一性を証明できない環境では終了しない。起動確認に失敗して所有を証明できない場合も強制終了せず、既存のidle終了処理に任せる。Goldenの変更はない。

## 配布binaryで見つけた追加修正

先行binary `f83eeb0f…` では実export成功後の終了を確認したが、存在しない保存先ではworkspace scan中にfinallyへ入り、idle guardが自身のscanを使用中と判断してdaemonを残した。この失敗を保持し、当該private test homeのdaemonだけを停止した。既知の言語と保存先directoryの検証を接続前へ移し、起動後の保存失敗回帰はsymlink拒否に変更して維持した。

追加回帰3件は旧実装で起動ありの失敗を確認し、修正後はspawn0・workspace POST0・registry無し。最終export対象は18pass / 70assertions、CLI型検査・対象Biome成功。再buildしたbinary `e13368f9bca5a9b99d48010e714a36c737aa41c797de0772f2301d0a937de801` でも、成功時code0 / HTMLあり / registry削除、無効保存先code1 / HTML無し / registry無しを実確認した。先行binaryでは日本語・英語helpとembedded selftest6checksも成功（1,042.505ms）。変更後はexportの2経路だけ再検証し、実LLM呼出0。[失敗と修正後の証跡](cli-lifecycle.json)。

最終sourceでも統合 `scripts/nd bun run check` 全7stepが成功（4.12秒、warm）。
