# Codex 生成の run 予算予約を実呼び出し額に合わせる

確認日: 2026-10-11。実 LLM・native process の追加呼び出しは 0。以下の金額は fixture の単価で計算した予約額・模擬 usage であり、請求額ではない。

## 原因と最小修正

workspace の `genDeps.engines = {}` では、`Runner.engineFor` → `createSchedulerEngine` → `toScheduledRequest` を通る。Codex の scheduled request は共有 `codexPreflight` により保守的な native byte 入力額へ引き上げられるが、従来の `Runner.launch` は小さな `row.plan.estimate.apiUsd` を予約したままだった。そのため、各 request が単独の上限内でも、並列 native 予約の合算が run 上限を超えた。

`executeTask` の初回・transport re-dispatch・cold repair の各 `engine.run` 直前に、同期 `admit` hook を置く。Runner は scheduler adapter と同じ launch 時の Codex config を使って `toScheduledRequest` の額を求め、次を一度に判定・予約する。

```
run に計上済みの usage
  + 他の進行中 task の予約
  + 当該 task の発生済み usage
  + 次の native turn の予約
  <= stopAtBudgetFraction × genRunMaxUsd
```

Codex の gather 待ち slot は 0 から始め、送信前に必ずこの hook を通る。他 slot の `call !== null` だけで絞らないので、終了処理中・retry 判定中の発生済み usage も予約から落ちない。admit から `engine.run` まで await はなく、他の task が同じ残額を重複予約できない。provider の pricing / consent は launch 時の同一 config、run cap と stop fraction は現在の明示設定を使う。上限・consent を自動で増やしていない。

初回の run admission 拒否は spawn / usage / cache なしで task を pending、run を budget pause にする。残額が十分になった後は既存 resume で進む。実行済み turn の再試行を拒否した場合は task を `failed / E_BUDGET_EXCEEDED` とし、`sink.finish()` を通して検証済み partial と発生済み usage を保持し、run を budget pause にする。通常の `E_CANCELLED` cleanup へ流して partial を削除しない。usage は task 完了時に run へ一度だけ移す。前の call を close する間の cancel も、次の admission より先に確認する。

変更箇所: `packages/gen/src/orchestrator/runner.ts`、`execute.ts`、新規 `codex-budget.test.ts`。既存の scheduler / adapter / 共通 preflight を再利用し、新たな予算抽象層を増やしていない。

## 本番と同じ fallback 経路の独立再現

UI reviewer が `/private/tmp/mitori-codex-gen-budget-trace-20261011.ts` で実 `gen.start` → Runner → fallback scheduler を通し、scheduler.submit に渡る request を捕捉した。直接 GenEngine は注入せず、RelayRun を保持して並列予約を観測し、cancel / idle で終了した。native spawn は行わない。

条件: standard effort、scope `s6/session` / `s6/auth`、model `codex:gpt-6.1-sol`、input $2/M・output $10/M・cache read $0.10/M、turn consent $1。run estimate $0.043110、run cap $0.15、停止閾値 $0.12、usage $0。従来の task 予約は $0.017876 + $0.017622。

| 状態 | scheduler に送信した native 予約 | 合計 | run / running tasks |
| --- | --- | ---: | --- |
| 修正前 | $0.101586, $0.101100 | $0.202686 | running / 2 |
| 修正後 | $0.101586 | $0.101586 | paused / 1 |

修正前の合算は run cap $0.15 を超える。修正後は stop threshold $0.12 以内で、2 件目を送信しない。再実行は exit 0 / 52.8 ms。read-only source review も追加 finding なし。

3 task の未送信 slot が先行呼び出しを止める懸念も別 trace で確認した。scope に `s6/http` を加え、concurrency / effective 4、interactive reserve 1、背景 3 slot。estimate $0.064676、従来の task 予約 $0.017876 + $0.017622 + $0.017756、cap / 閾値は同じ。修正後は初回 $0.101586 の 1 call を送信し、2 task が pending / run paused。first の模擬 terminal budget usage $0.001 を計上した後、cap を $0.15 に据え置いて resume すると $0.101100 の 2 call 目が送信され、残り 1 task は pending / run paused。未送信の旧推計が再開を妨げない。

## 回帰検証

`codex-budget.test.ts` は直接の Codex GenEngine を使わず、実 Runner → scheduler adapter → `toScheduledRequest` と、制御可能な fake EngineRun を使う。

- 複数 task の native 予約合算を送信前に守り、既計 usage を含めて不足なら pause。同 cap で不足のまま resume しても新 call を送らず、明示的に残額が十分になれば pending を再開する。
- 3 task が gather 待ちでも先行 1 call は通る。first の模擬 usage $0.01 の後、同 cap $0.15 のまま 2 call 目が通り、計上は calls 2 / $0.02 で重複しない。
- 単一 native 額に不足する初回は submissions 0 / calls 0 / usage 0 / cache 0 / pending。
- 他 task の進行中 native 予約 + 当該 accrued usage を含め、単独なら通る repair も合算で不足すれば拒否。追加 call なし、partial と usage を保持。
- cold repair と transport resend の両方で、既発生 usage $0.03 を落とさず、追加 call / cache を作らない。

`scripts/nd bun test packages/gen/src/orchestrator/codex-budget.test.ts packages/gen/src/orchestrator/orchestrator.test.ts packages/gen/src/orchestrator/control.test.ts` で既存 31 tests が pass。追加 3 task fixture の終了時に不要な cancel を挟んで DB を早く閉じたため、テスト後処理のみ 1 件失敗した。不要な cancel を除いて失敗単位だけを `scripts/nd bun test packages/gen/src/orchestrator/codex-budget.test.ts` で再実行し、新規 6 tests / 49 assertions が pass。対象合計は 37 tests / 224 assertions、製品コードの追加修正は不要だった。

`scripts/nd bunx --no-install tsc -b packages/gen` と、変更 3 files の Biome check は pass。既存の pause / cancel / recovery、Claude parked / cold retry、Codex authoritative token / USD budget 拒否時の partial 保持も対象テストで pass。全 unit / 全体 check の再実行はせず、最終統合の型・contract / index と CI は root に委ねる。

この修正は推計予約の合算を守るもので、native thinking の未報告 usage を hard cap にするものではない。実生成の provider usage / 推計の区別と承認枠は [品質検証](quality.md) の記録を維持する。
