# 最終統合の検証（2026-10-05、進行中）

対象は `codex/complete-backlog` の残タスク実装。2026-10-06 JST現在、第4回6d10eedでは3browser344pass/14skip・暗号化共有2pass/37assert・Ubuntu全checkが成功したが、unit4failとa11y起動8failで全体failure。後続sourcee229e4eの修正後はMap35unit/149assert、a11y6pass＋残るMap2pass、INT08 25pass/221assert、CI cassette8pass/31assert、custom TMPDIR3file16pass/75assert、Mac全check3.90sが成功。最新全CI・mergeは未完。[全CIと失敗単位の記録](pr5-ci-20261005.md)。

fdf71b9（production e229e4e）のall-target build・Mac自己検査・asset hard budget・compiled UIは成功。初期JS44,355B gzip相当、F7 footprint48.1571/156.5953MB、F15指定中央値30.5ms・round p9531.2ms、起動44.91msは既存hard内。soft target未達を保持し、旧測定へ改善率を付けない。[最新出荷物](shipping-validation-20261006.md)。Windows native / Cloudflare公開 / Safari実機・実IMEは承認またはMac解除待ち。

## 以前のCI・出荷物の履歴

第3回のactual remote headは`ad4fa817`、PR応答headは旧`08bb494`のためmanual dispatchで確認した。Ubuntu wall76.46秒 / limit72.14秒、Mac335pass/14skip/3fail。[第三CI詳細](pr5-ci-20261005.md)。後続checkerはCPU数に応じたキューと標準JSDoc解析条件を追加し、回帰3pass/23assert成功。追加Chromium診断は114pass/2failでcold handoffの操作欠落を発見、修正・検証中。[診断条件](pr5-browser-profile-20261006.md)。高負荷診断はquiet性能証拠に数えず、既存quiet/AC/較正guardをbrowser CIのbuild後へ接続し、実出力先の証跡を保存する。

[PR #5](https://github.com/satoki252595/mitori/pull/5)を作成・pushした。初回CIの28failは修正し、第2回は335pass/14skip/Chromium時間3fail、Ubuntuは補正済み時間超過だった。経緯は [PR実CI資料](pr5-ci-20261005.md)。source修正`7a39335`は標準checked solution builderへ変更、Mac cold全check9.42秒/20semantic builds・warm3.68秒/20cached、両exit0。出荷runtimeは`ed95494`のまま。native Reader/sizeは14pass/4skip、引用位置は全3browser成功。最終PR全体成功・mergeはまだ未実施。

更新版runtime46dfcd3の対象unit17pass/68assert、fixture型修正後tsc/Svelte3.42s成功（他5段は初回成功）、Escape→j→eは3browser全成功。all-target build・Mac自己検査・初期JS44,345B・compiled footprint48.4071/163.2358MB・palette中央値31.6msも確認した。[最新出荷物と実測](shipping-validation-20261006.md)。旧runtimeの以下の記録を新sourceへ付け替えず、全CIとは区別する。

quiet/ref条件のProcessType比較ではStandard0pass/3fail、Interactive3pass。同3case・同旧checkoutの限定結果として保存し、runner起動設定をInteractiveへ変更。初回再bootstrapはexit5、旧job終了後の同plist bootstrapで復旧した。全CIで確認予定。[条件・失敗を含むprofile](pr5-browser-profile-20261006.md)。

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

- 最初のall-target buildは成功したがWindows95,889,920 bytesでhard95MBを超えた。raw/br重複を省いて解消し、PR修正後のsource`ed95494`から再buildは **Mac70,548,978 / Linux89,572,832 / Windows94,346,752 bytes**、全binary95MB以内・size exit0。Linux/Windowsの85MB target WARNは保持。buildとSHAは [shipping-binaries-20261005.json](shipping-binaries-20261005.json)。以前の94,345,728Bも別JSONに保持。
- compiled Mac `_selftest --json --elk-runs 5` は成功。pinned9 filesのintegrity、web166 files、6言語parse、ELK、Shiki、SQLiteを実binaryで確認。[自己検査](shipping-selftest-20261005.json)。同じWindows/Linux binaryをnative実行した証拠ではない。
- compiled asset/static sizeはhard対象を成功。PR修正後の`--version`中央値45.87msは50ms limit内、20ms target WARN。gen/merge/paletteのchunk予算とprecompression率のnon-hard診断はredを保持。[asset結果](shipping-assets-20261005.json)。以前の43.14msも別JSONに保持。
- compiled実daemonのgo-small静的Map/Readerをfresh Chromiumで確認。最終Mac SHA`ea86a183194c15f50d2897f3bc8ee24a03dc5b15ce76ebf67982f80f032743f2`、JS実br **39,942B**、同decoded bytesのgzip9相当 **44,216B（43.2KiB）**。CSS実br16,832 / 13,611B、HTML/JSON/document込みencoded total83,899 / 77,958B。font/初回editing module無し、served JS/CSS raw SHAがmanifest一致、4build sealが前後不変、provider calls0。[実転送量](shipping-ui-20261005.json)。通常build S1/S2の44,210B、静的fixture、実brとgzip相当、未完了SSEを区別する。旧f492と7005の結果も別JSONに保持。
- Linux cold全check（Mac共有mount）は各stepの検査結果は成功したが **167.20秒、30秒hard超過でexit 1**。native Linuxの使い捨てfolderへexportをコピーし、frozen installと両type cache空からsource`7a39335`のchecked solution builder全check **11.44秒、exit 0**。全20semantic builds・0cached/0errors、Svelte・他checks成功、30秒hard・15秒targetとも達成。旧20compiler方式の13.02/14.59秒成功、途中のnative22.15秒のnew test型失敗、16.00秒の成功と共有mount167秒も保持。比較sourceとfilesystem条件を [Linux結果](linux-check-20261005/final/README.md) に記録し、同一snapshotの性能改善とは主張しない。PR5相対out指定のDocker起動前exit125は測定回数0として保存した。
- 最終compiled Macでdaemonとpaletteを一緒に限定測定。F7 physical footprintはempty3回中央値 **48.31MB**（50MB limit内・30MB target WARN）、loaded crit60秒 **161.10MB**（250MB limit内・150MB target WARN）。resident RSSとは別値。F15 crit Readerのkey→results paintはwarmup1＋5round中央値 **31.9ms**（指定統計medianは元33ms limit内・16ms target WARN）、round間p95 **33.2ms**（全sampleが33ms以内ではない）。最初のfacts mark欠落によるsetup timeoutは計測値無しの失敗として保持し、実facts gridにだけmarkを追加後、3browser表示確認3/3とS1 size1/1を成功した。[実測JSON](shipping-performance-20261005.json)、[F7条件](f7-daemon-shipping-20261005.md)、[F15条件と失敗履歴](f15-palette-shipping-20261005.md)。旧7005の48.25 / 146.58 / 32.1msは別JSONに保持。
- GitHub PRへ初回push済み。UbuntuとNix self-hosted Mac browser CIの初回失敗は修正済みで再CI待ち。merge / branch整理は未実施。
- native Safari: 起動済みSafariのAX取得後にもnative navigationでMacロックが確認され、解除待ち。compiled使い捨てfixtureを停止・nonce private file削除、前後provider calls0。AX取得を実機操作成功とは扱わず、WebKitをnative Safari/実IMEと同一視しない。
- Windows native CIの今回限定Nix例外とCloudflare専用resource / deployment: 利用者の承認待ち。未承認の操作を実施していない。

local private logsは `/tmp/mitori-final-*.log` に保持し、auth / nonce / private raw recordingをGitへ保存しない。計測のtargetとlimitを緩和しない。

read-onlyの第二者確認では、新initialUIのquery/GET/dry estimate/compressionとweb lintのexact HTML sinkを、その生成元まで照合した範囲で明確な新不具合は見つからなかった。最初の公開候補490 text filesは既存secret scannerで検出0件。最終576 text filesでは実daemonの検証script line32のruntime JSON読取式にgeneric_assignmentが1件反応し、独立read-only確認でcredential literalを含まないコード式への誤検出と判定した。値を保存せず、検出履歴・分類・confirmedSecrets0を [検査JSON](final-secret-scan-20261005.json) に記録した。変更913 pathsではprivate認証config/raw recordingの候補0、private cacheのignoreも確認。全面のsecurity保証ではなく、この変更範囲と候補ファイルの確認である。
