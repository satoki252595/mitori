# レビュー状態管理（internal） <!-- b_d4b2pc8h -->

- ファイル 22 · 5383 行 · 重要度 0.47
<!-- b_656e4q5z -->

> [!NOTE]
> **この章で分かること**
> - `Session` がレビュー状態をどう保持するか
> - コメントと `CritJSON` の構造
> - 遅延読み込み・通知・ロックの扱い <!-- b_jfxmvstk -->

## 責務 <!-- b_vfjrzbsp -->

このモジュールはレビューセッションの状態（変更ファイル、コメント、ラウンド、共有情報）を `Session` に集約する（[session.go:416-431](../../../internal/session/session.go#L416-L431)）。状態は `CritJSON` としてディスクへ保存・復元される（[session.go:540-555](../../../internal/session/session.go#L540-L555)）。差分の算出自体は `vcs.VCS` に委ねている（[session.go:416-418](../../../internal/session/session.go#L416-L418)）。 <!-- b_erhajhgq -->

## 公開インターフェース <!-- b_7q7vbaee -->

- `NewGitSession` / `NewSessionFromFiles`: git 変更またはファイル指定からセッションを作る（[session.go:829-835](../../../internal/session/session.go#L829-L835)、[session.go:1000](../../../internal/session/session.go#L1000)）。
- `AddComment` / `AddReply` / `ResolveReviewComment`: コメント、返信、解決の操作（[session.go:1282](../../../internal/session/session.go#L1282)、[session.go:1799](../../../internal/session/session.go#L1799)、[session.go:1483](../../../internal/session/session.go#L1483)）。
- `Subscribe` / `Unsubscribe`: SSE 購読チャネルの登録と解除（[session.go:2811-2827](../../../internal/session/session.go#L2811-L2827)）。
- `GetSessionInfo`: UI 向けの `SessionInfo` を返す（[session.go:3004-3037](../../../internal/session/session.go#L3004-L3037)）。 <!-- b_zv163dk9 -->

## データ構造 <!-- b_51abepg0 -->

- `Comment`: 行範囲、本文、解決状態、`Replies`、GitHub/GitLab の ID などを持つ（[session.go:129-163](../../../internal/session/session.go#L129-L163)）。
- `FileEntry`: ファイルのパス、状態、内容、差分、コメントを持つ（[session.go:210-218](../../../internal/session/session.go#L210-L218)）。
- `CritJSON`: ブランチ、ラウンド、共有情報、ファイル別コメントのマップを持つ保存形式である（[session.go:540-555](../../../internal/session/session.go#L540-L555)）。
- `Story`: 章（`StoryChapter`）で差分のハンクを並べる物語表現である（[session.go:611-621](../../../internal/session/session.go#L611-L621)）。 <!-- b_p5hcbq6c -->

## 設定 <!-- b_c8wp4w1h -->

環境変数 `CRIT_DEBUG` は `internal/session/session.go` 内で参照される（[session.go:2508-2512](../../../internal/session/session.go#L2508-L2512)）。 <!-- b_wc8jpqja -->

## 並行性 <!-- b_1sefg01s -->

`Session` は `sync.RWMutex` で状態を守り、購読者は別の `subMu` で管理する（[session.go:487-489](../../../internal/session/session.go#L487-L489)）。書き込みには `writeMu` と遅延タイマーが使われる（[session.go:490-498](../../../internal/session/session.go#L490-L498)）。 <!-- b_be7qs42g -->

## 性能 <!-- b_12zj48cd -->

`lazyFileThreshold` は 25 で、`FileEntry.Lazy` により内容と差分の読み込みを後回しにできる（[session.go:35](../../../internal/session/session.go#L35)、[session.go:231](../../../internal/session/session.go#L231)）。読み込みは `sync.Once` で一度だけ行われる（[session.go:231-233](../../../internal/session/session.go#L231-L233)）。 <!-- b_bs01f01d -->

> [!TIP]
> **まとめ**
> `internal/session` はレビュー状態の保持、永続化、通知を担う中核である。 <!-- b_cfnwhpv0 -->
