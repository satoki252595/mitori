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

**残る確認:** 実際の `windows-2025` runnerでsource testsが7成功・0 skip・0失敗となり、compiled binaryのembedded asset / Worker / SQLite selftestも成功すること。再実行が成功するまではWindows検証完了とは扱わない。最初のruntime差替え時の数値とローカル確認ログのハッシュは [windows-nix.json](windows-nix.json) に履歴として残している。
