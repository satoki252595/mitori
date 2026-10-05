# Jev §9: 数値上限の適用範囲の再確認

対象は pinned source `1231850a0bf1a0c0341fe408ef1668dbbfdfac46`、indexDigest `29bdbb49700e9fcf`。旧生成資料を手編集せず、§9だけを実Museで再生成した。**実行全体を250候補に制限する旧誤文は削除された。ただし、各上限を完全に説明できたとは判定しない。**

## 誤文と source

`jev-order-rewrite/doc/09-quality.md:12` は「1 実行は 60 操作と 120 決定要求と 250 候補に収める」と書く。250を実行全体へ適用する説明は誤りである。

- [questions.py:26](https://github.com/browser-use/jev-ultrafast/blob/1231850a0bf1a0c0341fe408ef1668dbbfdfac46/jev_ultrafast/questions.py#L26) が `MAX_STEPS=60` を定義し、[agent.py:75–76](https://github.com/browser-use/jev-ultrafast/blob/1231850a0bf1a0c0341fe408ef1668dbbfdfac46/jev_ultrafast/agent.py#L75-L76) の120は実行内の決定要求、[102–104](https://github.com/browser-use/jev-ultrafast/blob/1231850a0bf1a0c0341fe408ef1668dbbfdfac46/jev_ultrafast/agent.py#L102-L104) の60は操作履歴の上限。
- [snapshot.js:99–104](https://github.com/browser-use/jev-ultrafast/blob/1231850a0bf1a0c0341fe408ef1668dbbfdfac46/jev_ultrafast/snapshot.js#L99-L104) は各観測のDOM候補を250件へ切り詰めてから、scroll/wait候補を追加する。全候補数や実行全体を250件に制限するコードではない。
- [agent.py:106–115](https://github.com/browser-use/jev-ultrafast/blob/1231850a0bf1a0c0341fe408ef1668dbbfdfac46/jev_ultrafast/agent.py#L106-L115) は文面生成helperの呼び出しを別途記録する。120を全モデル呼び出しや請求額の上限とも扱わない。

## 生成履歴と最新snapshotの範囲

| UTC | 対象・証拠 | §9の扱い |
| --- | --- | --- |
| 2026-10-05 02:18:57.472 | 初回run `gr_vcpvjfr2` の quality task `gt_kav3m75j28` 完了。indexのAI limits block `b_yxhdrj1m` は `gen.quality@3` とこのrunを記録。 | 誤文が生成された。API相当推計$0.003937。保存promptの数値scope指示は無い。 |
| 2026-10-05 03:03:32.974–03:07:43.168 | `jev-decisions-verified`、`gr_f2b1r6hv`、scope `s10`。保存promptには数値scope指示がある。 | `gen.decisions@6` の指示追加を確認できるが、qualityの再生成ではない。 |
| 2026-10-05 12:19:07.072–12:19:46.531 | `jev-order-verified`、`gr_g1geegp7`、`gen.flows@6`、scope `s3`、0 blocks。 | 既存§9を複写したまま。履歴順序の訂正も全keepで失敗した記録を保持。 |
| 2026-10-05 12:29:39.341–12:32:30.355 | `jev-order-rewrite`、`gr_afdvbdrd`、`gen.flows@7`、scope `s3`、4 blocks。 | §3は訂正、§9は初回のまま。 |

§9ファイルのSHA256は初回から上記を含む8つの保存snapshotで同一: `4dd3056c2b01c9030a06732a46bbe6a5c2fbd27780c90230f5a40b8bc1249249`。初回quality保存promptのSHA256は `f033cbb72793709ebad545a90c03420dd8ac10fc32c7dd4119d5084cc3051d71`、decisions再生成の保存promptは `72991dfdc467ffd12bddef23f6349ae13a2cf4163c5f408688c7a3ee9dad4980`。本文・argv・env・認証情報・private保存先はこの資料へ出力しない。

`bench/measure/oss-quality.ts` は各OSSのreportをrun.startedAtで並べ、最新runのdocフォルダ全体を採用する。訂正前の `quality.audit.json` の `latestSnapshot=jev-order-rewrite` は、各節を同じrunやprompt版で再生成したという意味ではない。§3には更新したflows@7と保持されたflows@5、§9にはquality@3、§10にはdecisions@6があるmixed snapshotである。READMEの数値単位指示追加は初回qualityより後にdecisionsへ届いたことを保存入力で確認したが、追加の正確な編集時刻はこの記録だけでは特定しない。

## 最小prompt変更と無課金確認

qualityだけへ、数値の対象・単位・適用範囲をsourceどおり明示し、観測・request・runを一つのcapへ統合せず、不明なら質問する1行を追加。`gen.quality@4` → `@5`。decisions、system、共有入力、token budgetは変更しない。実行開始時のsource基点は `ddf748cdbfa3be38e290a0054cf2508beac42cb9` とこの差分。実行中にrootが同じ差分をsource/version `8f7176c`、locks `7f77419` として別々にcommitした。

- source/version: `packages/gen/src/prompts/templates.ts`、`packages/gen/src/contract.ts`。
- AC40 lock: `packages/gen/src/prompts/prompts.lock.json`、`packages/gen/src/prompts/render.lock.json`。qualityのentryだけを更新。
- 既存render-lock 1 test / 2 assertions、template-lock 1 test / 1 assertionが成功。対象4ファイルBiome成功。実生成の意味の正確さはこのunitでは証明しない。

## 事前見積りと実行条件

[dry report](jev-quality-estimate-final/report.json) は1 task、scope `s9`、Muse `muse-spark-1.3-contributor` / `max`、C1、API相当推計 **$0.002123**（入力18,607、出力1,308、信頼幅±25%、p50 19秒 / p90 26秒）。runは作成していない。既存の検証済みhome configを再利用し、認証設定は出力しない。

認可後に実行したコマンド:

```sh
MITORI_LIVE=1 scripts/nd bun bench/measure/gen-real.ts \
  --repo node_modules/.cache/mitori-oss-quality-20261005/jev-ultrafast \
  --home node_modules/.cache/mitori-oss-quality-20261005/jev-home \
  --engine generic --effort standard --scope s9 --concurrency 1 \
  --run --max-usd 0.03 --timeout-min 10 \
  --record node_modules/.cache/mitori-oss-quality-20261005/jev-quality-final-raw \
  --out docs/progress/oss-quality-2026-10-05/jev-quality-final \
  > /tmp/mitori-oss-jev-quality-final.log 2>&1
```

今回のAPI相当capは$0.03。保存済み累計$0.482213との合計上限は$0.512213で、認可済み総cap$1内。設定価格と推計tokensに基づくguardであり、providerの請求額やhidden reasoningの上限を保証する値ではない。旧誤文・失敗reportは保持し、新snapshotへ結果とsource照合を保存する。

## 実行結果とsource照合

[report](jev-quality-final/report.json) のrun `gr_sga79bzn` は2026-10-05 17:43:39.831–17:49:03.259 UTC、**s9のみ1/1 task、323.8秒、API相当推計$0.004909、cap $0.03未超過、exit0**。Muse Contributor / max、C1、attempt1、retry/drop0。新AIブロックのpromptVerは全て `gen.quality@5`。native child最大1、終了時と5秒後は0。`usageEstimated=true`で、報告input 38,037 / output 5,524は保守的な代用カウンター、provider exactとhidden reasoningは不明。first-pass valid 100%、L1 pass18 / fail0 / vacuous9、warning3は構文・識別子の結果であり、全文の意味の保証ではない。

[新本文](jev-quality-final/doc/09-quality.md) と公開sourceの照合:

- 旧12行の「1実行…250候補」は消えた。新21行の決定要求は実行ごとの `MAX_STEPS×2` として正しく説明する。
- **説明の省略は残る。** 新本文は60・120の具体値、各観測で250 DOM候補を残す処理、その後のscroll/wait追加を説明しない。保存入力には `MAX_STEPS×2` があるが、`MAX_STEPS=60` の定義、Agent.command:102–104の操作履歴上限、snapshot.js:99–104は無い。入力へ届かなかった上限を説明できた結果として数えない。
- 新19行の「do_POST…サーバー全体で同時実行は1要求」は、**POSTの共有LOCKに限定して読む**。POSTは[demo.py:111–125](https://github.com/browser-use/jev-ultrafast/blob/1231850a0bf1a0c0341fe408ef1668dbbfdfac46/jev_ultrafast/demo.py#L111-L125)で共有LOCKを取る。一方、[GET static/video:88–102](https://github.com/browser-use/jev-ultrafast/blob/1231850a0bf1a0c0341fe408ef1668dbbfdfac46/jev_ultrafast/demo.py#L88-L102)はLOCK無し、[GET state:85–87](https://github.com/browser-use/jev-ultrafast/blob/1231850a0bf1a0c0341fe408ef1668dbbfdfac46/jev_ultrafast/demo.py#L85-L87)はLOCK有り。全HTTP要求の同時実行数の保証へ拡大しない。AI本文は原文を保存し、この適用範囲の文言曖昧さを限界として残す。
- POST本体 `0<length<8192`、Origin欠落の許可、loopback既定、tickのStalePage回復、同一helper入力の再利用と実行後の破棄、観測前の実行記録は対応するsourceと合う。これはこの段落群のサンプル照合で、fresh全promptのsemantic完全保証ではない。

[provenance](jev-quality-final/provenance.json) は新旧ファイルhash、保存prompt hash、input coverageの有無、各節のAI version/runをallowlistで保持する。新§9 SHA256は `fd68ddaf27c3cf2bf2d557a217f36fbeef16524b36f286fb88f40b0f99085e14`、新reportは `1979675b80274197fe375f9dd72c9f2577be352bdb14ab5f586a6cc055f27b45`。新snapshotも§3のflows@5/@7と§10のdecisions@6を保持する。旧§9のSHA256は上記のままである。

既存 `oss-quality.ts` と `oss-native-audit.ts` を再実行し、latestSnapshotを `jev-quality-final` へ更新した。3OSS合計 **1,421引用先、無効0、全module generated、API相当推計累計$0.487122**。native auditは累計85 calls、unsafe profile0。Laya初回中止のincomplete1件は履歴として保持し、85件全てが完了したとは表示しない。今回1 callはcompleted・tool event無し。

品質sourceの追加変更・追加LLMは行わず凍結。既知の意味誤りの除去、未説明の上限、文言曖昧さ、未測定のprovider usageをそれぞれ別の結果として残す。
