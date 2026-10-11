# 残課題の契約変更（2026-10-11）

利用者の「残タスク全て」「Claudeを使わずCodex」「WindowsもNix経由」の指示を実装する。

- `GenEngineId` に既存 `codex-cli` を含め、既存native adapterの入力・費用 preflight を共有する。新SDK・新auth storeは作らない。実行設定と価格同意は既存CLI承認経路を維持する。
- testkitの既存home helperをtest-only leaf subpathで再利用し、loopの不要なgen再検査を除く。
- Nix-built Windows standaloneを検証runtimeにも使う。Job Object helperは許可env名だけを受け、値をargvへ出さずexact Unicode child envを作る。

採用先・制限は CR codex-gen-1 / CR test-home-1 / CR win-env-1 として `packages/core/CR-LEDGER.md` §17へ記録した。変更PRには `contract-change` を付ける。実行記録は `docs/progress/remaining-20261011/README.md`。

## CR perf-tier-1 — 全性能 tier の集計（2026-10-12）

Go cold の残課題調査で、実機の `hw.nperflevels=2`、level0 `Super` 6 logical cores、level1 `Performance` 12 logical cores、合計 18 / Efficiency 0 を確認した。CR m1-116 の「OS 最高性能 tier（level0）のみ」という定義では 6 となり、既存の最大 8 workers より小さい上限がかかる。Apple の [M5 Pro / M5 Max 発表（2026-03-03）](https://www.apple.com/uk/newsroom/2026/03/apple-debuts-m5-pro-and-m5-max-to-supercharge-the-most-demanding-pro-workflows/) も 6 super + 12 performance cores の構成を明記する（2026-10-12 JST 確認）。実機 sysctl の観測と公式の製品構成は区別して記録する。

新定義は既知の全 `Super` / `Performance` tier の logical core 合計で、`Efficiency` は除外する。platform の同期 helper は `hw.nperflevels` の取得後、全 level の name / logicalcpu を一括取得する。全件が揃い、名前が既知、各個数が正の整数、全 tier 合計が `cores` 以下であるときだけ採用し、未知・欠落・不正なら旧 level0 の検出へ、さらに失敗なら `null` へ戻す。全 sysctl 呼出しは共通の 1 秒 deadline を使う。CLI / 正式 bench の既存共有 helper と、重複検出のあった `bench-s01` を同じ定義に揃え、明示的な Worker sweep override は維持する。

`W = clamp(ceil(parseMB / 0.75), 1, min(8, max(1, cores − 2), perfCores ?? 8))` の cap 8・2 cores 予約・0.75 MB 係数、Worker 寿命・GC・parse timeout・対象・診断・予算は変更しない。過去の accepted CR 行と §3.1 の実測表は保存し、旧「6 本超で E-core」という説明は現行の tier 構成へ一般化しない。

較正未計測の Go ABBA 比較は、6 workers の baseline 2,268.274 / 2,038.615 ms に対し、8 workers の candidate 1,725.018 / 1,744.146 ms。各組の中央値で約19.4%短縮し、全3表の fingerprints・counters・files は一致した。RSS は baseline 913 / 927 MiB から candidate 1,083 / 1,137 MiB へ増加した。これは Go の参考値で、RSS の正式 case は react。正式 gate の合格を示す計測ではなく、hard 1,500 ms 未達は継続する。較正を伴う正式検証結果は進捗証跡へ別途記録する。
