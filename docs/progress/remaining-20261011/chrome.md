# 実Chromeでの確認（2026-10-11）

利用者がSafariの代わりにChromeを選択した。Chrome拡張の接続から、最終 `dist/mitori-darwin-arm64`（SHA-256 `67d632fa1c4fb061bb4d9630f2f5efd2d7e5f53ff08b803f7977d5a9a1e33459`）を一時HOMEとgo-small fixtureで確認した。ユーザー本人のmitori設定・認証・対象repoは変更していない。LLM呼び出し0。

- 初回マップに「スキャン完了・16ファイル・ここまで0 tok」が表示された。
- 検索欄に確定済みの日本語「設定」を入力すると「設定を開く」が出て、Enterで設定へ移動した。
- Codex選択でnativeチェックON、model `gpt-6.1-sol`、推計同意額USD 1が表示された。生成commandは実際の配布binaryから `setup codex --native --max-estimated-usd '1' --model 'gpt-6.1-sol'`。公式ログインボタンも表示された。
- nativeをOFFにすると対象repo欄へ切り替わり、`setup codex --repo '/tmp/example-repository'` を作れた。コマンド実行・ログイン開始は行っていない。
- 画面を目視し、設定操作・検索結果・コマンド表示を確認した。これはOSの実IME変換確認ではない。

`Input.imeSetComposition` はブラウザ操作許可で拒否された。別手段で同じイベントを注入せず、その場で停止した。実IMEの変換確定Enterと次のEnterの区別は利用者へ本人確認を依頼し、Chromeタブをその確認用に残した。Safari実機は今回の必須外。合成IMEイベントの自動回帰と実OS IMEの本人操作を混同しない。
