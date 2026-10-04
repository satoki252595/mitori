# ベンチ残課題の確認（2026-10-04）

実 LLM 呼出なし、依存追加なし、Docker 実行なし。既存の nix devShell（`scripts/nd`）だけを使った。
budget の target / limit / max、`unmeasured`、reference は変更していない。

## 統合で見つかった登録の重複

`bench/runner/run.ts --list` が exit 2 で止まっていた。`bench/idx.bench.ts` の scan だけの case と、
`bench/open.bench.ts` の初回 open case が、ともに `idx.s04.cold.100kloc` を登録していた。
`discover()` は選択前に全登録を検証するので、UI の ID を指定しても同じエラーになっていた。

現在の budget は **S0–S4 + 静的文書の適用まで**を要求し、measure も `bench/open.bench.ts` を指している。
scan だけの重複 export を削除し、pinned crit・新しい process / home・`.mitori` なしの初回 open を正規の case として残した。
名前を変えて短い scan 時間を同じ予算に代用していない。`bench/runner/runner.test.ts` に実際の registry を使う回帰試験を追加した。
`bench:compare` の子も同じ runner / registry を使うので、この修正で現 tree の選択は回復する。
過去の scan だけの値と現在の静的文書込みの値は、同じ IDでも測定範囲が違うため性能回帰率として比較しない。
重複を含む旧 tree を compare の base にした場合は、base の discovery が引き続き失敗する。

```sh
scripts/nd bun bench/runner/run.ts --id idx.s04.cold.100kloc --exact --list --json
MITORI_LIVE=0 scripts/nd bun test bench/runner/runner.test.ts -t 'BENCH-U-11'
scripts/nd bun test apps/web/src/reader/page.test.ts apps/web/src/reader/reader.test.ts
scripts/nd tsc -p bench/tsconfig.json --noEmit --pretty false
```

一覧は `bench/open.bench.ts` の1件になり exit 0。discovery の5件、Reader の30件が成功し、bench の型検査も成功した。
Reader の block window とコード範囲上限の試験は通るが、これを下の大規模 DOM / 入力 latency の実測には数えない。

## 小さな再計測

```sh
scripts/nd bun bench/runner/run.ts --id idx.s04.cold.100kloc --exact --runs 3 --warmup 1 --no-wait --absolute --out /tmp/mitori-continuation-bench-open.json
```

2026-10-04 12:01:52 UTC、HEAD `84fa9c79721b9aabd09b5fe14a42373a1fc14f6d` + 今回の未コミット変更で実行した。
保存した生データは次のとおり（warmup 1回を除外）。

| metric | sample（ms） | median | p95 | 生の target / limit | runner の判定 |
|---|---|---:|---:|---:|---|
| `idx.s04.cold.100kloc` | 1713.3, 2085.9, 2238.4 | 2085.9 ms | 2238.4 ms | 1000 / 2000 ms | warn、時間の hard gate は無効 |

生の中央値は limit を超えた。計測時は Apple M5 Max / 18 cores / 128 GiB / Darwin 27.0.0、AC 電源、
Bun 1.4.2、Node 22.23.3。開始時 loadavg は **15.289**（静かな条件の上限は 18 × 0.5 = 9）、factor は **1.30046**。
runner は基準速度から外れた条件として予算を 1300 / 2601 ms に補正し、hard gate を行わなかった。
exit 0 を生の 2000 ms 上限達成と解釈しない。負荷を下げた再計測が必要。

## 未計測7件の現状

同じ7 IDを `--list --json` に指定しても結果は `[]`（exit 0）。対応する case はまだ登録されていない。
`buildFixture("gen:doc-1000")` と `buildFixture("gen:large-file")` も実際に呼び、両方が `E_NOT_FOUND` / `no fixture` になることを確認した。

| ID | 今回測れなかった具体的な理由 | 必要な次の実装・条件 |
|---|---|---|
| `agent.resident.procs` | `bench/agent-live.bench.ts` がない。録画エンジンは real CLI の warm / parked process を作らない | ログイン済み Claude、warm pool を有効にした daemon、子 process の計数 |
| `agent.resident.rss` | 同上。generic Muse の単発 process は Claude の warm / parked 状態の代用にならない | 上記 process の RSS 合計を計測 |
| `ui.scanSummary` | `mitori:scan:summary` が web の marks と描画処理にない。`e2e/perf/scan-summary.spec.ts` もない | 要約が描かれた後の専用 mark と cold-open case |
| `ui.inputRender.1000` | real daemon の `gen:doc-1000` descriptor / golden seed がない。`e2e/perf/input-render.spec.ts` もない | 1,000 block を配信する real fixture、4× CPU throttle、入力から描画までの計測 |
| `ui.dom.max` | 全20節 + Deep Dive / Inbox 500 / Review 5,000行の最大状態を作る fixture / `e2e/perf/dom.spec.ts` がない | 指定された各最大状態を実 daemon で開いて最大 DOM を計測 |
| `ui.codeLines.mounted` | `gen:large-file` descriptor がない。既存 harness の値0は code view を開いていない shell の probe | 20k行ファイルを開き、scroll 中の `.cm-line + pre.mcode .line + [data-line]` の最大値を計測 |
| `ui.reviewDiff5000.dom` | 5,000行 diff の ready job を作る scenario / perf case がない | 人の review 画面へ scenario job を載せ、diff の DOM を計測（採用は不要） |

`e2e/web/reader.pw.ts` には mock daemon の1,000 block DOM 試験が既にある。real fixture・4× throttle・入力描画時間を
測る試験ではないため、`ui.inputRender.1000` / `ui.dom.max` の未計測を解除できない。今回は共有 build の上書きを避け、
上記の関連する既存 unit tests を実行した。

## reference と残りの制約

`bench/runner/reference.json` は 2026-10-03 08:48:19 UTC、同じ M5 Max / 18 cores の calibration **308.331791 ms**。
今回の read-only `--calibrate` は factor **1.44952**、cold-open run 内の測定は **1.30046**だった。
同じ hardware のまま変動しているため、この負荷下で reference を上書きすると遅い状態を基準にしてしまう。

quiet / AC の条件を満たした後に、次を実行して reference と対象の時間予算を取り直す。
`--record-reference` 自体は負荷や電源を拒否しないので、先に loadavg ≤ 9 と AC 電源を確認する。

```sh
scripts/nd bun bench/runner/run.ts --record-reference
scripts/nd bun bench/runner/run.ts --id idx.s04.cold.100kloc --exact --absolute --out auto
```

self-hosted runner 登録と PR の e2e 時間枠はこの測定では進めていない。
今回の tree の Linux arm64 検証は別途実施済み。修正後の frozen install と warm check、失敗した F1 の再試験は成功したが、cold check は57.25秒で30秒上限を超え、全体成功とは扱わない。条件・初回の失敗・修正後の scoped 結果は [Linux 継続検証](linux-continuation/README.md) を参照する。上の未計測7件は解除していない。
