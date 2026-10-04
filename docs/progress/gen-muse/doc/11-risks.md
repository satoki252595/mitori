# 11. リスクと負債 <!-- b_wvqsgnba -->

## 技術的負債 <!-- b_ahfjg9jw -->

- 移行互換として `LoadCritJSON` からの呼出し削除が残っている（[review\_migrate.go:14](../../internal/session/review_migrate.go#L14)）。
- 移行互換として `ensureReviewFolder` と共に削除予定の処理が残っている（[review\_migrate.go:59](../../internal/session/review_migrate.go#L59)、[review\_migrate.go:72](../../internal/session/review_migrate.go#L72)）。
- 外部互換として `gh` の旧版対応経路の削除が残っている（[github.go:466](../../internal/github/github.go#L466)）。
- 入力保護としてコメント編集中の再読込抑止が残っている（[live-mode.sse.js:95](../../web/live-mode.sse.js#L95)）。
- 補助文書に `main.go` への言及が残っている（[AGENTS.md:44](../../AGENTS.md#L44)）。 <!-- b_ck9xr540 -->

## テストの穴 <!-- b_52cpjxcg -->

全体スタイル定義は web において試験対象外である（推測）。見た目の回帰は自動で検出されず、手動確認が必要になる（推測）。 <!-- b_0kd9zk36 -->

## ホットスポット <!-- b_h1kgt2ea -->

- `AddComment` と `ChangeBaseBranch` が絡むため、internal/session/session.go の対象指定の変更は位置ずれや不整合を招きやすい（[session.go:1282-1303](../../internal/session/session.go#L1282-L1303)、[session.go:2365-2366](../../internal/session/session.go#L2365-L2366)、[session.go:2458-2487](../../internal/session/session.go#L2458-L2487)）。
- `withReady` や `Notify` の付け忘れが起こりやすいため、internal/server/server.go の経路追加時の分岐に注意が要る（[server.go:170-176](../../internal/server/server.go#L170-L176)、[server.go:1886-1894](../../internal/server/server.go#L1886-L1894)、[server.go:1904-1905](../../internal/server/server.go#L1904-L1905)）。
- `ParseUnifiedDiff` が入力の揺れを吸収するため、internal/vcs/git.go の書式判定の変更は正常系を壊しやすい（[git.go:1511-1515](../../internal/vcs/git.go#L1511-L1515)、[git.go:1547-1549](../../internal/vcs/git.go#L1547-L1549)、[git.go:360-366](../../internal/vcs/git.go#L360-L366)、[git.go:477-478](../../internal/vcs/git.go#L477-L478)）。
- `bodyHashAtPush` と `AtomicWriteFile` に依存するため、internal/github/github.go の判定や保存の変更は見落としや半端な保存を招きやすい（[github.go:1044-1048](../../internal/github/github.go#L1044-L1048)、[github.go:1130-1134](../../internal/github/github.go#L1130-L1134)）。
- `buildCommentCard` と `pierreViewActive` が広範囲に影響するため、web/app.js の表示状態の変更は波及しやすい（[app.js:4935-4963](../../web/app.js#L4935-L4963)、[app.js:234-237](../../web/app.js#L234-L237)、[app.js:7126-7128](../../web/app.js#L7126-L7128)、[app.js:1648](../../web/app.js#L1648)）。 <!-- b_r3vy3990 -->

## 壊れやすい箇所 <!-- b_hy32cq3h -->

> [!WARNING]
> **落とし穴**
> - 欠損を読み飛ばして空で続ける処理が internal/review と web にまたがるため、`findReviewFileByBranch` と `MatchingLiveSessions` と `fetchJSON` の変更は空応答の条件を変えやすい（[review\_file.go:498-512](../../internal/review/review_file.go#L498-L512)、[review\_file.go:204-216](../../internal/review/review_file.go#L204-L216)、[crit-shared.js:23-35](../../web/crit-shared.js#L23-L35)）。
> - `DefaultShareURL` が重複するため、internal/config と internal/share の片側のみの更新は公開先の不整合を招く（[config.go:17](../../internal/config/config.go#L17)、[share.go:27](../../internal/share/share.go#L27)）。
> - 削除処理が付随物を共に消すため、`RemoveSessionFile` の誤呼出しは復旧情報を失う（[daemon.go:297-307](../../internal/daemon/daemon.go#L297-L307)）。
> - 識別子の保存が原子性を前提とするため、`AtomicWriteFile` を外すと中断時に半端な状態が残る（[github.go:1130-1134](../../internal/github/github.go#L1130-L1134)）。
> - 基準枝の変更が複数記録の移送を伴うため、`ChangeBaseBranch` の片側のみの更新は不整合を残す（[session.go:2365-2366](../../internal/session/session.go#L2365-L2366)、[session.go:2458-2487](../../internal/session/session.go#L2458-L2487)）。 <!-- b_y3pmx9cy -->

| 印 | 内容 | 場所 |
|---|---|---|
| TODO | remove this function and its call from LoadCritJSON | `internal/session/review_migrate.go:14` |
| TODO | delete with ensureReviewFolder. | `internal/session/review_migrate.go:59` |
| TODO | delete with ensureReviewFolder. | `internal/session/review_migrate.go:72` |
| TODO | Remove this compatibility path once Crit requires gh v2.48.0+, | `internal/github/github.go:466` |
| TODO | skip the reload if a comment composer is currently focused | `web/live-mode.sse.js:95` |
| TODO | at `main.go:1826`). | `AGENTS.md:44` |
<!-- b_4abnpb9j -->

- （検出されませんでした）
<!-- b_0pw59wkj -->
