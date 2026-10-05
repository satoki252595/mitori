# 9. 非機能 <!-- b_szmvnyyw -->

## ホットパス <!-- b_vh7ezmz0 -->

編集系のホットパスは app の `Editor` に集まり、すべての `setGroups` 更新が `constrainModalRails` を経由する（[Editor.tsx:454](../../app/Editor.tsx#L454)、[Editor.tsx:461-463](../../app/Editor.tsx#L461-L463)）。言語切替では `changeLanguage` が `translateSnapshot` で文書と履歴を作り直すため、文書量に比例した走査が発生する（[Editor.tsx:472-476](../../app/Editor.tsx#L472-L476)、[Editor.tsx:485-488](../../app/Editor.tsx#L485-L488)、[Editor.tsx:265-278](../../app/Editor.tsx#L265-L278)）。描画側の毎フレーム計算は lib と components にまたがり、分割積分と時間制限で抑えられ、`Spring` の例がその上限を示す（[shapes.ts:180-186](../../lib/shapes.ts#L180-L186)、[shapes.ts:190-197](../../lib/shapes.ts#L190-L197)、[shapes.ts:205-212](../../lib/shapes.ts#L205-L212)、[shapes.ts:218-222](../../lib/shapes.ts#L218-L222)）。 <!-- b_x5pnbgp3 -->

## キャッシュ <!-- b_d06zt3jx -->

- 形状データの共有は lib と components にまたがり、`getShapes` が単一配列を使い回す形で例示される（[shapes.ts:154-162](../../lib/shapes.ts#L154-L162)）。
- `getShapes` の初回だけが解析と正規化を行い、キー分岐や作り直しを持たない（[shapes.ts:154-162](../../lib/shapes.ts#L154-L162)）。 <!-- b_qyzjxpmj -->

## 上限値 <!-- b_s4n8drja -->

- 起動表示は app の `Boot` と `Page` に閉じ、`setTimeout` が `BOOT_FADE_MS` 後に `setPhase` で done へ進める（[page.tsx:37](../../app/page.tsx#L37)、[page.tsx:46-54](../../app/page.tsx#L46-L54)）。
- 履歴は app の `snapshot` が `HISTORY_MAX` を超えた分を切り捨てる（[Editor.tsx:622-625](../../app/Editor.tsx#L622-L625)）。
- 寸法の共有例は lib と app にまたがり、`isPhoneFrame` が `PHONE_W` と `PHONE_H` の一致で電話枠を示す（[tokens.ts:2148-2151](../../lib/tokens.ts#L2148-L2151)）。 <!-- b_h729jnh9 -->

## セキュリティ境界 <!-- b_tcw4h1rk -->

- 外部入力の境界は app と lib にまたがり、`applyDoc` が配列と型の確認後にだけ文書状態へ反映する（[Editor.tsx:724](../../app/Editor.tsx#L724)、[Editor.tsx:737-758](../../app/Editor.tsx#L737-L758)）。
- 保存済み UI 設定の読み出しは `initialLanguage` が `JSON.parse` で検証し、不正時はブラウザ言語へ倒す（[page.tsx:25-32](../../app/page.tsx#L25-L32)）。
- app の文書適用では `setTheme` が `normalizeTheme` を通してテーマを補完する（[Editor.tsx:747-748](../../app/Editor.tsx#L747-L748)）。
- 言語識別子の検証は lib と app にまたがり、`isLang` が 4 言語への絞り込みを例示する（[i18n.ts:12](../../lib/i18n.ts#L12)）。 <!-- b_f74bt5x2 -->

## 信頼性 <!-- b_b8c6bkgb -->

- 起動読込の失敗時は app に閉じ、`queueMicrotask` と `fitRef` で遅延整形を試みる（[Editor.tsx:786-789](../../app/Editor.tsx#L786-L789)、[Editor.tsx:797](../../app/Editor.tsx#L797)）。
- app の起動で文書が無い場合は `seed` と `SEED_FRAMES` で初期画面を作り直す（[Editor.tsx:793-795](../../app/Editor.tsx#L793-L795)）。
- 履歴操作は空で何もせず、`pastRef` と `futureRef` の枯渇時は復帰も再実行も返るだけである（[Editor.tsx:665-666](../../app/Editor.tsx#L665-L666)、[Editor.tsx:673-674](../../app/Editor.tsx#L673-L674)）。
- AI 失敗の表示は lib と components にまたがり、例外の言語別表示化を `aiErrorText` が例示する（[AiPanel.tsx:10](../../components/AiPanel.tsx#L10)）。
- 生成要求の失敗は lib と components にまたがり、`complete` が停止と拒否と HTTP 異常での例外化を例示する（[ai.ts:79](../../lib/ai.ts#L79)、[ai.test.ts:42](../../lib/ai.test.ts#L42)、[ai.test.ts:47](../../lib/ai.test.ts#L47)、[ai.test.ts:52](../../lib/ai.test.ts#L52)）。 <!-- b_whwz1yty -->
