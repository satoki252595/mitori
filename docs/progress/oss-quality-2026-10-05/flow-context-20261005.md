# 主要経路の生成入力修正（2026-10-05）

[理解確認](comprehension-20261005.md)で見つかった §3 の起動殻 / UI 往復への偏りを、共有 flow seed と入力選択で修正した。ここにある確認は公開 pinned source の静的解析と unit / facade test であり、修正後の実 Muse 生成結果ではない。追加 LLM 呼び出し・上流アプリ実行・依存追加は行っていない。

## 原因と変更

- 既存 file walk は module を訪問済みにすると同 module の別 file をたどれず、entry が一つあるだけで内部候補が隠れた。source が読める場合は既存 symbol / import / callsite を使い、file の訪問で循環を防ぐ。module は順序を保って重複を圧縮する。entry file の実 callable / callback は実 qualname を持つ候補として扱い、HTTP route を推測で足さない。
- Python / JS の loose method resolution に graph name edge を使うと、Laya の `predict` が無関係な MCP / research file に伸びた。resolved repo import に限定した。Go の同 package は import なしの参照を許すが、別 package の name edge は call の根拠にしない。import だけで使われていない file は source walk に入らない。
- 旧 BODIES は seed 数で先に予算を割り、同じ大きい caller を繰り返し課金した。現在は branch を交互に選び、同 blob の実際に表示した番号付き行を重複除去してから総予算を適用する。長い caller は既存 head と、選択した callee を使う狭い callsite ±3 行を供給する。短い wrapper / guard は保持する。
- 同 file の private helper と、import を確認できた `functools.partial` の callable 引数も追う。warm cache は既存 file cap のまま、次 hop の文脈を最大 6 回補う。
- §9 は route file の main / guard を hot body より先に供給する。他の main と既存 fan-in 5 module は残りを使う。module / parent の DOCS は祖先の README / CONTRIBUTING も対象とし、CONTRIBUTING の setup 後にある宣言済み checklist を含む先頭最大 80 行を、元の DOCS 予算へ収まる長さにする。

新 field / security parser / prompt template は追加していない。seed 最大 8、file hop 最大 6、flow text 64 file、同 file helper 最大 6 / 400 行、gen.flows BODIES 12,000、gen.quality BODIES 6,000、元の DOCS 予算を維持する。既存 `Budget.done()` の省略 marker は source body 予算の外に付く。

## 0 LLM の入力確認

source SHA は [selection.json](selection.json) と同じ pinned clone。全 source を読める test pipeline に実 `gatherInputs` を接続し、出力の番号付き行を確認した。上流を起動せず、性能や動的 dispatch の正しさを実測したという意味ではない。

| 対象 | 修正後の BODIES / DOCS に到達した根拠 | 入力 token 推計 |
|---|---|---:|
| m3e-canvas | `Editor` の `effectivePrompt` と `clipboard.writeText`、`buildPrompt` の body。CONTRIBUTING 43–49 行の Kind / 4 言語 / renderer / item sentence / editor checklist。 | §3: 11,966 |
| jev-ultrafast | demo callback → Agent → `choose` / `Browser.act` の source body。各 file は同じ module でも経路に残る。 | §3: 11,966 |
| Laya | `systemone` → `_systemone_inner` → `partial(router.predict, …)` の actual callsite。§9 は `main` の `0.0.0.0` と `_authorized` の `api_key is None` を両方含む。 | §3: 11,991 / §9: 6,007（省略 marker を含む） |

静的候補と実行時の call trace は異なる。動的 receiver / alias / callback が解決不能な場合、未知の経路を model の想像で補わない。BODIES は有限のため、全 branch / guard が常に供給されるとは保証しない。Kind / PRESS_KEY の完全な変更手順や最終 Markdown の意味は、root の scoped 実 Muse 結果と pinned source の再照合で確認する。

## 対象検査

```sh
scripts/nd bun test packages/indexer/src/pack/flow.test.ts packages/gen/src/prompts/renderer.test.ts packages/gen/src/prompts/m4.test.ts packages/gen/src/prompts/seeds.test.ts
scripts/nd bun test packages/indexer/src/update/later.int.test.ts
scripts/nd bunx tsc -p packages/indexer/tsconfig.json --noEmit
scripts/nd bunx tsc -p packages/gen/tsconfig.json --noEmit
scripts/nd bunx biome check packages/indexer/src/pack/flow.ts packages/indexer/src/pack/flow.test.ts packages/indexer/src/update/later.ts packages/indexer/src/contract.ts packages/gen/src/prompts/inputs.ts packages/gen/src/prompts/renderer.test.ts packages/gen/src/prompts/m4.test.ts
```

4 unit files は **47 pass / 831 assertions**、既存 go-small facade integration は **1 pass / 14 assertions**、両 package の型検査と対象 Biome は成功。同 module の内部 branch、未使用 import / 無関係な同名 file の除外、長い caller の深い callsite、private wrapper / partial / guard、public server main の優先、元の token cap、宣言済み CONTRIBUTING checklist を回帰で確認した。全体 check / build / 有料 scoped 生成は root が行う。
