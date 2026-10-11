# 残課題の続行・検証記録（2026-10-11）

今回の変更と測定をまとめる。修正後head98c59a6のUbuntu CIは成功、Windows対象はhead23645fdで成功。Mac attempt6も既存guardを通過し、browser380pass / 14skip / 0fail、共有2pass、a11y8passが成功した。[PR #13](https://github.com/satoki252595/mitori/pull/13)は2026-10-11T11:16:43Zに通常merge `df014912ee7e31ac62c4ca50c846d396aeec9dff` でmainへ統合し、資料branchもローカルmainへ通常merge `bdcebaf` で取り込んだ。統合時main `bdcebaf` はoriginへpush済み。作業branch `codex/finish-remaining-20261011` と `codex/verification-docs-20261011` はともにlocal / remoteから削除済み。[CI記録](ci.md)。旧headの5失敗と後続guard停止は履歴へ保持し、過去の失敗を後の成功値で置き換えていない。

開発・検証はプロジェクトのNixと `scripts/nd`。通常利用は既存Bun / Git / LLMを使える方針を維持する。Dockerは利用者が許可した既存Linux検証ハーネスだけ。今回の実LLMはCodexと取得済みLM Studioで、Claudeは使用していない。Cloudflareへのデプロイはcloneしてローカル利用するための必須条件に含めない。

## 現在の判定

| 項目 | 確認できたこと | 残る確認・限界 | 証拠 |
|---|---|---|---|
| Codexでの実生成 | Jevの対象2節とm3eの対象moduleをNix経由で生成。修正後はterminal usage / exit 0を取得 | 引用窓のL1 failが残る。全文・全OSSの再生成成功は主張しない | [quality.md](quality.md) |
| Codex Explain / Nix・通常ローカル | go-smallで各1 application jobがdone、各引用1件有効、元source不変、後始末成功 | API相当合計$0.007274。課金先・サブスク枠は未確認 | [codex-explain.json](codex-explain.json) |
| LM Studio Explain / Nix・通常ローカル | 取得済みQwen GGUFで各1 HTTP推論がdone、各引用1件有効、source不変、追加費用$0。専用モデル解除・既存server維持を確認 | 短いExplainのみ。CLI指定4096と実load報告262144の不一致は未解決 | [lmstudio-explain.md](lmstudio-explain.md) |
| Codex並列生成の予算予約 | shared preflightで送信直前に合算判定。途中本文・usage保持と同額resumeを対象37tests / 224 assertionsで確認 | API換算の推計上限。hidden reasoningを含む実請求の厳密capではない | [codex-budget.md](codex-budget.md) |
| Linux cold check | testkitの既存home subpathへimportを絞り、全20semantic診断を維持。ARM同条件ABBAは4回ともhard limit内 | soft targetは未達、統合headのUbuntu x64 CIでの確認は別 | [cold-home.md](cold-home.md) |
| Go7k cold scan | Goの同一Node.type再取得を減らす変更を採用。最新正式5run / warmup1はquiet / AC・factor1.037243379882442で中央値1,980.096958ms | **hard limit1,500msは未達**。先行ABBAの10.64%短縮・全行hash一致も保持 | [採用変更](idx-type-local.md)、[先行不採用](idx-cold.md)、[正式測定の前後](idx-formal.json) |
| UI / assets / a11y | 読書位置修正後のcompiledはstrict asset全項目pass・初期JS54.697KB gzip。最新正式scanSummaryはquiet / AC・3run / warmup1で中央値1,615.700ms、hard limit2,000ms合格 | target1,000msはWARN。旧1,771.5ms / factor1.12のreport-onlyは履歴として保持 | [最新assets](reader-fix-assets.json)、[先行UI記録](ui-bench-release.md) |
| Mac正式CI | head98c59a6 / attempt6はquiet / AC・factor1.017953727365694でbrowser380pass / 14skip / 0fail、共有2pass / 0fail、a11y8pass | 同じNix固定runnerのforeground実行で成功。LaunchAgent配下との実子priority差は観測したが、厳密なQoSや根因は未確定。元のサービスは復元済み | [CI記録](ci.md) |
| Windows | head23645fdのNix crossbuildと実Windowsのsource tests7pass / 0skip / 0fail（33assert / 4.20s）、製品`--version`とembedded selftest6checksすべて成功 | verified Job Object経路の対象検証。非group直接Bun.spawnには標準環境変数の補充が残る | [最新Windows CI](https://github.com/satoki252595/mitori/actions/runs/38115528185)、[windows-nix.md](windows-nix.md)、[windows-env.md](windows-env.md) |
| 実ブラウザ操作 | 実Chromeの初回map、確定日本語検索、Codex native/MCP切替と配布binaryの接続commandを確認 | CDPの実IME送信が操作許可で拒否され、本人確認待ち。Safari実機はChrome代替の選択により必須外 | [chrome.md](chrome.md) |

## Codexの実生成とExplain

生成は `codex-cli` / `gpt-6.1-sol` / effort high。隔離したauth/config、空cwd、tool / network無効のlean profileで、対象OSSのhook / settings / toolを引き継がない。Jevはhistory記録 → observe → page_changed、60操作 / 120 prediction decision requests / scroll・wait追加前の250 DOM candidatesを本文へ回復した。m3eは条件付き変更先、4言語、typecheck / test / buildと、省略寸法を既定値で補う説明を保持した。

最新m3eの1回はinput32,788 / output4,476（うちreasoning1,879）、API-equivalent $0.110336。対象の既定値説明はL0 / L1 / L2 pass。一方、module全体はL1が28pass / 2fail / 8vacuous。Jev品質節もL1が22pass / 1fail / 2vacuous。残る3箇所はsource照合では意味が一致するが、別ファイル名や識別子を裏づける引用窓が弱い。検証器は緩めず、[引用窓の照合](quality.citation-review.json)へ残した。

生成検証の累計は、停止した初回2callsの保守推計を含みAPI-equivalent **$0.792490**（native7calls、terminal usage5calls / 推計2calls）、総枠$2内。raw prompt / argv / auth / envはGitへ保存していない。保存済みOSS docにhuman-locked blocksが0件だったため、実OSSでlocked本文の保持を確認済みとは扱わない。既存apply / replayの対象回帰は成功した。

Nix Explainは `gpt-6.1-sol` / effort low、cap$0.05 / output600 / timeout120秒で実行。run5.012秒、application job1件がattempt1でdone、terminal reported input1,582 / output47、API-equivalent **$0.003634**。既存ローカルBun 1.4.2でもrun4.334秒、1 job / attempt1 / done、input1,585 / output47、**$0.003640**。両経路とも引用1件が有効、source不変、daemon / fixture / homeの後始末が成功し、API相当合計**$0.007274**。元harnessの誤ったLLM呼出数カウンタは採用せず、[両経路の証跡](codex-explain.json)へapplication jobsとterminal usageを記録した。これらは請求額の実測やサブスク枠の保証ではない。

引用入力修正後の追加実生成2回はAPI換算保守$0.416844 / 見積枠$0.50で本人の費用承認待ち。ChatGPT認証とAPIキー未設定を確認したが、`credits.hasCredits:true` のため有料credit消費がない保証はできず、$0.50も実請求の上限ではない。今回の統合作業でnative呼出は0。

## 採用した変更と不採用の実験

Linux cold checkではloopのtestkit root importを既存home / fixtures / goldenへ分けた。loopのroot147件とtestkit公開71名は維持し、読み込むworkspace sourceが226→161件、gen sourceが50→0件になった。gen自体は全20projectの意味検査に残る。ARM・2CPUのcold ABBAはwall中央値28.36→27.085秒（4.50%短縮）、較正後中央値10.64%短縮。4回とも20semantic builds / 0cached / 0errors・全7項目成功。対象回帰は重複除外で69pass / Linux限定3skip / 0fail。[先行fixture案](cold-check.md)は速度改善を実証できず不採用のまま。

Go7kでは凍結した同一source・新process / 空homeで12runを比較し、blobs6,490行 / symbols133,602行 / skeleton11,997行が全行一致した。256KiB batchは速度13.54%悪化で不採用。GC前の参照解除はsandbox8Workerで0.59%、通常Mac6Workerで4.93%短縮したが未採用。sandbox内のsysctl拒否がWorker数を変える差も記録した。先行比較は既存quiet閾値を超え、較正未計測なのでabsolute gate成功とは扱わない。後続の既存正式caseは通常Mac / Nixで既定warmup1＋measured5を1 invocation実行し、中央値3,872.33ms / p954,776.41ms。待機後もload16.55、factor1.902929でreport-only、scaled limit2,854.39msにも超過。全6childのcoverage・6Worker・cache0を維持し、RSS中央値985.14MiB。当時は追加測定・候補適用をせず未解決として残した。[先行正式case](idx-formal.json)。

最新の正式 `idx.s01.cold.7kfiles` はsource `bdcebaf1aa97525bc86722cbf4f4cbf508bfa083`、warmup1 / measured5、quiet / AC、factor1.037243379882442で中央値1,980.096958ms。hard limit1,500msは未達。上のNOISY / report-only測定と採用ABBAはそれぞれ履歴として保持する。

後続helper候補のABBAもquiet / reference内（before1.078238 / after1.073405）で完了。baseline中央値1,853.212792msに対し候補1,849.252792ms（0.214%）で、3表の全行hash・counters・coverage・6Workerは一致したが、速度の採用根拠はなく未採用とした。

UIは初回nonce競合、仮想化アンカー、節移動でのengine再検出、初回statusの先取り競合、lazy chunkとprecompressionを修正した。strictの上限・件数・診断は維持し、先行compiledはgen6.890 / limit6.900KB、palette4.516 / 4.600KBと余裕が小さい項目も残す。Readerの実click→paintはnative65.2 / 31.7 / 32.1ms、enhanced31.9 / 32.0 / 16.1ms。修正前のscanSummary3,312.1 / limit2,000msと、先行compiledの1,771.5msを保持する。後者はfactor1.12でreport-onlyのため正式基準機合格へ読み替えない。[先行UI記録](ui-bench-release.md)。

最新のcompiled `ui.scanSummary` 正式測定は同source `bdcebaf1aa97525bc86722cbf4f4cbf508bfa083`、binary SHA-256 `8d1f22762b6b56d9eae7181e61a144b1d8e607f1ff84808b9d9673d51387deb7`。quiet / AC、factor1.0293374645265196 / after1.0867728003515473、warmup1 / measured3で測定値は1,767.800048828125 / 1,615.7001953125 / 1,577.099853515625ms、中央値1,615.7001953125ms。hard limit2,000msは合格、target1,000msはWARN。compiled scanSummaryの正式検証待ちは解消し、先行1,771.5msのreport-only結果も履歴として保持する。

WindowsはNix-built EXEを `BUN_BE_BUN=1` で再利用し、Windows用Bunの別ダウンロードを廃止した。[初回native run](https://github.com/satoki252595/mitori/actions/runs/38096491256)は5pass / 1fail。exact environmentだけが失敗し、引数 / stdio / 終了コードと子孫停止は成功した。環境「名」だけを渡すプロトコルで、Job Object経由の子へ明示した変数だけを渡す修正を実装した。既存native4ケースを維持し、portable protocol test1件と空値・非ASCII環境を追加。Nix crossbuild、Mac対象19pass / Windows限定4skip、platform型検査・整形は成功。[前回CI](https://github.com/satoki252595/mitori/actions/runs/38112767631)は525260dで7pass / 0skip / 0fail・33 assertions・4.38秒、selftest6checks成功。[最新Windows CI](https://github.com/satoki252595/mitori/actions/runs/38115528185)は `23645fdc7100e02e5f6b63bbbde2b33c59b1c79f` でcrossbuild / nativeとも成功し、同じ7pass / 0skip / 0fail・33 assertions・4.20秒、製品`--version`とembedded `_selftest` 6checks成功・2,606.378msだった。製品EXE SHA-256は `3e1d25c49fbb36b5974a4ec6036a3d9bc8ebcb81cc21d8d078b85143cf189e04`、API / 実ログ / artifactを照合済み。Windowsの非group直接Bun.spawn経路には標準環境変数の補充が残る。PR全体のCI結果は別途確認する。

## 次の確認

1. 本人による実Chrome日本語IMEの変換確定Enter / 次のEnterを確認する。compiled scanSummaryの正式検証はhard limit合格で完了し、target WARNは保持する。
2. Go7kの最新正式中央値1,980.096958msはhard limit1,500ms未達。後続helper候補も0.214%差で未採用。Jev / m3eは引用用import入力と共通verdictを修正し、追加実生成2回の費用承認待ち。有料creditを使わない保証はできず、API換算$0.50も実請求の上限ではない。Windowsの今回対象は最終CIで完了した。

利用者の対応待ちは実IME確認と追加実生成2回の費用承認。任意providerを使う場合はその本人認証が必要。LM Studioは既存モデルの読込と実回答を今回確認し、検証後に専用モデルだけ解除した。利用時は本人のモデルを読み込む。Codexは今回ログイン済みで、認証待ちではない。Claudeのログインを今回の続行条件にしない。Safari実機とCloudflare公開は今回の必須条件から外れている。

## 最終統合の追記

- source `bdcebaf` で正式時間測定を再確認。Go7kはquiet / AC・factor1.037243 / warmup1＋5runで中央値1,980.096958ms、hard limit1,500ms未達。compiled scanSummaryは同binary SHA `8d1f2276…`、quiet / AC・factor1.029337 / after1.086773 / warmup1＋3runで中央値1,615.700ms、hard limit2,000ms合格・target1,000ms WARN。先行のreport-only結果は上書きしない。
- Mac attempt6 / job114455888859はload6.19384765625・quiet / AC・待機0、factor1.017953727365694で既存guardを通過。browser380pass / 14skip / 0fail（4.5分）、共有2pass / 0fail、a11y8pass（7.9秒）の3stepすべてが成功した。同じNix固定runnerのforeground較正Bunはps PRI31、LaunchAgent配下では4だったが、厳密なQoSや根因は未確定。上限・referenceは変更せず、検証後は元の同じplistでサービスを復元した。旧失敗とguard停止も保持する。[CI記録](ci.md)。
- 先行Go候補とは別に、同一Node.typeのWASM再取得を減らす最小変更を後続で採用した。quiet / AC・較正before1.010 / after1.077のABBAで中央値2,232.14→1,994.58ms（10.64%短縮）、抽出3表の全行hash、coverage、診断、6Workerが一致。1,500ms目標は未達。[比較の全結果](idx-type-local.md)。
- 通常の既存Bun 1.4.2でもCodex Explainが1 job / attempt1で成功。API相当$0.003640、引用1件有効、source非変更、停止と一時データ削除を確認。Nixと合計$0.007274、課金先・請求額は不明。[両経路の証跡](codex-explain.json)。
- 先行compiled UIは初期JS54.639KB gzip、CSS18.100KB、strict asset全項目成功。scanSummary1771.5ms / limit2000ms、Reader6requests。時間はfactor1.12でreport-only、正式reference合格とは扱わない。a11y8成功・違反0。[先行UI記録と正式後続](ui-bench-release.md)。
- 実Chromeで初回map、確定済み日本語検索、Codex native/MCP切替と配布binaryの接続commandを確認。実IME変換は操作許可が拒否されたため本人確認待ち。[Chrome記録](chrome.md)。
- 統合checkは初回tscだけtest fixtureの不足で失敗。fixtureを直しtscのみ再実行成功。費用予約の最終修正後にも全7stepが4.35秒で成功した（warm）。先行Ubuntu実装head CIも再実行で成功し、全20semantic builds・0cached・0errors、unit3,017pass / 134skip / 4todo / 0fail、golden109pass / 4skip / 0fail、fixtures verify・size・Linux binary buildとversion成功。[CI記録](ci.md)。
- 費用予約修正後のMac配布binaryを再build。SHA-256 `6ce44b0863bc1f805329d437dd3565d8249aea2086d54125c6895138f6415da7`、70,565,490 bytes。embedded selftest全6checks成功（1,049ms）、[strict assets](final-assets.json)成功で初期JS54.639KB gzipを維持。Chrome・時間計測の先行binaryのSHAと混同しない。
- 引用入力・Go Node.type・読書位置の修正後にも統合check全7step成功（4.18秒、warm）。再buildしたMac binaryのSHA-256は `8d1f22762b6b56d9eae7181e61a144b1d8e607f1ff84808b9d9673d51387deb7`、embedded selftest全6checks成功（1,075ms）。[strict assets](reader-fix-assets.json)も全項目成功、初期JS54.697KB、gen6.886 / limit6.900KB、palette4.520 / limit4.600KB。
