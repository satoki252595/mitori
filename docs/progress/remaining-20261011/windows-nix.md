# Windows 検証を Nix 由来の成果物で実行する — 2026-10-11

WindowsでBunを別途ダウンロード・インストールする工程を取り除いた。Linuxの既存Nix shellから生成する `mitori-windows-x64.exe` を、Bun公式の `BUN_BE_BUN=1` でBun CLIとして再利用し、frozen installと既存source testsを実行する。新しいランタイム、グローバルPATH変更、Windows向けのNix運用例外は追加しない。

公式仕様: [Bun — Single-file executable / Act as the Bun CLI](https://bun.sh/docs/bundler/executables#act-as-the-bun-cli)（2026-10-11確認）。`BUN_BE_BUN=1` を設定したstandalone executableは、埋め込みentrypointを実行せず、test runnerを含むBun CLIとして動作する。

既存のnative4ケースはすべて維持する。literal UTF-16 argv・exact environment・stdin/stdout/stderr・終了コード、非group子の生存というpositive control、group leader終了時の子孫停止、SIGINT/SIGTERM/SIGKILLでの独立detach孫プロセス停止を検証する。fixtureは必要な `BUN_BE_BUN` だけを明示的に子・孫へ渡す。検証対象の実装やcontainment条件は変更していない。

MacのNix Bun 1.4.2で、製品と同じautoload無効化flagを付けた小さなstandalone executableを生成し、Bun CLIモードのtest runner・bunfig preload・`-e`のliteral argv・exact child environmentを確認した。1成功・0失敗、4 assertions。さらにそのstandaloneを使い、対象3ファイルは3成功・Windows限定4 skip・0失敗、13 assertions。これはWindows native成功の代用にはならない。

Workflow YAMLと結線の8 assertions、対象Biome、`git diff --check`は成功した。開始input名は承認例外を意味する旧名から `verify_windows` に変更した。統合先へpushした後の開始コマンドは次のとおり。

```sh
scripts/nd gh workflow run ci.yml --repo satoki252595/mitori --ref <検証対象branch> -f verify_windows=true
```

Windowsのsource test工程だけで `BUN_BE_BUN=1` を設定する。別工程の製品 `--version`・`_selftest` は通常のentrypointを実行する。Windowsでのsource testログとselftest JSONをActions artifactへ保存する。

**初回native実行:** [run 38096491256](https://github.com/satoki252595/mitori/actions/runs/38096491256) は5成功・1失敗。BunがWindows標準環境変数を補ったため、exact environmentだけが失敗した。既存のnative4ケースと厳密比較を維持してランチャーを修正し、環境名プロトコルの検証を1件追加した。詳細は [windows-env.md](windows-env.md) / [windows-env.json](windows-env.json)。

**前回のnative実行:** [run 38112767631](https://github.com/satoki252595/mitori/actions/runs/38112767631)（`525260d354233147d18232073a7a3ae17ad94b38`）はNix crossbuildと `windows-2025` native jobの両方が成功した。Nix-built Bun 1.4.2でfrozen installを実行し、source testsは**7成功・0 skip・0失敗**、2ファイル・33 assertions・4.38秒。既存native4ケースすべてが成功し、環境の厳密比較も維持した。

製品の通常entrypointでは `--version` が `mitori 0.0.0 (api 1)` を返し、`_selftest` は `source: embedded` / `standalone: true`、**integrity / web / parse / elk / shiki / sqliteの6 checksすべて成功**、計4,507.7945msだった。[native job](https://github.com/satoki252595/mitori/actions/runs/38112767631/job/114392030222)と[証跡artifact](https://github.com/satoki252595/mitori/actions/runs/38112767631/artifacts/11692446328)を保存した。初回の失敗とMacでの確認値は [windows-nix.json](windows-nix.json) / [windows-env.json](windows-env.json) に履歴として残している。今回のWindows対象検証は完了したが、全Windows版・全利用経路の保証ではない。

**最新headのnative実行:** [run 38115528185](https://github.com/satoki252595/mitori/actions/runs/38115528185)（`23645fdc7100e02e5f6b63bbbde2b33c59b1c79f`）もNix crossbuildと `windows-2025` nativeが成功。Nix-built Bun 1.4.2のfrozen installは280 packages、source testsは**7成功・0skip・0失敗**、33 assertions・**4.20秒**。通常entrypointの `--version` とembedded / standalone `_selftest` **6 checksすべて成功**、計**2,606.378ms**。[native job](https://github.com/satoki252595/mitori/actions/runs/38115528185/job/114400007117) / [証跡artifact](https://github.com/satoki252595/mitori/actions/runs/38115528185/artifacts/11692704229)。API・checkout・artifactのhead SHAを照合し、製品EXEのSHA-256は `3e1d25c49fbb36b5974a4ec6036a3d9bc8ebcb81cc21d8d078b85143cf189e04`。ZIP digestと実数も実ログ・artifactで確認し、前回525260d成功はJSONのhistoryへ別記した。Windows Bunの別ダウンロード、追加実測、ソース変更は行っていない。このWindows-only runをPR全体のCI成功とは扱わない。
