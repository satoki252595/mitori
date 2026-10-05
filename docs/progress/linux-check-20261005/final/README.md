# Linux arm64 最終 cold check — 2026-10-05

**checked solution builder 修正後の native Linux filesystem 最終全 check は11.44秒・exit 0**。15秒目標・30秒 hard limit をともに満たした。全20 project が semantic build を実行し、cached は0件、型エラーも0件だった。Svelte と既存の全 check も成功し、未検査項目を省略した結果ではない。

| 実測 | frozen install | whole check | 結果 |
|---|---|---|---|
| 最初の Mac bind export | 9秒 / exit 0 | 167.20秒 / exit 1 | 検査内容は全成功、30秒 hard 超過。原ログを保持。 |
| native FS の初回 | 2秒 / exit 0 | 22.15秒 / exit 1 | 全20 semantic 実行、packaging test の型1件のみ失敗。他 check 成功、30秒以内。 |
| 型修正後の final verified | 1秒 / exit 0 | 16.00秒 / exit 0 | 全 check 成功、30秒以内、15秒目標 warn。 |
| facts 条件追加後の final facts-verified | 2秒 / exit 0 | **14.59秒 / exit 0** | 全 check 成功、15秒目標・30秒上限ともに達成。 |
| PR #5 修正後の final pr5-verified | 2秒 / exit 0 | **13.02秒 / exit 0** | 全 check 成功、15秒目標・30秒上限ともに達成。 |
| checked solution builder 修正後の final solution-verified | 1秒 / exit 0 | **11.44秒 / exit 0** | 20 semantic builds・0 cached・全 check 成功。15秒目標・30秒上限ともに達成。 |

bind export は Mac の filesystem metadata 遅延を含む。共有ハーネスの変更は、全 export をコンテナ内の `mktemp` 領域へコピーして検査し、退出時に破棄する部分に限定した。元の export は read-only mount、`--keep` はホストの source export を保持する。native workdir に Linux 用の frozen dependencies を入れ、check 前に `node_modules/.cache/tsc` と `node_modules/.cache/tsc-semantic` を両方削除する。全ソース・型検査・check・時間上限は同じ契約のままで、依存追加は無い。

最初の bind 測定と native 測定の間に Windows packaging の5 files が追加・整形された。native 初回と verified の間には `apps/cli/src/build/assets.test.ts:77` の Buffer / Uint8Array matcher 型を揃える修正が入った。このため三行を全く同じ source の benchmark として扱わない。native FS で metadata を多く読む各 step の時間が大きく下がったことと、現在の全 check の成功を分けて記録する。

その後、初期 UI の `facts:painted` マーク欠落を直す `main.ts` の1条件と、Linux workdir の `mktemp` 失敗時に退出する guard が追加された。その runtime source を含めるため、全差分を改めて export し、別領域 `facts-verified` で frozen install・両 TS cache 削除・全 check を一回実施した。14.59秒はこの snapshot の値であり、前の16.00秒を上書きせず履歴として残す。

| facts-verified step | 時間・結果 |
|---|---|
| declarations | 3.94秒 / exit 0 |
| 全20 semantic checks | 10.53秒 / 3並列 / 0 failures |
| tsc 全体 | 14.59秒 / exit 0 |
| Svelte | 4.72秒 / 0 errors、0 warnings |
| Biome | 0.55秒 / exit 0、既存108 warnings・2 infos |
| boundaries | 1.19秒 / exit 0 |
| CR ledger | 0.09秒 / exit 0 |
| budgets | 0.01秒 / exit 0 |
| contract index | 0.88秒 / exit 0 |

Ubuntu 24.04.5 / Linux 7.0.14 OrbStack / arm64 / 18 CPU、Bun 1.4.2 / Node 22.23.3。facts-verified 開始時 loadavg は0.00 / 0.01 / 0.20。Mac の重い check・build・browser・perf を止めた quiet window で実施した。source tree は `fce997ad2dcc61cbd13ee8c5001f6ebfdeaa15ed`。冷却条件は TypeScript の両 disk cache が無いことを指し、OS page cache まで空にした測定ではない。全20 semantic の有効性を保ち、宣言生成の noCheck を意味検査へ流用していない。

facts 測定の証跡: [facts-verified check.log](facts-verified/check.log)、[cold 条件](facts-verified/check-cold.json)、[source tree](facts-verified/source-tree.txt)、[environment](facts-verified/env.txt)、[summary](facts-verified/summary.txt)、[frozen install](facts-verified/install.log)。前の成功は [16.00秒 check.log](verified/check.log)、失敗履歴は [bind check.log](check.log) と [native 型失敗 check.log](native/check.log)。production の Windows size・Linux unit・browser・実 LLM の結果を、この check 成功に含めない。

PR #5 のブラウザー失敗修正後、HEAD `ed95494` の runtime source と現在の資料差分を再 export し、別領域 `pr5-verified` で frozen install と全 cold check を一回実施した。IME通知・料金超過通知・再訪時の project chip と、native→full 移行中の最新 cite focus 保持、CI の機械係数配線を含む現在の source に対する結果であり、前の14.59秒と同じ source の比較とは扱わない。このローカル Linux 測定は GitHub Actions ではないため係数1、実時間の15秒目標・30秒上限をそのまま適用した。

| pr5-verified step | 時間・結果 |
|---|---|
| declarations | 3.61秒 / exit 0 |
| 全20 semantic checks | 9.29秒 / 3並列 / 0 failures |
| tsc / whole check | 13.02秒 / exit 0 |
| Svelte | 4.30秒 / 0 errors、0 warnings |
| Biome | 0.52秒 / exit 0、既存108 warnings・2 infos |
| boundaries | 1.14秒 / exit 0 |
| CR ledger | 0.13秒 / exit 0 |
| budgets | 0.01秒 / exit 0 |
| contract index | 0.85秒 / exit 0 |

Ubuntu・CPU・runtime は上記と同じ。開始時 loadavg は0.00 / 0.00 / 0.00、重い Mac 検査を停止した quiet window で実施した。export の source tree は `2c4530d6a466a4c39f1bc20916e4c98532698195`。両 TS disk cache は削除済み、OS page cache は削除していない。最初の相対 `--out` 指定は Docker の volume 名と解釈され、コンテナ起動前に exit 125 となったため check は実行されなかった。同じ保存先を絶対 path に直して起動した記録を [launch-failure.log](pr5-verified/launch-failure.log) に残す。ハーネスや上限の変更はしていない。

PR #5 測定の証跡: [pr5-verified check.log](pr5-verified/check.log)、[cold 条件](pr5-verified/check-cold.json)、[source tree](pr5-verified/source-tree.txt)、[environment](pr5-verified/env.txt)、[summary](pr5-verified/summary.txt)、[frozen install](pr5-verified/install.log)。14.59秒の証跡は上記の `facts-verified` に保持する。

HEAD `7a39335` は typecheck を TypeScript の checked solution builder 1回へ変更した。`noCheck: false` のまま project references を辿って全20 project を検査し、共有の resolution/source/declaration cache を同じ solution 内で利用する。以前の宣言生成＋別 process の3並列意味検査とは実装が異なるため、11.44秒を同じ checker 実装の比較とは扱わない。runtime web source は変更していない。この source と現在の資料差分を `solution-verified` へ fresh export し、frozen install と両 TS cache 削除後に全 check を一回実行した。

| solution-verified step | 時間・結果 |
|---|---|
| checked solution builder | 11.30秒 / 20 projects・20 semantic builds・0 cached・0 errors |
| tsc / whole check | 11.44秒 / exit 0 |
| Svelte | 5.63秒 / 0 errors、0 warnings |
| Biome | 0.57秒 / exit 0、既存108 warnings・2 infos |
| boundaries | 1.39秒 / exit 0 |
| CR ledger | 0.10秒 / exit 0 |
| budgets | 0.01秒 / exit 0 |
| contract index | 1.02秒 / exit 0 |

Ubuntu・CPU・runtime は上記と同じ。開始時 loadavg は0.00 / 0.00 / 0.00、Mac heavy を止めた quiet window で実施した。source tree は `8f9faf2e3557974a404b25aedebc99384e78b05f`。両 TS disk cache は削除済み、OS page cache は削除していない。係数1の実時間で15秒目標・30秒上限をそのまま満たした。今回の成功に browser CI、whole unit、shipping build の結果は含めない。

最新証跡: [solution-verified check.log](solution-verified/check.log)、[cold 条件](solution-verified/check-cold.json)、[source tree](solution-verified/source-tree.txt)、[environment](solution-verified/env.txt)、[summary](solution-verified/summary.txt)、[frozen install](solution-verified/install.log)、[機械可読結果](result.json)。旧13.02秒・14.59秒・16.00秒・22.15秒・167.20秒の証跡は保持する。

```sh
scripts/nd bash scripts/linux-ci.sh --arch arm64 --steps install,check \
  --seccomp unconfined --keep \
  --out "$PWD/docs/progress/linux-check-20261005/final/solution-verified"
```

この出力先は既存証跡なので、再実行時は別の新規出力先を使う。
