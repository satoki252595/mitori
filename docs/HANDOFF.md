# mitori 引き継ぎ資料（2026-10-11 残課題の続行・Codex実検証）

> **現在の入口は直下の §★ と [2026-10-11の検証一覧](progress/remaining-20261011/README.md)。以下の「2026-10-07履歴★」「前回★」「履歴★」と §0 / §0a / §0b は以前の記録。**
> 今回の実LLMはCodexと取得済みLM Studio。Claudeは使用していない。過去の認証待ち・未統合・失敗の記述は、当時の履歴として残す。

## ★ 現在の状態（2026-10-11、実装・検証・未達の区別）

利用者の残タスク続行指示に従い、Codexの正式生成経路、OSSの説明省略、UIの初回表示とasset、Linux cold check、Windows native検証を進めた。修正後head98c59a6のUbuntu CIは成功（unit3,022pass / 0fail、golden109pass / 0fail）、Windows対象もhead23645fdで成功した。Mac attempt6も既存guardを通過し、browser380pass / 14skip / 0fail、共有2pass、a11y8passが成功。[PR #13](https://github.com/satoki252595/mitori/pull/13)は2026-10-11T11:16:43Zに通常merge `df014912ee7e31ac62c4ca50c846d396aeec9dff` でmainへ統合し、資料branchもローカルmainへ通常merge `bdcebaf` で取り込んだ。統合時main `bdcebaf` はoriginへpush済みで、実装・資料の両作業branchをlocal / remoteから削除した。旧headの5失敗と後続guard停止は履歴へ保持した。[CIの前後](progress/remaining-20261011/ci.md)。詳細と各JSONの入口は [remaining-20261011/README.md](progress/remaining-20261011/README.md)。

### ★.1 実装と確認できたこと

- **初回parse準備:** lazy poolのfactory直後はWorker数0だったため、既存prewarmが1件も送信されていなかった。起動予定数で準備を送る1行を修正し、旧実装で失敗する回帰を確認。対象6tests / 20assertions成功。ABBAは抽出3表の全行hash・coverage・counters一致、S1のWorker起動待ちは約10msから0.04msになったが、終了較正が基準外なので全体の速度改善・1,500ms合格は主張しない。[原因と比較](progress/remaining-20261011/idx-prewarm.md)。
- **F10 / F14:** 旧監査に残っていた実績較正・全体help・export終了処理を後続branchで修正。較正はexact profileの実測超過だけを足し、保守floor・USD cap・confidence25を維持する。対象40tests成功。[較正の確認](progress/remaining-20261011/ledger-calibration.md)。helpは既存の日本語・英語案内を再利用。exportは自身のchildと証明できるdaemonだけを終了対象にし、後接続や作業中なら同期idle guardで維持する。終了拒否や通信失敗でも結果・元エラーを保持。CLI対象とserver shutdown対象が成功し、統合check全7stepも成功（5.76秒、warm）。[終了処理の確認](progress/remaining-20261011/cli-lifecycle.md)。後続branchのCI・main統合は別途記録する。
- **export入力の事前検証:** 配布binaryで無効保存先によるscan中のdaemon残存を発見し、言語・保存先検証を接続前へ移した。追加3回帰の旧実装失敗と修正後spawn0を確認、最終export18pass / 70assertions。修正後binaryでも正常書き出しと無効保存先の両経路でregistry無しを確認。最終sourceの統合check全7stepも成功（4.12秒、warm）。[失敗と修正後](progress/remaining-20261011/cli-lifecycle.json)。
- **Codex実生成:** `codex-cli` / `gpt-6.1-sol` / highを正式に配線し、Nix経由でJevの対象2節とm3eの対象moduleを実生成した。対象OSSの設定・hook・toolを継承しないlean profileを維持。Jevのhistory → observe → page_changed、60操作 / 120 prediction decision requests / scroll・wait追加前の250 DOM candidates、m3eの条件付き変更先・4言語・検証3コマンド・省略寸法の既定値補完を本文へ回復した。[品質記録](progress/remaining-20261011/quality.md)。
- **Codex Explain / Nix・通常ローカル:** go-smallで各1 application jobがattempt1 / done、各引用1件有効、元source不変、後始末成功。Nixはterminal reported input1,582 / output47、API-equivalent $0.003634、run5.012秒。既存ローカルBun 1.4.2はinput1,585 / output47、$0.003640、run4.334秒。各cap$0.05、合計$0.007274。誤った旧LLM呼出数カウンタは採用していない。[両経路の安全な証跡](progress/remaining-20261011/codex-explain.json)。Codexは認証待ちではない。
- **LM Studio Explain / Nix・通常ローカル:** 取得済みQwen GGUFで各1 HTTP推論がattempt1 / done、各引用1件有効、元source不変、追加費用$0。専用モデルだけunloadし既存serverを維持した。短いExplainのみで、CLI指定4096とload報告262144の不一致は原因未確定。[両経路の証跡](progress/remaining-20261011/lmstudio-explain.md)。
- **生成の停止と費用:** 完成した日本語出力のbyte数をtoken上限と比較していたCodex tool-free経路を修正し、terminal usageを受け取る。reported token / USD、stdout、timeout、agent modeのguardは維持。予算拒否をcoverage完成だけで成功扱いしない回帰も追加した。生成検証累計は初回停止分を含みAPI-equivalent $0.792490（native7calls、terminal usage5calls / 推計2calls）、総枠$2内。上のExplain費用は別計上。請求額・サブスク枠の保証ではない。
- **並列生成の費用予約:** Codexの送信直前に共有preflightの額を予約し、並列・再試行の使用済み額を合算する。初回の予算不足はpendingとして同じ上限で再開でき、再試行の不足は有効な途中本文とusageを保持して停止する。対象37tests / 224 assertionsとgen型検査が成功、独立再現も一致。実LLM追加0。[前後の再現と回帰](progress/remaining-20261011/codex-budget.md)。最終統合checkも全7step成功（4.35秒、warm）。
- **UI:** 初回nonce競合、仮想化アンカー、節移動のlive engine再検出、初回status先取り、lazy chunksとprecompressionを修正。読書位置修正後のcompiledもstrict asset全項目pass、初期JS54.697KB gzip、embedded selftest6checks成功。[最新assets](progress/remaining-20261011/reader-fix-assets.json)。先行測定のReader6 requests、a11y8pass / 違反0と、factor1.12でreport-onlyだったscanSummary1,771.5msは履歴へ保持した。[先行UI記録](progress/remaining-20261011/ui-bench-release.md)。後続のcompiled `ui.scanSummary` 正式測定はwarmup1 / measured3、quiet / AC、factor1.029337 / after1.086773で中央値1,615.700ms。hard limit2,000msは合格、target1,000msはWARNで、正式測定待ちは解消した。対象binaryと全測定値は[最新一覧](progress/remaining-20261011/README.md)に記録。実Chromeの初回map、確定済み日本語検索、Codex native / MCP切替と配布binaryの接続commandを確認。[Chrome記録](progress/remaining-20261011/chrome.md)。
- **Mac正式CI:** run38119108193 / attempt6 / job114455888859はload6.19384765625・quiet / AC・待機0、factor1.017953727365694で既存guardを通過。browser380pass / 14skip / 0fail（4.5分）、共有2pass / 0fail、a11y8pass（7.9秒）の3stepすべてが成功した。同じNix固定runnerをforegroundで実行した較正Bunのps PRIは31、LaunchAgent配下では4だったが、厳密なQoSや根因は未確定。上限・referenceは変更せず、検証後は元の同じplistでサービスを復元した。[CI記録](progress/remaining-20261011/ci.md)。
- **Linux cold check:** testkitの既存home / fixtures / goldenへimportを絞り、loopで早期に読むworkspace sourceを226→161、genを50→0へ減らした。全20projectの意味検査・診断・較正・checked/noCheck境界を維持。ARM / 2CPUのcold ABBAは4回とも20semantic builds・0cached・0errors・全7項目成功、wall中央値4.50%短縮。対象回帰69pass / Linux限定3skip / 0fail。Ubuntu CIのhard limitは合格、soft target未達は保持する。[採用した変更](progress/remaining-20261011/cold-home.md)、[不採用の先行fixture案](progress/remaining-20261011/cold-check.md)。
- **Windows:** Nix-built EXEを `BUN_BE_BUN=1` で再利用し、Windows用Bunの別ダウンロードを廃止。初回native CIの5pass / 1failと前回525260d成功を保存。[最新Windows CI](https://github.com/satoki252595/mitori/actions/runs/38115528185)（`23645fdc7100e02e5f6b63bbbde2b33c59b1c79f`）はNix crossbuild / Windows nativeとも成功し、source tests7pass / 0skip / 0fail・33 assertions・4.20秒。既存native4ケースを維持して実Windowsで成功し、製品`--version`とembedded `_selftest` の6checksもすべて成功・2,606.378ms。製品EXE SHA-256は `3e1d25c49fbb36b5974a4ec6036a3d9bc8ebcb81cc21d8d078b85143cf189e04`、API / 実ログ / artifactを照合済み。[Nix方式](progress/remaining-20261011/windows-nix.md)、[環境修正](progress/remaining-20261011/windows-env.md)。Windowsの非group直接Bun.spawn経路には標準環境変数の補充が残る。PR全体のCI結果とは区別する。

### ★.2 未解決・再確認待ち

1. **実IME:** Chrome通常操作・確定済み日本語検索・native / MCP設定は確認済み。実IMEの `Input.imeSetComposition` は操作許可で拒否されたため、迂回せず本人の変換確定Enter / 次のEnter確認を依頼中。[Chrome記録](progress/remaining-20261011/chrome.md)。compiled scanSummaryの正式hard limit検証は上の後続測定で完了。旧3,312.1ms未達と1,771.5ms / factor1.12のreport-onlyは履歴として保持し、後続結果へ付け替えない。Safari実機は利用者がChrome代替を選択したため今回の必須外。
2. **Go7k cold 1,500ms:** parser / query / GCの先行候補と正式caseのNOISY / report-only失敗は保持した。[原因と不採用証拠](progress/remaining-20261011/idx-cold.md)、[正式後続](progress/remaining-20261011/idx-formal.json)。Goの同一Node.type再取得を減らす変更は同条件ABBAで中央値2,232.14→1,994.58ms（10.64%短縮）、全行hash・coverage・診断・6Worker一致を確認して採用した。[採用の根拠](progress/remaining-20261011/idx-type-local.md)。最新の正式 `idx.s01.cold.7kfiles` はwarmup1 / measured5、quiet / AC、factor1.037243379882442で中央値1,980.096958ms。hard limit1,500msは未達で、上限やWorker規則は変えていない。後続helper候補のquiet / reference内ABBAも中央値1,853.212792→1,849.252792ms（0.214%）に留まり、3表hash・counters・coverage・6Workerは一致したが採用根拠がなく未採用。
3. **引用窓:** 保存済みm3e最新版はL1が28pass / 2fail / 8vacuous、Jev品質節は22pass / 1fail / 2vacuous。[source照合](progress/remaining-20261011/quality.citation-review.json)。m3e依存文のimport原文を入力へ補い、複数行importのspecifier行からもbindingsを保持する。既存28k枠・除外・元行・blob・citableと既定値helperをofflineで確認、検証器は緩めていない。文書の再検証もcoreの共通verdictへ統一した。修正後の追加実生成2回はAPI換算保守$0.416844 / 見積枠$0.50で本人の費用承認待ち。ChatGPT認証とAPIキー未設定を確認したが、`credits.hasCredits:true` のため有料credit消費がない保証はできず、$0.50も実請求の上限ではない。今回の統合作業でnative呼出は0。保存済み出力の全引用pass・全文semantic保証とは扱わない。

4. **外部provider本人環境:** Codex・Muse・Ollama・LM Studioの記録とは別に、Antigravityの実接続、Grokの本人ログイン・生成、外部ツール4種での本人設定登録後の文書生成は未確認。公式本人認証やアプリ側の再読込が必要で、設定や認証を勝手に変更しない。[provider別記録](progress/startup-matrix-20261007/README.md)。

後続の初回parse準備修正も、開始factor1.083876に対し終了factor1.124994で基準外だった。正式caseの後続試行も事前factor1.130491でguard停止、scan0回。機能修正と全行hash一致を確認したが、Go7kの正式未達を上書きしない。[guardの記録](progress/remaining-20261011/idx-prewarm.json)。

### ★.3 利用方針・外部操作・守ること

本体はcloneしてローカル利用する。通常利用にNixを必須とせず、既存Bun / Git / LLMを使える。開発・検証は `scripts/nd` とproject Nix、Docker例外は許可済みの既存Linuxハーネスだけ。Cloudflareの共有公開・Paid化は任意で、ローカル利用の必須残タスクには含めない。

利用者の対応待ちは上の実IME確認と追加実生成2回の費用承認。任意providerを使う場合はその本人認証、LM Studioを使う場合はモデル読込・サーバー開始が別途必要。CodexログインやClaudeログインを今回の待ち条件にしない。AIの変更はアンカー済み・範囲限定・ゲート済み・人の確認・未コミット適用・Undo可、side repo、lean起動を維持する。通常の修正・検証・Git操作は2026-10-11に包括承認済み。ローカルへの直接ソフトインストールと追加費用が発生する操作、Cloudflare deploy / Paid化は事前確認する。生prompt / auth / env / nonceはGitへ保存しない。

---

## 2026-10-07履歴★ 起動手順・LLM別検証時の状態

以下は2026-10-07時点の記録。認証待ち・Windows未実行など、現在の状態は上の§★を優先する。

最新の作業は[Issue #11](https://github.com/satoki252595/mitori/issues/11)。貼付ログのdirenv blocked / Bun lockfile / Nix store upgrade失敗を確認し、絶対パスの新Bunでもpackage start内で旧PATH Bunへ戻る原因を`npm_execpath`で修正した。Nix・既存Bun 1.4.2のclean clone→frozen install→初回UI build→scan/HTTP/停止を確認。8providerの設定プレビューとMCP共通通信、既存Linux arm64 Dockerの内部導線も確認し、READMEへ復旧手順と結果を反映した。Dockerは利用者の選択によりLinux検証用とし、公式LLMの認証・推論用にはしない。[検証記録](progress/startup-matrix-20261007/README.md)。

実ExplainはMuse native 1.4.3 Contributor / maxと、既存Ollama `qwen3-coder-next:latest`でNix/通常ローカルとも成功。各回答の引用1件は有効で意味もfixtureと一致。Muse API相当推計合計$0.000554/cap$0.10で、課金先・サブスク枠は未確認。`qwen3:4b`は600tokenをthinkingに消費して本文が空、`/no_think`でも解消しなかった。失敗を保持し万能対応と報告しない。Codex/Cursor/Grokは公式native CLI＋隔離設定で両Bun経路からMCP接続し8ツールを取得したが、実生成は未確認。Antigravityは設定読込だけで接続未確認。Claudeは公式ログイン待ち、LM Studioはモデル読み込み/サーバー開始待ち。外部4ツールの本人設定への登録・実生成も未確認。[残る利用者操作](progress/startup-matrix-20261007/README.md#利用者の協力が必要な確認)。

2026-10-06の認証対応はAPIキー必須を避け、本人の公式ログインと対応サブスクを優先すること。[Issue #8](https://github.com/satoki252595/mitori/issues/8)で設定画面の認証ボタン、browser-only固定ログイン入口、TTYで確認する`auth`、Grok Buildのsession既定/API明示選択を追加した。Ollamaローカルは認証不要、Cloudだけ公式signin。Antigravityは認証専用コマンド未確認のため公式手順を案内する。Museは保存APIキーの優先を避けるため確認後に公式logout→loginする。ログイン実行は利用者操作に任せ、dispatchと成功を区別する。[認証仕様の確認](research/subscription-login-20261006.md)。

前回の追加は[Issue #6](https://github.com/satoki252595/mitori/issues/6)のローカル起動と主要LLM設定。通常利用は既存Bun/Gitで`bun run start -- <repo>`、Nixは開発・検証に維持する。Claude Code / Muse / Grok / Ollama / LM Studio / Codex / Cursor / Antigravityの簡単設定を用意し、外部セッションはMCPとprep/ingestを案内する。[README](../README.md)、[実装・検証記録](progress/onboarding-20261006.md)、[公式仕様の確認](research/llm-onboarding-20261006.md)。新providerの実推論は実施せず、既存Muse実検証と今回のmock/loopback成功を区別する。

作業追跡は [Issue #2](https://github.com/satoki252595/mitori/issues/2)、一覧は [backlog-2026-10-05.md](progress/backlog-2026-10-05.md)。第7回CI（head `a663a459`、実merge checkout `24a342e8`）は全体success。Ubuntu全7check/20semantic/0cached/0errors・unit2944pass/134skip/4todo/0fail・fixture全12・golden109pass/4skip・size・Linux binary smoke、Mac web344pass/14skip・共有2pass/37assert・a11y8passが成功した。Windowsは未承認skip。 [PR #5](https://github.com/satoki252595/mitori/pull/5)は2026-10-06 JSTにmainへmerge済み（`09610433865b444372aeee1e4a00d628b5702c4c`）、作業branchはlocal/remoteとも削除した。merge treeは成功CIのtreeと一致し、golden専用commitを含む履歴を保持した。[CI経緯](progress/pr5-ci-20261005.md)、[統合・削除照合](progress/pr5-publication-20261006.json)。以前の4 remブランチも統合・整理済み。

### 2026-10-07履歴★.1 実装・単位検証済み

- web の文書戻す / ブロック・節翻訳 / やさしく表示、docpatch/1、人の採用・Undo、side repo だけからGitHub PRを作る経路、Codex native lean agent を実装した。[backend報告](progress/remaining-backend-20261005.md)。Codex は Mac の検証済み binary と apply_patch だけ。可視 step 上限と費用推計同意であり、provider の hidden token / USD hard cap を保証する仕様ではない。
- 実 GitHub の product export helper から own repo に一時 draft [PR #3](https://github.com/satoki252595/mitori/pull/3) を作り、1 file / 3 additions と local Git metadata不変を確認後、close / remote branch削除した。[実送信証跡](progress/pr-native-probe-20261005.md)。web側のhuman/gate条件は別int検証と区別している。
- 引用と推論・provenance、outbound入力、shallowで利用可能な履歴、pinの後始末を修正。[gen/indexer報告](progress/remaining-gen-indexer-20261005.md)。moduleのDOCS/flow入力、共有summary、既存flowの同ID更新も、OSS理解確認で見つけた不足に合わせて修正した。
- floorplanはdefault offのfeature flagで実装。8 corpusのactor保持 / determinism、fallback25%、40room algorithm約1.4–1.5msを確認。[floorplan証跡](progress/floorplan-20261005.json)。初回worker起動時間とは区別した。
- 未計測7benchを5UI＋2agent residentとして測定。[UI計測](progress/ui-bench-20261005/README.md)。scanSummary中央値1,413.6msは1,000ms target超過だが2,000ms limit内のWARN。他の対象予算はgreen。Muse終了5秒後は0 process / 0MBで、Claude常駐cacheを測ったとは扱わない。
- AC接続・前後負荷guardを維持して静かな基準機を校正。2026-10-05T03:01:28Z、5試行best316.23ms。[基準機記録](progress/reference-machine-20261005.md)。以前の補正結果を新係数で遡って成功へ変えていない。
- Nix管理のself-hosted Mac runnerは `mitori-reference-mac`、label `mitori-reference` で online。第7回CIの3browser全suite344pass/14skip、shared viewer2pass、a11y8passが成功。Ubuntu全体も成功。型検査/修復時間・a11y/guard/cassetteの過去の失敗と原因修正はCI経緯へ保持した。
- WindowsはNix/ZigのJob Object helper、SHA検証・配布assets、path対応、manual native CIを用意。Nix crossbuildは成功し、native実行は未実施。[Windows報告](progress/windows-job-20261005.md)。unverified helper/profileを安全機能付きと表示しない。
- 暗号化共有はAES-GCM・署名付きsnapshot・R2/D1 quota・期限・コメントとCLIを実装。Miniflare/D1とChromium/Firefox/WebKit、保存file://viewerを確認、Worker dryrun15.41KiBraw/5.30KiBgz。[共有報告](progress/cloudflare-share-2026-10-05.md)。remote resource作成 / deploy / Paid化はしていない。

### 2026-10-07履歴★.2 実 Muse のOSS品質確認

- 最近作成されstarの多い公開OSS3件をGitHub APIで選定しSHA固定した。m3e-canvas (8,692 stars)、jev-ultrafast (21,997)、Laya (30,713)。Trending順位やstar増加量を測ったとは言わない。[選定・費用・結果](progress/oss-quality-2026-10-05/README.md)。
- Muse `muse-spark-1.3-contributor` / `max`、shell/write/web toolsなしのnative lean profile。上流依存 / script / アプリを実行せず、mitoriの解析と生成を試した。初回m3e13/13、Jev11/11。Layaは45分で18/21まで、失敗1＋中止2を保持した。
- Layaの45文字slugを40文字上限で拒むvalidatorの不整合を修正。失敗moduleと必要な節だけ再開し4/4、全13module page generatedを確認した。初回一括21/21とは報告しない。
- 設計判断・問いを修正して該当節だけ実Muse再検証した。key保存と送信、Host/Originと盗聴、最低版とCI版の混同を修正した。JevのGET handlerとLOCK/atexitの役割、history追加がobserveより先であること、Layaの公開既定値を最新生成で訂正した。m3eの条件付き変更先とJevの一部手順には説明の省略が残る。1,421引用先の無効0は意味の正しさの保証ではない。
- API相当推計累計は現在$0.487122、総cap$1。m3eのfresh standardは13/13・1704.0秒。本文bytesと設定単価の推計で、実請求・hidden reasoning tokenではない。private config / raw recordingsはGitに入れない。native85callsの安全監査で違反0、初回Layaの未完1を履歴に保持した。Laya途中runのcap超過$0.000095も保持し、最終spending guardを修正した。

- 追加照合でJev旧§9の「250候補/run」誤文を発見。qualityへ数値の適用範囲の指示を加え@5で§9だけ再生成、1/1・323.8秒・推計$0.004909/cap$0.03。誤文は削除されたが、上限の具体数は入力に不足し説明省略、POSTの共有LOCKを全HTTPへ広げない補足も保存。全文semantic保証とは扱わない。[修正と限界](progress/oss-quality-2026-10-05/jev-quality-correction-20261006.md)。

### 2026-10-07履歴★.3 残る外部条件

2026-10-06の利用者確認: 本体はcloneしてローカル利用する想定。Cloudflare公開は必須の残タスクから除外する。URL共有を利用する場合だけ、別途承認してデプロイする。

1. **Windows native:** 今回限りの公式Bun依存に対するNix例外は回答待ち。Nix crossbuild・配布準備は成功、native Job Object/自己検査は未実施。[承認後のmain実行手順](progress/windows-job-20261005.md)。
2. **Safari実機/実IME:** 第7回CI終了後もCUAでMacロックを確認。Firefox/WebKitとsynthetic IMEの成功は実Safari/IMEの代わりにしない。

任意のCloudflare共有は実装・Miniflare・3browserまで検証済み、remote/Paid化は未実施。[必要になった場合の公開手順](progress/cloudflare-share-2026-10-05.md)。GitHubは現在private、ルートLICENSEは未設定。一般公開するOSSとして配布する段階では、公開範囲とライセンスを決める必要がある。

前回のall-target compiled出荷検証は7f77419（production品質promptの修正8f7176c）、Mac SHA1e170b95…、all-target全95MB hard内・Mac自己検査成功。compiled asset hard gateと起動表示中央値48.39ms/limit50が成功、target20 WARN。UIのmanifest/renderer/web manifest 3SHAは前版と一致。前版fdf71b9/e229e4eの初期JS gzip相当44,355B・実br40,066Bと、AC/quiet/factor1.000573のphysical footprint48.1571/156.5953MB、palette指定median30.5ms/round p9531.2msは元binaryの実測として保持し、新binaryへ付け替えない。advisory asset targetの未達も保持。[最新出荷物と旧測定](progress/shipping-validation-20261006.md)。

3OSSの実Muse/source照合は完了。説明省略と未取得のexact provider usageは限界として記録し、1,421引用先の無効0を全文semantic passとは扱わない。F11の同Claude-v5推計比0.476356はtarget内、保守的byte比1.1142のred・後続全prompt fresh未測定も保持。[品質証跡](progress/oss-quality-2026-10-05/README.md)。未完を「残なし」と報告しない。

---

## 前回★ 初回push・整理時の状態（履歴）

### 前回★.1 統合と実装

- `rem/bench` → `rem/safety` → `rem/doc` → `rem/ui` は **main へ統合済み・push済み**。merge commit は `8abe718` / `4c8f463` / `f393f17` / `84fa9c7`。各統合後の check は成功。CR 台帳の追記は両方保持し、INT-06 の両方の検証を残した。2026-10-05に利用者の指示で未pushの90コミットを反映し、統合済みlocal78本・remote16本を削除した。両側のbranchはmainのみ。詳細と削除ref/SHAは `docs/progress/git-publication-2026-10-05.md` / `.json`。
- 続行の実装は `8cdae9c`、scoped生成の問いの復元は `49c1575`、リスク生成のTODO状態保持は `28388df`、スレッド由来の決定の文言は `848c4d4` に保存した。検証・生成例・引き継ぎは別の資料コミットで保存する。
- safety API の web 配線を追加した。Composer の保存・再開・見積り・送信に `Thread.context` を渡し、コード引用の × は書き込み権限だけを外す。外部 pull round の変更一覧と範囲外表示、Undo 前の再確認を Reader / Inbox / Review へ接続した。
- F6 / CR ui-3 は実装済み。大きな節は anchor 周囲の HTML を先に取得し、残りを idle で補充する。section JSON は br/gzip に対応。SSE の更新・削除・freshness、全文検索、既読 marker との整合を保つ。
- UI の非同期設定保存・全文検索の stale reply、freshness の DOM 更新、Git 2.43 の promisor missing object 処理、crit cold-open ベンチの重複 id を修正した。

### 前回★.2 任意 LLM / 今回の Muse

- 既存 generic CLI にモデル・reasoning・明示単価・出力 protocol・生成 deadline を接続した。説明、構造化 patch/findings、設計書生成で使う。任意 CLI の agent tools は未対応。設定境界と制限は `docs/design/adr/0015-configurable-llm.md`。
- 今回は **`generic:muse-spark-1.3-contributor` / `max`**。既存 Muse native binary を使い、新しい依存は追加していない。Claude の OAuth は今回の検証に不要。
- web は実行設定を直接 PATCH しない。Settings のコマンドを利用者が CLI で確認・登録し、その一致を再取得してからモデル/default/reasoning を保存する（SEC-06）。Contributor の入力・出力の学習利用は設定画面に明示している。
- 実デモは成功: Explain → Fix → gofmt / go test / go vet → 人の採用 → 未コミット確認 → Undo。Explain の最初の本文 event は 8.413 s、回答 10.497 s。Fix は ready 24.452 s。記録値 $0.001128、**usage 推計**。証跡 `docs/progress/live-muse/measurements.json` と PNG。
- Muse は正確な token usage / hidden thinking を返していない。設定価格と本文 byte 数の推計を記録するため、API 換算 cap は実請求額の保証ではない。料金未知を無料と表示せず、推計をキャッシュ校正へ使わない。
- 実修復ターンも成功: go-vet 失敗 → attempt2 → 3ゲート成功、最後は reject して元の bytes を維持した。記録値 $0.001284（usage 推計）。Muse の各起動は認証だけをコピーした0700/0600の一時 profile と空 toolset を使い、終了時に削除する。tool/hook/reminder/MCP は観測0。generic の追加 context は同じWRITE範囲・current head・既存30行hintを用い、1 job で1回まで。証跡 `docs/progress/repair-muse/measurements.json`。
- critは継続分を合わせ**24/24完了**。scoped集約の42問欠落を修正し、リスク節と問いだけを再生成した。最後は43RAWから15問、内部retry0%、壁時計再開8.3%、L1 99.6%、27calls、実行時間合計3,458.4秒。USD0.182344推計、初回120秒失敗分を含めUSD0.212474。45分一括完走は未達。最終文書・合成方法・原記録の入口は `docs/progress/gen-muse-final/README.md`。

### 前回★.3 検証と次の入口

- 最終 `scripts/nd bun run check` は10.63秒、`build:bin` は成功。全 unit の初回3失敗は各単位の再検証で解消。focused Chromium 32件中30件成功、残りCLSを修正しCLS/size4件成功。詳細は `docs/progress/continuation.md`。
- UI / F6 の検証: `docs/progress/continuation-ui.md`。初期 JS は地図約87.4 / Reader約91.3 KB gz、**60 KB は未達**。CLSは1280/1440幅で0。初回に必要な shell/store 境界の再設計が残る。
- Linux arm64 は frozen install を修正して成功、全体unitのF1失敗も限定再検証で解消。watch と sandbox は成功。cold check は約57秒で30秒上限未達、warm は15.68秒で成功。条件と証拠は `docs/progress/linux-continuation/README.md`。
- bench の検証: `docs/progress/continuation-bench.md`。crit 静的文書込み cold open 中央値2,085.9 ms、高負荷補正下の計測。未計測7件と基準機の記録は残る。
- 実 LLM の再実行コマンド、cap、観測上の制限: `docs/progress/continuation-live.md`。一時設定と生の provider 記録は `/tmp` のみに置き、認証情報を Git へ保存しない。
- 作業追跡: [Issue #1](https://github.com/satoki252595/mitori/issues/1)。原コンセプトと運用上の安全・費用制約は以下の履歴★.4、repo の `AGENTS.md`、ADR-0013 / ADR-0015 を維持する。

### 前回★.4 残り

1. 生成品質の残り: 設計判断の細部偏重、識別子列挙/反復、TODO周辺文脈、未出典文など。実測で問いの欠落・TODO意味逆転・決定の曖昧表示を修正したが、全件解消ではない。具体例は `docs/progress/continuation-quality.md`。実修復の37行の独自error/整数formatにも簡潔さの改善余地がある。
2. 初期 JS 60 KB、静かな基準機での bench 記録、未計測7件、self-hosted runner、Linux cold check の30秒上限。
3. CR ui-4 の revert / translate / simplify、EX-04 / NC-19〜21、outbound fact の生成利用、浅い clone の co-change 制限。
4. Cloudflare 共有・床面図・Windows・Firefox/Safari 実機・Codex agent mode・docpatch/GitHub PR。Cloudflare deploy / Paid 化、月1,000円以上の継続費用増は承認が必要。

---

## 履歴★ 前回停止時の状態

### 履歴★.1 main
- `origin/main` = `a427f36`（監査 49 件の仕上げまで取り込み済み・push 済み）。`check` 緑、`bun test` 2,775 pass / 1 fail（IDX-AT-15 は高負荷のときだけ落ちる時間依存。単独では通る）。
- 実エンジン（実 `claude`）の検証が未実施。この Mac の `claude` は **ログアウト中**（`claude auth status` → `loggedIn:false`）。OAuth は agent からは通せない。**利用者が `claude /login` する必要がある**。

### 履歴★.2 未マージの 4 ブランチ（すべて origin に push 済み・各 `check` 緑・未統合）
残課題パス（ログイン不要の分）を 4 トラックで実装し、各トラックの敵対的検証まで終わっている（ui は検証の途中で止めたため、WIP コミットを含む）。統合（最終回帰）は未実施。

| ブランチ | 内容（詳細は各報告書） | 報告書 |
|---|---|---|
| `rem/bench` | 計測ハーネス: 予算 132 件を実測できる bench case（13 ファイル）、e2e/perf・a11y(axe)、nightly 用 `bench.yml`（dispatch/schedule のみ）、負荷に強い全テスト（負荷 66〜83 でも 0 fail）、**Linux 検証**（OrbStack の Ubuntu arm64 + x64 バイナリ、`scripts/linux-ci.sh`）、O3 watcher は A のまま | `docs/progress/rem-bench.md`、`docs/progress/bench-baseline.md` |
| `rem/safety` | **ゲートのサンドボックス決定**（ADR-0013 R2: 自分のループバックだけ許可、デーモンポート等は遮断。macOS は sandbox-exec、Linux は bwrap の private netns）、agent の残り全部（初回入力上限・`needs_more_context`・ctime・worktree 上限・symlink 脱出の無効化・F1/F8/F9/F10）、**スレッドがコード範囲を持つ**（`Thread.context`）、自動「対象コード」チップを外せる（API 側）、所有者外編集のレビュー | `docs/progress/rem-safety.md` |
| `rem/doc` | 0 トークンの設計書内容: §7 型/データモデル・§8 外部通信、**「変更の手引き」**節（依存元/先・テスト・co-change・よく使われる宣言）、1,500 行超ファイルの領域目次、**再オープンの安定化**（親モジュール ID の再生成バグ修正）、route/flow seed の解決（crit 44→61/62）、Next.js/Vite の入口検出 | `docs/progress/rem-doc.md` |
| `rem/ui` | UI 残り: NC-04/08/09/13/14/15/17、EX-08〜11、CitePeek 行番号、アプリ内 HTML 書き出しダイアログ、ブラウザ側の初回描画の CLS 修正、route ごとの初回 JS 118.8→86.3 KB（目標 60 は未達）。WIP コミット 1 件 | `docs/progress/rem-ui.md` |

**統合の手順（推奨順 bench → safety → doc → ui）**: 試験マージ済み。衝突は **`packages/core/CR-LEDGER.md`（追記同士。両方残す）と `test/int/int06.test.ts`（safety）のみ**。`prompts.lock.json` は今回の 4 本では触っていないが、念のため `AC-40` を回すこと。各マージ後に `scripts/nd bun install --frozen-lockfile && scripts/nd bun run check`、最後に全 `scripts/nd bun test`（他プロセスが重いと時間依存で落ちる。`rem/bench` の `scripts/under-load.ts` と負荷ゲート済みのテストで安定する）。統合後に `scripts/linux-ci.sh` も回す。

### 履歴★.3 残り（優先順）
1. **統合**（上）。ブランチは全部 origin にあるので、worktree は不要。
2. **要ログイン・実費小**（`claude /login` 後）
   - 最終デモ（`@` なしの Fix を含む）: `scripts/nd bun run build:bin && scripts/nd bun test/int/shots/live.ts --engine real --out docs/progress/final`（上限 $0.60、想定 $0.03）
   - 修復ターンの実エンジン確認: `MITORI_LIVE=1 MITORI_MAX_USD=0.2 scripts/nd bun test test/int/int08.live.test.ts -t "3\."`（$0.01〜0.03）
   - crit の標準生成の再計測（再試行率 <30%・L1 ≥ 90% が実エンジンで出るか）: `bench/measure/gen-real.ts --scope`（≈ $1.0）
3. **生成の質（実エンジンで測ってから入れる）**: EX-04（出典の無い文を claim 化するか span を広げる、指標 `bench/measure/doc-uncited.ts`）、NC-19〜21、`gen.overview` の「フロアプラン→間取り図」（`prompts.lock.json` が変わる）、gen が outbound 事実を使う（`cr-requests/doc.md` #1）、「新しい Kind を足すには」の理解チェック再採点。
4. **web 側の未配線（rem/safety の API は入っている）**: Composer が `POST /threads`・`/prompt` に `context` を送る、出典チップの ×（`write:<path>`）、⤴/⧉ の「⚡ その場で実行」ブロック解除（手順 `cr-requests/safety.md` CR safe-6）。
5. **rem/ui 由来**: 初期 JS 60 KB（route 表を client 用に生成、Rail/Header の縮退ロジックを route chunk へ）、F6 のサーバー側範囲取得・圧縮（CR ui-3）、ブロック revert・節の translate/simplify の route（501、CR ui-4）、AC-J01 の spec 書き直し（地図の作り直しで古い）、`ui.cls.boot` 0.037（limit 0.01）と地図の axe `nested-interactive`（bench/a11y が本物の違反を検出）。
6. **rem/bench 由来**: 未計測 7 件、`reference.json` の静かな機械での記録（`bench --record-reference`）、self-hosted runner の登録（ユーザー作業）、`ci:pr` に e2e/web を入れる件、Linux の tree-sitter install 不具合（`--ignore-scripts` で回避中）、PLAT-I-008（Linux）、`.pin/store.ts` の `saveRows` の後始末（`cr-requests/doc.md` #5）。
7. **未着手**: WP-17 Cloudflare 共有（**デプロイ前にユーザー承認必須、Paid 化も同様**）、WP-18 床面図、Windows、Firefox/Safari 実機、codex の agent mode、docpatch/1・GitHub PR。
8. **履歴の無い shallow clone では co-change が出ない**（platform の方針。`cr-requests/doc.md` #4）。

### 履歴★.4 守ること（コンセプト）
> 一度 repo を省トークンで読み、人が読める見やすい設計書にする。人がその箇所にコメント/修正を入れると、**その位置に紐づけて**ユーザー自身の AI が修正・レビュー対応する。初心者も専門家も同じ文書で。速度とトークン量と UI/UX に徹底的にこだわる。
- AI の変更は常に **アンカー済み・範囲限定・ゲート済み・人が確認・未コミットで適用・Undo 可能**。ユーザー repo の refs/objects/worktree には書かない（side repo、ADR-0012）。
- エージェントは lean 起動（I1〜I14）。対象 repo の設定/hook は読ませない（セキュリティ境界）。
- 月 1,000 円以上の継続費用が増える操作（Cloudflare Paid 化など）は事前承認。実エンジンの費用は各タスクに API 換算の上限を付ける。
- コミットは `Co-Authored-By` 付き、`.env` 等は commit しない。push は利用者の意向がある場合のみ。

### 履歴★.5 コスト（反省）
ワークフローで多数エージェントを並列に回すと数 M〜十数 M トークンを消費する。今回の累計はサブエージェントで合計およそ 50M トークン級。次は、並列 3〜4、定型は sonnet、検証は失敗した受け入れ試験のある単位だけ、各エージェントは `docs/design/briefs/WP-xx.md` と該当報告書だけを読む、を守る。

---

## 0. 現在の状態（監査 49 件の仕上げ、2026-10-04、main・未 push）

統合後の main を 3 本の監査（初見者・専門家・非機能。`docs/progress/audit-{newcomer,expert,nonfunc}.md`）で見て、49 件の指摘を受けた。
そのうち critical / high の 17 件（中身は 16 件）を直した。13 件は修正、4 件は一部修正。安く直せる medium / low も直した。
件ごとの判定と回帰テストは **`docs/progress/audit-resolution.md`** にある。commit は `9b7ce32`〜（`git log bb496b4..`）。push はリードが行う。

| コンセプト | 今回の変更 |
|---|---|
| 初見者が「これは何か」を知る | 最初の画面に README の 1 段落目・toolchain・ライセンス・remote が出る（生成後は §0 の文）。Reader が §2 間取り図と §3 の流れを SVG で描く。§4 は 0 tok の手順（m3e: Node ^22.12… → `npm install` → `npm run dev` → `localhost:3000`）。§5 に「読む順番」（入口 → 基盤の型 → ハブ → 機能の芯、行範囲付き）。地図の部屋名は生成名になり、popover に役割が出る |
| 専門家が細部を詰める | 選んだ文の出典だけを使い、出典の無い文が名指しするコードは定義を渡す（EX-03）。「AI に設計書を直させる（コードが正しい）」（EX-06）。却下・Undo した Fix の提案は閉じる（EX-05）。出典の無い事実文を数えて（crit 16 %）、「詳しい」で点線を引く（EX-04）。逆リンクの重複を直した。300 行を超えるファイルに目次を出す |
| 文書の一点 → AI がそこを直す・答える | Composer は開いた瞬間に打てる（NC-01）。`g` が消えない（EX-02）。静的な表の行は、その行のコードを AI に渡す（`@` 不要）。Review の主ボタンは「承認して検査 → 採用」 |
| 一度だけ読んだ成果物を失わない | 生成済み `.mitori/` を別パス・新しい home で開いても、module 章はスタブにならない（実 crit: 0 / 16。以前は 14 / 16）。`members` で分割を完全に復元する（EX-01） |
| 安全・非機能 | agent mode が追跡ファイルの秘密を伏せ字にする（F1）。出荷版が gate の sandbox を検出する（F2）。測っていない budget は理由が無いと check で失敗する（F4）。state DB は 0600（F13） |

**main で再確認したもの**（Apple M5 Max。他のセッションと同居していて、**ロードアベレージは 20〜55**）:

| 確認 | 結果 |
|---|---|
| `scripts/nd bun run check` | 緑 |
| `scripts/nd bun test`（全体） | 2,790 件中 **2,765 pass**、9 skip、5 todo、**11 fail はすべて時間の予算**（health 1 s、ELK 120 ms、`--version` 50 ms、GitReader 20 ms、SSE p99 5 ms、検索 1 ms、更新 10 ms、INT-02 50 ms、INT-06 の go vet 5 s、RSS）。単独で再実行して INT-02・INT-06・pack は通った。構造の更新経路は、同じ負荷で base `bb496b4` が 22.4 ms、現在が 13.9 ms（退行ではない） |
| `scripts/nd bun run build:bin` | `dist/mitori-darwin-arm64` 70.8 MB、`--version` 中央値 ≈ 50 ms（負荷下） |
| export e2e（`MITORI_E2E_CHANNEL=chrome bun run e2e --grep @export`） | **29 / 29** |
| web e2e（モック、`bunx playwright test -c e2e/web/playwright.config.ts --project=chromium`） | 79 件中 73 件が pass。6 件は失敗で、どれも **base `bb496b4` の web でも同じように失敗する**（地図の AC-J01 / J06、起動時の CLS ×3、streaming の CLS）。この suite は `ci:pr` に入っていない（F4 の残り）。NC-05 の新しい e2e は pass（base では失敗） |
| 最終デモ `test/int/shots/live.ts --engine fake` | 通過（`docs/progress/live.md` 冒頭、スクショは `docs/progress/final/`）。説明も修正も **`@` なし**で、設計書の表の行から始めた。gofmt・go test・go vet が pass、採用 810 ms、Undo 108 ms、コンソールエラー 0・4xx/5xx 0 |
| 実エンジンでの最終デモ | **未実施**。`claude` CLI がログアウト状態（`loggedIn: false`）。このパスの LLM 消費は **$0** |

### 0.1 残り（優先順）

1. **（要ログイン・実費小）** `claude /login` してから、実エンジンで 3 つ確かめる。
   - 最終デモ: `scripts/nd bun run build:bin && scripts/nd bun test/int/shots/live.ts --engine real --out docs/progress/final`（上限 $0.60、想定 $0.03 前後）
   - 修復ターン: `MITORI_LIVE=1 MITORI_MAX_USD=0.2 scripts/nd bun test test/int/int08.live.test.ts -t "3\."`
   - crit の S5 の再計測: `bench/measure/gen-real.ts --scope`、≈ $1.0
2. **生成の質（実エンジンが要る）**
   - EX-04 の残り: 出典の無い文を claim にするか、span を広げる。再試行率への影響を測ってから入れる。指標は `bench/measure/doc-uncited.ts`
   - NC-19〜21: 未解決の問いが mitori 自身に向く、設計判断が細部に寄る
   - gen.overview の「フロアプラン」→「間取り図」（`prompts.lock.json` が変わる）
   - 横断的な「変更の手引き」節
3. **判断が要る**: sandbox はループバックも遮断する（ADR-0013、`cr-requests/agent.md` #8）。出荷版が sandbox を使うようになったので、`httptest` を使う repo の go test は base でも head でも失敗し、⚠ になる。
4. **残った監査項目**（`audit-resolution.md` の「見送り」「一部」）
   - 初見者: 本文の全文検索と「AI に聞く」（NC-09）、§7 / §8 の静的事実（NC-10）、初回の既定を「初めて」と 5 分コースに（NC-08）、ヘルプの「この画面でできること」（NC-13）、EN 表示（NC-14）、読書パス（NC-15）、popover の 1 層化（NC-17）、地図の「文脈」ズーム（NC-04）
   - 専門家: Undo の後のコード列（EX-08）、Review の左の本文をアンカーしたブロックへ（EX-09）、履歴の UI と全 claim への ✓✓（EX-10）、trust toast の重なり（EX-11）
   - 非機能: 初期 JS の分割（F5、117.7 KB gz）、大きな節の分割配信（F6）、メモリ（F7）、pull 経路の範囲チェックと Undo（F8）、formatter の信頼 hash（F9）、見積りの固定分（F10）、agent の依存リンクと symlink（F1 の残り）、`ci:pr` の e2e/web と毎晩の perf（F4 の残り）
5. **前回からの残り**（§0a.3 のうち、まだ開いているもの）
   - アプリ内の書き出しダイアログ
   - スレッドがコード範囲を持たない問題（⤴ / ⧉ に候補が渡らない）
   - 4,800 行級のコンポーネントの中身
   - agent 周り: 初回入力の上限、`needs_more_context` のヒント、`FsStat` の ctime、Linux / bwrap、codex の agent mode、`maxWorktreesPerWs`
   - export viewer の予算に余裕が無い（58.75 / 60 KB）
   - 負荷に弱いテスト（上の 11 件）
   - 所有者のレビュー待ち: CR fin-1〜5 を含む（`packages/core/CR-LEDGER.md` §7）
   - 未着手: WP-17（Cloudflare 共有。**デプロイ前にユーザー承認必須**）、WP-18、Windows、Firefox / Safari 実機

---

## 0a. 前回の更新（仕上げパス 4 トラックを main に統合、2026-10-04。歴史）

ユーザーの「残っていること」（コード指定なしの Fix・Review ヘッダー・Composer の引用・提案 accept/reject・`mitori install`・
実エンジン未検証の項目）と「次の 3 手」（`@` なしの Fix の案内・実エンジンでの標準生成の再実行・エージェントモードと HTML エクスポート）を
4 トラック（`fin/export`・`fin/gen`・`fin/agent`・`fin/ux`）で並行して実施し、それぞれ「実装 → 敵対的検証」を通したうえで
**この順に `--no-ff` で main へ統合した**（統合者は push しない。push はリードが行う）。

| 統合 | 衝突・統合時の修正 |
|---|---|
| `fin/export` → `fin/gen` → `fin/agent` | 衝突なし。各マージ後に `bun install --frozen-lockfile`・`bun run check` 緑。`prompts.lock.json` は gen だけが変更（AC-40 で一致を確認） |
| `fin/ux` | `docs/design/briefs/INDEX.md`（生成物）だけ衝突 → `bun run contract:index` で再生成。export と ux が**同じ不具合**（`bun test` 下の gen-assets が NODE_ENV=test を継いで別ハッシュの開発版 bundle を作り ENOENT / viewer 予算超過）を別々に直していたので、`genAssets` 側の 1 か所（viewer も含む）に寄せた |

**統合後の main で再確認したもの**（Apple M5 Max、ロードアベレージ ≈ 11 の中で）:

| 確認 | 結果 |
|---|---|
| `scripts/nd bun run check` | 緑（tsc・biome・境界・CR 台帳・budgets・契約索引・svelte-check） |
| `scripts/nd bun test`（全体） | **2,716 pass / 0 fail**（9 skip = コーパス・replay・実エンジンの opt-in、5 todo）、278 files、240 s |
| `scripts/nd bun run build:bin` | `dist/mitori-darwin-arm64` 70.7 MB、`--version` 起動 中央値 36 ms（target 20 / limit 50 — 警告のみ）、web 資産 ok |
| `test/int/shots/live.ts --engine fake`（本物の UI を Chrome で、説明 → 修正 → 検査 → 採用 → Undo） | 通過。検査は **gofmt（autofix）・go test・go vet の 3 つ**（WP-08c の検出が入った）、採用 185 ms、Undo 106 ms、コンソールエラー 0・4xx/5xx 0 |
| export e2e（`MITORI_E2E_CHANNEL=chrome bun run e2e --grep @export`） | **29 / 29**（開発版）、**29 / 29**（`MITORI_E2E_BINARY=compiled`、統合後のバイナリ） |

この統合パスでの LLM 消費は **$0**。トラック側の実エンジン消費（API 換算、Max サブスク枠）: gen **$3.43**（上限 $4.00）、agent **$0.20**（run 1〜4）、
ux・export **$0**。**現在この環境の `claude` CLI はログアウト状態**（`claude auth status` → `loggedIn: false`）で、実エンジンが要る残り（下の 1）は
ユーザーの再ログイン待ち。

### 0a.1 ユーザーの依頼ごとの状態

| 依頼 | 状態 | 何がどう変わったか（根拠） |
|---|---|---|
| コード指定なしの Fix（412・ヒント無し） | **済** | 文の出典が自動で「対象コード」になる（router と同じ範囲）。出典が無ければ候補（表の行のコード参照 → 名前一致 → 全文検索 → 同じ節の近い出典）を 1 クリック / ⌥1–4 で選ぶ。何も無ければその場で `@` の指し方を案内。対象の無い Fix は見積りを要求しない（412 もコンソールエラーも出ない）。route 5 ms（go-small）〜 2–41 ms（crit）、`f` → 候補描画 34–86 ms。`docs/progress/ux.md` §1、`ux/ux-01,02,06,09.png` |
| Review ヘッダーが混む | **済** | ◆ はレビュータブだけ、レビュー中はドロワーボタンなし、block id は「詳しい」だけ、ゲート警告はピルの行に。`ux/ux-04-review.png`（+ dark） |
| Composer の引用に隣のセルが混ざる | **済** | 表のセルは選んだ文字列そのもの、段落は自分の段落の中だけ（UX-QUOTE-01） |
| 提案の accept / reject（501） | **済** | 本文中の提案差分（和文は文字・英数字は語単位）、SSE で即表示、単独の採用 / 却下、レビュー中ジョブの提案は Review でコードと一緒に。人の編集 route（`POST /doc/blocks/:block/edit`）も配線 = 共同編集の入口。`ux.md` §2 |
| `mitori install` | **済** | `/integrations` 一式、AGENTS.md ブロック 74 tok（上限 80）、SKILL.md ≤ 1,487 B（上限 1,500）、`claude plugin validate` 警告なし。`ux.md` §3 |
| 実エンジンでの標準生成の再実行 | **済（crit は一部未達）** | m3e-canvas: 再試行 **25 %**・1 回目 valid 91.5 %・L1 **93.0 %**・$0.69・最初の AI ブロック 3.2 s・見積誤差 −3 %（$）。crit: $1.65・再試行 33 %・L1 88.2 %（最終コードで記録を再生すると 16 % / 90.6 %、実エンジンでの再計測は未）。初見者理解テスト（m3e、10 問）: README 20 % → **mitori 50 %**（+30 pt）。29 + 25 claim を出典と突き合わせ、支持されないもの 0。`docs/progress/gen-quality.md`、生成物 `docs/progress/dogfood2/` |
| エージェントモード（WP-08c） | **済（実エンジン 1 項目のみ未）** | 複数ファイルの修正を side repo のワークツリーで（Read/Edit/Glob/Grep のみ、書き込み範囲のファイルごとに `Edit(//abs)`）、事後検査、検査ゲート（Go / JS・TS / Python / Rust の typecheck・test・lint を検出）、修復ターン ≤ 2（continuation → resume → cold）、昇格（patch → agent は上限内のみ自動、Opus は確認必須）、external patch。録画エンジンで INT-08 全経路（22 tests）。**本物の claude**: agent Fix（3 ファイル）入力 context 7.7k・**$0.048–0.053・17–21 s**、Request changes 3.9 s / $0.010、採用 154 ms、**並列 2 ジョブ**（別ファイルは完全に重なる、同じ行は `waiting_lock` → 2 本目採用で 409）。`docs/progress/agent-mode.md` |
| 修復ターン（実エンジン） | **未完** | run 4 で本物の claude への REPAIR continuation が走ったが、入力上限（4k）で止まった → 修正済み（回帰テストあり）。修正後の実エンジン再実行は CLI ログアウトで未実施 |
| HTML エクスポート（WP-13） | **済（アプリ内ダイアログのみ未）** | `mitori export --html [-o file\|dir] [--no-code]` と `GET /ws/:ws/export/html`。1 ファイル・ネットワーク不要・読み取り専用で Reader と同じ体験（目次・読者レベル・出典 peek・確かさバッジ・用語・図・⌘K・ダーク・EN）。viewer JS **58.75 KB gz**（予算 60）、crit 1.58 MB（`--no-code` 0.92 MB）を **0.41–0.65 s**、LCP 92–104 ms、秘密は伏せ字（fixture で 6 件・原文 0）、CSP で外部読み込み 0。Chrome + WebKit で確認。`docs/progress/export/README.md` |
| Linux | **未** | bwrap・watcher とも未実行 |

### 0a.2 コンセプトに対してどうなったか

- **一度だけ省トークンで読む → 読める設計書**: 0 トークンの静的文書（crit 1.05 s）+ 標準生成（m3e $0.69 / crit $1.65、L0 100 %）。初見者は README より +30 pt 理解でき、専門家が出典を開いて確かめても支持されない claim 0。
- **文書の一点にコメント → AI がそこに対応するコードを直す / 答える**: 文の出典がそのまま書き込み範囲になり（`@` 不要）、patch（1 ファイル $0.014）でも agent（複数ファイル $0.05）でも、採用は人が hunk ごとに・未コミットで・Undo 可。設計書側の変更は提案として本文に出て、人が採用 / 却下する。
- **初見者と専門家が同じ文書で**: 読者レベル（初めて / 標準 / 詳しい）、出典 peek、確かさバッジ。export でも同じ。
- **非機能**: 見積 → 上限 → 実績を全ジョブで表示、修復は会話の継続（増分のみ）、UI の楽観カード 26–44 ms。
- **ローカルファースト / 自分のエージェント**: ⤴ 自分のセッション（pull bundle）・`mitori install`（Claude Code / AGENTS.md）・MCP `submit_patch`。

### 0a.3 残り（その時点。解消したものは §0 で消した。まだ開いているものは §0.1-5）

- その時点の 1（実エンジンの確認）は §0.1-1、3（ループバック）は §0.1-3 に残る。
- 2（CLI がゲートの sandbox を検出しない）は **解消した**（F2）。
- 6 のうち、再 open で分割が変わる問題（#8）は **解消した**（EX-01）。「5 分で試す」が Node の版を落とす問題も **解消した**（NC-06）。
- 8 のうち、cite peek の行番号は export だけで、アプリ本体は未。

## 0b. 前回の更新（2026-10-04 再開後 — グループ B の取り込みと実機デモ。歴史）

引き継ぎ資料の §5.3 に沿って再開した。**グループ B の 8 ブランチのうち 8 本すべてが main に取り込み済み**（push 済み）。

| 取り込み | 備考 |
|---|---|
| dogfood / perf / 06b / 11 | 06b と dogfood で gen プロンプト版が衝突 → 統合結果に合わせて `prompts.lock.json` を再生成。planner テストのしきい値を固定（再試行込みの見積が 12.1 万 tok になったため） |
| structure | **バグ修正**: 入れ子の親モジュール（`packages/excalidraw` など）が再スキャンで ID/スラッグを失っていた（照合索引が「ファイル→1 コミュニティ」だった）。crit の最大モジュールは 35.7k → 9.0k 行、leaf 14 個。crit のモジュラリティ下限は暫定 0.35（仕様の 0.45 は [仮]、実測 0.356） |
| 08b | lint 修正のみ。**ただし `createLoop` ファクトリ本体は未実装**（部品は揃っている） |
| visual / 10b | 見た目はプロトタイプに大きく近づいた（生成カード・ヒーロー・Reader の表・ミニマップ。`docs/progress/m1/*.png`） |

main の状態: `check` 緑・テスト 2,440 pass / 0 fail。crit のコールドオープンは約 0.8 s（ロードアベレージが高いと 8 s 近く出るが退行ではない）。

**完了（main に取り込み済み）**:
- `createLoop` の組み立て + サーバー配線 + INT-06/07（`docs/progress/loop-wiring.md`）。
- **実機デモ**（本物の UI・daemon・`claude`）で 説明 → 修正 → gofmt ゲート → 採用 → Undo を通した（`docs/progress/live.md`、スクショ `docs/progress/live/`）。Explain 4.7 s / $0.009、Fix 7.9 s / $0.014、UI の楽観カード 26〜44 ms。実機で見つけた結合バグ（SSE の同一 rev 取りこぼし、空の ASK 送信、他）は修正済み。再実行: `scripts/nd bun test/int/shots/live.ts --engine fake|real`。

**その時点の「次にやること」**（1〜3 は §0a で済。4 は小規模版のみ — §0.1-2）:
1. Fix が `@` 指定なしだと何も書かずに 412 になる件の UX（ヒント表示 or 自動でコード候補を選ぶ）。
2. 本物のエンジンでの標準生成の再実行（dogfood のプロンプト修正後の品質確認。API 換算 $1〜3）。
3. WP-08c（agent mode・test gate・修復ターン）、WP-13（HTML export）、`mitori install` 配線、doc proposal の accept/reject ルート。
4. 初見者理解テスト（`docs/design/specs/testing.md`）。

以下の §2.2「退避ブランチ」表は停止時点の記録であり、現在は全て main にある。

---

## 1. プロダクト概要（1 分で）

**mitori（見取り図）** — リポジトリを一度だけ省トークンで読み、人が読める「設計書」を生成する。設計書の任意の箇所にコメントすると、**ユーザー自身の AI エージェント**（Claude Code / Codex）が最小コンテキストでコードと設計書を同時に直し、差分と費用を返す。ローカルファースト、日本語ファースト、Bun 単一バイナリ。

- 参考: lnkiai/m3e-canvas（設計→AI 向けプロンプト）、tomasz-tomczyk/crit（レビュー→エージェントへフィードバック）
- 差別化: 設計書アンカー型の閉ループ / 全 claim に出典と検証バッジ / 初心者〜専門家を 1 文書で / 費用の事前見積→上限→実績 / 日本語組版
- リポジトリ: `github.com/satoki252595/mitori`（private）

## 2. 停止時点の状態（歴史 — 現在は §0）

### 2.1 main（安定・push 済み）

| 項目 | 状態 |
|---|---|
| 最新 | `docs: handoff` コミット（この文書）。直前 `7b4bcba feat(core): CR batch 2` |
| ゲート | `scripts/nd bun run check` 緑 / `scripts/nd bun test` 2,144 pass・0 fail（約 2 分） |
| 完了マイルストーン | M0（土台・契約凍結）、M0.5（walking skeleton）、M1（0 トークンの見取り図）、M2 の大半（生成パイプライン・セッションエンジン）。詳細 `docs/progress/M1.md` |
| 動くもの | `mitori <path>` → daemon 起動 → S0〜S4 解析 → 静的設計書（間取り図・目次・facts 表・§4/§5/§6/§8/§11）をブラウザ表示（**0 トークン、crit 1,219 files で 1.05 s**）。⌘K、ライト/ダーク、ファイル保存→鮮度バッジ、生成の見積→実行→ブロック streaming（録画エンジンで検証済み）、`.mitori/` への書き出し（GitHub で出典リンクが効く）、`mitori gen --prep/--ingest` |
| 動かないもの（main では） | レビュー→AI 修正ループ（`createLoop` 未マージ）、Pull CLI（`mitori review` 等）、差分更新 S9、HTML export。初回起動で claude CLI が「見つかりません」になる（修正は track/dogfood にある） |

### 2.2 グループ B の退避ブランチ（未マージ・未検証）

各トラックは「実装 → 敵対的検証」の **実装段階の途中**で停止。検証エージェントは未実行。`wip(...)` コミットは停止時点の未コミット作業をそのまま保存したもの。

| ブランチ | 内容 | `bun run check` | 次の作業 |
|---|---|---|---|
| `track/dogfood` | **実エンジン生成の修正一式**: 初回 claude 検出（TOFU pinning）、**プロンプトが 2 回送られトークン 2 倍になるバグ修正**、プロセス残留修正、プロンプト @2〜@4、L1 検証改善、見積に再試行分を加算、`bench/measure/gen-real.ts` | ✅ | **最優先でマージ**（検証 → main）。gen-measure レポートは未作成（数値は §3.2） |
| `track/11` | WP-11 CLI 一式（review/bundle/reply/touch/open/check/digest/gen/install/mcp/config/export/usage/stop/doctor）、Pull hook、installer、MCP tools/list golden、進捗レポート | ✅ | 検証 → マージ。daemon 側の配線待ち項目はブランチ内レポート参照 |
| `track/06b` | WP-06b: S9 差分更新、on-demand、翻訳、M4 prompt 5 本、crit 40 commit replay テスト | ✅ | 検証 → マージ |
| `track/perf` | 増分 S2 facts、wasm モジュール共有、watcher の stat 判定・ディレクトリ削除、永続化の非同期化（+ wip: GitReader local） | ✅ | 検証 → マージ。gostd の時間/RSS 予算は再計測が必要 |
| `track/10b` | WP-10b レビュー UI（選択ツールバー・Composer・ジョブ/ready カード・Review パネル・Inbox）+ wip（遅延ロード化、e2e/loop） | ✅ | 検証（Playwright でスクショ確認）→ マージ |
| `track/visual` | 見た目の磨き込み（地図ラベル切れ、ヒーロー、生成カード状態、Reader の重複見出し・表、i18n）— **全部 wip**（53 files） | ✅ | 検証（スクショ比較）→ マージ |
| `track/08b` | WP-08b git 安全（side repo・snapshot・scope・accept/undo・gc）+ wip（gates・jobs・createLoop 相当） | ❌（tsc 未使用変数 1、biome 25） | 修正して検証 → マージ。**これがマージされるとレビュー→修正ループが動く** |
| `track/structure` | S3 のディレクトリ整合 leaf、パス名、module/repo skeleton、moduleContext、要約 + wip（cluster 調整・テスト） | ❌（biome 4） | 修正して検証 → マージ。巨大モジュール問題（crit で 35.7k 行が 1 module）の解消確認 |

推奨マージ順（依存と衝突の少なさ）: `dogfood` → `perf` → `structure` → `06b` → `08b` → `11` → `visual` → `10b`。マージ後に `packages/server/src/compose.ts` へ `createLoop`（08b）と 06b の入口を配線する（WP-INT の仕事。`docs/design/briefs/WP-INT.md`）。

## 3. 実測値（停止時点。最新の生成・agent・export の数字は §0a.1、監査後の数字は §0）

### 3.1 解析・UI（M1、Apple M5 Max、他エージェント稼働中）

| 指標 | 予算 target / limit | 実測 |
|---|---|---|
| 起動 → 最初の有用な画面（crit） | 3 s / 5 s | **1.05 s**（m3e 0.56 s） |
| S0〜S4 + 静的文書（crit） | 1.0 / 2.0 s | 0.80 s |
| 保存 → 鮮度バッジ | 50 ms / 1 s | go-small 30 ms、crit 80〜140 ms |
| 初期 JS（gz） | 60 KB 警告 / 150 KB | 83〜84 KB |
| バイナリ | 85 / 95 MB | 68.8 MB、`--version` 26.6 ms |
| gostd cold / peak RSS | 1.5 s / 1 GB（limit） | 2.0 s / 1.05 GB（**超過**、track/perf で対処中） |

### 3.2 実エンジンでの標準生成（track/dogfood、lean `claude -p`、Max サブスク、並列 3）

| repo | 所要 | 最初の AI ブロック | API 換算 | 入力（うち cache read） | 出力 | citation L0 / L1 |
|---|---|---|---|---|---|---|
| crit（65k 行） | 145 s | 2.7 s | **$1.32** | 828k（65%） | 37k | 100% / 84.8% |
| m3e-canvas | 94 s | 4.3 s | **$0.52** | — | — | — |

- 初回 run は「プロンプト 2 重送信」バグで CLI 実費 $3.88（台帳 $1.88）・子プロセス 33 本残留 → 修正済み（track/dogfood）。
- 課題: 行の再試行率 63%（費用の主因）、見積誤差 +84%（再試行分を見積に加算する修正は入った）、L1 が limit 85% をわずかに下回る。
- 生成された実物の設計書: `docs/progress/dogfood/{crit,m3e-canvas}/doc/*.md`（品質確認用）。

## 4. 既知の課題（停止時点の記録。1〜3 と 7 の WP-08c / WP-13 は解消済み。現在の残りは §0.1）

1. **レビュー→修正ループが main で動かない**（08b + 10b + 11 のマージと配線が必要）。MVP の「魔法の瞬間」はここ。
2. **モジュール分割が粗い**（crit で 1 module 35.7k 行、名前が `internal + cmd · CritJSON`）→ track/structure。
3. **間取り図の見た目**（ラベル切れ・空箱・常時出る「間取り図にできない構成」バナー）、ヒーロー/生成カード/Reader の表 → track/visual。
4. 生成の再試行率 63% と見積誤差（§3.2）。
5. gostd 規模の解析時間・メモリ超過、crit の鮮度バッジ 80〜140 ms。
6. Linux 未計測（watcher 方式 O3 含む）、Windows 未対応。
7. 未着手: WP-08c（agent mode・test gate・修復）、WP-13（HTML export）、WP-17（Cloudflare 共有、**デプロイ前にユーザー承認必須**）、WP-18（床面図）、公開ベンチ・初見者理解テスト。

## 5. 再開手順

### 5.1 環境

```bash
cd ~/work/20261002_aiAgentTool
scripts/nd bun install --frozen-lockfile   # nd = キャッシュ済み nix devShell で実行（nix develop は使わない）
scripts/nd bun run check                   # typecheck + biome + 境界 + CR 台帳 + budgets + svelte-check
scripts/nd bun test                        # 全テスト（静かな機械で約 4〜5 分、2,790 件）
scripts/nd bun run build:bin               # dist/mitori-darwin-arm64
./dist/mitori-darwin-arm64 <repo-path>     # ブラウザで見取り図が開く
```

- コーパス（ベンチ用 clone）はセッション一時領域にあった。再取得: `scripts/nd bun scripts/fetch-corpus.ts`（`bench/corpus.lock.json` の pin で shallow clone）。
- 実エンジン生成の計測: `.claude/skills/mitori-measure/`（`MITORI_LIVE=1` と `--max-usd` が無いと 1 円も使わない設計）。

### 5.2 ブランチの取り込み（コストを抑えたやり方）

1 ブランチずつ、手元で:

```bash
git checkout -b integrate/dogfood main
git merge --no-ff track/dogfood
scripts/nd bun run check && scripts/nd bun test
```

失敗したら原因をそのブランチで直してから main へ。08b / structure は lint エラーがあるので `scripts/nd bunx biome check --write <path>` と未使用変数の修正から。

### 5.3 推奨する次の一手（停止時点のもの。すべて済み — 現在の次の一手は §0.1）

1. **（ほぼ無料）** `track/dogfood`・`track/perf`・`track/06b`・`track/11` は check 緑。テストを通してマージ。
2. **（小）** `track/08b`・`track/structure` の lint 修正 → テスト → マージ → `compose.ts` に `createLoop` 配線 → INT-06（デモ台本: Explain → Fix → 採用 → Undo → `mitori review`）を録画エンジンで通す。
3. **（中）** `track/10b`・`track/visual` をスクショで確認してマージ。
4. **（中〜大、LLM 費用あり）** 実エンジンでデモ台本を 1 回（go-small、API 換算 $0.5 以下）。初見者理解テスト（`docs/design/specs/testing.md`）。

### 5.4 コストについて（今回の反省と次回の運用）

- 今回は ultracode（多数エージェントの並列ワークフロー）で進めた。サブエージェントの消費トークンはおおよそ: リサーチ 3.2M、設計 10.3M、M0 2.1M、グループ A 14.5M、グループ B（停止まで）数 M〜10M 規模。**設計フェーズの仕様が 2MB と過大**で、各エージェントの読み込みコストを押し上げた。
- 次回の目安:
  - 並列は 3〜4 本まで、検証は「失敗した受け入れ試験がある WP だけ」に絞る。
  - 定型作業は sonnet、opus は設計判断・セキュリティ・統合だけ。
  - 各エージェントは `docs/design/briefs/WP-xx.md`（≤ 12k token）だけを読み、spec 本文の全文読みを禁止する。
  - 実エンジン生成は 1 repo あたり API 換算 $0.5〜1.5（サブスク枠から消費。継続的な課金増は無し）。
- 継続費用: **0 円**（Cloudflare 未デプロイ、GitHub Actions は push トリガー無し・未実行）。

## 6. ドキュメント地図

| 何を知りたいか | どこ |
|---|---|
| 調査の結論（競合・数値・方針） | `docs/research/00-synthesis.md`（Critic addendum を含む） |
| アーキテクチャ・判断 | `docs/design/ARCHITECTURE.md`、`docs/design/adr/0001〜0014` |
| 作業分割・受け入れ試験・所有ディレクトリ | `docs/design/MILESTONES.md`、各 WP の要約 `docs/design/briefs/WP-xx.md` |
| 仕様の優先順位 | 契約（`packages/*/src/contract.ts`、`packages/core/src/{domain,api}.ts`）> `docs/design/REVIEW-LOG.md` > ARCHITECTURE/ADR > `docs/design/specs/*.md`（各 spec 冒頭「改訂 R1」が本文に優先） |
| 契約変更の台帳 | `packages/core/CR-LEDGER.md`、未処理の要望 `docs/design/cr-requests/` |
| UI の正解（目標の見た目） | `docs/design/prototypes/editorial/`（index.html + shots）、統合仕様 `docs/design/prototypes/JUDGEMENT.md` §6 |
| 監査とその解決（現在） | `docs/progress/audit-{newcomer,expert,nonfunc}.md`、件ごとの判定 `docs/progress/audit-resolution.md`、最終デモ `docs/progress/live.md` 冒頭 + `docs/progress/final/` |
| 進捗・実測 | `docs/progress/M1.md`、`docs/progress/m1/*.png`、`docs/progress/dogfood/`、ループ配線 `loop-wiring.md`、実機デモ `live.md`、生成品質 `gen-quality.md`（生成物 `dogfood2/`）、agent mode `agent-mode.md`、レビュー UX `ux.md`（`ux/*.png`）、HTML export `export/README.md` |
| 開発コマンド・規約 | `CLAUDE.md`、`.claude/skills/{mitori-check,mitori-bench,mitori-measure,mitori-release-build,mitori-export}` |

## 7. 守るべき約束（設計で決めた安全側の既定）

- エージェント起動は lean flags 必須（`--setting-sources ""`/`--strict-mcp-config`、stdin でプロンプト、`--system-prompt-file`、`--no-session-persistence`、完全なモデル ID）。**対象 repo の project 設定・hook を読ませないのはセキュリティ境界**（invariants I1〜I14、`packages/agent`）。
- サブスクで `claude -p` を使う扱いは 2026 年に 3 回変わっている（ADR-0005）。並列は既定 3、無人ループなし。
- ユーザー repo の refs/objects/worktree には書かない（side repo、ADR-0012）。accept は未コミットで作業ツリーへ + checkpoint で Undo。
- `fixtures/repos/{injection,secrets}` には**意図的な偽の秘密情報**がある（スキャナ試験用）。
- Cloudflare リソースは `mitori-` 接頭辞。**デプロイ・Paid 化は事前承認**。
