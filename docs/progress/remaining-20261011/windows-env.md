# Windows native CI — 子環境の厳密な受渡し（2026-10-11）

[run 38096491256](https://github.com/satoki252595/mitori/actions/runs/38096491256)（`b6b61f2291a7fe29345a98bb4d1f9f12655f610e`、native job `114343799001`）はcheckoutとNix-built Bun runtimeの起動・frozen installを完了し、source testsは5成功・1失敗だった。literal UTF-16 argv、stdio、終了コードの確認は通り、exact environmentの比較でWindows標準9変数が余分に現れた。正の対照、leader終了時の孫プロセス停止、全signalでの独立detach孫プロセス停止は成功。compiled `_selftest` は前段失敗のため未実行だった。

原因はBunのWindowsプロセス起動による標準環境変数の補充を、native launcherが `GetEnvironmentStringsW` でそのまま子へ渡していたこと。余分な名前は `HOMEDRIVE` / `HOMEPATH` / `LOGONSERVER` / `SYSTEMDRIVE` / `TEMP` / `USERDOMAIN` / `USERNAME` / `USERPROFILE` / `WINDIR`。実値はこの資料に保存していない。

修正では、TypeScriptからランチャーへ明示した環境変数名だけをcount/listとして渡し、C側でその名前だけのUnicode環境blockを作る。値は環境に保持し、argvへ追加しない。環境名をlocaleに依存しないUnicode ordinal順で並べ、invalid・重複・存在しない名前を拒否する。空値と元の名前の大文字小文字を保持し、double-NUL終端で `CreateProcessW` へ渡す。[Microsoftの環境block仕様](https://learn.microsoft.com/en-us/windows/win32/procthread/changing-environment-variables)（2026-10-11確認）に合わせた。空値の扱いを曖昧にしないため、環境blockを直接選別している。

原子的なJOB_LISTへの所属、KILL_ON_JOB_CLOSE、breakaway禁止、stdio3ハンドルだけの継承、全signalのhard stop、UTF-16引数のquote処理は維持した。環境bufferは既存blockの長さから確保し、新しい集計サイズ上限は加えていない。strict equalityを緩めず、既存native4ケースへ空値・非ASCII名/値を加えた。環境「名」だけのプロトコルと曖昧な名前の拒否を確認するportable testを1件追加した。

この変更はverified Job Objectを使う `processGroup:true` の経路を対象とする。`processGroup:false` は既存の直接Bun.spawnの経路で、Windows標準環境変数を補う挙動が残る。POSIX経路は変更していない。

後続の静的caller確認では、自動LLMのClaude / Codex / generic（Museを含む）はすべて `scrubEnv` と `processGroup:true` を使い、warm / cold / continuation・gen / loop・detectにも迂回はなかった。falseは固定 `--version` と明示plugin導入のみ、公式認証は別の人確認済み経路、HTTP engineは子processなし。この制限による自動LLMのlean起動違反は見つからず、追加変更は不要と判断した。これは静的確認であり、Windows上の実LLM互換性を実証するものではない。

既存の `scripts/nd nix develop .#windowsCross --command bun scripts/build-windows-job.ts` でZig 0.16.0のcrossbuildを実施し、`-Wall -Wextra -Werror` を含む既存flagsで成功した。最初はsandboxが既存Nix cache DBの書込みを拒否したため、正規escalationで同じコマンドを再実行した。新依存、Windows Bunの直接ダウンロード、グローバルinstallは追加していない。

MacのNix Bunで、native asset / extraction / build record / spawnerの対象4ファイルは19成功・Windows限定4skip・0失敗、59 assertions。platform型検査は診断0、対象3 TypeScriptファイルのBiomeとdiff checkは成功した。CのcrossbuildとMacテストはWindows native成功の代用にはならない。

**前回の修正後再CI:** [run 38112767631](https://github.com/satoki252595/mitori/actions/runs/38112767631)（`525260d354233147d18232073a7a3ae17ad94b38`）のNix crossbuildと `windows-2025` native jobが成功。source testsは**7成功・0skip・0失敗**、2ファイル・33 assertions・4.38秒だった。literal UTF-16 argv・空値/非ASCIIを含むexact environment・stdio・終了コード、正の対照、leader終了時と全signalでの独立detach子孫停止を実Windowsで確認した。

別工程の製品 `--version` は `mitori 0.0.0 (api 1)`、compiled `_selftest` は `source: embedded` / `standalone: true` で**integrity / web / parse / elk / shiki / sqliteの6 checksすべて成功**、計4,507.7945ms。[native job](https://github.com/satoki252595/mitori/actions/runs/38112767631/job/114392030222) / [証跡artifact](https://github.com/satoki252595/mitori/actions/runs/38112767631/artifacts/11692446328)。Nix-built EXEを `BUN_BE_BUN=1` で使う検証方式を維持し、Windows Bunの別ダウンロードは行っていない。初回失敗、最終成功、コマンド、生成PEとソースのSHA-256は [windows-env.json](windows-env.json)。

**最新headの再確認:** [run 38115528185](https://github.com/satoki252595/mitori/actions/runs/38115528185)（`23645fdc7100e02e5f6b63bbbde2b33c59b1c79f`）もNix crossbuild / Windows nativeとも成功した。[native job 114400007117](https://github.com/satoki252595/mitori/actions/runs/38115528185/job/114400007117)のcheckout SHAとAPIのhead SHAが一致し、source testsは**7成功・0skip・0失敗**、2ファイル・33 assertions・**4.20秒**。`--version` は同じ `mitori 0.0.0 (api 1)`、embedded / standalone `_selftest` は同じ**6 checksすべて成功**、計**2,606.378ms**だった。前回525260dの時間値は上に残し、最新runへ付け替えていない。

[最新の証跡artifact](https://github.com/satoki252595/mitori/actions/runs/38115528185/artifacts/11692704229)のselftest JSONはnative実ログと一致し、ダウンロードした2 artifactsのZIP digest / sizeもGitHub APIと一致した。[製品artifact](https://github.com/satoki252595/mitori/actions/runs/38115528185/artifacts/11693273084)内のEXEは94,430,208 bytes、SHA-256 `3e1d25c49fbb36b5974a4ec6036a3d9bc8ebcb81cc21d8d078b85143cf189e04`。native launcherは60,416 bytes / `ab791a37e55b5e0c682dfa13189295d645940c9e2a129211f2027e37839d4df2`で実crossbuildログと一致した。EXEはMacでは実行せず、hashだけを取得した。初回失敗・前回成功・最新成功を [windows-env.json](windows-env.json) に分けて保存した。これはWindows対象の結果であり、PR全体のCI完了を意味しない。

## 後続修正：非groupの環境とCLI自動起動

上の非group経路の制限も修正対象にした。Windowsの全Spawner起動にverified native assetを必須とし、`processGroup:false`だけ`--single-process`を付ける。明示した環境名だけを渡す既存protocolを共用し、単独起動はleaderだけ、group起動は子孫まで停止する。[Job Objectの仕様](https://learn.microsoft.com/en-us/windows/win32/procthread/job-objects)に従い、SILENT_BREAKAWAY_OKは単独起動に限定する。group側のbreakaway禁止、原子的JOB_LIST、stdio、literal引数とstrict equalityは維持した。

CLIの自動daemon起動にはasset準備が無く、native wrapperのPIDを実daemonのPIDとして比較する別の不具合もあった。assetを必要時だけ展開し、親CLI終了後もwrapperを維持する。lockを取ったdaemonだけが専用pipeへ実PIDを一度通知し、既存のregistry / HMAC healthとのPID一致と子未終了を所有証明に使う。敗者・不正通知・期限切れでは所有を付与しない。準備・通知・health待ちは既存の5秒期限を共有する。固定version probeと明示plugin実行にも同じassetを配線した。

MacのNix環境ではplatform対象19pass / Windows限定6skip / 0fail、CLI所有権・期限28pass / 0fail、installer・discovery36pass / 0fail（discoveryは重複）、version probe3pass / 0fail。最終全7checkは4.50秒で成功。配布EXEを外部asset無しの一時フォルダへコピーするWindows限定2ケースを追加し、cold export後のregistry削除、scanの親終了後の存続、既存daemonのexport再利用と明示停止を確認する。Macではこの2件はskipで、後続native実行はまだ未確認。実LLM・認証操作・追加LLM費用は0。現在の結果は [windows-env.json](windows-env.json) の `singleProcessAndBootstrap20261011` を参照。

後続初回の [run 38147674750](https://github.com/satoki252595/mitori/actions/runs/38147674750)（head `eaa0265`）はNix crossbuild成功、Windows nativeは**9pass / 2fail / 0skip、52assertions、9.87秒**。新旧9件の環境・引数・単独停止・子孫停止はすべて成功した。新compiled2件だけが `path must be absolute` で失敗し、server workspace受付のPOSIX限定チェックを原因として特定した。後続のdocDir結合とプロジェクト保護にも同じ区切り文字依存があり、OS標準のパス処理へ修正する。compiled selftestは前段失敗で未実行。成功したnative helper確認をCLI全体の成功とは扱わない。

パスの後続修正ではworkspace絶対パス・名前、drive/UNC/home保護、doc root包含・祖先・realpath比較、shadow保存先の新規作成をnativeパスへ統一した。repo-relativeのbackslash・traversal・root別名・Windowsのdrive-relative/drive未指定・ADSは拒否し、symlinkとrealpath完全一致の保護を維持する。docの字句的な`node:path`だけを[ADR-0010 R3](../../design/adr/0010-package-boundaries.md)の限定例外とし、読み書きは引き続きFsReader/SafeWriter経由。Macの関連5ファイルは52pass / Windows限定4skip / 0fail・259assertions、7checkは6.68秒で成功。native workflowにshadow cold exportと、project/doc root保護の名前指定試験を追加した。修正後のWindows実行はまだ未確認。
