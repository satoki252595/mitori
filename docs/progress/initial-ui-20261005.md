# 初期 UI 60 KiB の実装・配信量（2026-10-05）

F15計測mark修正前の通常 web test harness の production client / canonical SSR assets で、S1 Map と S2 Reader の初期 JavaScript はともに **43,763 B（42.7 KiB gzip）**。既存 size probe を **60 KiB の hard assertion** にして、first useful paint mark までに実際に配信したすべての JS を合計した。CSS は **19,241 / 15,707 B（18.8 / 15.3 KiB）**、font request と初期 CM6 は0。F15修正後のS1再確認は下記 **43,792 B（42.8 KiB）**。以前の87.4 / 91.3 KiBは10月4日時点の履歴で、現版の値ではない。

冒頭の値は通常 production assets と mock canonical DTO に対するブラウザーの証拠。最終compiled daemonの静的fixture実測は下記に分け、native Safariと全体checkはrootの最終統合記録と区別する。新規依存、モデル呼び出し、commitはこのUI作業で行っていない。

## 初期機能を残した分離

- `initial/server.ts` は既存 Shell / MapPage / ReaderPage をSvelteのserver compilerで描画する。元requestの資格情報で既存redacted DTOを読む固定allowlistと、同workspaceの固定dry estimate callbackだけを使う。任意HTML、inline executable payload、evalは追加しない。詳細は [HTTP境界](initial-ui-http-20261005.md)。
- `initial/main.ts` は native Map controller と Reader controllerをすぐ接続する。Mapのpan / zoom / room選択・開く / flow / roving focusと、Readerのj/k / level / TOC / hash / virtual window / read markerはSvelte起動を待たない。
- 既存coreの純粋なmap model / SVG rendererを公開barrelから再利用する。SSEとrange fillは現在のepoch、workspace、page、block hashを検査し、partialはtextContentだけで描画する。必要なCSSを取得してからuseful markを付ける。
- 大きな文書の初期HTMLは既存50-block窓の3窓分、最大150件。残りは同じrange APIの `outline:false` で補完し、変わったhashのbatchは部分適用しない。遠いhashは先に対象窓を描画する。runtimeのviewport±1窓は従来通りで、常時150件という別上限を作らない。
- popover / citation pin / Composer / settings / code等の初回操作で既存full UIへ移る。boot直前の最新snapshot、camera、focus、scroll anchor、partial、予約高さをseedし、選択quoteは現在文面との一致を再検証して再生する。pending hover / focus / Escapeと同workspace内のj/k hash更新を区別する。
- 未生成Mapは元画面と同じ3件のdry estimateを初期表示前に作る。3 effortのcanonical SidePanelを同じstores context内のinert templateにして、radio切替は同期で既存推計を表示する。追加estimate / gen startを発行しない。
- provider / plan / model / disclosure rowの同一性を確認したVisibleClockをfull UIへ渡す。90%以上・実表示1秒の条件と人の明示clickを維持し、template作成・preset・bootによってdata policyをackしない。
- level保存は既存のdebounceとfull UIのPrefs queueへ移譲する。SSR refresh待機中に選んだlevel / effortは遅いresponseで巻き戻さず、header radioも現在levelへ同期する。read markerの新規到達後はcanonical Rail progressを再取得する。
- Readerの未採用proposalは固定GETのpending DTOから既存ProposalBlockをserver-renderする。ProposalBlock / ServerHtmlの既存CSSを初期manifestから取得してから表示し、採用・拒否のclickだけ既存ProposalLayerへ渡す。rendererに採用・拒否POST能力は渡さず、人・gate・未コミットの条件を変えない。

初期clientはSvelte runtime / stores / full route modulesを取得しない。最終JS probeはworker等を特別扱いして除外しない。server SSR moduleはshipping用 **797,054 B raw**（default harness用795,685 B）でブラウザー資産に含めず、CLIの生成asset registryへcodeとして組み込む。最終binaryサイズは別途測定する。

## JS以外も含めた初期転送

[機械可読の実測](initial-ui-20261005.json)は1440×900のChromium、通常client / SSR production buildを使用した。`encodedBodySize` は圧縮後body、`transferSize` はブラウザーのheader等込みの値。HTMLとsnapshotを含むUI JSON・catalog JSON・keymap・CSS manifest・settingsをすべて含む。live SSEはresponseが閉じるまでResourceTimingがbodyを返さないため、この合計には含まれない。

| 画面 | JS gzip | CSS gzip | JSON等 | documentを含むbody合計 | header等込み |
|---|---:|---:|---:|---:|---:|
| S1 生成済み | 43,763 B | 19,241 B | 60,030 B | **124,554 B** | 134,754 B |
| S1 未生成・見積り | 43,763 B | 19,241 B | 60,633 B | **125,157 B** | 135,357 B |
| S2 Reader | 43,763 B | 15,707 B | 56,050 B | **117,040 B** | 127,540 B |

UI endpoint単体の未圧縮JSONは99,552 / 114,817 / 100,879 B。そのうちHTMLは32,442 / 52,695 / 31,717 Bで、未生成Mapにだけ3 effort templateが入る。UI JSONをgzipするmockでの実配信量であり、HTML / data外部化による増分をJS削減だけとして隠していない。実serverのUI routeもrootが既存 `negotiate` / async zlib / 8 KiB閾値でbr / gzipを追加し、4 tests / 48 assertionsで復号とq=0を確認した。mockの値を実daemon計測と呼ばない。

## default harnessと対象検証

`e2e/web/support/global-setup.ts` は通常のVite client buildに加え、Bun child processでcanonical SSRを `dist/.build/e2e-initial` にbuildする。Playwright NodeからBun専用moduleを静的importしない。mockはserver起動後、最初のUI requestで既定のSSR moduleを読み、`MITORI_E2E_SSR` 等の任意env無しでnative経路を使う。renderer未搭載の旧daemonの501だけはfull UIへ互換fallbackする。通常harnessはshipping用 `dist/.build/initial` を上書きしない。SvelteのCSS scope hashはbuild cwdに依存するため、client / SSRは同じ呼出し元で作った対応組を使う。

```sh
# 最後のsourceを通常default harnessでbuildし、3ケースを3browserで確認
MOCK_PORT=4353 scripts/nd bunx playwright test -c e2e/web/playwright.config.ts \
  initial-ui.pw.ts --project=chromium --project=firefox --project=webkit
# 9 pass: invalid state、dry3 / effort identity、visible consent、pending refresh level

# 同じbuildでhard budgetとstream reservationを確認
MITORI_E2E_SKIP_BUILD=1 MOCK_PORT=4354 scripts/nd bunx playwright test \
  -c e2e/web/playwright.config.ts size.pw.ts streaming.pw.ts --project=chromium
# 5 pass、当時S1/S2 42.4 KiB、stream CLS 0（最終sizeは下記42.7 KiB）

MITORI_E2E_SKIP_BUILD=1 MOCK_PORT=4355 scripts/nd bunx playwright test \
  -c e2e/web/playwright.config.ts native-reader.pw.ts --grep 'keeps tools cold' \
  --project=chromium --project=firefox --project=webkit
# 3 pass、j/k / level / farhash / TOC中のfull JS取得無し

scripts/nd bunx tsc -b packages/core packages/client apps/web e2e apps/cli
scripts/nd bun run check:web
# tsc成功、svelte-check 0 errors / 0 warnings
```

対象unitはkeys / head / cookie / reading / doc store / map / assets / gen-assetsの8ファイル、**82 pass / 0 fail / 385 assertions / 1 snapshot**。先のunit失敗はSSR storage shimがtestのdocumentを隠した問題と旧route preload期待値で、server storageを保存値だけのoverrideにし、headはcanonical初期経路で不要なpreloadを作らない期待へ修正した。対象Biomeはexit0（initial mainのnon-null assertionに9 warnings）、owned diff-check成功。core公開barrelだけを使い、package boundary checkも成功した。

最終全体typecheckで、`scripts/gen-assets.ts` の静的なVite config importがscripts projectへweb sourceを取り込むrootDir / TS6307を検出した。既知のrepo絶対pathからruntime importし、Vite公開の `UserConfigExport` で型を保つ最小修正へ変更した。`tsc -b scripts` と対象Biomeは成功し、UI動作やclient assetsを変更する修正ではない。

Reader peerのcanonical/full handoff・first quote・Escape・citation pin・pending level等の最終対象33件は原因を修正して失敗単位だけ再実行し全件成功。[実行の内訳](native-reader-20261005.md)を参照する。この資料の9＋5＋3件を33件の全面再実行とは呼ばない。今回の最後の修正はSSR response待ち中のlevel変更を保存する新しいrace回帰と、同一表示のlevel radio同期に限定した。

ログ: `/tmp/mitori-ui-final-race.log`、`/tmp/mitori-ui-final-size-stream.log`、`/tmp/mitori-ui-final-cold.log`、`/tmp/mitori-ui-final-types.log`、`/tmp/mitori-ui-final-svelte.log`、`/tmp/mitori-ui-final-unit.log`。sourceは下記回帰修正後に再freezeし、最終compiled build / 統合全check / 実daemonとSafariの確認はrootが続ける。

## 最終whole-unitで見つかった回帰の修正

- source checkoutのasset tableは前のweb manifestを永続cacheしない。gen-assetsが再生成した現manifestを読む。embedded tableのcacheは保持する。EXP-I-05は旧tableを先に読んでからtest / productionの二度の再生成と現asset読込を検証し、**1 pass / 8 assertions**。export API対象も **13 pass / 74 assertions**。viewerは **59,808 B gzip**でhard **60,000 B**以内。SSRだけで使うwindow/template計算をcompile-time SSR分岐にし、offline viewerの読書機能を削っていない。
- native / SSR HTMLのlint承認は完全なfile＋sink expressionだけに限定し、同fileの別expressionを拒否するnegative caseを追加した。canonical DTOのhash / section確認とchromeのescapeを保持する。IME wrapperは最初のstatementで既存guardを通し、初期SidePanelは既存gen catalogのlazy分類へ合わせた。関連5unitは **36 pass / 1,127 assertions**。
- normalized Rangeのstartを隣接node境界の右側、endを左側へ戻し、table cell選択の引用が前後のセルまで広がる原因を修正した。native restore→existing anchorFromRangeの隣接cell回帰は **3 browser / 3 pass**。
- 実daemon＋installed ChromeのUXは最終 **1 pass / 4 assertions**。reload直後のproposalのpadding / background / shadow、両決定buttonの実寸≥28×28、初期CLS **0**、editing JS未取得を検証してから、既存採用・拒否を実行した。旧literalは現在のcanonical静的文言へ追従し、no-target / no-estimate / no-sendの検査を残した。
- default harnessのSSR分離後、S1/S2 hard sizeは **2/2 pass**。最終3routeのResourceTimingを上記JSONへ再保存した。header等込み総量を含み、proposal用CSSの増加も省いていない。対象formatはexit0、tscとsvelte-checkは成功（0 errors / 0 warnings）。

最終ログ: `/tmp/mitori-final-ui-size.log`、`/tmp/mitori-final-ui-transfer.log`、`/tmp/mitori-final-ux-ui.log`、`/tmp/mitori-final-ux-export.log`、`/tmp/mitori-final-ui-units.log`、`/tmp/mitori-final-export-int.log`、`/tmp/mitori-final-ui-format.log`。UI所有source / production assetsはここでfreezeし、以後この担当は資料だけを更新する。

## 最終compiled daemonの静的fixture実測

Windows binaryのhard95,000,000 B超過はweb資産の重複梱包を除いて解消した。Brotliがあるfileはその一つをidentityとbr用に共有し、compiled registryだけが既存Brotli decoderでidentityを復元する。gzip、配信内容、SHA、dev checkoutのraw pathは保持した。web埋込みは2,498,478→**978,653 B**。rootの梱包回帰10 tests / 55 assertions、all-target build / size / selftestが成功し、Windowsは**94,345,728 B**でhard95,000,000 B内となった。85 MB target超過のwarningは残す。

facts mark修正後の最終Mac binary **70,548,978 B**（SHA256 `700514e4ecb5ac2b488dc65dd7ee13b69d516a468b926bb3eeea0cd5ed205de9`）を既存 `startTestDaemon` で起動し、fresh Chromium・1440×900で測った。[一回限りのprobe](shipping-ui-probe.ts)と[最新実測JSON](shipping-ui-20261005.json)に保存した。対象は小さな **go-small静的fixture** の未生成Mapと静的s4 Readerであり、大規模生成文書・実Safari・性能時間の代表値とはしない。修正前のf49252e2 binaryの数値は[修正前JSON](shipping-ui-before-facts-20261005.json)にそのSHAとともに保持した。

| 画面 | JS実wire（br） | JS gzip9換算 | CSS実wire（br） | CSS gzip9換算 | HTML/JSON/document込みbody合計 | header等込み |
|---|---:|---:|---:|---:|---:|---:|
| S1 静的・未生成Map | 39,567 B | **43,798 B（42.8 KiB）** | 16,832 B | 19,234 B | **83,535 B** | 94,035 B |
| S2 静的s4 Reader | 39,567 B | **43,798 B（42.8 KiB）** | 13,611 B | 15,711 B | **77,565 B** | 88,365 B |

通常Chromiumのcontent negotiationは全JS/CSSとUI JSONにbrを選んだため、実wireとgzip換算は別の値である。first useful markまでに完了した全応答を集計し、live SSEは閉じていないためResourceTimingのbody合計に入らない。UI JSONの未圧縮量は51,516 / 35,926 B、そのHTMLは26,459 / 15,410 B。全served JS/CSSのidentity SHAはshipping manifestのfileと一致し、binary / manifest / renderer / web manifestの開始・終了SHAも不変。初期font・editing JS・CM6は無し、provider calls **0**、一時HOME / fixture / daemon / browserはcleanupした。記録にbearerやnonceを保存していない。

最新ログ: `/tmp/mitori-shipping-ui-probe-after-facts.log`（修正前 `/tmp/mitori-shipping-ui-probe.log`）。このprobeはbuildやsourceの変更を行っていない。

## F15計測setupのmark漏れ

compiled palette計測は、測定keyへ進む前の `firstUse` が `mitori:facts:painted` を待って30秒で失敗した。factsはcanonical SSRで既に表示されていたが、元のmarkはMapPageのscan `$effect` にあり、SSRではeffectが実行されない。native `loadView` でMap route・scan summary・実DOM `.facts .grid` を確認してから、同じ `markAfterPaint` を呼ぶ最小修正を行った。30秒の上限、必須mark、key→paint測定は変更していない。

3browserの回帰は、mark時に実facts tile・非空の値・gridの実寸があることと、Readerではmarkを発行しないことを確認し **3/3成功**。S1 hard sizeも **1/1成功**（43,792 B / 42.8 KiB、29 B増、CSS18.8 KiB、font / CM6なし）。非ChromiumのCDP size2件は従来どおり明示skip。対象tscとBiomeはexit0。ログは `/tmp/mitori-facts-mark-browser.log`、`/tmp/mitori-facts-mark-types.log`、`/tmp/mitori-facts-mark-format.log`。

この修正後のshipping再build / size / selftest / compiled asset checkはrootが完了し、そのbinaryで上記静的fixtureの初期転送を再測定した。F7 / F15のfresh実測はrootが続ける。修正前のJSONとSHAも保持し、異なるbinaryへ測定値を付け替えない。

## 同じUIトラックの先行完了分

NC19はoutline tupleのoriginをSectionView / client / exportまで引き継ぎ、static-only本文をAI生成と表示しない。secondary翻訳の別provenanceをDTOが持たないため、secondary表示ではprimaryのmodel tagを出さない。

floorplan flagは既定false。既存IRのLOCでroomsを配分し、依存の共有壁にdoorsを付け、外部actorを保持する。既存Bun compute Workerへ処理を追加し、同一cache / quality gateでfallbackする。8件のfresh pinned corpus offline scanはfallback **2/8（25%）**、40-room warm algorithm **1.41–1.48 ms** / worker RPC **1.56–1.66 ms**。cold worker起動時間をalgorithmの30msと混同しない。[実測](floorplan-20261005.json)と対象37 tests / 1776 assertionsを記録した。

revert / translate / simplifyのUIは既存API、dry estimate、実engineのdata policy確認、既存proposal / translation cache / 人のaccept / Undo経路へ接続した。backend guardは[backendの記録](remaining-backend-20261005.md)、Readerのcold controlsは[Reader分割](reader-first-use-20261005.md)を参照する。
