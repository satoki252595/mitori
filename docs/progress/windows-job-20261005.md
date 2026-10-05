# Windows process tree の続行

確認日: 2026-10-05。source と crossbuild まで実施。**Windows native 実行は未確認**であり、Windows 対応完了とは扱わない。変更は未コミット、生成 EXE は ignored cache のみ。

統合担当の追加準備: `.github/workflows/windows.yml` は manual / reusable workflow として、Nix crossbuild→公式Bunのdigestを確認したWindows2025 native test→compiled Worker selftestを用意した。既存 `ci.yml` のdispatchから現在branchのreusable workflowを呼べるため、native test前にmainへ入れる必要はない。Nix例外の入力は既定false、未承認で実行しない。YAML parseとopt-in条件のassertを確認済み。承認とbranch push後の実行例:

```sh
scripts/nd gh workflow run ci.yml --repo satoki252595/mitori --ref codex/complete-backlog -f windows_nix_exception_approved=true
```

既存 Spawner の `process.kill(-pid)` は POSIX の process group に限定される。Windows の taskkill では leader が既に終了した子孫を保証できないため、小さな native Job Object launcher に接続した。Bun FFI や shell は使わない。

## 起動と停止

`packages/platform/native/windows-job.c` は absolute executable と literal UTF-16 argv を受け取る。CreateProcessW の JOB_LIST で、child の最初の命令より前に job へ所属させる。HANDLE_LIST は複製した stdin / stdout / stderr の3件のみ、environment は wrapper に渡された完全な Unicode environment block、cwd は同じものを使う。job handle は継承せず、BREAKAWAY / SILENT_BREAKAWAY を許可しない。Windows 10 / Server 2016 以降が必要で、対応できない起動は125で拒否する。

job に KILL_ON_JOB_CLOSE を設定し、leader 終了時には残りの子孫を終了して leader の exit code を返す。wrapper 自体が終了した場合も kernel が最後の job handle を閉じる。Windows `processGroup=true` の SIGINT / SIGTERM / SIGKILL は、wrapper の hard terminate に写像する。**cooperative SIGINT と最終 usage line は保証しない。** LLM の途中停止では既存の未取得 usage 推計が必要になる。POSIX の signal / escalation は維持した。

`SpawnerOptions.windowsJobLauncher` は `{path,sha256}`。毎 spawn で absolute / canonical realpath / regular non-symlink / bounded size、inode / mtime / ctime / size の前後一致、sha256 を検証する。verified helper が無い Windows processGroup は E_UNSUPPORTED で拒否し、弱い停止経路へ切り替えない。

CLI の asset embedding / private home extraction / daemon binding は統合担当が既存の SafeWriter と資産パターンへ接続した。process-tree containment は filesystem / network sandbox の代わりではない。Windows の gate sandbox / Codex precise native profile の制約をこの helper で解消したとは言わない。

## Nix crossbuild

日常の default shell は増やさず、`flake.nix` に `windowsCross`（bun＋Zig）を追加した。

```sh
nix develop .#windowsCross -c bun scripts/build-windows-job.ts
```

Mac では `/tmp` が symlink のため、小さな flake copy を使う場合は canonical `/private/tmp` が必要。daily `scripts/nd` と同じく flake.nix / flake.lock のみをコピーして評価した。Nix の Zig 0.16.0 で strict C11 / Wall / Wextra / Werror crossbuild 成功、59392 bytes の AMD64 PE を得た。

出力は `node_modules/.cache/mitori-windows-job/windows-job-x64.{exe,json}`。gen-assets が `dist/.build` を削除しても失われない。record は source / build script / emitted exe の hash、size、compiler version を記録し、source 変更・改変・非AMD64 PE を拒否する。record の path は固定値を確認してから読む。同じ確定 source / build / compiler の再ビルドでも同じ sha256 を得た。証拠は [windows-cross-build-20261005.json](./windows-cross-build-20261005.json)。生成 EXE は Git に追加しない。

## 検証

```sh
scripts/nd bun test scripts/build-windows-job.test.ts packages/platform/src/spawn/windows-job.test.ts packages/platform/src/spawn/spawn.test.ts
scripts/nd bunx tsc -p packages/platform --noEmit
```

Mac: 17 pass / 0 fail / 4 Windows-only skip、49 assertions、約0.5秒。asset の変更・symlink / unknown helper 拒否、record の source / build / exe / path / PE 検証、既存 POSIX argv / environment / pipes / process group / reapGroup の回帰を確認した。platform 型検査、対象 Biome error 0。

別担当の read-only source review でも、atomic JOB_LIST、non-inherited job handle、stdio HANDLE_LIST、UTF-16 argv、cleanup、Bun environment / cwd の経路に具体的な欠落は見つからなかった。これはソースレビューであり、native 実測の代わりにはしない。

Windows-only の4ケースを同じ test file に置いた。native crossbuilt artifact を指定できる環境で、以下を確認する。

1. empty / Japanese / quote / backslash / wildcard / shell-looking literal argv、完全な env、stdio、leader exit7、unknown-helper 拒否。
2. containment を使わない positive control では独立 child の遅延 write が実行できる。
3. job の leader が先に終了しても独立 child の遅延 write が起こらない。
4. leader が生きている状態から3種の cancellation signal で child / grandchild が終了し、遅延 write が起こらない。

```powershell
$env:MITORI_WINDOWS_JOB_LAUNCHER = "C:\absolute\path\windows-job-x64.exe"
bun test packages/platform/src/spawn/windows-job.test.ts
```

Windows 実機 / native CI の環境・依存例外は統合担当が利用者確認中。Wine / エミュレーション、Windows でのグローバル install、実 LLM 呼び出しは行っていない。crossbuild の成功を native process-tree 証拠へ読み替えない。

## 出典

[Microsoft UpdateProcThreadAttribute](https://learn.microsoft.com/en-us/windows/win32/api/processthreadsapi/nf-processthreadsapi-updateprocthreadattribute) の HANDLE_LIST / JOB_LIST と対応OS、[Job Object limits](https://learn.microsoft.com/en-us/windows/win32/api/winnt/ns-winnt-jobobject_basic_limit_information) の KILL_ON_JOB_CLOSE、[CreateProcessW](https://learn.microsoft.com/en-us/windows/win32/api/processthreadsapi/nf-processthreadsapi-createprocessw) の explicit executable / environment / handle 契約、[C argv の quote / backslash 規則](https://learn.microsoft.com/en-us/cpp/c-language/parsing-c-command-line-arguments?view=msvc-170)、[mingw-w64 wildcard default](https://raw.githubusercontent.com/mingw-w64/mingw-w64/master/mingw-w64-crt/crt/wildcard.c) を確認した（2026-10-05）。
