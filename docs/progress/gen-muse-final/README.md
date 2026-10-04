# crit / Muse 最終記録

対象: [crit](https://github.com/tomasz-tomczyk/crit) `406875dd31e0eacc9af33b7643d54100620e8775`。原corpusを変更せず専用cloneと専用homeで実行した。configured modelは `generic:muse-spark-1.3-contributor`、要求reasoningは `max`。出荷条件 `build: release`。

| 区間 | 完了 | 時間 | calls | API換算推計USD |
|---|---:|---:|---:|---:|
| `../gen-muse-window/report.json` | 20/24、45分でcancel | 2,702.4秒 | 22（2abortを含む） | 0.156396 |
| `../gen-muse/report.json` | scoped残り4/4、s13は誤った空RAWで0call | 472.6秒 | 3 | 0.016885 |
| `report.json` | s11品質改善 / s13 RAW復元、2/2 | 283.4秒 | 2 | 0.009063 |
| 合成最終結果 `combined.json` | **24/24** | **実行時間合計3,458.4秒** | **27** | **0.182344** |

同じprompt/mode/targetの最新版のfinished taskを使い、旧版・abortを含むusage recordを同じsemantic taskへ対応させて合成した。内部retryは最終taskのattemptで測り0%。最初の壁時計cancelで開始済みのままpendingへ戻った2タスクは別に再開率8.3%（2/24）とした。意図的なs11の品質再生成と0callのs13復元は壁時計再開に数えない。原reportは書き換えていない。

L0 100%、L1 **99.6%**（450pass/2fail）、vacuous23.6%、valid1/marker100%、失敗task0。L1は引用構造の検査であり意味の正しさを保証しない。internal retry<30% / L1≥90%の条件は満たすが、45分の一括完走は未達。最初のAI blockは178.6秒。全区間で終了時/5秒後のchildは0。最後の2タスクは依存順に実行し、childの最大は1だった。

初回120秒timeoutの失敗6calls / USD0.030130は `../gen-muse-first/report.json` に別保存した。**失敗分を含むcrit合計はUSD0.212474の推計**。providerのnative tokens/hidden thinking/実請求額は取得できず、thinking:0は観測なしを表す。推計単価はinput/output/cache-readが0.1/0.2/0.002 USD/百万token。全体見積りの317秒p50と本文byte推計は実際の長いmax生成を過小評価した。calibrationN=0、推計usageは校正へ使わない。

`doc/` は最後の文書、`doc.index.json` は同じflush後のindex。問いは現在本文から43RAWを集約して15件に整理し、未生成placeholderを解消した。質問はcritの構造/仕様に向いており、mitoriや提示DATAについての問いは観測しなかった。cloneのHEADとtracked作業ツリーは不変。一時Muse profileの認証コピーは終了後に残っていない。

EX-04はadjacent indexのAI originを使う。modules:421文/未出典48（11.4%）、コード名付き未出典26（6.2%）。全節:590文/未出典103（17.5%）。静的表・human文をAIの品質へ混ぜない。数値低下を旧mixed-origin測定との品質改善として扱わない。

```sh
scripts/nd bun bench/measure/doc-uncited.ts docs/progress/gen-muse-final/doc --list
scripts/nd bun bench/measure/doc-uncited.ts docs/progress/gen-muse-final/doc --all
```

再実行の設定とcapは `../continuation-live.md`、意味の照合と残課題は `../continuation-quality.md`。raw provider記録と認証を含む設定はGitに保存していない。

合成のvalidator/usage集計は既存helperで再現できる（repo rootで実行）:

```sh
scripts/nd bun -e '
import { aggregate } from "./bench/measure/gen-real-report.ts";
const paths = ["gen-muse-window", "gen-muse", "gen-muse-final"];
const rs = await Promise.all(paths.map(p => Bun.file(`docs/progress/${p}/report.json`).json()));
const key = t => JSON.stringify([t.prompt, t.mode, t.target_kind, t.target_id]);
const latest = new Map(), ids = new Map();
for (const r of rs) for (const t of r.tasks) {
  const k = key(t); ids.set(t.id, k);
  if (!latest.has(k) || ["done", "cached"].includes(t.state)) latest.set(k, t);
}
const tasks = [...latest.values()];
if (tasks.length !== 24 || tasks.some(t => !["done", "cached"].includes(t.state))) throw Error("unfinished tasks");
const seen = new Set();
const records = rs.flatMap(r => r.records).filter(r => !seen.has(r.id) && seen.add(r.id))
  .map(r => ({ ...r, scope: { ...r.scope, id: latest.get(ids.get(r.scope.id)).id } }));
console.log(JSON.stringify(aggregate(tasks, records), null, 1));
'
```
