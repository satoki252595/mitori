# Reader の初回不要機能分割（2026-10-05）

Reader / ContextColumn の公開動作を保ち、Reader の popover・文書操作 controller とコード欄の fetch / resize を first-use chunk に移した。未コミット。追加依存・モデル呼び出しなし。

- `ReaderTools.svelte`: 引用 peek、用語、claim、履歴、verify/revert、simplify/translate。初回 action の時に読み込み、処理中の Escape / Composer 開始 / pin / Reader 破棄が待機 action を取り消す。初回の選択 Range 捕捉、Composer 引き継ぎ、j/k、code の mode 戻りは ReaderPage に残した。
- `ContextCode.svelte`: CodePane、ファイル取得、リサイズ。code mode の時だけ読み込む。キャッシュの index.changed 無効化は ContextColumn に残し、margin 中の変更も次の code 表示へ反映する。
- 初回の空 margin と about / cited files、既存 extension margin / review 表示、外側の column CSS は維持した。空白化や CLS 増加による削減ではない。

## 測定

最初に受け取った module-byte snapshot の Reader main chunk は gzip -9 **18,037 B**、分割後の snapshot は **15,398 B**（**2,639 B / 約2.6 KiB減**）。ReaderTools **7,423 B**、ContextCode **1,064 B** と CodePane は初回 closure に含まれない。分割による個別 gzip 増加はあり、全機能利用後の累計削減を主張しない。

孤立 production build は `/tmp/mitori-reader-after`、module-byte / import 記録は `/tmp/mitori-reader-after.json`。並行した ui_budget の共通 shell / Map 修正も含むため、route 全体の before/after 比較には使わない。

`size.pw.ts` の served-byte 最終 snapshot は **S2 76.1 KiB gz / CSS 14.3 KiB、S1 73.6 KiB gz / CSS 18.6 KiB**。60 KiB 目標は未達で、150 KiB hard limit と25 KiB CSS limit は満たす。最終 S2 の初回ファイルは boot / entry / i18n-ja / reader / decorate / code / Rich / levels。共通 entry は58,121 B、cold ReaderTools / ContextCode / CodePane は含まれなかった。

途中 snapshot で Map の namespace helper が ReaderTools を巻き込む現象は ui_budget が Map の legacy fallback 分離で解消した。ReaderTools 内も namespace import を named import に簡素化した。これを cold chunk の遅延成功と混同しないよう、最終 served closure を再測定した。

## 対象検証

全 browser run は既存 Nix `scripts/nd`、既存 mock、孤立 dist を使い、shared build 出力には書いていない。

```sh
MITORI_E2E_SKIP_BUILD=1 MITORI_E2E_DIST=/tmp/mitori-reader-after MOCK_PORT=4347 \
  scripts/nd bunx playwright test -c e2e/web/playwright.config.ts \
  reader-lazy.pw.ts popovers.pw.ts code-column.pw.ts composer-quote.pw.ts
```

- 最終 controller / markup に対し既存6機能 × Chromium / Firefox / WebKit = **18成功**（引用・用語・Escape層・履歴・human verify・コード再取得・選択引用）。新 slow-chunk 回帰は3ブラウザー **3成功**。合計21機能成功。
- 新回帰は初回 margin に cold JS がなく、ReaderTools の JS を保留している間も Escape と `o` が動き、後から古い peek action が復活しないことを確認。最初のテストが JS と同名 CSS を合わせて2リクエストと数えた3失敗は `.js` 限定へ修正し、失敗した3ケースだけを再実行した。製品コードの条件を緩めていない。
- 前段の Chromium Reader / code / quote / size **17成功**。Reader の boot CLS **0**、空 margin 維持、最初の `o` pin、peek focus / scroll、j/k・レベル切替も成功。
- 最終 served size **2成功**。ログ `/tmp/mitori-reader-size-final.log`。
- Reader の既存 unit **32 pass / 0 fail / 142 assertions**（reader/page/operation）。
- Svelte-check **0 errors / 0 warnings**、対象 Biome / diff-check 成功。単独 `tsc -p apps/web --noEmit` は並行 Map/core 変更前の古い参照 declaration に起因する Map 型エラーを観測した。Reader の型エラーはなく、共通宣言の更新を伴う最終 `tsc -b` は root が担当する。

browser ログ: `/tmp/mitori-reader-browser.log`、`/tmp/mitori-reader-cold-3browser.log`（最初の新テスト失敗を含む）、`/tmp/mitori-reader-cold-3browser-rerun.log`。全 source の最終 asset build / 全体 check と60 KiB目標の残りは root / ui_budget の記録を参照する。
