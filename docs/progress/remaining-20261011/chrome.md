# 実Chromeでの確認（2026-10-11）

利用者がSafariの代わりにChromeを選択した。Chrome拡張の接続から、最終 `dist/mitori-darwin-arm64`（SHA-256 `67d632fa1c4fb061bb4d9630f2f5efd2d7e5f53ff08b803f7977d5a9a1e33459`）を一時HOMEとgo-small fixtureで確認した。ユーザー本人のmitori設定・認証・対象repoは変更していない。LLM呼び出し0。

- 初回マップに「スキャン完了・16ファイル・ここまで0 tok」が表示された。
- 検索欄に確定済みの日本語「設定」を入力すると「設定を開く」が出て、Enterで設定へ移動した。
- Codex選択でnativeチェックON、model `gpt-6.1-sol`、推計同意額USD 1が表示された。生成commandは実際の配布binaryから `setup codex --native --max-estimated-usd '1' --model 'gpt-6.1-sol'`。公式ログインボタンも表示された。
- nativeをOFFにすると対象repo欄へ切り替わり、`setup codex --repo '/tmp/example-repository'` を作れた。コマンド実行・ログイン開始は行っていない。
- 画面を目視し、設定操作・検索結果・コマンド表示を確認した。これはOSの実IME変換確認ではない。

`Input.imeSetComposition` はブラウザ操作許可で拒否された。別手段で同じイベントを注入せず、その場で停止した。実IMEの変換確定Enterと次のEnterの区別は利用者へ本人確認を依頼し、Chromeタブをその確認用に残した。Safari実機は今回の必須外。合成IMEイベントの自動回帰と実OS IMEの本人操作を混同しない。

## 続行時の確認（12:45〜12:53 UTC）

この時点では公式Computer Use経路のnative Chrome操作が許可され、既存検索欄への個別キー入力を実行できた。macOS設定の既存入力ソースはABC / 日本語ローマ字、切替ショートカットはControl+Space / Control+Option+Space。設定自体は変更せず、確認に開いたSystem Settingsも終了済みをinventoryで確認した。

両ショートカットと個別キーによる `settei` → SpaceはASCIIのままで、OSの未確定文字・変換候補を取得できなかった。これを実IME成功へ読み替えない。以前のCDP操作拒否は当時の履歴として保持する。

切断済みの旧デモを、main統合後の配布binary（SHA-256 `d0a6c5a2d2aa809e549fcdb4eea43dde997d33c3a2a19623dc77a79b56965a56`、build source `6d892ea`）による一時HOME / fixtureのデモへ置き換えた。実Chromeでdaemon接続済み・16ファイルの初回map・0 tokと検索欄表示を確認。全LLM無効・各費用上限0・running / queued0、元fixture digest不変も確認した。本人の認証や設定は使用していない。

本人確認用URLは `http://127.0.0.1:55878/w/ws_x3pkt2wn3t4b`。日本語IMEで「せってい」→変換「設定」→最初のEnterで検索欄維持→次のEnterで設定画面、の実操作結果を待つ。一時daemonは本人確認用に維持し、終了手順は `/private/tmp/mitori-chrome-ime-20261011-xApzuy/README.txt`。nonce・cookie・auth情報は保存しない。本人結果未取得のため残課題は継続。
