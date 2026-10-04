# 11. リスクと負債 <!-- b_wvqsgnba -->

## 技術的負債 <!-- b_ahfjg9jw -->

- 移行互換の関数と `LoadCritJSON` からの呼び出し削除が残っている（[review\_migrate.go:14](../../internal/session/review_migrate.go#L14)）。
- `ensureReviewFolder` と共に削除予定の互換処理が 2 箇所残っている（[review\_migrate.go:59](../../internal/session/review_migrate.go#L59)、[review\_migrate.go:72](../../internal/session/review_migrate.go#L72)）。
- `gh` が v2.48.0 以上必須になったら互換経路を削除する予定である（[github.go:466](../../internal/github/github.go#L466)）。
- コメント入力欄にフォーカスがある場合の再読み込み抑止が未実装である（[live-mode.sse.js:95](../../web/live-mode.sse.js#L95)）。 <!-- b_ck9xr540 -->

## テストの穴 <!-- b_52cpjxcg -->

全体スタイル定義は試験対象外として挙げられている（推測）。 <!-- b_0kd9zk36 -->

## ホットスポット <!-- b_h1kgt2ea -->

- internal/session/session.go では `AddComment` と `ChangeBaseBranch` が絡むため、対象指定の変更は位置ずれや不整合を招きやすい（[session.go:1282-1303](../../internal/session/session.go#L1282-L1303)、[session.go:2365-2366](../../internal/session/session.go#L2365-L2366)、[session.go:2458-2487](../../internal/session/session.go#L2458-L2487)）。
- internal/server/server.go では `withReady` の付け忘れや `Notify` の呼び忘れが未 ready 素通しや未配信を招く（[server.go:170-176](../../internal/server/server.go#L170-L176)、[server.go:1886-1894](../../internal/server/server.go#L1886-L1894)、[server.go:1904-1905](../../internal/server/server.go#L1904-L1905)）。
- internal/vcs/git.go では `ParseUnifiedDiff` が先頭行の揺れを吸収するため、正常系境界の変更に注意が要る（[git.go:1511-1515](../../internal/vcs/git.go#L1511-L1515)、[git.go:1547-1549](../../internal/vcs/git.go#L1547-L1549)、[git.go:360-366](../../internal/vcs/git.go#L360-L366)、[git.go:477-478](../../internal/vcs/git.go#L477-L478)）。
- internal/vcs/git.go では `ResolveDefaultBranchSHA` の失敗時縮退があるため、全体失敗化の変更に注意が要る（[git.go:759-762](../../internal/vcs/git.go#L759-L762)、[git.go:1111-1113](../../internal/vcs/git.go#L1111-L1113)）。
- internal/github/github.go では本文比較が `bodyHashAtPush` と `LastPushedBodyHash` に依存し、保存が `AtomicWriteFile` に依存するため、照合漏れや中断時不整合を招きやすい（[github.go:1044-1048](../../internal/github/github.go#L1044-L1048)、[github.go:1130-1134](../../internal/github/github.go#L1130-L1134)）。
- web/app.js では `buildCommentCard` 越しの全体波及と `pierreViewActive` による対象切替えがあるため、表示変更の影響範囲が広い（[app.js:4935-4963](../../web/app.js#L4935-L4963)、[app.js:234-237](../../web/app.js#L234-L237)、[app.js:7126-7128](../../web/app.js#L7126-L7128)、[app.js:1648](../../web/app.js#L1648)）。 <!-- b_r3vy3990 -->

## 壊れやすい箇所 <!-- b_hy32cq3h -->

> [!WARNING]
> **落とし穴**
> - internal/review と web にまたがり、`findReviewFileByBranch` の警告付きスキップや `MatchingLiveSessions` の空続行や `fetchJSON` の空値化が分散する（[review\_file.go:498-512](../../internal/review/review_file.go#L498-L512)、[review\_file.go:204-216](../../internal/review/review_file.go#L204-L216)、[crit-shared.js:23-35](../../web/crit-shared.js#L23-L35)）。
> - `DefaultShareURL` の定義が全体設定と共有処理に分散し、片側更新では食い違う（[config.go:17](../../internal/config/config.go#L17)、[share.go:27](../../internal/share/share.go#L27)）。
> - `RemoveSessionFile` が作業記録と排他制御も消去するため、片付け範囲の変更は消去漏れや過剰消去を招く（[daemon.go:297-307](../../internal/daemon/daemon.go#L297-L307)）。
> - `ChangeBaseBranch` が保持と移送の両方を要するため、片側のみの変更は不整合を招く（[session.go:2365-2366](../../internal/session/session.go#L2365-L2366)、[session.go:2458-2487](../../internal/session/session.go#L2458-L2487)）。
> - 行検証前の分岐後に `Notify` を欠くと他画面へ届かないため、通知漏れに注意が要る（[server.go:1886-1894](../../internal/server/server.go#L1886-L1894)、[server.go:1904-1905](../../internal/server/server.go#L1904-L1905)）。 <!-- b_y3pmx9cy -->

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
