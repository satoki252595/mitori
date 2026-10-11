# 残課題の続行・検証記録（2026-10-11）

今回の変更と測定をまとめる。修正後head98c59a6のUbuntu CIは成功、Windows対象はhead23645fdで成功。Mac attempt6も既存guardを通過し、browser380pass / 14skip / 0fail、共有2pass、a11y8passが成功した。[PR #13](https://github.com/satoki252595/mitori/pull/13)は2026-10-11T11:16:43Zに通常merge `df014912ee7e31ac62c4ca50c846d396aeec9dff` でmainへ統合し、資料branchもローカルmainへ通常merge `bdcebaf` で取り込んだ。統合時main `bdcebaf` はoriginへpush済み。作業branch `codex/finish-remaining-20261011` と `codex/verification-docs-20261011` はともにlocal / remoteから削除済み。[CI記録](ci.md)。旧headの5失敗と後続guard停止は履歴へ保持し、過去の失敗を後の成功値で置き換えていない。

開発・検証はプロジェクトのNixと `scripts/nd`。通常利用は既存Bun / Git / LLMを使える方針を維持する。Dockerは利用者が許可した既存Linux検証ハーネスだけ。今回の実LLMはCodexと取得済みLM Studioで、Claudeは使用していない。Cloudflareへのデプロイはcloneしてローカル利用するための必須条件に含めない。

## 現在の判定

後続の[PR #14](https://github.com/satoki252595/mitori/pull/14)も2026-10-11T12:28:11Zに通常merge `6d892ea8be7976d4095eb2bfe8c1bbf8e346f545` でmainへ反映した。prewarm・F10・F14・export事前検証と再確認条件の修正を含む。Ubuntuは修正head b74d4faでunit3,042pass / 0fail、golden109pass / 0fail、全20semantic / 0cached / 0errors、fixtures・size・Linux binary成功。Macは初回NOISY停止後、同headのattempt2 / 3もquiet / AC・factor1.172012 / 1.195410で較正guard停止、browser・共有viewer・a11y未確認。通常端末起動でも解消しなかった。対象回帰・Ubuntu全体・配布binary確認を根拠に統合した。merge treeと検証headのtreeは一致し、作業branchをlocal / remoteから削除、元のrunnerサービスを復元した。[CIの全経緯](ci.md)。

2026-10-12 JST時点では[PR #15](https://github.com/satoki252595/mitori/pull/15)は通常merge `e34178c` でmainへ統合済み。source `89f228ea300dd1dd4211b32488042993a75e3235` のWindows後続検証と最新headのUbuntu CIが成功した。Mac全suiteの未確認と他の未達は維持する。

| 項目 | 確認できたこと | 残る確認・限界 | 証拠 |
|---|---|---|---|
| Codexでの実生成 | Jevの対象2節とm3eの対象moduleをNix経由で生成。修正後はterminal usage / exit 0を取得 | 引用窓のL1 failが残る。全文・全OSSの再生成成功は主張しない | [quality.md](quality.md) |
| Codex Explain / Nix・通常ローカル | go-smallで各1 application jobがdone、各引用1件有効、元source不変、後始末成功 | API相当合計$0.007274。課金先・サブスク枠は未確認 | [codex-explain.json](codex-explain.json) |
| LM Studio Explain / Nix・通常ローカル | 取得済みQwen GGUFで各1 HTTP推論がdone、各引用1件有効、source不変、追加費用$0。専用モデル解除・既存server維持を確認 | 短いExplainのみ。CLI指定4096と実load報告262144の不一致は未解決 | [lmstudio-explain.md](lmstudio-explain.md) |
| Codex並列生成の予算予約 | shared preflightで送信直前に合算判定。途中本文・usage保持と同額resumeを対象37tests / 224 assertionsで確認 | API換算の推計上限。hidden reasoningを含む実請求の厳密capではない | [codex-budget.md](codex-budget.md) |
| 本人環境の外部MCP | Codex / Cursor / Grokはproject設定、Antigravity 2.12.2は共通設定で各8ツールの接続を確認。Codexは子プロセスだけのplugin無効化と既存4設定の無効化で再確認。LLM要求・MCPツール実行・追加LLM費用0 | 初回Codex override失敗とAntigravityのproject設定の制約を保存。4外部セッションからの文書生成は未実行 | [実設定の確認](../startup-matrix-20261007/README.md) |
| Linux cold check | testkitの既存home subpathへimportを絞り、全20semantic診断を維持。ARM同条件ABBAは4回ともhard limit内 | soft targetは未達、統合headのUbuntu x64 CIでの確認は別 | [cold-home.md](cold-home.md) |
| Go7k cold scan | Node.type再取得削減に加え、Super / Performance全tierの検出を修正。新旧ABBAは19.45%短縮・全3表hashとcounters一致。新8Workerの正式caseは前後quiet / AC・reference内、warmup1 / measured5で中央値1,694.155083ms、p951,806.187875ms | **hard limit1,500msはFAIL（exit1）**。旧6Worker正式値1,980.096958msは履歴として保持。GoのRSS増加とReact中央値986.688MiB / 上限1000以内 / 目標700MiB WARNも保持 | [全性能tierと最新正式測定](idx-performance-tiers.md)、[先行採用](idx-type-local.md)、[先行正式測定](idx-formal.json) |
| 初回parse準備 | lazy poolのsize0でprewarmが送られない原因を1行修正。回帰6pass / 20assertions、ABBAで3表の全行hash・coverage・counters一致 | 終了較正factor1.124994が基準外。後続正式試行も事前factor1.130491でscan0回。全体速度の改善・hard limit合格は未証明 | [原因と比較](idx-prewarm.md) |
| F10の実績較正 | 既存ledgerをexact profileで見積りへ接続。対象40pass、保守floor・USD cap・confidence25維持 | 既存EMAは保持。実精度・実請求の保証なし | [較正の確認](ledger-calibration.md) |
| F14のCLI案内・終了処理 | 既存help接続、自身が起動したdaemonだけ終了対象。後接続・作業中は同期idle guardで維持。対象回帰・統合check成功 | 起動者のPID同一性を証明できない環境では停止しない | [終了処理の確認](cli-lifecycle.md) |
| UI / assets / a11y | 読書位置修正後のcompiledはstrict asset全項目pass・初期JS54.697KB gzip。最新正式scanSummaryはquiet / AC・3run / warmup1で中央値1,615.700ms、hard limit2,000ms合格 | target1,000msはWARN。旧1,771.5ms / factor1.12のreport-onlyは履歴として保持 | [最新assets](reader-fix-assets.json)、[先行UI記録](ui-bench-release.md) |
| Mac正式CI | head98c59a6 / attempt6はbrowser380pass / 14skip / 0fail、共有2pass、a11y8pass。統合後main35d897dでも独立した共有2pass / 37 assertionsとa11y8pass / 違反0を確認 | 後続PR #14 / #15 / #16の全browser CIはNOISY / 較正guard停止で未確認。独立した共有 / a11yの成功へ置き換えない。元のrunnerサービスは復元済み | [CI記録](ci.md) |
| Windows | head89f228eaのNix crossbuildと実Windowsで選択14pass / 109 assertions。Git / shadowのcold export永続化・所有daemon後始末、scan親終了後の存続・export再利用・明示stop、製品`--version`とembedded / standalone selftest6checksが成功 | 対象経路の検証。Windowsの一般全経路・実LLM互換性を意味しない。先行head23645fdの7passも履歴に保持 | [最新Windows CI](https://github.com/satoki252595/mitori/actions/runs/38149209280)、[windows-nix.md](windows-nix.md)、[windows-env.md](windows-env.md) |
| 実ブラウザ操作 | 実Chromeの初回map、確定日本語検索、Codex native/MCP切替と配布binaryの接続commandを確認。続行時はnative Chrome操作も許可され、最新binaryの無料デモを本人確認用に準備 | nativeキー入力もASCIIのままで実IME変換は未確認。本人操作結果待ち。Safari実機はChrome代替の選択により必須外 | [chrome.md](chrome.md) |

## Codexの実生成とExplain

生成は `codex-cli` / `gpt-6.1-sol` / effort high。隔離したauth/config、空cwd、tool / network無効のlean profileで、対象OSSのhook / settings / toolを引き継がない。Jevはhistory記録 → observe → page_changed、60操作 / 120 prediction decision requests / scroll・wait追加前の250 DOM candidatesを本文へ回復した。m3eは条件付き変更先、4言語、typecheck / test / buildと、省略寸法を既定値で補う説明を保持した。

最新m3eの1回はinput32,788 / output4,476（うちreasoning1,879）、API-equivalent $0.110336。対象の既定値説明はL0 / L1 / L2 pass。一方、module全体はL1が28pass / 2fail / 8vacuous。Jev品質節もL1が22pass / 1fail / 2vacuous。残る3箇所はsource照合では意味が一致するが、別ファイル名や識別子を裏づける引用窓が弱い。検証器は緩めず、[引用窓の照合](quality.citation-review.json)へ残した。

生成検証の累計は、停止した初回2callsの保守推計を含みAPI-equivalent **$0.792490**（native7calls、terminal usage5calls / 推計2calls）、総枠$2内。raw prompt / argv / auth / envはGitへ保存していない。保存済みOSS docにhuman-locked blocksが0件だったため、実OSSでlocked本文の保持を確認済みとは扱わない。既存apply / replayの対象回帰は成功した。

Nix Explainは `gpt-6.1-sol` / effort low、cap$0.05 / output600 / timeout120秒で実行。run5.012秒、application job1件がattempt1でdone、terminal reported input1,582 / output47、API-equivalent **$0.003634**。既存ローカルBun 1.4.2でもrun4.334秒、1 job / attempt1 / done、input1,585 / output47、**$0.003640**。両経路とも引用1件が有効、source不変、daemon / fixture / homeの後始末が成功し、API相当合計**$0.007274**。元harnessの誤ったLLM呼出数カウンタは採用せず、[両経路の証跡](codex-explain.json)へapplication jobsとterminal usageを記録した。これらは請求額の実測やサブスク枠の保証ではない。

引用入力修正後の追加実生成2回はAPI換算保守$0.416844 / 見積枠$0.50で本人の費用承認待ち。ChatGPT認証とAPIキー未設定を確認したが、`credits.hasCredits:true` のため有料credit消費がない保証はできず、$0.50も実請求の上限ではない。今回の統合作業でnative呼出は0。

## 採用した変更と不採用の実験

Linux cold checkではloopのtestkit root importを既存home / fixtures / goldenへ分けた。loopのroot147件とtestkit公開71名は維持し、読み込むworkspace sourceが226→161件、gen sourceが50→0件になった。gen自体は全20projectの意味検査に残る。ARM・2CPUのcold ABBAはwall中央値28.36→27.085秒（4.50%短縮）、較正後中央値10.64%短縮。4回とも20semantic builds / 0cached / 0errors・全7項目成功。対象回帰は重複除外で69pass / Linux限定3skip / 0fail。[先行fixture案](cold-check.md)は速度改善を実証できず不採用のまま。

Go7kでは凍結した同一source・新process / 空homeで12runを比較し、blobs6,490行 / symbols133,602行 / skeleton11,997行が全行一致した。256KiB batchは速度13.54%悪化で不採用。GC前の参照解除はsandbox8Workerで0.59%、通常Mac6Workerで4.93%短縮したが未採用。sandbox内のsysctl拒否がWorker数を変える差も記録した。先行比較は既存quiet閾値を超え、較正未計測なのでabsolute gate成功とは扱わない。後続の既存正式caseは通常Mac / Nixで既定warmup1＋measured5を1 invocation実行し、中央値3,872.33ms / p954,776.41ms。待機後もload16.55、factor1.902929でreport-only、scaled limit2,854.39msにも超過。全6childのcoverage・6Worker・cache0を維持し、RSS中央値985.14MiB。当時は追加測定・候補適用をせず未解決として残した。[先行正式case](idx-formal.json)。

旧6Workerの正式 `idx.s01.cold.7kfiles` はsource `bdcebaf1aa97525bc86722cbf4f4cbf508bfa083`、warmup1 / measured5、quiet / AC、factor1.037243379882442で中央値1,980.096958ms。hard limit1,500msは未達だった。上のNOISY / report-only測定と採用ABBAもそれぞれ履歴として保持する。

最新8Workerの正式caseはsource `a8cadad800a0b71265c5ccff5a90fcde3b01164c`、warmup1 / measured5、開始前load6.701172 / quiet / AC・factor1.0033811104106738、終了後load8.081055 / quiet / AC・factor1.0870683419986469。中央値1,694.155083ms / p951,806.187875msで、hard limit1,500msはFAIL・exit1だった。全6childで8Worker / cacheHits0 / filesParsed6,539 / degraded2 / files7,687 / included6,009。前後reference内の正式結果であり、較正未計測の採用ABBAと分ける。[正式結果とsanitized証跡](idx-performance-tiers.md)。

後続helper候補のABBAもquiet / reference内（before1.078238 / after1.073405）で完了。baseline中央値1,853.212792msに対し候補1,849.252792ms（0.214%）で、3表の全行hash・counters・coverage・6Workerは一致したが、速度の採用根拠はなく未採用とした。

main ecf20d0で追加のCJK早期終了とGo refs2pass候補も確認した。前者は全corpusのhelper CPU約31msだけの差。後者は対象33tests成功・3表全行hash一致だが、baseline範囲内の4.45%差でquery CPU / RSS低下なし、前後ともNOISY・較正基準外だった。両方不採用、最新正式1,500ms未達を保持する。[追加候補の判断](idx-cold.md)。

head63e23b0の単独API診断では同じ言語へのsetLanguage呼出しと省略guardを比較した。各warmup1,000 / measured8,000で0.381750 / 0.016916ms、6,490ファイルの直列推計差は約0.296msだった。正式目標との差480.097msを解消する根拠にならず不採用とし、製品変更・追加scanは行っていない。実scanや正式時間の比較には使わない。[小差の不採用記録](idx-cold.md)。

main85aabcfのprivateコピーでは抽出phaseを追加計時し、query処理の約91%がWASM側と確認した。2回とも3表全行hash・coverage・診断・countersは一致したが、較正未確認の計時付き診断で、正式速度やbefore / after比較には使わない。大幅短縮を裏づける安全なquery削減案は得られず、製品は変更していない。[phase診断](idx-cold.md)。契約枠だけを使うCodex設定も公式一覧とCLI helpからは確認できず、追加実生成2回は既存の費用確認を待つ。[公式仕様の確認](quality.md)。

PR #14のMacだけを再実行した後続attempt2 / 3はquiet / ACだったが、factor1.172012 / 1.195410で較正guard停止。前回成功した通常端末起動でも解消しなかった。browser・共有viewer・a11yは未実行、Ubuntuは再実行せず成功を継承。元のrunner常駐起動を復元済みで、Mac全suite未確認を維持する。[後続CI](ci.md)。

UIは初回nonce競合、仮想化アンカー、節移動でのengine再検出、初回statusの先取り競合、lazy chunkとprecompressionを修正した。strictの上限・件数・診断は維持し、先行compiledはgen6.890 / limit6.900KB、palette4.516 / 4.600KBと余裕が小さい項目も残す。Readerの実click→paintはnative65.2 / 31.7 / 32.1ms、enhanced31.9 / 32.0 / 16.1ms。修正前のscanSummary3,312.1 / limit2,000msと、先行compiledの1,771.5msを保持する。後者はfactor1.12でreport-onlyのため正式基準機合格へ読み替えない。[先行UI記録](ui-bench-release.md)。

最新のcompiled `ui.scanSummary` 正式測定は同source `bdcebaf1aa97525bc86722cbf4f4cbf508bfa083`、binary SHA-256 `8d1f22762b6b56d9eae7181e61a144b1d8e607f1ff84808b9d9673d51387deb7`。quiet / AC、factor1.0293374645265196 / after1.0867728003515473、warmup1 / measured3で測定値は1,767.800048828125 / 1,615.7001953125 / 1,577.099853515625ms、中央値1,615.7001953125ms。hard limit2,000msは合格、target1,000msはWARN。compiled scanSummaryの正式検証待ちは解消し、先行1,771.5msのreport-only結果も履歴として保持する。

WindowsはNix-built EXEを `BUN_BE_BUN=1` で再利用し、Windows用Bunの別ダウンロードを廃止した。[初回native run](https://github.com/satoki252595/mitori/actions/runs/38096491256)は5pass / 1fail。exact environmentだけが失敗し、引数 / stdio / 終了コードと子孫停止は成功した。環境「名」だけを渡すプロトコルで、Job Object経由の子へ明示した変数だけを渡す修正を実装した。既存native4ケースを維持し、portable protocol test1件と空値・非ASCII環境を追加。Nix crossbuild、Mac対象19pass / Windows限定4skip、platform型検査・整形は成功。[前回CI](https://github.com/satoki252595/mitori/actions/runs/38112767631)は525260dで7pass / 0skip / 0fail・33 assertions・4.38秒、selftest6checks成功。[先行Windows CI](https://github.com/satoki252595/mitori/actions/runs/38115528185)は `23645fdc7100e02e5f6b63bbbde2b33c59b1c79f` でcrossbuild / nativeとも成功し、同じ7pass / 0skip / 0fail・33 assertions・4.20秒、製品`--version`とembedded `_selftest` 6checks成功・2,606.378msだった。製品EXE SHA-256は `3e1d25c49fbb36b5974a4ec6036a3d9bc8ebcb81cc21d8d078b85143cf189e04`、API / 実ログ / artifactを照合済み。このheadの成功は先行検証として保持し、後続変更の結果へ流用しない。

全子プロセスの明示環境とCLI起動・終了処理の修正後、source `89f228ea300dd1dd4211b32488042993a75e3235` の[run38149209280](https://github.com/satoki252595/mitori/actions/runs/38149209280)はNix crossbuild job114498898080 / Windows native job114499464069とも成功した。native3ファイルは12pass / 0fail・73 assertions・18.26秒。Git / shadowのcold exportはHTMLと正しい保存先のdoc.index.jsonを永続化し、自身のregistryを削除した。shadowでは対象repoに.mitoriを作らない。scan親CLI終了後のdaemon存続、exportによる同一daemon再利用、明示stopも成功した。別filterのWindows project guardは1pass / 15 assertions、doc pathsは1pass / 21 assertionsで、合計選択14pass / 109 assertions。製品`--version`とembedded / standalone `_selftest` の6checksもすべて成功、total4,784.7962msだった。実ログは2026-10-11T15:00 UTC台（2026-10-12 JST）。Windowsの一般全経路・実LLM互換性まで確認したとは扱わない。

## PR #16の追加統合

性能tierの修正を通常merge `b8f2dca` でmainへ統合・pushし、作業branchをlocal / remoteから削除した。source `0ac54f0` のUbuntuは再実行でunit3,047pass / 0fail・golden109pass / 0fail、全20semantic・0cached・0errors、fixtures・size・Linux binary成功。Macはfactor1.101552で開始前停止。Go ABBAの改善と正式未達は分けて保持する。[性能比較](idx-performance-tiers.md)、[CI](ci.md)。

## 次の確認

旧監査の再照合で見つけたF10の実績較正とF14のCLI help・export終了処理はPR #14でmainへ通常統合した。初回全unitで見つけた再確認条件の回帰も修正し、既存fixture不変で修正前失敗・修正後成功とUbuntu全体成功を確認した。

1. 本人による実Chrome日本語IMEの変換確定Enter / 次のEnterを確認する。compiled scanSummaryの正式検証はhard limit合格で完了し、target WARNは保持する。
2. Go7kの最新8Worker正式中央値1,694.155083msはhard limit1,500msに対してFAIL。旧6Worker正式値1,980.096958ms、helper候補0.214%差の未採用、setLanguage省略候補の推計約0.296msの未採用は履歴として保持する。Jev / m3eは引用用import入力と共通verdictを修正し、追加実生成2回の費用承認待ち。有料creditを使わない保証はできず、API換算$0.50も実請求の上限ではない。
3. PR #16の後続Mac job114512014975はquiet / AC・factor1.087611で実行し376pass / 14skip / 4fail。Escapeの固定時間待機を既存camera安定判定へ置き換え、対象8件と全7checkは成功した。Chromium時間予算3件を含む修正後全suiteは再確認待ち。旧guard停止とPR #13成功を別履歴として保持する。
4. 外部4クライアントの本人環境MCP接続は各8ツールで確認済み。4外部セッションからの文書生成・取り込みは未実行で、Codex native生成と区別して残す。

利用者の対応待ちは実IME確認と追加実生成2回の費用承認。任意providerを使う場合はその本人認証が必要。LM Studioは既存モデルの読込と実回答を今回確認し、検証後に専用モデルだけ解除した。利用時は本人のモデルを読み込む。Codexは今回ログイン済みで、認証待ちではない。Claudeのログインを今回の続行条件にしない。Safari実機とCloudflare公開は今回の必須条件から外れている。

## 最終統合の追記

- 旧source `bdcebaf` の正式時間測定を履歴として保持。Go7kの旧6Workerはquiet / AC・factor1.037243 / warmup1＋5runで中央値1,980.096958ms、hard limit1,500ms未達だった。compiled scanSummaryは同binary SHA `8d1f2276…`、quiet / AC・factor1.029337 / after1.086773 / warmup1＋3runで中央値1,615.700ms、hard limit2,000ms合格・target1,000ms WARN。先行のreport-only結果は上書きしない。
- Mac attempt6 / job114455888859はload6.19384765625・quiet / AC・待機0、factor1.017953727365694で既存guardを通過。browser380pass / 14skip / 0fail（4.5分）、共有2pass / 0fail、a11y8pass（7.9秒）の3stepすべてが成功した。同じNix固定runnerのforeground較正Bunはps PRI31、LaunchAgent配下では4だったが、厳密なQoSや根因は未確定。上限・referenceは変更せず、検証後は元の同じplistでサービスを復元した。旧失敗とguard停止も保持する。[CI記録](ci.md)。
- 先行Go候補とは別に、同一Node.typeのWASM再取得を減らす最小変更を後続で採用した。quiet / AC・較正before1.010 / after1.077のABBAで中央値2,232.14→1,994.58ms（10.64%短縮）、抽出3表の全行hash、coverage、診断、6Workerが一致。1,500ms目標は未達。[比較の全結果](idx-type-local.md)。
- 通常の既存Bun 1.4.2でもCodex Explainが1 job / attempt1で成功。API相当$0.003640、引用1件有効、source非変更、停止と一時データ削除を確認。Nixと合計$0.007274、課金先・請求額は不明。[両経路の証跡](codex-explain.json)。
- 先行compiled UIは初期JS54.639KB gzip、CSS18.100KB、strict asset全項目成功。scanSummary1771.5ms / limit2000ms、Reader6requests。時間はfactor1.12でreport-only、正式reference合格とは扱わない。a11y8成功・違反0。[先行UI記録と正式後続](ui-bench-release.md)。
- 実Chromeで初回map、確定済み日本語検索、Codex native/MCP切替と配布binaryの接続commandを確認。実IME変換は操作許可が拒否されたため本人確認待ち。[Chrome記録](chrome.md)。
- 統合checkは初回tscだけtest fixtureの不足で失敗。fixtureを直しtscのみ再実行成功。費用予約の最終修正後にも全7stepが4.35秒で成功した（warm）。先行Ubuntu実装head CIも再実行で成功し、全20semantic builds・0cached・0errors、unit3,017pass / 134skip / 4todo / 0fail、golden109pass / 4skip / 0fail、fixtures verify・size・Linux binary buildとversion成功。[CI記録](ci.md)。
- 費用予約修正後のMac配布binaryを再build。SHA-256 `6ce44b0863bc1f805329d437dd3565d8249aea2086d54125c6895138f6415da7`、70,565,490 bytes。embedded selftest全6checks成功（1,049ms）、[strict assets](final-assets.json)成功で初期JS54.639KB gzipを維持。Chrome・時間計測の先行binaryのSHAと混同しない。
- 引用入力・Go Node.type・読書位置の修正後にも統合check全7step成功（4.18秒、warm）。再buildしたMac binaryのSHA-256は `8d1f22762b6b56d9eae7181e61a144b1d8e607f1ff84808b9d9673d51387deb7`、embedded selftest全6checks成功（1,075ms）。[strict assets](reader-fix-assets.json)も全項目成功、初期JS54.697KB、gen6.886 / limit6.900KB、palette4.520 / limit4.600KB。
