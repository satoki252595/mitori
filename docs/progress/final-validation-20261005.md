# 最終統合の検証（2026-10-05、進行中）

対象は `codex/complete-backlog` の残タスク実装。最終 commit と PR の結果は後で追記する。未実施を成功として扱わない。

[PR #5](https://github.com/satoki252595/mitori/pull/5)を作成・pushした。初回CIのUbuntu wall判定と3browserの28 failを修正中の経緯は [PR実CI資料](pr5-ci-20261005.md)。修正後のMac全checkは6.01秒/exit0。最終PR全体成功・mergeはまだ未実施。

## 最初の全体実行と限定再検証

- Mac 全 `bun test`: **2,952 pass / 42 fail / 16 skip / 5 todo**、3,015 tests、342 files、124,897 assertions、229.25秒。失敗を残し、修正対象の単位だけ再実行した。
- Mac `check`: 11.12秒、初回 exit 1。scripts project の static Vite config import が web source を rootDir の外へ引き込む型エラーと編集中の整形を修正した。既知 absolute path の runtime import にし、誤って source tree へ出力された declaration を除去した。全20 project の意味型検査は再実行7.29秒で成功、Biome再実行も成功。その他5 check は初回成功。
- fixture descriptors: 新規 `gen-*` を既存 `gen:` descriptor に対応付け、生成specと初期historyを検査。対象1 test / 12 assertions成功。通常fixtureのtruth照合は維持した。
- golden: CLI share help、static outbound/decision文言、loopの既存helper優先、export metadataの変更を目視確認し、既存更新経路で30 filesを更新。対象16 tests / 508 assertions成功。goldenは独立した `golden:` commitへ保存する。
- `fixtures:build --verify`: 全12 fixture の commit一致を確認、exit 0。
- initial UI HTTP: auth/query/内部GETとestimate範囲、br/gzip/identityを対象に4 tests / 48 assertions成功。無圧縮DTOとの一致とno-storeを確認。
- 最終real UXでcold proposal表示欠落を確認後、固定same-ws proposal GETだけをallowlistへ追加。別ws・accept routeを拒否しadapterが呼ばれないことを追加して4 tests / 54 assertions成功。採用/拒否はSSRの能力へ追加していない。
- generation dependency: prep phase内でもhard dependencyの完了を待つ共有経路へ修正。questionsへflowsのCLAIMSが入り、再実行の12 tasksが全cached。session14 tests / 93 assertions成功。資料は [session-deps-20261005.md](session-deps-20261005.md)。

最初の失敗には、web assetの再生成後にsource daemonのtableが旧chunk名を保持する問題、export viewerの60,000 bytes制約、隣接table cellの引用range境界、namespace監査の新SidePanel、source lint監査、古いgoldenと編集中の生成promptが含まれた。共有asset table / range / viewer / UI監査を修正し、失敗した19 int filesの限定再実行は **88 pass / 0 fail / 733 assertions、85.09秒**。生成renderer全体も **17 pass / 144 assertions**。

残る失敗単位は別の限定実行で確認した。UX-UI＋viewerは **2 pass / 12 assertions**、UI監査は **36 pass / 1,127 assertions**。golden13件は上記16 passの実行、gen2件はrendererとsessionの実行、fixture1件はdescriptor/truthの実行へ対応する。19 int filesの実行だけで最初の42 fail全てを検証したとは扱わない。

最終Mac `scripts/nd bun run check` は **12.61秒、exit 0**。全20 projectの意味型検査、Svelte 0 errors / 0 warnings、Biome、boundaries、CR ledger、budgets、contract indexが成功した。全unitの最初の42 failは履歴として保持し、その後の全unitをMacで再実行したとは報告しない。

その後の梱包修正では、raw/brの重複埋込みを省き、既存Brotli解凍でidentityを復元する共有registryへ変更した。devのraw pathとbr/gzip配信を維持し、同一bytes・missing/corrupt拒否を既存testへ追加。**10 pass / 55 assertions**。新testのBuffer/Uint8Array matcher型不一致を修正後、最終Mac checkは **7.02秒、exit 0**（全20意味検査を含む）。

## 出荷物・実環境（未完）

- 最初のall-target buildは成功したがWindows95,889,920 bytesでhard95MBを超えた。raw/br重複を省いた再buildは **Mac70,548,978 / Linux89,572,832 / Windows94,345,728 bytes**、全binary95MB以内・size exit0。Linux/Windowsの85MB target WARNは保持。buildとSHAは [shipping-binaries-20261005.json](shipping-binaries-20261005.json)。
- compiled Mac `_selftest --json --elk-runs 5` は成功。pinned9 filesのintegrity、web166 files、6言語parse、ELK、Shiki、SQLiteを実binaryで確認。[自己検査](shipping-selftest-20261005.json)。同じWindows/Linux binaryをnative実行した証拠ではない。
- compiled asset/static sizeはhard対象を成功。facts mark修正後の`--version`中央値43.14msは50ms limit内、20ms target WARN。gen/merge/paletteのchunk予算とprecompression率のnon-hard診断はredを保持。[asset結果](shipping-assets-20261005.json)。
- compiled実daemonのgo-small静的Map/Readerをfresh Chromiumで確認。最終Mac SHA`700514e4ecb5ac2b488dc65dd7ee13b69d516a468b926bb3eeea0cd5ed205de9`、JS実br **39,567B**、同decoded bytesのgzip9相当 **43,798B（42.8KiB）**。CSS実br16,832 / 13,611B、HTML/JSON/document込みencoded total83,535 / 77,565B。font/初回editing module無し、served JS/CSS raw SHAがmanifest一致、4build sealが前後不変、provider calls0。[実転送量](shipping-ui-20261005.json)。通常build facts mark修正後S1の43,792B、静的fixture、実brとgzip相当、未完了SSEを区別する。旧f492の結果も別JSONに保持。
- 最終Linux cold全check（Mac共有mount）は各stepの検査結果は成功したが **167.20秒、30秒hard超過でexit 1**。native Linuxの使い捨てfolderへexportをコピーし、frozen installと両type cache空からfacts paint mark修正後の全check **14.59秒、exit 0**。全20意味検査・Svelte・他checks成功、30秒hard・15秒targetとも達成。途中のnative22.15秒のnew test型失敗、16.00秒の成功と共有mount167秒も保持。比較sourceとfilesystem条件を [Linux結果](linux-check-20261005/final/README.md) に記録し、同一snapshotの性能改善とは主張しない。
- 最終compiled Macでdaemonとpaletteを一緒に限定測定。F7 physical footprintはempty3回中央値 **48.25MB**（50MB limit内・30MB target WARN）、loaded crit60秒 **146.58MB**（150MB target内）。resident RSSとは別値。F15 crit Readerのkey→results paintはwarmup1＋5round中央値 **32.1ms**、round p95 **32.4ms**（元33ms limit内・16ms target WARN）。最初のfacts mark欠落によるsetup timeoutは計測値無しの失敗として保持し、実facts gridにだけmarkを追加後、3browser表示確認3/3とS1 size1/1を成功した。[実測JSON](shipping-performance-20261005.json)、[F7条件](f7-daemon-shipping-20261005.md)、[F15条件と失敗履歴](f15-palette-shipping-20261005.md)。
- GitHub PRのUbuntuとNix self-hosted Mac browser CI、push / merge / branch整理: 未実施。
- native Safari: Mac解除を一度UIで再観測したが、最終確認前に再ロックしたため解除待ち。WebKitをnative Safari/実IMEと同一視しない。
- Windows native CIの今回限定Nix例外とCloudflare専用resource / deployment: 利用者の承認待ち。未承認の操作を実施していない。

local private logsは `/tmp/mitori-final-*.log` に保持し、auth / nonce / private raw recordingをGitへ保存しない。計測のtargetとlimitを緩和しない。

read-onlyの第二者確認では、新initialUIのquery/GET/dry estimate/compressionとweb lintのexact HTML sinkを、その生成元まで照合した範囲で明確な新不具合は見つからなかった。最初の公開候補490 text filesは既存secret scannerで検出0件。最終576 text filesでは実daemonの検証script line32のruntime JSON読取式にgeneric_assignmentが1件反応し、独立read-only確認でcredential literalを含まないコード式への誤検出と判定した。値を保存せず、検出履歴・分類・confirmedSecrets0を [検査JSON](final-secret-scan-20261005.json) に記録した。変更913 pathsではprivate認証config/raw recordingの候補0、private cacheのignoreも確認。全面のsecurity保証ではなく、この変更範囲と候補ファイルの確認である。
