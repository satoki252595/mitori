# 残課題の続行・検証記録（2026-10-11）

今回の変更と測定をまとめる。[PR #13](https://github.com/satoki252595/mitori/pull/13)へpush済み。修正後head98c59a6のUbuntu CIは成功、Windows対象はhead23645fdで成功。Macの同head再実行は較正が既存範囲外でbrowser開始前に停止した。旧head6af11b8の369pass / 14skip / 5failは履歴であり、読書位置修正後の正式suite合格とは扱わない。マージ・不要ブランチ削除は未実施。[CI記録](ci.md)。過去の失敗を後の成功値で置き換えず、各資料に前後の証拠を残した。

開発・検証はプロジェクトのNixと `scripts/nd`。通常利用は既存Bun / Git / LLMを使える方針を維持する。Dockerは利用者が許可した既存Linux検証ハーネスだけ。今回の実LLMはCodexと取得済みLM Studioで、Claudeは使用していない。Cloudflareへのデプロイはcloneしてローカル利用するための必須条件に含めない。

## 現在の判定

| 項目 | 確認できたこと | 残る確認・限界 | 証拠 |
|---|---|---|---|
| Codexでの実生成 | Jevの対象2節とm3eの対象moduleをNix経由で生成。修正後はterminal usage / exit 0を取得 | 引用窓のL1 failが残る。全文・全OSSの再生成成功は主張しない | [quality.md](quality.md) |
| Codex Explain / Nix・通常ローカル | go-smallで各1 application jobがdone、各引用1件有効、元source不変、後始末成功 | API相当合計$0.007274。課金先・サブスク枠は未確認 | [codex-explain.json](codex-explain.json) |
| LM Studio Explain / Nix・通常ローカル | 取得済みQwen GGUFで各1 HTTP推論がdone、各引用1件有効、source不変、追加費用$0。専用モデル解除・既存server維持を確認 | 短いExplainのみ。CLI指定4096と実load報告262144の不一致は未解決 | [lmstudio-explain.md](lmstudio-explain.md) |
| Codex並列生成の予算予約 | shared preflightで送信直前に合算判定。途中本文・usage保持と同額resumeを対象37tests / 224 assertionsで確認 | API換算の推計上限。hidden reasoningを含む実請求の厳密capではない | [codex-budget.md](codex-budget.md) |
| Linux cold check | testkitの既存home subpathへimportを絞り、全20semantic診断を維持。ARM同条件ABBAは4回ともhard limit内 | soft targetは未達、統合headのUbuntu x64 CIでの確認は別 | [cold-home.md](cold-home.md) |
| Go7k cold scan | Goの同一Node.type再取得を減らす変更を採用。quiet / reference条件のABBAで2,232.14→1,994.58ms、全行hash・coverage・診断一致 | **1,500ms上限は未達**。既存正式5回caseの合格とは扱わない | [採用変更](idx-type-local.md)、[先行不採用](idx-cold.md)、[正式後続](idx-formal.json) |
| UI / assets / a11y | 読書位置修正後のcompiledもstrict asset全項目pass、初期JS54.697KB gzip。先行測定はReader6 requests、a11y8pass / 違反0 | scanSummary1771.5 / limit2000ms、factor1.12のためreport-only | [最新assets](reader-fix-assets.json)、[先行UI記録](ui-bench-release.md) |
| Windows | head23645fdのNix crossbuildと実Windowsのsource tests7pass / 0skip / 0fail（33assert / 4.20s）、製品`--version`とembedded selftest6checksすべて成功 | verified Job Object経路の対象検証。非group直接Bun.spawnには標準環境変数の補充が残る | [最新Windows CI](https://github.com/satoki252595/mitori/actions/runs/38115528185)、[windows-nix.md](windows-nix.md)、[windows-env.md](windows-env.md) |
| 実ブラウザ操作 | 実Chromeの初回map、確定日本語検索、Codex native/MCP切替と配布binaryの接続commandを確認 | CDPの実IME送信が操作許可で拒否され、本人確認待ち。Safari実機はChrome代替の選択により必須外 | [chrome.md](chrome.md) |

## Codexの実生成とExplain

生成は `codex-cli` / `gpt-6.1-sol` / effort high。隔離したauth/config、空cwd、tool / network無効のlean profileで、対象OSSのhook / settings / toolを引き継がない。Jevはhistory記録 → observe → page_changed、60操作 / 120 prediction decision requests / scroll・wait追加前の250 DOM candidatesを本文へ回復した。m3eは条件付き変更先、4言語、typecheck / test / buildと、省略寸法を既定値で補う説明を保持した。

最新m3eの1回はinput32,788 / output4,476（うちreasoning1,879）、API-equivalent $0.110336。対象の既定値説明はL0 / L1 / L2 pass。一方、module全体はL1が28pass / 2fail / 8vacuous。Jev品質節もL1が22pass / 1fail / 2vacuous。残る3箇所はsource照合では意味が一致するが、別ファイル名や識別子を裏づける引用窓が弱い。検証器は緩めず、[引用窓の照合](quality.citation-review.json)へ残した。

生成検証の累計は、停止した初回2callsの保守推計を含みAPI-equivalent **$0.792490**（native7calls、terminal usage5calls / 推計2calls）、総枠$2内。raw prompt / argv / auth / envはGitへ保存していない。保存済みOSS docにhuman-locked blocksが0件だったため、実OSSでlocked本文の保持を確認済みとは扱わない。既存apply / replayの対象回帰は成功した。

Nix Explainは `gpt-6.1-sol` / effort low、cap$0.05 / output600 / timeout120秒で実行。run5.012秒、application job1件がattempt1でdone、terminal reported input1,582 / output47、API-equivalent **$0.003634**。既存ローカルBun 1.4.2でもrun4.334秒、1 job / attempt1 / done、input1,585 / output47、**$0.003640**。両経路とも引用1件が有効、source不変、daemon / fixture / homeの後始末が成功し、API相当合計**$0.007274**。元harnessの誤ったLLM呼出数カウンタは採用せず、[両経路の証跡](codex-explain.json)へapplication jobsとterminal usageを記録した。これらは請求額の実測やサブスク枠の保証ではない。

## 採用した変更と不採用の実験

Linux cold checkではloopのtestkit root importを既存home / fixtures / goldenへ分けた。loopのroot147件とtestkit公開71名は維持し、読み込むworkspace sourceが226→161件、gen sourceが50→0件になった。gen自体は全20projectの意味検査に残る。ARM・2CPUのcold ABBAはwall中央値28.36→27.085秒（4.50%短縮）、較正後中央値10.64%短縮。4回とも20semantic builds / 0cached / 0errors・全7項目成功。対象回帰は重複除外で69pass / Linux限定3skip / 0fail。[先行fixture案](cold-check.md)は速度改善を実証できず不採用のまま。

Go7kでは凍結した同一source・新process / 空homeで12runを比較し、blobs6,490行 / symbols133,602行 / skeleton11,997行が全行一致した。256KiB batchは速度13.54%悪化で不採用。GC前の参照解除はsandbox8Workerで0.59%、通常Mac6Workerで4.93%短縮したが未採用。sandbox内のsysctl拒否がWorker数を変える差も記録した。先行比較は既存quiet閾値を超え、較正未計測なのでabsolute gate成功とは扱わない。後続の既存正式caseは通常Mac / Nixで既定warmup1＋measured5を1 invocation実行し、中央値3,872.33ms / p954,776.41ms。待機後もload16.55、factor1.902929でreport-only、scaled limit2,854.39msにも超過。全6childのcoverage・6Worker・cache0を維持し、RSS中央値985.14MiB。追加測定・候補適用はせず未解決として残した。[正式後続](idx-formal.json)。

UIは初回nonce競合、仮想化アンカー、節移動でのengine再検出、初回statusの先取り競合、lazy chunkとprecompressionを修正した。strictの上限・件数・診断は維持し、最終compiledはgen6.890 / limit6.900KB、palette4.516 / 4.600KBと余裕が小さい項目も残す。Readerの実click→paintはnative65.2 / 31.7 / 32.1ms、enhanced31.9 / 32.0 / 16.1ms。修正前のscanSummary3,312.1 / limit2,000msは保持し、最終compiledは1,771.5ms。ただしfactor1.12でreport-onlyのため正式基準機合格へ読み替えない。[最終UI記録](ui-bench-release.md)。

WindowsはNix-built EXEを `BUN_BE_BUN=1` で再利用し、Windows用Bunの別ダウンロードを廃止した。[初回native run](https://github.com/satoki252595/mitori/actions/runs/38096491256)は5pass / 1fail。exact environmentだけが失敗し、引数 / stdio / 終了コードと子孫停止は成功した。環境「名」だけを渡すプロトコルで、Job Object経由の子へ明示した変数だけを渡す修正を実装した。既存native4ケースを維持し、portable protocol test1件と空値・非ASCII環境を追加。Nix crossbuild、Mac対象19pass / Windows限定4skip、platform型検査・整形は成功。[前回CI](https://github.com/satoki252595/mitori/actions/runs/38112767631)は525260dで7pass / 0skip / 0fail・33 assertions・4.38秒、selftest6checks成功。[最新Windows CI](https://github.com/satoki252595/mitori/actions/runs/38115528185)は `23645fdc7100e02e5f6b63bbbde2b33c59b1c79f` でcrossbuild / nativeとも成功し、同じ7pass / 0skip / 0fail・33 assertions・4.20秒、製品`--version`とembedded `_selftest` 6checks成功・2,606.378msだった。製品EXE SHA-256は `3e1d25c49fbb36b5974a4ec6036a3d9bc8ebcb81cc21d8d078b85143cf189e04`、API / 実ログ / artifactを照合済み。Windowsの非group直接Bun.spawn経路には標準環境変数の補充が残る。PR全体のCI結果は別途確認する。

## 次の確認

1. 修正後head98c59a6のUbuntu CIは成功。Macは較正範囲外で正式suite開始前に停止。quiet / reference条件で再確認し、成功後にマージ・不要ブランチ削除する。[CI記録](ci.md)。
2. 本人による実IME確認と、quiet基準機での時間予算を確認する。Chrome通常操作と最終compiled測定は完了。
3. Go7kは約10.64%短縮したが1,500ms上限は未達。Jev / m3eは引用用import入力と共通verdictを修正し、追加実生成2回の費用承認待ち。Windowsの今回対象は最終CIで完了した。

利用者の本人操作待ちは実IME確認。任意providerを使う場合はその本人認証が必要。LM Studioは既存モデルの読込と実回答を今回確認し、検証後に専用モデルだけ解除した。利用時は本人のモデルを読み込む。Codexは今回ログイン済みで、認証待ちではない。Claudeのログインを今回の続行条件にしない。Safari実機とCloudflare公開は今回の必須条件から外れている。

## 最終統合の追記

- 先行Go候補とは別に、同一Node.typeのWASM再取得を減らす最小変更を後続で採用した。quiet / AC・較正before1.010 / after1.077のABBAで中央値2,232.14→1,994.58ms（10.64%短縮）、抽出3表の全行hash、coverage、診断、6Workerが一致。1,500ms目標は未達。[比較の全結果](idx-type-local.md)。
- 通常の既存Bun 1.4.2でもCodex Explainが1 job / attempt1で成功。API相当$0.003640、引用1件有効、source非変更、停止と一時データ削除を確認。Nixと合計$0.007274、課金先・請求額は不明。[両経路の証跡](codex-explain.json)。
- 最終compiled UIは初期JS54.639KB gzip、CSS18.100KB、strict asset全項目成功。scanSummary1771.5ms / limit2000ms、Reader6requests。時間はfactor1.12でreport-only、正式reference合格とは扱わない。a11y8成功・違反0。[最終UI記録](ui-bench-release.md)。
- 実Chromeで初回map、確定済み日本語検索、Codex native/MCP切替と配布binaryの接続commandを確認。実IME変換は操作許可が拒否されたため本人確認待ち。[Chrome記録](chrome.md)。
- 統合checkは初回tscだけtest fixtureの不足で失敗。fixtureを直しtscのみ再実行成功。費用予約の最終修正後にも全7stepが4.35秒で成功した（warm）。Ubuntu実装head CIも再実行で成功し、全20semantic builds・0cached・0errors、unit3,017pass / 134skip / 4todo / 0fail、golden109pass / 4skip / 0fail、fixtures verify・size・Linux binary buildとversion成功。[CI記録](ci.md)。
- 費用予約修正後のMac配布binaryを再build。SHA-256 `6ce44b0863bc1f805329d437dd3565d8249aea2086d54125c6895138f6415da7`、70,565,490 bytes。embedded selftest全6checks成功（1,049ms）、[strict assets](final-assets.json)成功で初期JS54.639KB gzipを維持。Chrome・時間計測の先行binaryのSHAと混同しない。
- 引用入力・Go Node.type・読書位置の修正後にも統合check全7step成功（4.18秒、warm）。再buildしたMac binaryのSHA-256は `8d1f22762b6b56d9eae7181e61a144b1d8e607f1ff84808b9d9673d51387deb7`、embedded selftest全6checks成功（1,075ms）。[strict assets](reader-fix-assets.json)も全項目成功、初期JS54.697KB、gen6.886 / limit6.900KB、palette4.520 / limit4.600KB。
