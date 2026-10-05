# Linux arm64 最終 cold check — 2026-10-05

**native Linux filesystem の最終全 check は14.59秒・exit 0**。15秒目標・30秒 hard limit をともに満たした。全20 semantic project を3並列で検査し、Svelte と既存の全 check を実行した。未検査項目を省略した結果ではない。

| 実測 | frozen install | whole check | 結果 |
|---|---|---|---|
| 最初の Mac bind export | 9秒 / exit 0 | 167.20秒 / exit 1 | 検査内容は全成功、30秒 hard 超過。原ログを保持。 |
| native FS の初回 | 2秒 / exit 0 | 22.15秒 / exit 1 | 全20 semantic 実行、packaging test の型1件のみ失敗。他 check 成功、30秒以内。 |
| 型修正後の final verified | 1秒 / exit 0 | 16.00秒 / exit 0 | 全 check 成功、30秒以内、15秒目標 warn。 |
| facts 条件追加後の final facts-verified | 2秒 / exit 0 | **14.59秒 / exit 0** | 全 check 成功、15秒目標・30秒上限ともに達成。 |

bind export は Mac の filesystem metadata 遅延を含む。共有ハーネスの変更は、全 export をコンテナ内の `mktemp` 領域へコピーして検査し、退出時に破棄する部分に限定した。元の export は read-only mount、`--keep` はホストの source export を保持する。native workdir に Linux 用の frozen dependencies を入れ、check 前に `node_modules/.cache/tsc` と `node_modules/.cache/tsc-semantic` を両方削除する。全ソース・型検査・check・時間上限は同じ契約のままで、依存追加は無い。

最初の bind 測定と native 測定の間に Windows packaging の5 files が追加・整形された。native 初回と verified の間には `apps/cli/src/build/assets.test.ts:77` の Buffer / Uint8Array matcher 型を揃える修正が入った。このため三行を全く同じ source の benchmark として扱わない。native FS で metadata を多く読む各 step の時間が大きく下がったことと、現在の全 check の成功を分けて記録する。

その後、初期 UI の `facts:painted` マーク欠落を直す `main.ts` の1条件と、Linux workdir の `mktemp` 失敗時に退出する guard が追加された。厳密に最新の runtime source を含めるため、全差分を改めて export し、別領域 `facts-verified` で frozen install・両 TS cache 削除・全 check を一回実施した。14.59秒はこの最新 snapshot の値であり、前の16.00秒を上書きせず履歴として残す。

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

最新証跡: [facts-verified check.log](facts-verified/check.log)、[cold 条件](facts-verified/check-cold.json)、[source tree](facts-verified/source-tree.txt)、[environment](facts-verified/env.txt)、[summary](facts-verified/summary.txt)、[frozen install](facts-verified/install.log)、[機械可読結果](result.json)。前の成功は [16.00秒 check.log](verified/check.log)、失敗履歴は [bind check.log](check.log) と [native 型失敗 check.log](native/check.log)。production の Windows size・Linux unit・browser・実 LLM の結果を、この check 成功に含めない。

```sh
scripts/nd bash scripts/linux-ci.sh --arch arm64 --steps install,check \
  --seccomp unconfined --keep \
  --out "$PWD/docs/progress/linux-check-20261005/final/facts-verified"
```

この出力先は既存証跡なので、再実行時は別の新規出力先を使う。
