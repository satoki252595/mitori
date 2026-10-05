# Firefox / WebKit 機能検証（2026-10-05）

Playwright 1.63.0 の Firefox / WebKit に `e2e/web/*.pw.ts` 全機能ケースを開放した。初回は固定した 11:18 JST の `dist/.build/web` を使用し、102 ケースずつ実行した。追加 LLM 呼び出し・課金は 0。

| 初回全体実行 | pass | fail / timeout | 明示 skip |
|---|---:|---:|---:|
| Firefox | 92 | 3 | 7 |
| WebKit | 88 | 7 | 7 |
| 合計 | 180 | 10 | 14 |

10 件の失敗は以下の原因を修正し、該当単位だけ再実行してすべて解消した。既存の時間・DOM・横スクロール閾値は変更していない。

- Firefox の SVG `<a>` の bounding box は、その子の可視 `rect.fl` と位置が異なった。Playwright の中心クリックが隣の部屋へ当たるため、テストは見えている床へ通常のクリックを行う。強制クリック・合成イベントは使用しない。
- 引用フォーカス後に `o` を押すと、遅れて届いた引用応答が閉じた Peek を再表示し、Escape が Peek だけを閉じた。Reader は close / pin 時に未完了応答を無効化し、最新の接続中アンカーだけを表示する。
- WebKit では選択直後の最初の `e` が、遅延読み込み中の SelectionToolbar に届かず、Reader の未選択ブロック用のヒントに終わった。キー時点の Range を保持し、既存の `anchorFromRange` / `targetOf` / `openComposer` を読み込み後に呼ぶ。既存の `selectionClaim` による二重処理防止と workspace / page 照合を保つ。Composer を開くだけで送信しない。
- WebKit はボタンのマウスクリックでフォーカスを与えず、Export の復帰先が本文になった。Settings の既存ボタンは開く前に自身へフォーカスし、既存 LayerStack の復帰処理を利用する。
- context column の即時固定幅と 320ms の grid track 遷移が二重に働き、4 幅で 1px の横スクロールが生じた。column は grid track の幅に従う。sheet / overlay の既存幅、本文、コード、幅変更操作は保持する。

局所修正後の `/tmp/mitori-crossbrowser-fixed` はその時点の native Header / Rail も含む独立 build。全体を重複実行せず、修正が作用するケースと新規共通ケースを検証した。

| 修正後の対象実行 | 結果 |
|---|---:|
| Firefox / WebKit: 即時 Escape、選択直後 `e`、Export マウス復帰、失敗した code 4 幅 | 14 pass |
| Chromium: 同じ 3 操作と code 全 7 幅 | 10 pass |
| 全 3 エンジン: Map の初回表示、部屋→カード→Reader、flow 操作 | 9 pass |
| Chromium: 新規 Inbox 200→200→100 cursor / 500 行表示 | 1 pass |

新規 Inbox ケースは Firefox / WebKit の初回全体実行でも通過しており、3 エンジンで共通確認できた。`check:web` は 0 errors / 0 warnings、`tsc -p e2e/tsconfig.json --noEmit` と対象 Biome も通過。

Reader / Map / Settings / Export / routes / 10,000 blocks / pagination などの機能確認は各エンジンで実行する。CDP の heap / listener、layout-shift の CLS、Chromium 基準の時間・配信サイズ予算は対象外エンジンで明示 skip または `skip-metric` annotation とし、未対応値を 0 として扱わない。10,000-block ケースの最大 DOM は Firefox 1,916、WebKit 2,446。heap 値は両方 `null`。

trusted CDP IME は Chromium 専用で、Firefox / WebKit は DOM composition イベント順序の再生 2 ケースずつを実行した。これはネイティブ IME 操作の実測ではない。Playwright WebKit とネイティブ Safari は区別し、ロック中 Safari の実測完了は主張しない。

集計・失敗理由・除外メトリクス・観測値は [results.json](results.json)。大きな元レポートは `/tmp/mitori-crossbrowser-initial-report.json`、修正後の元レポートは `/tmp/mitori-crossbrowser-{fixed,chromium,map,pagination}-report.json` に保存した。

再現例（既存 Nix runtime、独立 build）:

```sh
scripts/nd bunx vite build --config apps/web/vite.config.ts --outDir /tmp/mitori-crossbrowser-fixed --logLevel warn
MITORI_E2E_SKIP_BUILD=1 MITORI_E2E_DIST=/tmp/mitori-crossbrowser-fixed MOCK_PORT=4367 \
  scripts/nd bunx playwright test -c e2e/web/playwright.config.ts --project=firefox --project=webkit
```

上のコマンドは新しい build の全体再実行用。ここで記録した全体結果は固定 11:18 build と、修正後の対象再実行を組み合わせた証拠であり、更新後 build の全件再実行という意味ではない。Git HEAD は `815957fd01fb4856b5ae8d3aa2091edd1ddd263f` + uncommitted changes。
