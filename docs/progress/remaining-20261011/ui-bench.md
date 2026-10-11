# UI bench の再現・修正記録（2026-10-11）

対象: [Issue #4](https://github.com/satoki252595/mitori/issues/4)、[Issue #10](https://github.com/satoki252595/mitori/issues/10)。基点 `06ed15f`、共有作業ツリー上の変更。LLM 呼び出し・新規依存・追加費用はない。開発は `scripts/nd`。ブラウザ・build・重い測定は他担当の計測と同時実行しない。予算や件数上限は変更せず、失敗対象だけを再実行した。

## 原因と変更

- **case 0 件**: checkout の祖先に `node_modules` があると、探索が絶対パス全体を除外していた。bench 内の相対パスで除外する。既存の runner 移設先 `.mitori/cache/github-runner` と合わせ、旧 Node の TS config 読込制限も避ける。
- **optimistic / stale timeout**: newcomer で非表示の旧 token 文言ではなく、送信可能なボタンと実際の開示を待つ。stale は仮想表示範囲外の引用アンカーへ移動し、対象ブロック描画後の変更 → SSE badge を測る。
- **最大文書 timeout**: 初回 `goto(load)` の後、nonce 認証を次の navigation で中断していた。初回の描画 mark を待つ。また read-progress の有効な `appendix` が `/ui` に拒否される製品不具合を直した。
- **Reader 36 requests**: native map/Reader の base 翻訳と keymap を boot に含め、canonical CSS を 1 枚にする。設定は canonical `/ui` snapshot を使う。初回 expert/en と後から変更した newcomer/ja を実ブラウザで確認した。
- **Reader の実遅延**: canonical SSR が節移動ごとに live `GET /engines` を呼び、ログアウト中の Claude 再検出に約 1.4 秒かかっていた。Reader は同時取得済み workspace status の engines を使用する。map と利用者の「再検出」は live のまま。mock で Reader の内部 engine GET がないことを確認した。
- **section の計測対象**: 実 click event timestamp → paint を測る。action 開始 → paint と actionability 待ちは別 annotation に保持する。リンクを Reader の `.toc` に限定し、header の設計書リンクによる full navigation が混ざる問題も直す。対象だけ実行しても Reader を開く。
- **初回 scanSummary の状態競合**: status を doc/staticReady より先に読み、完成した画面にも `scanning` / summary なしを返していた。status GET を outline 完了後へ移す。旧 SSR では初回 summary mark timeout、新 SSR では 1 request で描画、実 source daemon も ready / 1,219 files を返すことを確認。live `/engines` の二度目の待ちを要求しない。詳細は `ui-bench-scan-trace.md/json`。
- **shell paint**: workspace open 直後へ announce を移し、scan/static doc の完了を待たずログイン URL を発行する。`/ui` 内の doc/map は既存 `staticReady()` を待ち、scan 完了・nonce・エラー経路は保つ。
- **lazy assets**: map の room/dialog/engine 問題/進捗/生成完了カード、閉じた生成内訳を必要な状態だけで読む。SSR は同期部品で従来の内容を出す。native で既に見える部品は DOM 手渡し前に読み、最初のクリックを保つ。palette は入力後に action registry、通常の本文検索でのみ全文 index、AI 質問実行時にのみ ask helper を読む。CodeMirror の共通 editor/language/Lezer を共有 chunk にまとめ、merge は diff 実装だけにする。機能を削っていない。
- **precompression 94.96%**: 小 facade は Brotli のみ 5% 以上節約でき、旧処理は gzip を保存しなかった。どちらか一方が 5% 以上節約するファイルには br/gz 両形式を保存する。両方とも得にならないファイルは raw のまま。

## 最終統合確認

Settings guided Codex と初回 status 競合修正を含めて最終 host build・strict asset・compiled perf・a11y を確認した。最新証拠は `ui-bench-release.md/json`。初期 JS 54.639 KB、CSS 18.100 KB、gen 6.890 / limit 6.900 KB。scanSummary は raw 1,771.5 / 元 limit 2,000 ms へ改善、factor 1.12 のため時間判定は report-only。Reader 6 requests / 50.2 ms、a11y 8 pass。TOC の click 前 mark 混入もハーネスで直し、対象のみ再実行して全 6 操作が有限・非負になった。

## 検証

| 検証 | 結果 | 記録 |
|---|---|---|
| discovery regression / UI list | 7 pass、21 assertions / 24 cases | `ui-bench-selection.json` |
| i18n / first-run unit | 9 pass、800 assertions | 当日ローカル結果 |
| optimistic / codeLines / stale、各 3 samples | 全成功、median 29.6 ms / 361 nodes / 30 ms | `ui-bench-targets-initial.json` |
| 失敗した max 3 件のみ再実行、各 3 samples | DOM 10,366 / 入力 p95 14.3 ms / review 10,366 DOM | `ui-bench-max-fixed.json` |
| compiled binary / Node perf worker | 13 pass、機能・カウンター成功、timing は report-only | `ui-bench-perf.json` |
| first-run / initial / palette / gen / map browser | 初回 32 pass / 4 fail → 失敗した初回 click 4 件を修正、4 pass | `ui-bench-lazy.json` |
| 生成完了 / 内訳 / 生成ボタン browser | 2 pass / 1 selector 誤り → Reader の実ブロックへ直して 1 pass | `ui-bench-lazy.json` |
| precompression regression | 1 pass、9 assertions | `ui-bench-lazy.json` |
| compiled 5,000 行 review diff | 1 pass、DOM 上限内 | `ui-bench-lazy.json` |
| compiled Chromium a11y 最終 | 8 pass / 9.0 s、light/dark map/Reader、違反 0 | `ui-bench-a11y-final.json` |
| web TypeScript / Svelte | pass / 0 errors・0 warnings | `ui-bench-lazy.json` |
| host binary build | pass | `ui-bench-lazy.json` |
| served assets / strict | **全項目 pass**、元の上限を維持 | `ui-bench-assets.json` |
| final compiled perf の対象 4 件 | 4 pass / 14.9 s、Reader 6 requests、TOC 6 操作 | `ui-bench-perf-final.json` |

## 最終の実取得とサイズ

compiled binary の診断で Reader は **6 requests / 47.1 ms / 2,058 DOM**。節移動の実 click → paint は native **65.2 / 31.7 / 32.1 ms**、enhanced **31.9 / 32.0 / 16.1 ms**。通常の Reader 移動には engine 検出がなく、明示的な live `/engines` 診断は 1,466.1 ms。この診断は Reader 計測後に行った。詳細は `ui-bench-latency-final.json`。nonce・token は保存せず、workspace ID は `WS` に置き換えた。

1. `/w/WS/doc/s8`（document）
2. `/assets/boot-BxpKEnWT.js`
3. `/assets/rolldown-runtime-DK3Fl9T5.js`
4. `/assets/initial-CxGPntV5.css`
5. `/api/v1/ws/WS/ui`
6. `/api/v1/events`（SSE）

最終の strict asset 実測: 初期 JS **54.639 KB gzip** / 約 47.9 KB Brotli、CSS **18.100 KB gzip**、font 0 B。gen **6.888 / limit 6.900 KB**、merge **9.611 / 11.500 KB**、palette **4.520 / 4.600 KB**、cm6 + merge **101.277 / 155.000 KB**、precompression **100% / 100%**。gen の余裕は小さいため今後も strict を維持する。target より大きい CSS/gen/palette は warning だが limit はすべて満たす。以前の不合格値も asset JSON の `before` に残した。

## 残る確認と担当

- 時間予算は基準機・静穏条件で判定する。初回の Node perf は factor 1.12〜1.18 / load 10〜11 のため report-only。最終対象 4 件は Node Playwright の直接実行で factor 未測定のため、超過 timing は report-only。構造・カウンターと機能の成功を時間予算の正式合格へ読み替えない。
- early announce 後の shell paint は診断 914.8 ms と最終診断 230.5 ms で変動した。単発の 230.5 ms のみで恒常的な 500 ms 達成を主張しない。firstUseful は最終診断 3,274.8 ms。final perf は shell 282.5 ms、firstUseful 3,469.5 ms（limit 5,000 ms）、scanSummary **3,312.1 ms / limit 2,000 ms**。この測定時点の scanSummary は未達。その後 status 先取りの競合を直して初回 summary 描画の回帰は成功したが、最終 compiled timing は 1,771.5 ms まで改善した。factor 1.12 のため正式な基準機 verdict は report-only（`ui-bench-release.md/json`）。
- 旧 nightly `idx.s01.cold.7kfiles` 1,880 / limit 1,500 ms は indexer / cold 担当が根本調査中。旧 job は log のみ、child timing JSON はない。
- 共有作業ツリー全体の最終 `check`・commit・CI は root が他担当完了後に実施する。偽の factor override、skip、上限緩和は行っていない。
