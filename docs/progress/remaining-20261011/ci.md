# PR #13 統合CI（2026-10-11）

対象headは `23645fdc7100e02e5f6b63bbbde2b33c59b1c79f`。[PR #13](https://github.com/satoki252595/mitori/pull/13)、[CI run](https://github.com/satoki252595/mitori/actions/runs/38115347695)、[機械可読の結果](ci.json)。

Ubuntuの初回は全20projectの意味検査・診断0件だが、checkの補正上限72.49秒を超過した。失敗したUbuntu jobだけを再実行し、check全7項目43.74秒 / hard limit49.79秒、unit3,017pass / 134skip / 4todo / 0fail、golden109pass / 4skip / 0fail、fixtures verify・size・Linux binary buildと`--version`が成功した。soft target24.89秒は未達のまま。上限・較正・検査対象は変更していない。

同headの[Windows run](https://github.com/satoki252595/mitori/actions/runs/38115528185)も成功。[Windowsの実数と証跡](windows-nix.md)を参照。

Macはload11.3823、既定の2回待機後もNOISYで、browser suite開始前のreference guardが停止した。guardを外す・較正を書き換える・赤のままマージする操作はしていない。

## head6af11b8での後続

資料のみを追加したhead `6af11b8c27394435e860132cf87179c4198356a9` の[CI run](https://github.com/satoki252595/mitori/actions/runs/38116332962)もUbuntuは成功。Mac初回はload10.0303でguard停止、次のjobはload7.7891だがfactor1.107595で既存の±10%範囲外だった。再実行対象は失敗したMac jobだけとした。

[Mac job114404755569](https://github.com/satoki252595/mitori/actions/runs/38116332962/job/114404755569)はload8.4214 / quiet / AC / factor1.053251で既定guardを通過し、実browser suiteを実行した。結果は369pass / 14skip / 5fail（8.8分）。Chromiumのroom card最大226.6ms（上限100）、level切替p95107.9ms（上限50）、TOC遷移p95242.4ms（上限100）が失敗。ChromiumとWebKitでは、streaming完了節の予約解除後に読書位置が1,546.625px移動し、上限4pxを超えた。共有viewer / a11yの後続stepは未実行。単なるguard停止ではなく、これらの失敗を修正・限定再検証してから統合する。

## 読書位置の最小修正と限定回帰

同じページのrefreshがGET /ui待機前の読書位置を復元していたため、DOMを置き換える直前に同page / workspaceの現位置を取り直す。加えて、`content-visibility:auto`で描画を省略された節の子要素が古い矩形を返し、画面内のanchorと誤認されていた。共有captureAnchorで `checkVisibility({contentVisibilityAuto:true}) === false` の要素を飛ばす。API未対応時の経路、既存fallback、4px上限は維持した。製品変更は合計7行。

新しいpending通信中の移動回帰は旧動作で約4,497pxずれ、修正後はChromium / Firefox / WebKitすべて成功（3件 / 4.6秒）。描画省略節の回帰も旧動作がb_skippedを誤選択し、修正後は実CSSでb_visibleを選び3件 / 3.8秒成功した。元のstreaming試験9件も3browserすべて成功、CLS0。web / e2e型検査と対象4file Biomeは成功。一時診断はすべて復元し、streaming試験・入力・mark・上限を変更していない。

既存Chromium時間試験3件の限定診断は3pass / 4.8秒。card31〜47ms、open21〜33ms、level1.5〜12.1ms、TOC32〜49ms。ただしload11.99でreference条件外なので、正式CI成功へ読み替えない。levelのinput→rAF予約は1〜3ms、rAF待ちは0〜10.7ms、TOCは予約19〜24ms / rAF待ち12〜24.6ms。CIで見えた100ms成分はここでは再現せず、原因をcompositorと断定していない。統合headの元のCI gateで再確認する。

引用入力・Go Node.type・読書位置の修正を含む統合checkは全7step成功（4.18秒、warm）。配布Mac binaryのSHA-256は `8d1f22762b6b56d9eae7181e61a144b1d8e607f1ff84808b9d9673d51387deb7`、embedded selftest6checks成功（1,075ms）。[strict assets](reader-fix-assets.json)全項目成功、初期JS54.697KB gzip / target60KB。正式CIの代わりには扱わない。

## 修正後head98c59a6

[CI run38119108193](https://github.com/satoki252595/mitori/actions/runs/38119108193)のUbuntuは成功。check全7項目63.04秒 / hard limit68.30秒、全20semantic builds / 0cached / 0errors。unit3,022pass / 134skip / 4todo / 0fail（121,956 assertions）、golden109pass / 4skip / 0fail（1,028 assertions）、fixtures verify・size・Linux binary build / versionが成功した。soft target34.15秒は未達のまま。

Mac初回job114409967855はload9.7925でNOISY。失敗したMac jobだけ再実行した[job114412318444](https://github.com/satoki252595/mitori/actions/runs/38119108193/job/114412318444)はload8.4741 / quiet / ACだがfactor2.308816が既存0.9–1.1範囲外で、browser suite開始前に停止した。Ubuntuを再実行せず、上限・較正・基準機referenceは変更していない。旧headの5失敗は履歴として保持し、修正後の正式Mac suite成功とは扱わない。PR #13は未マージ。

3回目も失敗したMac jobだけ再実行。[job114416752978](https://github.com/satoki252595/mitori/actions/runs/38119108193/job/114416752978)はload8.9409 / quiet / AC、factor1.899867が範囲外でbrowser開始前に停止した。dispatch直前のroot側はload8.5039 / factor1.084268だったが、別時点の測定なのでCIの合格や遅延原因の証明にしない。共有viewer / a11yの後続stepも未実行、Ubuntuの成功は保持した。

## 同一headのMac CI成功と統合

4回目はload5.7344 / factor2.226020、5回目はload7.4229 / factor2.071958で、quiet / ACでも較正範囲外だった。通常端末では同じCI checkout・Nix・Bun・較正コードでfactor約1.01となり、CIフラグを付けても差は再現しなかった。

本人の専用runnerだけを観察すると、LaunchAgent配下の実較正BunはNI0 / ps PRI4 / task priority31 / Darwin BG0。同じplistでの再起動後もListenerはPRI4だった。同じNixのrunnerを通常端末から一時起動すると実較正BunはPRI31となった。厳密なQoS classは取得できず、Machの読み取り拒否を迂回していない。常駐経路の恒久原因を確定したとは扱わない。監視は最初のChromium起動から約3.7秒後に停止し、その後は別の重い検証を併走させていない。

[6回目job114455888859](https://github.com/satoki252595/mitori/actions/runs/38119108193/job/114455888859)は **load6.1938 / quiet / AC / factor1.017954** で既存guardを通過し、**browser380pass / 14skip / 0fail（4.5分）、共有viewer2pass / 0fail、a11y8pass（7.9秒）**。元の時間予算3件と読書位置保持も成功した。Ubuntuの成功を維持し、基準reference・判定範囲・試験入力・上限は変更していない。検証後は一時runnerを終了し、元のplistから常駐起動を復元した。

PR #13は2026-10-11T11:16:43Zに通常mergeでmainへ統合した（`df014912ee7e31ac62c4ca50c846d396aeec9dff`）。golden専用commitを保持している。後続の[compiled scanSummary正式計測](ui-bench-release.md)は中央値1,615.700msで元のhard limit2,000msを満たした（soft target1,000msはWARN）。[Go正式5回計測](idx-formal.json)は中央値1,980.097msでhard limit1,500ms未達。実IMEの本人確認と費用承認待ちの引用再生成も残る。

## PR #14 初回CIと確認条件の修正

[run38137725740](https://github.com/satoki252595/mitori/actions/runs/38137725740)、head `7215440e2ab137cbb8d84217f99121553f47ae0c` のUbuntu checkは全20semantic builds / 0cached / 0errors、63.25秒で成功。unitは3,041pass / 134skip / 4todo / 1fail（122,066assertions、384.28秒）。INT-07 LIVE-02でcontext変更後の確認をExpected409に対し200で通していた。cache入力を分母に加えたことで従来の20%判定を弱めていたため、元input＋output判定とcache込みtotal判定のORへ修正した。fixture不変の対象int07は3pass / 1failから4pass / 0failへ。fixtures・golden・size・binary smokeは初回unit失敗後に実行されておらず、成功扱いしない。[較正の追補](ledger-calibration.md)。

同runのMac job114464937944はload12.360352 / NOISY / AC、既存待機2回後もquiet条件外でbrowser開始前に停止した。較正値は未測定、共有viewer・a11yもskipped。後続の再実行準備ではfactor1.084904でもload9.146484が既存閾値9を超えたため待機した。reference・上限・入力・worker規則は維持する。[全記録](ci.json)の `pr14` に初回失敗を保持する。

修正head `b74d4fad143ab17be6cb412da675156d399d0ebb` の[run38138661011](https://github.com/satoki252595/mitori/actions/runs/38138661011)はUbuntu job114467729984が成功。checkは全20semantic / 0cached / 0errors、46.80秒（表示factor1.736、hard52.07秒内、soft target超過）。unit3,042pass / 134skip / 4todo / 0fail、122,068assertions・315.52秒、fixture12件verify、golden109pass / 4skip / 0fail・1,028assertions、asset size・Linux binary build / versionも成功した。binary89.6MBはhard95MB内・target85MB WARN。startup73.83msはfactor1.690でreport-onlyの上限超過であり、正式合格へ読み替えない。

同headのMac job114467730095もload9.688965 / NOISY / AC、待機2回後にbrowser開始前のguard停止。較正・browser・共有viewer・a11yは未確認のまま、Ubuntu成功を維持し、Macの条件が整うのを待つ。以前のPR #13での成功をこのheadの成功へ付け替えない。

## PR #14の通常統合

ブラウザ側コードと試験の差分はなく、変更したCLI・見積り・初回解析の対象回帰、Ubuntu全体と実配布binaryの確認を根拠に、2026-10-11T12:28:11Zに通常merge `6d892ea8be7976d4095eb2bfe8c1bbf8e346f545` でmainへ統合した。新headのMac全suiteは未確認のまま残す。merge treeと検証head b74d4faのtreeは `8cf402397678f1cc33c849820b0b6dd2cb30c90f` で一致。golden変更なし、専用commitの履歴を維持。作業branch `codex/fix-lazy-parse-prewarm-20261011` はmainへの祖先性を確認してlocal / remoteから削除した。

一時runnerはAPIでbusy:falseを確認して終了し、元の同じplistからLaunchAgentを復元、running / online / busy:falseを確認した。plist・reference・guardは変更していない。統合mainでMac binaryを再buildし、`--version` 成功、SHA-256 `d0a6c5a2d2aa809e549fcdb4eea43dde997d33c3a2a19623dc77a79b56965a56`。前段のselftest・help・export検証をこの再buildの実行結果へ付け替えない。実LLM追加0・新依存0・追加費用0。

## PR #14 Macのみの後続再実行（13:11〜13:16 UTC）

負荷6.703 / AC・専用runner online / busy:falseを確認後、同runの失敗したMac jobだけを再実行した。[attempt2 / job114478129026](https://github.com/satoki252595/mitori/actions/runs/38138661011/job/114478129026)はload7.504 / quiet / AC / 待機0を通ったが、measured factor1.172012で既存±10%の較正guardに止まった。

前回成功した起動条件を再確認するため、空き状態の同じNix runnerだけを通常端末から一時起動した。[attempt3 / job114478593964](https://github.com/satoki252595/mitori/actions/runs/38138661011/job/114478593964)もload8.798 / quiet / AC / 待機0は通過、factor1.195410で同じguard停止だった。常駐起動の変更だけでは今回解消していない。両回ともglobalSetupで止まり、browserテスト0件実行、共有viewer / a11yはstep skipped。未実行を0failの成功へ変えない。Ubuntuは元の成功を継承し、再実行していない。

対象headはb74d4faで、通常merge6d892eaとtree一致、その後のmain85aabcfまで製品差分は0。reference・上限・試験・plistは変更せず、追加LLM・依存・費用0。終了後に一時runnerを終了し、元plistからLaunchAgentを復元、PID35761のrunningとAPI online / busy:falseを確認した。Mac全suite未確認を保持し、今回の追加再実行はここで終了する。両回の許可項目・raw hashは [ci.json](ci.json) の `pr14.macFollowUp20261011`。

## PR #15のCI履歴

[PR #15](https://github.com/satoki252595/mitori/pull/15)、head `eaa02650e947eec427dcd58f65b52b609ff6d45e` の[run38147671086](https://github.com/satoki252595/mitori/actions/runs/38147671086)は、Ubuntu job114494328364が成功。check全7step60.34秒 / hard66.56秒（factor2.219）、全20semantic / 0cached / 0errors・59.23秒。unit3,044pass / 138skip / 4todo / 0fail・122,086assertions、golden109pass / 4skip / 0fail・1,028assertions、fixtures verify・size・Linux binaryも成功。Mac job114494328645はload8.28662109375 / quiet / AC / 待機1、factor1.1259891742625705で較正guard停止。browser試験は0件実行、共有viewer / a11yはstep skippedだった。

head `d16e4166ae1a36d31de6cf842f5d867b34bc2a01` の[run38148770466](https://github.com/satoki252595/mitori/actions/runs/38148770466)は、Ubuntu job114497601700で全20semantic / 0cached / 0errors・52.12秒、check内部の全7stepが成功した。ただし全体wall52.74秒がhard limit52.05秒（factor1.735）を超え、jobは失敗。unit以降は未実行で、意味検査の成功を時間gate成功へ読み替えない。Mac job114497601470もload7.22314453125 / quiet / AC / 待機0、factor1.4945246055015173で較正guard停止。browser試験0件、共有viewer / a11yはstep skippedだった。

新head `89f228ea300dd1dd4211b32488042993a75e3235` の[run38149175316](https://github.com/satoki252595/mitori/actions/runs/38149175316)はUbuntu job114498795140成功。check全7step48.72秒 / hard51.82秒（factor1.727）、全20semantic / 0cached / 0errors・48.07秒。unit3,046pass / 140skip / 4todo / 0fail・122,105assertions・320.12秒、golden109pass / 4skip / 0fail・1,028assertions、fixtures verify・size・Linux binaryも成功した。同headの[Windows native確認](windows-env.md)も選択14件とselftest6checksすべて成功。

Mac job114498794909はload9.33154296875 / NOISY / AC、待機2回後も既存quiet条件外で較正前に停止。browser0件実行、共有viewer / a11yもskipped。後続の通常端末preflightもload11.5322265625 / NOISY / ACだったため、較正やMac再実行を追加していない。先行headの成功・失敗を後続headへ付け替えず、reference・上限・入力・runner設定は維持する。[機械可読の追記](ci.json)の `pr15` を参照。

## PR #15の通常統合

2026-10-11T15:06:09Z（JST 2026-10-12）に通常merge `e34178c40dd954e0d6ecb53f8cae51c96e2a032d` でmainへ統合した。検証head89f228eとmerge commitのtreeは`08855f95c6f68b12dc882e40819130d6eb30558f`で一致。Ubuntu全体・Windows native・Macの変更単位の回帰を根拠とし、Mac全browser suiteは未確認のまま残す。golden変更なし、専用commitの履歴を維持。作業branch `codex/windows-exact-env-20261011` はmainへの祖先性を確認し、local / remoteから削除した。後続のcommitは検証結果を反映する資料だけで、実LLM要求・新規依存は0。
## PR #16 — macOS性能tier（2026-10-12 JST）

[PR #16](https://github.com/satoki252595/mitori/pull/16)のsource `0ac54f071d2693ea212a19c168e19104436e6870` を[run38151228742](https://github.com/satoki252595/mitori/actions/runs/38151228742)で確認した。初回Ubuntuは全7check / 全20semantic・0cached・0errorsを通過したが、wall44.35秒が較正後上限43.30秒を超え、unit以降は未実行。失敗したUbuntu jobだけを再実行した。

再実行job114506189385は成功。check64.74秒 / 上限67.79秒、全20semantic・0cached・0errors。unit3,047pass / 140skip / 4todo / 0fail・122,117 assertions、golden109pass / 4skip / 0fail・1,028 assertions、fixtures verify・size・Linux binary build / versionが成功した。

Mac job114504937824はquiet / AC・load8.770020、factor1.101552で既存±10%を外れ、browser開始前に停止した。browser0、共有・a11yはskip。attempt2のjob114506190375は同じ開始・終了日時とログの持ち越しで、Macの再実行成功とは扱わない。

通常merge `b8f2dca5667e181e709233d77115376aede063c6` をmainへ反映。merge treeと検証source treeはともに `071e3263b75c4b9e72d5036fdf831162f1e3e272`。作業branchをlocal / remoteから削除した。Go正式1,500ms、最新Mac全suite、実IME、費用確認待ちの追加生成、外部4クライアントの実生成は残る。詳細・private原ログのhashは[ci.json](ci.json)のpr16。

## 統合後mainの独立したMac確認（2026-10-12 JST）

main `35d897d7badc470e9825ac6ed0dd8f0c64ef293d` で、既存の共有試験をChromium / Firefox / WebKit付きで実行し、2pass / 0fail・37 assertions（4.79秒）を確認した。既存a11yもChromium・1 Workerで8pass / 0fail / 0retry（12.69秒）。明暗のmap / Reader計4画面でaxe違反0、contrast・smallText・smallTargetsも0だった。依存の追加、実LLM要求、remote deploymentは0。

正式計測の事前確認は15:55:36 UTCに既定2回待機後もload9.209473 / NOISY / ACだった。較正・Go正式scan・全browser CIの再実行は行っていない。今回の独立した共有 / a11y成功と、PR #16のCIで両stepがskipだった履歴は区別する。全browser CIとGo1,500msは未確認・未達を維持する。許可項目だけの結果とprivate原ログのhashは[ci.json](ci.json)の `localMainVerification20261012`。

## PR #16 Mac再実行の4失敗と限定回帰（2026-10-12 JST）

同[run38151228742のMac job114512014975](https://github.com/satoki252595/mitori/actions/runs/38151228742/job/114512014975)は、source `0ac54f071d2693ea212a19c168e19104436e6870`、checkout `b5975863d724f05af4f8a00081d0538e9f6cdb5d`。load8.56298828125 / quiet / AC / 待機0、measured factor1.0876105399172018で既存guardを通過し、browserは376pass / 14skip / 4fail（6.9分）だった。共有viewer / a11yはstep skipped。Ubuntu job114512016123は旧job114506189385の成功を持ち越したもので、Ubuntuを再実行していない。

| engine / 元の試験位置 | 失敗値 | 維持する条件 |
|---|---|---|
| Chromium / map.pw.ts:77 room card | 最大229.3ms | ≤100ms |
| Chromium / reader.pw.ts:36 level switch | p95106.6ms | ≤50ms |
| Chromium / reader.pw.ts:77 TOC | p95227.8ms | ≤100ms |
| Firefox / map.pw.ts:152 Escape | scale 2.22094 → 2.22525 | 選択解除だけでは変わらない、precision3 |

Firefoxの試験は固定450ms sleepでアニメーション完了を仮定していた。`map.pw.ts`内に既にあったAC-J07の「rAF上でtransformが120ms不変」の完了観測をファイル内helperへ抽出し、Escapeのsettleにも共有した。製品source・入力・performance mark・共有の`inputToMark` helperは変更せず、AC-J07のtrigger `t2`・camera予算340ms・Escapeの3桁一致を維持した。固定sleepや許容差を増やしていない。固定sleepが最終frameを観測しないことは確認できるが、Firefoxのスケジューリング要因までは確定していない。

ローカルの初回baselineはload10.097168 / NOISY / AC / 待機2で開始guardに止まり、browser試験0件・exit1。private phase診断は3pass（7.3秒）だったが、較正付き正式検証ではない。rAF待ち86 samplesは0〜29.2ms、UI fetch20 samplesは2.4〜4.8ms、観測LongTaskは0。計時用helperの一時instrumentationは元とbyte一致で復元した。CIの大きな時間超過はここでは再現せず、通常起動との差や原因は未確定で、compositor / rAFが原因だったとは断定しない。

修正後のChromium対象4件（AC-J07・Escape・level・TOC）は、開始load8.8037109375 / quiet / AC / 待機1、factor1.0176377670064807で既存guardを通過し、4pass / 0fail・40.7秒・exit0。Firefox / WebKit各2件（AC-J07の機能assertion・Escape）は開始load8.68798828125 / quiet / AC / 待機0、factor1.0301351509084022で通過し、合計4pass / 0fail・13.0秒・exit0だった。後者の試験中host loadサンプルは9.19 / 9.98で、終了後較正は取得していない。Firefox / WebKitの成功をChromium限定の時間予算合格へ読み替えない。

**ローカル対象8件の成功は全CI成功ではない。** この追記時点では、修正後の全Mac browser / share / a11y CI成功は未確認。ChromiumのCI時間超過も解決済みとは扱わず、同じ入力・mark・上限とNix runnerで全gateを再確認する。原CIログは116,220 bytes、SHA-256 `064ac952f54713243557895e56d354f7e7ad766e76587a750812d39d75b622c6`。追加の許可項目・対象ログのhashは[ci.json](ci.json)の`pr16MacFollowUp20261012`へadd-onlyで保存した。rawログ本文・instrumentation本文・個人path・認証情報は追加していない。

## PR #17 Mac全suite成功（2026-10-12 JST、Ubuntuは確認待ち）

[PR #17](https://github.com/satoki252595/mitori/pull/17)のsource `27d8bd4f02a6c0cfa64cbf65116ab1d156ccaa8e`、[run38155349977 / Mac job114517080181](https://github.com/satoki252595/mitori/actions/runs/38155349977/job/114517080181)は成功した。実checkoutは`89631077708309aa26e07417aa49665a3df0b11b`。開始load5.74951171875 / quiet / AC / 待機0、measured factor0.9921457306726087で元のguardを通過した。

結果は**browser380pass / 14skip / 0fail（4.3分）、共有viewer2pass / 0fail・37 assertions（2.57秒）、a11y8pass / 0fail（7.2秒）**で、3stepすべてを実行した。失敗したChromiumの元の時間試験とFirefoxのEscapeもこの全suiteで成功している。時間予算・reference・試験入力・markは変更していない。過去の4失敗とローカル8件の成功は履歴として保持し、今回の成功と区別する。Chromiumの先行遅延の恒久原因を特定したとは扱わない。

CIは同じRUNNER_ROOT・固定Nixの一時foreground runnerで実行した。終了後にCtrl-Cで一時runnerを止め、元のplistをbootstrapし、LaunchAgentはrunning / PID11808へ復元した。この記録時点では最終online確認とUbuntu jobはまだ確認待ちで、**全CI成功とはまだ扱わない**。

原Macログは114,180 bytes、SHA-256 `fd5d1ca5f7945bff16d06ed303b3ccccebad867848973b235e40f664c8725541`を照合した。許可項目だけを[ci.json](ci.json)の`pr17`へadd-onlyで保存し、既存JSONのキーと値は保持した。rawログ本文・個人path・認証情報は追加していない。

後続照合では、sourceと上記PR merge checkoutのtreeが`c355509846dbd7a592f6eff802a74e5773070cf0`で一致した。元LaunchAgentはPID11808 / running、GitHub runner21はonline / busy:falseまで確認し、元の常駐runnerへの復元は完了した。Ubuntuの結果は引き続き確認待ち。

## PR #17 全CI成功とmain統合

[Ubuntu job114517080017](https://github.com/satoki252595/mitori/actions/runs/38155349977/job/114517080017)も成功し、APIで[run38155349977](https://github.com/satoki252595/mitori/actions/runs/38155349977)全体のsuccessを確認した。上の「Ubuntu確認待ち」はMac完了時点の履歴で、最終状態ではUbuntu / Macの両必須jobが成功している。

UbuntuはNixの全7checkを60.03秒 / hard limit64.76秒（表示factor2.159）で通過。全20projectのsemantic builds20 / cached0 / errors0・59.30秒を維持した。soft target32.38秒は未達のまま。unit3,047pass / 140skip / 4todo / 0fail・122,117 assertions・1 snapshot（357files、362.65秒）、golden109pass / 4skip / 0fail・1,028 assertions（11files、5.74秒）、fixtures12件verify、size、Linux binary build / versionが成功した。

初期JSは表示54.70KB gzip、CSS18.10KB gzip、web font0、precompressed100%。binary89.6MBはhard95MB内・target85MB WARNで、CSS・gen・paletteのsoft target WARNも保持する。startup中央値96.92msはlimit50msを超えたが、factor2.119の非reference機でreport-only / 非gateだった。CI job成功を正式startup合格へ読み替えない。standalone compileは1,444ms、`mitori 0.0.0 (api 1)`を確認した。

PR #17は2026-10-11T16:34:35Z（JST 2026-10-12）に通常merge `0f223015e4a742413fc1419f5ace7115ffcff9c4` でmainへ統合した。source `27d8bd4`・CI checkout `89631077`・merge commitのtreeは`c355509846dbd7a592f6eff802a74e5773070cf0`で一致。作業branch `codex/browser-ci-followup-20261012` はmainへの祖先性を確認してlocal / remoteから削除した。Mac全suiteの残件は今回の実成功で解消し、旧失敗の履歴は保持する。

原Ubuntuログは682,358 bytes、SHA-256 `55a1031bae75d2521435b58fdfec1f05dd4c34228c1696963d2a2dd496ae52a6`を照合した。最終CI・Ubuntu実数・通常merge・branch削除を[ci.json](ci.json)の`pr17`へadd-onlyで追記し、Mac-only時点を含む既存の値は保持した。rawログ本文・個人path・認証情報は追加していない。
