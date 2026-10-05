# GenState の非同期操作分割（2026-10-05）

`GenState` の見積もり取得、開始・制御・優先指定、節の見積もり・開始を `gen/actions.ts` に移し、既存の非同期操作を呼ぶ時だけ読み込む。追加依存・モデル呼び出しなし。未コミット。

SSE の `applyRun` / `applyTask`、同期状態、`current` / `key`、effort / engine 選択、既存 task hydration は store に残した。各呼び出しは import 前に workspace と必要な engine / effort / estimate / run を捕捉する。reset 世代と workspace を照合し、切替中の import は API を呼ばず、遅い応答は新しい状態へ適用しない。古い開始処理の finally が新しい開始処理の `starting` を消すことも防いだ。

estimate ID、`confirm: true`、idempotency key、`notBefore`、期限切れ時の再見積もりと2回目の人のクリック、節の estimate→run の2段階を維持した。engine と data policy の既存 UI は変更していない。公開 API / 契約の変更はない。

## 測定

並行 UI 編集を比較に混ぜないため、web source 全体をメモリに固定した同じ production build に対し `stores/gen.svelte.ts` だけ HEAD 版 / 分割版を差し替えた。Vite config は既存設定、出力は `/tmp/mitori-gen-actions-before` / `after`。shared dist は変更していない。

- entry gzip -9: **56,877 → 56,729 B（148 B減）**。
- GenState rendered code: **5,070 → 4,094 B**。この値は minify / gzip 前であり、転送量とは異なる。
- cold actions: **774 B gz** と既存 efforts chunk。entry の static imports は空で、actions は dynamic import のみ。最初の Map / Reader の paint 時の served JS に actions は含まれない。
- 繰り返した dynamic import は生成される preload 処理が削減を相殺したため、単一 `loadActions` にまとめた。圧縮後の削減は小さく、700 B以上の削減や全機能利用後の総量削減は主張しない。

同じ after snapshot の既存 served-byte probe は **S1 70.3 KiB gz / CSS18.6 KiB、S2 75.6 KiB gz / CSS14.3 KiB**。60 KiB目標は未達。150 KiB hard limit / CSS25 KiB / 初回 font0 / CM6なしは成功。route 全体には並行した ui_budget の変更も含むので、本分割だけの削減量には使わない。

測定 script / JSON / log: `/tmp/mitori-gen-actions-measure.ts`、`/tmp/mitori-gen-actions-{before,after}.json`、`/tmp/mitori-gen-actions-build.log`。

## 対象検証

```sh
scripts/nd bun test apps/web/src/gen/actions.test.ts apps/web/src/gen/gen.test.ts
MITORI_E2E_SKIP_BUILD=1 MITORI_E2E_DIST=/tmp/mitori-gen-actions-after MOCK_PORT=4347 \
  scripts/nd bunx playwright test -c e2e/web/playwright.config.ts \
  --project=chromium gen-card.pw.ts size.pw.ts
```

- 新規6回帰＋既存 gen unit: **25 pass / 0 fail / 99 assertions**。import 前の選択捕捉、期限切れの再確認、節の2クリック、workspace切替時の送信抑止、同一workspaceに戻った時もreset世代で古い応答を捨てること、SSE runを古い制御結果が上書きしないことを確認。
- 既存 Chromium gen card12件＋served size2件: **14成功**。data policy の1秒表示とack→start順、未ack時の抑止、billing / overage / window risk / engine検出を維持。
- Svelte-check **0 errors / 0 warnings**、対象 Biome / diff-check成功。GenStateの最後の単一 loader 集約後も unit と browserを確認。全 source の最終 check / build は root が担当する。

検証ログ: `/tmp/mitori-gen-actions-unit-final.log`、`/tmp/mitori-gen-actions-browser.log`、`/tmp/mitori-gen-actions-check.log`。
