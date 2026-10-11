# F10: 利用実績による固定入力の較正（2026-10-11）

見積り側に未配線だった既存 `UsageLedger.fixedOverhead` を、server → loop → job planningへ接続した。新たな推論や依存は追加しない。engine・mode・model・prompt版をplanning / dispatch / Job記録で共用し、同じprofileの実測だけを参照する。

台帳の実測は固定入力全体なので、bundleに既に含む固定分を差し引いた超過だけを加える。既存の保守floorとUSD capは維持する。agentの追加往復分と初回入力budgetをそれぞれ補正し、再見積りの20%比較にはcache入力も含める。未測定・別profile・不正sampleは既定値へ戻す。sample数は表示するが、精度を測っていないためconfidenceは25のまま。

新たな固定入力sampleには推計usage、resume会話、別served-modelの結果を含めない。過去EMAは消去しておらず、過去sampleの全件がこの条件を満たすとの保証はない。実精度や実請求の改善を実証した変更ではない。

2026-10-11 11:47:56 UTCまでの対象検証:

- `scripts/nd bun test packages/loop/src/jobs/engine.test.ts`：8pass。
- `scripts/nd bun test packages/agent/src/ledger/ledger.test.ts`：10pass。
- `scripts/nd bun test packages/agent/src/claude/engine.test.ts`：追加fixtureの初回失敗を修正し、このfileだけ再実行して22pass。
- 合計40pass / 0fail。planningと送信profile一致、二重加算回避、fallback、confirmation・初回入力・USD境界、推計usageとresume除外を確認。
- `scripts/nd tsc -b packages/loop packages/server --pretty false`、対象9source fileのBiome、`scripts/nd bun scripts/check.ts boundaries cr-ledger contract-index`、diff checkが成功。独立reviewにblocking指摘なし。

drift分岐そのものの実行再現は未実施。実LLM呼出・新依存・追加費用0。
