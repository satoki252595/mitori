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
