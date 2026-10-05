# Native Reader 初期操作（2026-10-05）

60 KiB 初回 JavaScript 目標に向け、認証済み canonical Svelte SSR の Reader を Svelte/stores の起動前に操作する controller を実装した。追加依存・モデル呼び出し・commit はない。SSR endpoint、初期 main、full UI boot、asset build は別担当の実装と組み合わせる。

- `reader/native.ts`: 既存 page/levels/virtual/decorate/scroll-anchor/dom-anchor の helpers を再利用。j/k、章キー、hash、L3 reveal、level 切替を同期操作する。長いページは SSR の inert template から必要な50-block windowを移動し、前後の window を保つ。virtual spacer と現在 block の座標を補償する。
- 範囲 API の canonical HTML は既存ID・section・hashが全件一致する batch だけ補完する。新IDやhash変更は部分適用せず、main側のcanonical SSR再取得へ渡す。mounted body と template body、titleを含むsnapshot DTO、親/子に重複した同一block DTOを更新し、placeholder の生成ボタンも既存 BlockHost と同じ構造で維持する。
- `doc.block.partial` は textContent と caret のみ。HTML として解釈しない。予約高さは既存 reservePx と以前の予約の最大値を使い、refresh/full UI hand-offへ未確定textを渡す。confirmed upsert時にmain側がpartialをclearし、generated/static_only sectionへ古いpartialを復元しない。
- `NativeReaderState` はws/page、focused/forced/window、scroll anchor、正規化済みselectionのquote、画面内予約高さ、partialを捕捉する。別ws/pageのstateを適用しない。Range復元は現在のexact/prefix/suffix一致を再検証し、古い文面なら破棄する。
- `ReaderPage` のfull mount初回はnativeのfocused/scrollを維持し、通常の先頭へ戻す処理を避ける。selection/action replayはws/page/navigation guardを持つ。既存first-key Range捕捉とpopover/Escape/Composer排他は維持する。

## 検証

独立controller fixtureはcanonical wrapperを模したDOMで現在sourceだけをBun browser bundleにし、実ブラウザーで操作する。SSR endpoint/full hand-offや出荷assetのsizeをこの証拠で達成扱いにしない。

```sh
scripts/nd bun test apps/web/src/reader/native-state.test.ts apps/web/src/reader/page.test.ts
MITORI_E2E_SKIP_BUILD=1 MITORI_E2E_DIST=/tmp/mitori-reader-after MOCK_PORT=4397 \
  scripts/nd bunx playwright test -c e2e/web/playwright.config.ts \
  native-controller.pw.ts --project=chromium --project=firefox --project=webkit
```

Unit **19 pass / 0 fail / 76 assertions**。独立controller **15 pass / 0 fail**（5 cases × Chromium/Firefox/WebKit、6.0秒）。j/k・reveal・遠いhash、NFC選択quote・stale拒否、mounted/template補完・batch guard、reservationの画面外release・destroy cleanup、partialのHTML無解釈・refresh保持・confirmed clearを確認した。Svelte-check **0 errors / 0 warnings**。対象Biomeはerrorsなし（fixtureのnon-null assertion警告あり）、diff-check成功。

ログは `/tmp/mitori-native-reader-unit.log`、`/tmp/mitori-native-controller-browser.log`、`/tmp/mitori-native-reader-check.log`。後続のcanonical placeholder分岐を加えた対象fill/partialは5成功とFirefox fillの1失敗を観測した。独立fixtureのEND markerが実製品と異なるzero-area spanで、IntersectionObserver通知を2フレームだけで決めていたため、実markup同様1px read-markと条件待機へ修正し、失敗したFirefoxの1caseだけ再実行して成功。製品read条件は変更していない。証跡 `/tmp/mitori-native-controller-fill.log`、`/tmp/mitori-native-controller-fill-firefox.log`。

途中にdefault globalSetupがBun専用moduleをPlaywright Nodeで静的importして開始前に停止した。`scripts/lib/repo.ts` の `import.meta.dir` がundefinedとなる例外で、ハーネス担当がBun child process経由へ直した。既存controllerの条件やbudgetを変更していない。

## Canonical SSR / full UI 統合

```sh
MITORI_E2E_SKIP_BUILD=1 MITORI_E2E_DIST=/tmp/mitori-ui-current \
MITORI_E2E_SSR=/tmp/mitori-ui-ssr/initial.js MOCK_PORT=4398 \
  scripts/nd bunx playwright test -c e2e/web/playwright.config.ts \
  native-reader.pw.ts --project=chromium --project=firefox --project=webkit
```

実SSR/main/full UI統合は最終 **9成功**（3cases × 3ブラウザー）。matching client/SSR snapshotはui担当のisolated production buildを使用した。

- cold j/k/level/hash/TOC中にfull main・ReaderTools・Composer・loop JavaScriptを取得しない。遠いhashを含むSSR responseは3window/150blocks以下、native viewportの前後1windowを保ちDOM **5,000以下**。
- main chunkを保留した初回selection→`e`、待機中のj/scroll、full UIへの切替後もexact引用がComposerへ届きtextareaがfocusを得る。
- citationをfocusしてmain chunk待機中にEscapeで取消し、後から古いpopoverが復活しない。続くselection→`e`が正常に動く。

最初のcold3caseは新testの「常に150mounted以下」という想定で200を観測して失敗した。既存virtual policyはviewport±1windowなので、対象がwindow境界にある場合は2 visible＋2 neighboursが必要になる。SSR初回150以下とruntime既存DOM上限を分けて確認するtestへ直し、失敗したcold3caseのみ再実行した。製品window algorithmや既存budgetは変更していない。

ログ `/tmp/mitori-native-reader-integrated.log`（最初の3失敗と6成功）、`/tmp/mitori-native-reader-cold-rerun.log`（cold3成功）。この対象検証はmock canonical DTOと実SSR/browser/asset経路の確認であり、実daemon全APIや最終binary buildの証拠ではない。

## 初回操作の回帰修正と最終対象検証

read-only reviewで、termのhover/focus/clickが区別されず、pointer leave後に遅いpopoverが再生される問題と、citationからTabで離れたfocus requestが残る問題を確認した。native actionにviaを付け、pointer leave/downはhover、focusoutはfocusだけを失効する。focusを維持しているcitationはpointerが離れても取消さない。独立controllerに両者の区別を加え、3ブラウザー **3成功**（`/tmp/mitori-native-reader-leave-unit.log`）。最初の15ケースと後続の対象再検証を合わせた証拠であり、18ケースの一括再実行とは区別する。

full UI初回使用を含む既存caseも確認した際、次の実際の回帰を修正した。

- native citationのfocusをfull mount後の新DOMへ復元し、Escape後の`o`を既存pinPeekへ渡す。native pin actionはcite/blob/blockを保持し、現在DTOの同じ引用にだけ適用する。
- nativeのlevel PATCHがまだdebounce中のとき、full mountの古いsettingsがexpertをstandardへ戻していた。未保存levelを既存PrefsStateのqueueへ渡し、既存のversion/retry guardを使う。nativeに別の保存機構は作らない。
- Railの既存keyboard focus selectorにあった`CSS.escapeHtml`をブラウザー標準の`CSS.escape`へ直した。SSR markup/layoutは変えていない。

これらはUI/root担当のcapacity error中に事前共有して行った狭い修正で、`initial/main.ts`、`shell/main.ts`のboot引数と引き継ぎ、Railの1行を含む。

```sh
MITORI_E2E_SKIP_BUILD=1 MITORI_E2E_DIST=/tmp/mitori-native-reader-final \
MITORI_E2E_SSR=/tmp/mitori-native-reader-ssr/initial.js MOCK_PORT=4398 \
  scripts/nd bunx playwright test -c e2e/web/playwright.config.ts \
  native-reader.pw.ts reader-lazy.pw.ts popovers.pw.ts composer-quote.pw.ts code-column.pw.ts \
  --project=chromium --project=firefox --project=webkit
```

対象33ケースは初回 **24成功/9失敗**、原因修正後に失敗のみ **6成功/3失敗**、残るcitation focusを修正して失敗のみ **3成功**。全対象が成功したが、最終sourceで33ケースをまとめて再実行した記録ではない。証跡 `/tmp/mitori-native-reader-final-browser.log`、`/tmp/mitori-native-reader-legacy-rerun.log`、`/tmp/mitori-native-reader-lazy-rerun.log`。新native統合4case×3ブラウザーは、cold j/k/hash/TOC/level、selection→eの引用/focus/scroll維持、Escape取消、citation keyboard focusがpointer leave後も有効であることを含む。

最後の対象svelte-checkは **0 errors / 0 warnings**（`/tmp/mitori-native-reader-check.log`）。matching client/SSRは既存Vite buildをisolated tempへ出力した `/tmp/mitori-native-reader-final` と `/tmp/mitori-native-reader-ssr/initial.js`。共有build directoryは変更していない。

## 最新snapshotの配信量

同じ最新temp snapshotに対し、既存served-byte size probe（Chromium reference、paint markまでの実response encodedBodySize）を実行した。

```sh
MITORI_E2E_SKIP_BUILD=1 MITORI_E2E_DIST=/tmp/mitori-native-reader-final \
MITORI_E2E_SSR=/tmp/mitori-native-reader-ssr/initial.js MOCK_PORT=4398 \
  scripts/nd bunx playwright test -c e2e/web/playwright.config.ts \
  size.pw.ts --project=chromium
```

**2成功**。S1 MapはJS **42.3 KiB gz**、CSS **18.7 KiB gz**。S2 ReaderはJS **42.3 KiB gz**、CSS **14.2 KiB gz**。両方ともJS≤60 KiB/CSS≤25 KiB、font request 0、Review前のCM6取得なし。ログ `/tmp/mitori-native-reader-size.log`。現ソースのこの出荷形式の達成証拠で、最終binaryへ同assetが組み込まれた確認や実daemon全APIの確認とは区別する。全体check・最終出荷buildはroot/ui担当の記録を参照する。
