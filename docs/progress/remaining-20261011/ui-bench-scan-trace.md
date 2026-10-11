# 初回 scanSummary の状態競合（2026-10-11）

対象: Issue #10。先の compiled perf の `ui.scanSummary` 3,312.1 / limit 2,000 ms を内部 read/probe の 1 回診断で追跡した。実 LLM 呼び出し・新規依存はない。既存 corpus の一時コピーと一時 `MITORI_HOME`、プロジェクト Nix、実 source daemon、既存 SSR build を使った。待受と probe は正規 escalation で実行し、生成呼び出しは診断 spawner が拒否した。

## 原因と最小修正

初回 `/ui` の renderer は workspace status と doc outline を同時取得していた。doc は `staticReady()` を待つが status は先に `scanning` / summary なしで確定する。その後に完成した doc/map を返しても snapshot の status は古いまま。native client の summary/facts mark は snapshot の summary を要求するため初回に出ず、SSE の refresh 後の二度目の `/ui` まで待っていた。

map の `/ui` は live `/engines` を待つ。Claude の detect は problems なしだけを 10 分 cache するので、未ログインでは version/auth/help の probe が再実行される。二度目の SSR がこの検出を繰り返していた。gen の dry estimate に detect 呼び出しはない。map layout も今回の主要な待ちではない。

`apps/web/src/initial/server.ts` の status GET だけを doc outline 完了後へ移した。描画対象の文書と status/summary が揃い、初回画面で summary/facts mark を出せる。map の live 検出、Reader の cached engine status、明示的な再検出は保つ。

## 証拠

`ui-bench-scan-trace.json` に内部 read と probe の開始/終了を保存した。時刻は daemon start 起点、単位 ms。workspace ID は `WS` に置き換え、nonce/token、認証出力、prompt、コード本文は保存していない。

| 内部 phase | 修正前 | 修正後 |
|---|---:|---:|
| staticReady 完了 | 1,164.8 | 1,031.7 |
| live `/engines` 完了 | 1,263.3 | 1,145.8 |
| map GET 所要 | 6.0 | 5.2 |
| dry estimates 最大所要 | 443.0 | 397.7 |
| 初回 HTTP 応答完了 | 1,721.0 | 1,558.2 |
| 返却 state / summary | scanning / なし | ready / 1,219 files |

source daemon の module import、CLI の起動、ブラウザ paint を含まない 1 回診断なので、この数値から時間予算の正式合格は主張しない。根拠は古い state を返す競合と、二度目の SSR を要求しない初回表示の回帰である。

- 新 cold scan 回帰を旧 SSR で実行: 初回 `mitori:scan:summary` がなく 10 秒で失敗し、症状を再現。
- 修正後 SSR のみを一時 build（939 ms）して同じ回帰: 1 request / 218 ms で成功。
- 既存 Reader の engine 再検出なし回帰: 23 ms で成功。2 tests / 714 ms / 0 fail。
- 変更した renderer と e2e 5 ファイルの Biome: exit 0。

その後の統合 compiled build/perf は raw `ui.scanSummary` 1,771.5 ms（元 limit 2,000 ms）まで改善した。factor 1.12 のため正式な基準機 verdict は report-only。最新の結果は `ui-bench-release.md/json`。予算、factor、retry、skip は変更していない。
