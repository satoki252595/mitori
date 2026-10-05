# 旧非機能監査の残り5件（2026-10-05）

`audit-nonfunc.md` / `audit-resolution.md` の F7 / F11 / F12 / F15 / F16 を現ソースと証跡で照合した。F7 idle / F15はPR修正後のcompiled binary SHA `ea86a183194c15f50d2897f3bc8ee24a03dc5b15ce76ebf67982f80f032743f2`で規定の待機時間・回数を使って実測済み（[最終結果](shipping-performance-20261005.json)）。これらのbenchでLLM呼び出しはない。当初の「重いbenchを実行していない」「未計測」は後半に残した履歴であり、現在の判定は次表のとおり。旧版や別SHAの値を最新binaryの実測へ付け替えない。

| 項目 | 現在の判定 | 根拠と不足 |
| --- | --- | --- |
| F7 daemon RSS | **idle / peakのhard limit内・一部target WARN** | 最終shippingのemptyは3回×15秒、Mac physical footprint中央値 **48.3133MB**：target30 **WARN** / limit50 **PASS**。loaded critはscan後60秒で **161.0952MB**：target150 **WARN** / limit250 **PASS**（[idle条件・resident別値](f7-daemon-shipping-20261005.md)、[最新結果](shipping-performance-20261005.json)）。旧版146.5796MBも履歴に保持。CR m1-117どおりMacの判定値はphysical footprintで、resident RSSは別に記録する。既存React indexer peak中央値 **886.86MB**：target700 **WARN** / limit1000 **PASS**（[根因・原結果](f7-idx-peak-20261005.md)）。peakは10ms採取のRSSで、idleのprocess・時点・metricと同一視や合算をしない。 |
| F11 inputFiltered | **同counter推計target内・byte比率red / provider exact未測定** | 予算0.5 / 0.6は維持。同じ13件のserialized入力を既存Claude-v5推計器で数えた296051 / 同pinned indexの621491 = **0.476356**でtarget0.5内（[同counter診断](oss-quality-2026-10-05/token-efficiency-comparable.md)）。追加課金無しの推計でprovider exactは未測定。経理用のUTF8-byte上限ledger692453 / filtered621491 = **1.1142 red**は保持し、旧report / guard / 費用を成功へ書き換えない。 |
| F12 初回保存先の告知 | **CLIの既存 afterOpen 経路を修正・対象確認済み** | git workspaceは既定`.mitori`、shadow / remote-readonlyはhome配下の実docDirを使う。`afterOpen` が既存workspace statusからkindと `docDirOf(info)` の実保存先を1行告知し、commitがopt-inであることと既に設定済みかを示す。`mitori <path>` の新規daemon / 既存daemonの両経路が使う。保存場所自体は変更していない。 |
| F15 palette key→paint | **最終compiled中央値31.9ms・元limit PASS / target WARN** | real daemon＋crit Reader＋Chromiumでinput timestamp→`mitori:palette:results` paintを計測。1warmup＋5roundの各round p95は32.2 / 33.2 / 31.0 / 31.9 / 31.0ms、その中央値 **31.9ms**、round間p95 **33.2ms**。指定統計medianの33ms limit **PASS** / 16ms target **WARN**。round間p95はlimitを0.2ms超える（[条件・失敗履歴](f15-palette-shipping-20261005.md)、[最新結果](shipping-performance-20261005.json)）。初回はfacts mark待ち30秒のsetup失敗で、palette未到達の[失敗結果](f15-palette-shipping-before-20261005.json)を保持した。必須mark・待機上限・key→paintの定義や予算は緩和していない。worker matching、別inputRender指標、旧baselineやmock成功で代用しない。 |
| F16 clean initial partition | **Reactの独立cold2回＋seeded2回で一致** | pinned Reactを4 independent child / fresh homeで開き、source commit、module id/slug/parent/sorted members、complete planのstage/task数/input token列が一致。1test / 10assert。F7 production配線後も同じ検証で成功（[条件・JSON](f16-react-20261005.md)）。各childのRSSや全snapshot fieldの一致は記録外で、証明範囲へ加えない。 |

F11の最終照合は[同counter診断](oss-quality-2026-10-05/token-efficiency-comparable.md)。完全入力13件をrun/task/record/hashと照合し、既存Claude-v5推計器で296051 tokens、同じpinned indexの分母621491、比率0.476356でtarget0.5内を確認した。これは追加課金無しの推計で、provider exactは未測定。経理用byte上限と元の1.1142 redを変更した結果ではない。以下の対象検証・offline実装・既存証跡は各時点の履歴であり、「未測定」「実runを追加していない」は最終fresh実測前の説明として読む。

## F12 の対象検証

`apps/cli/src/commands/open.ts` / `open.test.ts` のみ変更。pathはJSONでquoteし、制御文字を含むpathでも告知が複数行に分かれない。古いdaemonでstatusを取得できない場合はopenを壊さない。

```sh
scripts/nd bun test apps/cli/src/commands/open.test.ts
scripts/nd tsc -p apps/cli/tsconfig.json --noEmit --pretty false
```

既存install告知2件、新規git / shadow / English設定済み告知3件で **5 pass / 0 fail / 14 assertions**。CLI型確認・対象Biome / diff-check成功。未コミット。ログ `/tmp/mitori-open-doc-notice-unit.log` / `mitori-open-doc-notice-type.log`。

## F11 のoffline集計（実装済み）

testing spec §7.5(d)の定義を維持し、実gen-reportだけを読むoffline tokens経路を加えた。runのtask IDに属する `gen_task` ledger行の `in + cacheWrite + cacheRead` を合計し、同じpinned indexDigest / SHAの `INCLUDED_CLASSES`（source / test / docs / config）full-text token推定の合計で割る。task最終usageのみではretry / cancelled attemptを失うためledger行を使う。

`bench/measure/gen-real.ts` はestimate / runの直前にindexerのsnapshotと `FileEntry.tokensEst` 合計を保存する。offline経路はrunのpinned indexDigestとの一致も確認する。task IDはrunをまたいで安定しており、collectorは開始前5秒も含むため、ledger completion timestampを `run.startedAt` 〜 `finishedAt` に限定して前後の同ID使用量を除く。baseline欠損・SHA欠損/不一致・indexDigest不一致・filtered classの不一致・非standard・scoped / incremental / on-demand・未完了・cache利用・task欠損・ledger欠損/重複/不正usage・timestamp欠損は未測定理由を返す。後のソースや別SHAを分母にしない。

`usageEstimated: false` が明示された分子だけ `numerator: provider`、`true` を含むnative Muse等の分子は `estimated`。flagがundefinedのusageはunknownとして未測定にする。runがdoneでもfailed task / failed counter、done taskの欠落または0入力は拒否する。**分母は `FileEntry.tokensEst` の推計なので、分子がexactでも比率とSLO行は `estimated: true`** と表示する。native exact達成・請求額の保証とは扱わない。0.5 / 0.6予算は変更していない。offline経路はengine detectionやpaid callを行わず、cap / spentとも$0。S6o全promptの合併、naive_full / naive_mapreduce / その他tokens指標の実装はこの変更に含まない。

```sh
scripts/nd bun run eval --suites tokens \
  --gen-report <fresh-standard-full-run>/report.json \
  --gen-report <another-fresh-standard-full-run>/report.json \
  --out <summary-dir>
```

入力に新baselineが必要。`gen-real --scope ...` のレポートにはbaselineを保存してもfull Pass 1の比率には使わない。exitは0（全件計測・limit以内）、1（limit超過）、2（未測定あり）。JSONの `tokenEfficiency[]` に条件・推計区分・未測定理由、MarkdownにSLO行と推計区分を保存する。完全なfresh standard実runを追加実施していないため、F11達成とは主張しない。

対象確認:

```sh
scripts/nd bun test eval/tokens.test.ts eval/run.test.ts eval/slo.test.ts
scripts/nd tsc -p eval/tsconfig.json --noEmit --pretty false
scripts/nd tsc -p bench/tsconfig.json --noEmit --pretty false
```

**26 pass / 0 fail / 192 assertions**。engine.detectを呼ぶと失敗するspyを渡したoffline回帰、CLI複数report、retry/cache入力合計、前後runの同task ID排除、比率超過、22種類の欠損/不一致を確認。eval / bench型確認と対象Biome / diff-check成功。ログ `/tmp/mitori-tokens-unit.log` / `mitori-tokens-type.log` / `mitori-token-baseline-bench-type.log`。

既存レポートの実読み取り（0 paid）では `m3e-decisions-final` はscoped、`jev-ultrafast` はbaseline未保存、`laya` はrun未完で3件とも未測定、exit2・SLO行0件。`/tmp/mitori-tokens-existing-20261005/summary.{json,md}` と `/tmp/mitori-tokens-existing.log` に記録。既存raw / recording / private configを変更せず、baselineを偽付与していない。

## 既存証跡の対象

- `/tmp/mitori-integrated-unit.log`: crit / excalidraw seeded reopen int（481–482行）、structure（2952–2953行）、軽いcompiled RSS probe（1627–1628行）。後続のUI / gen改善前に実施した全体suiteの記録であり、最終ソースの再測定とは扱わない。
- `linux-continuation/arm64/unit.log`: compiled RSS probe36.4MB、corpus reopenはclone無しでskip。
- `rem-doc.md` / `structure/quality.corpus.test.ts` / `test/int/reopen-corpus.test.ts`: seedと解析inputの一致の証跡。reactの独立clean初回一致とは区別した。
- `ui-bench-20261005/README.md`: 新UI5件。palette per-keyは含まない。

当初の照合ではF7 idle / F15のUI freeze後scoped実測とF11のfresh full standard入力比が未完だった。その後の完了範囲は冒頭表の最新結果に更新済み。F11のprovider exactとその他tokens指標は引き続き未測定である。F16のclean条件は上記4回で対象確認済み。この末尾の古い証跡を最終shipping値として扱わない。
