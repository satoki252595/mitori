# 11. リスクと負債 <!-- b_1k65jrby -->

## 技術的負債 <!-- b_frk8mqxn -->

- `internal/session/review_migrate.go` の移行関数は、`LoadCritJSON` からの呼び出しごと削除する予定になっている（[review\_migrate.go:14](../../internal/session/review_migrate.go#L14)）。
- 同ファイルの残り2か所も `ensureReviewFolder` と一緒に消す前提で、移行コードが三点に分かれて残っている（[review\_migrate.go:59](../../internal/session/review_migrate.go#L59)、[review\_migrate.go:72](../../internal/session/review_migrate.go#L72)）。
- `internal/github/github.go` の互換パスは、Crit が gh v2.48.0 以上を必須にした時点で削除する対象である（[github.go:466](../../internal/github/github.go#L466)）。
- `web/live-mode.sse.js` には、コメント入力欄にフォーカスがある間はリロードを控える処理が未実装のまま残っている（[live-mode.sse.js:95](../../web/live-mode.sse.js#L95)）。 <!-- b_px6sw331 -->

## テストの穴 <!-- b_8j4m3eat -->

本体スタイルシートの `web/style.css`（約6800行）は、テストを持たないモジュールとして挙がっている（推測）。 <!-- b_ewx3ntfd -->

## ホットスポット <!-- b_vj7ssfda -->

- `internal/session/session.go` の `ChangeBaseBranch` は、ロックの外でVCS処理を行い、差し替え直前にコメントを取り直す。変更時はこの順序を崩すと、処理中のコメント編集が失われる（[session.go:2458-2466](../../internal/session/session.go#L2458-L2466)）。
- 同関数はファイルパスの変更時に削除墓標 `deletedCommentIDs` も移す。パスを扱う変更では墓標の移し替えも見る必要がある（[session.go:2467-2480](../../internal/session/session.go#L2467-L2480)）。
- `internal/vcs/git.go` の `ParseUnifiedDiff` は、空白が落ちた空行を境界内に限って復元する。境界判定を変えると末尾の空要素が行として混ざる（[git.go:1575-1587](../../internal/vcs/git.go#L1575-L1587)）。
- `internal/server/server.go` には新ルートを足すたびに登録方法の選択が要るため、追加時に判断を忘れやすい（[server.go:135-148](../../internal/server/server.go#L135-L148)）。 <!-- b_vy40aezb -->

## 壊れやすい箇所 <!-- b_69m0f6ta -->

> [!WARNING]
> **落とし穴**
> - 設定の `ConfigPresence` に bool 項目を足すときは、`LoadConfigFile` の検出と `mergePresenceBools` の両方を直す必要があり、片方だけだと設定のマージが静かにずれる（[config.go:293-304](../../internal/config/config.go#L293-L304)、[config.go:393](../../internal/config/config.go#L393)）。
> - レビューファイルの探索では、壊れたJSONは警告だけでスキップされる。同じブランチに複数ファイルがあると `errReviewFileAmbiguousForBranch` になる（[review\_file.go:507-513](../../internal/review/review_file.go#L507-L513)、[review\_file.go:514-531](../../internal/review/review_file.go#L514-L531)）。
> - GitHubへのコメント同期では、新規コメントへのID書き戻しが `path:EndLine` のキーに依存している（[github.go:1346-1347](../../internal/github/github.go#L1346-L1347)）。
> - デーモンの `DaemonHasBrowser` は、到達不能やJSON不正でも「ブラウザあり」と扱い、誤って停止しない側に倒している（[daemon.go:553-576](../../internal/daemon/daemon.go#L553-L576)）。
> - `ChangeBaseBranch` は変更ファイル検出に失敗すると、基準ブランチの上書き値を元に戻してエラーを返す（[session.go:2386-2419](../../internal/session/session.go#L2386-L2419)）。 <!-- b_g4jvpf83 -->

| 印 | 内容 | 場所 |
|---|---|---|
| TODO | remove this function and its call from LoadCritJSON | `internal/session/review_migrate.go:14` |
| TODO | delete with ensureReviewFolder. | `internal/session/review_migrate.go:59` |
| TODO | delete with ensureReviewFolder. | `internal/session/review_migrate.go:72` |
| TODO | Remove this compatibility path once Crit requires gh v2.48.0+, | `internal/github/github.go:466` |
| TODO | skip the reload if a comment composer is currently focused | `web/live-mode.sse.js:95` |
| TODO | at `main.go:1826`). | `AGENTS.md:44` |
<!-- b_t16rgrxs -->

- （検出されませんでした）
<!-- b_9xy7v3q6 -->
