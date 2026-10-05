# TypeScript 推論基盤 <!-- b_3hp1ztxd -->

- ファイル 19 · 5068 行 · 重要度 0.13
<!-- b_fd3vth6e -->

**変更の手引き**
- 影響が及ぶ先（このモジュールを使う）: [実行見本集](examples-laya-dotnet-samples-laya-ts-examples.md)
- テスト: `laya-ts/tests/structured.test.ts`（39 件）・`laya-ts/tests/hooks.test.ts`（30 件）・`laya-ts/tests/revision-pinning.test.ts`（28 件）・`laya-ts/tests/confidence-gating.test.ts`（22 件） ほか 30
- よく使われる宣言（変えると波及する）: `QuestionDef` `laya-ts/src/agent.ts:39`（5 ファイル）・`checkMinConfidence` `laya-ts/src/common.ts:274`（4 ファイル）・`flagLowConfidence` `laya-ts/src/common.ts:321`（4 ファイル）・`SystemOneResult` `laya-ts/src/agent.ts:97`（3 ファイル）・`serializeState` `laya-ts/src/common.ts:37`（3 ファイル）
- 一緒に変わりやすいファイル（直近 289 commit）: `sdk/typescript/test/client.test.mjs` 2 回
<!-- b_8jan5dg2 -->

> [!NOTE]
> **この章で分かること**
> - 検証から復号までの全体像と用語を学ぶ
> - 振分と実行と構造化出力の分担を学ぶ
> - 設定と検査と落とし穴の要点を学ぶ <!-- b_yapb31da -->

## 責務 <!-- b_j5wh58s4 -->

Node.js とブラウザー向けの TypeScript 推論層で、`Agent` の型付き回答と `Router` の機種選択を提供する（[agent.ts:382-389](../../../laya-ts/src/agent.ts#L382-L389)、[router.ts:244-251](../../../laya-ts/src/router.ts#L244-L251)）。`SessionProvider` 越しの実行へ符号化と判定と計画を束ねる（[providers.ts:64-66](../../../laya-ts/src/providers.ts#L64-L66)）。HTTP 配送や学習は持たず、要求の組立てと復号に専念する（推測）。 <!-- b_gn7a53kn -->

## 公開インターフェース <!-- b_2yy9mm0f -->

- `Agent` は `systemOne` で回答を返す（[agent.ts:382-384](../../../laya-ts/src/agent.ts#L382-L384)、[agent.ts:494-498](../../../laya-ts/src/agent.ts#L494-L498)）。
- `Router` は `route` で選び `predict` で実行する（[router.ts:244-246](../../../laya-ts/src/router.ts#L244-L246)、[router.ts:441-445](../../../laya-ts/src/router.ts#L441-L445)、[router.ts:575-579](../../../laya-ts/src/router.ts#L575-L579)）。
- `SessionProvider` は `runEncoder` と `runHead` を隠す（[providers.ts:64-66](../../../laya-ts/src/providers.ts#L64-L66)）。
- `TokenizerLike` は `encode` を担い `parseTokenizerJson` で作る（[tokenizer.ts:1-5](../../../laya-ts/src/tokenizer.ts#L1-L5)、[tokenizer.ts:415-416](../../../laya-ts/src/tokenizer.ts#L415-L416)）。
- `checkQuestion` は検証し `toInternal` は内部化する（[agent.ts:169-171](../../../laya-ts/src/agent.ts#L169-L171)、[agent.ts:331](../../../laya-ts/src/agent.ts#L331)）。
- `decide` は `questionsFromJsonSchema` で計画する（[structured.ts:236](../../../laya-ts/src/structured.ts#L236)、[structured.ts:326-327](../../../laya-ts/src/structured.ts#L326-L327)）。
- `PredictContext` は `HookRegistry` で観測される（[hooks.ts:10](../../../laya-ts/src/hooks.ts#L10)、[hooks.ts:266-267](../../../laya-ts/src/hooks.ts#L266-L267)）。 <!-- b_mqp1fqd8 -->

## 依存関係 <!-- b_28ytfsn3 -->

examples 配下が `agent` の呼び出し元として使う（推測）。この層は他層に依存せず、標準機能と実行層の上で閉じる（推測）。 <!-- b_p3zvsn4k -->

## データ構造 <!-- b_skq5vjz3 -->

- `QuestionDef` は `type` と `instructions` と `criteria` を持つ（[agent.ts:39-43](../../../laya-ts/src/agent.ts#L39-L43)）。
- `SystemAnswer` は `confidence` と `answer_confidence` と `action` を持つ（[agent.ts:50-57](../../../laya-ts/src/agent.ts#L50-L57)、[agent.ts:80](../../../laya-ts/src/agent.ts#L80)）。
- `SystemOneResult` は `model` と `answers` と `usage` を持つ（[agent.ts:97-100](../../../laya-ts/src/agent.ts#L97-L100)）。
- `RouteDecision` は `model` と `repo` と `reason` と `workflow` を持つ（[router.ts:104-109](../../../laya-ts/src/router.ts#L104-L109)）。
- `TokenizerData` は `vocab` と `merges` と `ids` を持つ（[tokenizer.ts:22-26](../../../laya-ts/src/tokenizer.ts#L22-L26)）。 <!-- b_87785scn -->

## 処理の流れ <!-- b_ht35nkhg -->

1. `Router` の `route` が機種を選ぶ（[router.ts:244-246](../../../laya-ts/src/router.ts#L244-L246)、[router.ts:441-445](../../../laya-ts/src/router.ts#L441-L445)）。
2. `Router` の `predict` が `Agent` の `systemOne` を呼ぶ（[router.ts:244-246](../../../laya-ts/src/router.ts#L244-L246)、[router.ts:575-579](../../../laya-ts/src/router.ts#L575-L579)、[agent.ts:382-384](../../../laya-ts/src/agent.ts#L382-L384)、[agent.ts:494-498](../../../laya-ts/src/agent.ts#L494-L498)）。
3. `checkQuestion` の後に `buildQuestionPrefix` が入力を作る（[agent.ts:169-171](../../../laya-ts/src/agent.ts#L169-L171)、[common.ts:88-89](../../../laya-ts/src/common.ts#L88-L89)）。
4. `runEncoder` と `runHead` の後に復号して信頼度を付ける（[providers.ts:64-66](../../../laya-ts/src/providers.ts#L64-L66)）。
5. `flagLowConfidence` で印を付けて返す（[common.ts:321-324](../../../laya-ts/src/common.ts#L321-L324)）。 <!-- b_a5hp5ez4 -->

## 設定 <!-- b_0qgkw8aa -->

- `RouterOptions` の `models` と `maxLoaded` が保持を決める（[router.ts:118-126](../../../laya-ts/src/router.ts#L118-L126)）。
- `revision` と `sha256Digests` と `LAYA_SHA256_DIGESTS` が版を決める（[router.ts:134](../../../laya-ts/src/router.ts#L134)、[router.ts:138](../../../laya-ts/src/router.ts#L138)、[router.ts:195](../../../laya-ts/src/router.ts#L195)）。
- `PredictOptions` の `lang` と `minConfidence` が上書きする（[agent.ts:143](../../../laya-ts/src/agent.ts#L143)、[agent.ts:149](../../../laya-ts/src/agent.ts#L149)、[agent.ts:160](../../../laya-ts/src/agent.ts#L160)）。
- `ProviderOptions` の `device` と `numThreads` が実行を決める（[providers.ts:166-168](../../../laya-ts/src/providers.ts#L166-L168)）。 <!-- b_6qg1m34x -->

## テスト <!-- b_s3wjhs3g -->

- 空質問の短絡や不正質問の拒否を確認する（[agent.test.ts:17](../../../laya-ts/tests/agent.test.ts#L17)、[agent.test.ts:29](../../../laya-ts/tests/agent.test.ts#L29)）。
- 選択復号や水準の扱いと信頼度の付与を確認する（[agent.test.ts:22](../../../laya-ts/tests/agent.test.ts#L22)、[agent.test.ts:33](../../../laya-ts/tests/agent.test.ts#L33)、[answer-confidence.test.ts:39](../../../laya-ts/tests/answer-confidence.test.ts#L39)）。
- 最新ターンの保持や名称の互換を確認する（[audit-regressions.test.ts:31](../../../laya-ts/tests/audit-regressions.test.ts#L31)、[audit-regressions.test.ts:88](../../../laya-ts/tests/audit-regressions.test.ts#L88)）。
- 英語既定や空言語の委譲と符号優先を確認する（[blank-lang-routing.test.ts:14](../../../laya-ts/tests/blank-lang-routing.test.ts#L14)、[blank-lang-routing.test.ts:21](../../../laya-ts/tests/blank-lang-routing.test.ts#L21)、[blank-lang-routing.test.ts:29](../../../laya-ts/tests/blank-lang-routing.test.ts#L29)）。 <!-- b_rwhdxsy1 -->

## 不変条件 <!-- b_qar7252q -->

- `checkQuestion` は識別子の非空と 3 型を要求する（[agent.ts:169-183](../../../laya-ts/src/agent.ts#L169-L183)）。
- `criteria` は選択では非空であり採点では非空列である（[agent.ts:217-226](../../../laya-ts/src/agent.ts#L217-L226)、[agent.ts:262-270](../../../laya-ts/src/agent.ts#L262-L270)）。
- `clampTemperature` は `TEMP_MIN` から `TEMP_MAX` に収める（[common.ts:347-348](../../../laya-ts/src/common.ts#L347-L348)）。
- `labels` は `false` と `true` の別名である（[agent.ts:292-307](../../../laya-ts/src/agent.ts#L292-L307)）。 <!-- b_dtg8atfa -->

## エラー処理 <!-- b_jfeehkvx -->

- `checkQuestion` は不正を `Error` で識別子付きで拒否する（[agent.ts:169-176](../../../laya-ts/src/agent.ts#L169-L176)）。
- `parseTokenizerJson` は失敗時に `null` を返す（[tokenizer.ts:415-425](../../../laya-ts/src/tokenizer.ts#L415-L425)、[tokenizer.ts:467-469](../../../laya-ts/src/tokenizer.ts#L467-L469)）。
- `fetchWithRetry` は再試行し `dispatchAsync` は集約する（[providers.ts:201](../../../laya-ts/src/providers.ts#L201)、[hooks.ts:360-365](../../../laya-ts/src/hooks.ts#L360-L365)）。 <!-- b_fd4t8xxn -->

## 並行性 <!-- b_7bmm6emq -->

`systemOne` と `predictBatch` は `Promise` を返す非同期処理である（[agent.ts:494-498](../../../laya-ts/src/agent.ts#L494-L498)、[agent.ts:809-813](../../../laya-ts/src/agent.ts#L809-L813)）。共有は `prefixCache` と `addedPhases` と `_loading` に限られる（[common.ts:87-89](../../../laya-ts/src/common.ts#L87-L89)、[tokenizer.ts:332](../../../laya-ts/src/tokenizer.ts#L332)、[router.ts:260-262](../../../laya-ts/src/router.ts#L260-L262)）。 <!-- b_jxq3vt8c -->

## 性能 <!-- b_cck96t5e -->

接頭辞は `prefixCache` で再利用される（[common.ts:87-89](../../../laya-ts/src/common.ts#L87-L89)）。写像は `cached` に保持され `max_len` で切詰める（[tokenizer.ts:57-58](../../../laya-ts/src/tokenizer.ts#L57-L58)、[agent.ts:118-120](../../../laya-ts/src/agent.ts#L118-L120)）。 <!-- b_c3gq8fmx -->

## 落とし穴 <!-- b_d7g52x2b -->

> [!WARNING]
> **落とし穴**
> - `toInternal` の `String` 畳込みで重複鍵が落ちる（[agent.ts:246-260](../../../laya-ts/src/agent.ts#L246-L260)）。
> - `maxLoaded` と `_touch` の更新漏れで退避がずれる（[router.ts:255-262](../../../laya-ts/src/router.ts#L255-L262)、[router.ts:370](../../../laya-ts/src/router.ts#L370)）。 <!-- b_apn721jn -->

## 深掘り <!-- b_k9thxb4c -->

> [!NOTE]
> **深掘り**
> 言語救済と非ラテン分割の調整理由である。 <!-- b_nt0kvwr9 -->

> [!NOTE]
> **深掘り**
> 温度と補正表による較正の由来である。 <!-- b_qyrjkmwt -->

> [!TIP]
> **まとめ**
> 検証から実行と復号までを束ねる推論層である。 <!-- b_q7ganen1 -->
