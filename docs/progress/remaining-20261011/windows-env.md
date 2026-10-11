# Windows native CI — 子環境の厳密な受渡し（2026-10-11）

[run 38096491256](https://github.com/satoki252595/mitori/actions/runs/38096491256)（`b6b61f2291a7fe29345a98bb4d1f9f12655f610e`、native job `114343799001`）はcheckoutとNix-built Bun runtimeの起動・frozen installを完了し、source testsは5成功・1失敗だった。literal UTF-16 argv、stdio、終了コードの確認は通り、exact environmentの比較でWindows標準9変数が余分に現れた。正の対照、leader終了時の孫プロセス停止、全signalでの独立detach孫プロセス停止は成功。compiled `_selftest` は前段失敗のため未実行だった。

原因はBunのWindowsプロセス起動による標準環境変数の補充を、native launcherが `GetEnvironmentStringsW` でそのまま子へ渡していたこと。余分な名前は `HOMEDRIVE` / `HOMEPATH` / `LOGONSERVER` / `SYSTEMDRIVE` / `TEMP` / `USERDOMAIN` / `USERNAME` / `USERPROFILE` / `WINDIR`。実値はこの資料に保存していない。

修正では、TypeScriptからランチャーへ明示した環境変数名だけをcount/listとして渡し、C側でその名前だけのUnicode環境blockを作る。値は環境に保持し、argvへ追加しない。環境名をlocaleに依存しないUnicode ordinal順で並べ、invalid・重複・存在しない名前を拒否する。空値と元の名前の大文字小文字を保持し、double-NUL終端で `CreateProcessW` へ渡す。[Microsoftの環境block仕様](https://learn.microsoft.com/en-us/windows/win32/procthread/changing-environment-variables)（2026-10-11確認）に合わせた。空値の扱いを曖昧にしないため、環境blockを直接選別している。

原子的なJOB_LISTへの所属、KILL_ON_JOB_CLOSE、breakaway禁止、stdio3ハンドルだけの継承、全signalのhard stop、UTF-16引数のquote処理は維持した。環境bufferは既存blockの長さから確保し、新しい集計サイズ上限は加えていない。strict equalityを緩めず、既存native4ケースへ空値・非ASCII名/値を加えた。環境「名」だけのプロトコルと曖昧な名前の拒否を確認するportable testを1件追加した。

この変更はverified Job Objectを使う `processGroup:true` の経路を対象とする。`processGroup:false` は既存の直接Bun.spawnの経路で、Windows標準環境変数を補う挙動が残る。POSIX経路は変更していない。

既存の `scripts/nd nix develop .#windowsCross --command bun scripts/build-windows-job.ts` でZig 0.16.0のcrossbuildを実施し、`-Wall -Wextra -Werror` を含む既存flagsで成功した。最初はsandboxが既存Nix cache DBの書込みを拒否したため、正規escalationで同じコマンドを再実行した。新依存、Windows Bunの直接ダウンロード、グローバルinstallは追加していない。

MacのNix Bunで、native asset / extraction / build record / spawnerの対象4ファイルは19成功・Windows限定4skip・0失敗、59 assertions。platform型検査は診断0、対象3 TypeScriptファイルのBiomeとdiff checkは成功した。CのcrossbuildとMacテストはWindows native成功の代用にはならない。

**前回の修正後再CI:** [run 38112767631](https://github.com/satoki252595/mitori/actions/runs/38112767631)（`525260d354233147d18232073a7a3ae17ad94b38`）のNix crossbuildと `windows-2025` native jobが成功。source testsは**7成功・0skip・0失敗**、2ファイル・33 assertions・4.38秒だった。literal UTF-16 argv・空値/非ASCIIを含むexact environment・stdio・終了コード、正の対照、leader終了時と全signalでの独立detach子孫停止を実Windowsで確認した。

別工程の製品 `--version` は `mitori 0.0.0 (api 1)`、compiled `_selftest` は `source: embedded` / `standalone: true` で**integrity / web / parse / elk / shiki / sqliteの6 checksすべて成功**、計4,507.7945ms。[native job](https://github.com/satoki252595/mitori/actions/runs/38112767631/job/114392030222) / [証跡artifact](https://github.com/satoki252595/mitori/actions/runs/38112767631/artifacts/11692446328)。Nix-built EXEを `BUN_BE_BUN=1` で使う検証方式を維持し、Windows Bunの別ダウンロードは行っていない。初回失敗、最終成功、コマンド、生成PEとソースのSHA-256は [windows-env.json](windows-env.json)。

**最新headの再確認:** [run 38115528185](https://github.com/satoki252595/mitori/actions/runs/38115528185)（`23645fdc7100e02e5f6b63bbbde2b33c59b1c79f`）もNix crossbuild / Windows nativeとも成功した。[native job 114400007117](https://github.com/satoki252595/mitori/actions/runs/38115528185/job/114400007117)のcheckout SHAとAPIのhead SHAが一致し、source testsは**7成功・0skip・0失敗**、2ファイル・33 assertions・**4.20秒**。`--version` は同じ `mitori 0.0.0 (api 1)`、embedded / standalone `_selftest` は同じ**6 checksすべて成功**、計**2,606.378ms**だった。前回525260dの時間値は上に残し、最新runへ付け替えていない。

[最新の証跡artifact](https://github.com/satoki252595/mitori/actions/runs/38115528185/artifacts/11692704229)のselftest JSONはnative実ログと一致し、ダウンロードした2 artifactsのZIP digest / sizeもGitHub APIと一致した。[製品artifact](https://github.com/satoki252595/mitori/actions/runs/38115528185/artifacts/11693273084)内のEXEは94,430,208 bytes、SHA-256 `3e1d25c49fbb36b5974a4ec6036a3d9bc8ebcb81cc21d8d078b85143cf189e04`。native launcherは60,416 bytes / `ab791a37e55b5e0c682dfa13189295d645940c9e2a129211f2027e37839d4df2`で実crossbuildログと一致した。EXEはMacでは実行せず、hashだけを取得した。初回失敗・前回成功・最新成功を [windows-env.json](windows-env.json) に分けて保存した。これはWindows対象の結果であり、PR全体のCI完了を意味しない。
