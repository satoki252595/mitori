# Linux cold check 改善 — 2026-10-05

最終凍結 source の native Linux cold check は **14.59秒・exit 0**。宣言生成と semantic cache を両方削除し、全20 project の TypeScript・Svelte・他の全 check が成功した。15秒目標・30秒上限をともに満たした。[最終証跡と失敗履歴](final/README.md) を参照。

以下は改善初回の履歴。cold check の型検査を、宣言生成と全 project の意味検査に分け、**15.12秒**（従来57.25秒）を測定した。全20 project の TypeScript と Svelte は成功したが、編集中ファイルの整形9件と契約一覧 stale により全体は **exit 1** だった。

`scripts/typecheck.ts` は既存 TypeScript 6.0.3 を使う。`tsc -b --noCheck` で参照先の declaration を生成した後、solution の全 references とその transitive references を `tsc -p --noEmit --noCheck false` で3並列に検査する。意味検査用の build-info を `node_modules/.cache/tsc-semantic/` に分け、宣言生成の incremental 状態を上書きしない。すべての失敗を集計し、1つでも失敗すれば exit 1。Biome、boundaries、CR ledger、budgets、contract index、Svelte の既存検査と時間上限は維持した。依存追加なし。

実 compiler の回帰は、solution から直接参照しない project を含む2 project 両方の型エラーを検出し、noCheck による declaration が存在しても全体を失敗にすること、修正後にキャッシュを使った再検査が成功することを確認する。**1 pass / 7 assertions**。ローカル対象 TypeScript / Biome も成功した。ローカル初回は declaration 2.94秒 + semantic 8.29秒で20 project 全成功。

Linux の cold 実測は、既存 `scripts/linux-ci.sh` の fresh working-tree export と frozen install を使用した。LLM、全体 unit、production build は実行していない。source snapshot の開始時 loadavg は0.00。Ubuntu 24.04.5 / Linux 7.0.14 OrbStack / arm64、18 CPU、Bun 1.4.2、Node 22.23.3。

| 項目 | 結果 |
| --- | --- |
| frozen install | exit 0、4秒 |
| TypeScript 全20 project | exit 0、15.12秒 |
| Svelte | exit 0、4.86秒 |
| boundaries / CR ledger / budgets | exit 0 |
| Biome | snapshot の整形9件で exit 1 |
| contract index | snapshot の `docs/design/briefs/INDEX.md` stale で exit 1 |
| check 全体 | exit 1、15.12秒。15秒目標の警告、30秒上限内 |

証拠: [check.log](check.log)、[summary.txt](summary.txt)、[environment](env.txt)、[install.log](install.log)。未検査項目を省略して時間上限を満たした結果ではない。

```sh
scripts/nd bun test scripts/typecheck.int.test.ts
scripts/nd bun scripts/typecheck.ts
scripts/nd bash scripts/linux-ci.sh --arch arm64 --steps install,check \
  --seccomp unconfined --keep --out "$PWD/docs/progress/linux-check-20261005"
```

cold 再測定時には新 scratch を使うか、保持した scratch の `node_modules/.cache/tsc` と `node_modules/.cache/tsc-semantic` の両方を消す。warm check を cold の成功として報告しない。
