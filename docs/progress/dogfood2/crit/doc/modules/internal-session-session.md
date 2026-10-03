# レビューセッション管理（internal） <!-- b_3fd2wgrq -->

- ファイル 18 · 5850 行 · 重要度 0.49
<!-- b_ndrnbrh7 -->

> [!NOTE]
> **この章で分かること**
> - レビューセッション `Session` が保持する状態と、その生成方法
> - コメントの追加・取得と、review.json への書き出し
> - ラウンド完了時にコメントを新しい内容へ引き継ぐ仕組み <!-- b_yt9m01qg -->

## 責務 <!-- b_nnck8dhw -->

このモジュールはレビュー対象のファイル群、コメント、レビューラウンドをメモリ上で管理する `Session` を提供する。git モードとファイルモードの両方でセッションを作り、変更を監視して差分を更新し、コメントを review.json に永続化する（[session.go:416-431](../../../internal/session/session.go#L416-L431)）。行単位の差分計算は `internal/diff` の `ComputeLineDiff` に分かれている（[diff.go:37](../../../internal/diff/diff.go#L37)）。VCS 操作そのものは `vcs.VCS` インターフェース越しに行い、このモジュールでは実装しない（[session.go:416-418](../../../internal/session/session.go#L416-L418)）。 <!-- b_nt1qmk42 -->

## 公開インターフェース <!-- b_g7w62xaf -->

- `NewSessionFromFiles` は明示的に指定したファイルからセッションを作る（[session.go:1000-1003](../../../internal/session/session.go#L1000-L1003)）。
- `NewGitSession` と `NewGitSessionLenient` は VCS から変更ファイルを検出して作る（[session.go:829](../../../internal/session/session.go#L829)、[session.go:835](../../../internal/session/session.go#L835)）。
- `AddComment`、`AddFileComment`、`AddLivePin` は行・ファイル・DOM ピンのコメントを追加する（[session.go:1282](../../../internal/session/session.go#L1282)、[session.go:1327](../../../internal/session/session.go#L1327)、[session.go:1354](../../../internal/session/session.go#L1354)）。
- `GetComments` は現在の focus で見えるコメントだけを返す（[session.go:1870-1890](../../../internal/session/session.go#L1870-L1890)）。
- `SetFocus` は作業ツリーと範囲（PR など）の表示対象を切り替える（[session\_focus.go:226](../../../internal/session/session_focus.go#L226)）。
- `ChangeBaseBranch` は基準ブランチを変更して差分を再計算する（[session.go:2365-2375](../../../internal/session/session.go#L2365-L2375)）。
- `Subscribe` と `Unsubscribe` は SSE イベントの購読口である（[session.go:2811](../../../internal/session/session.go#L2811)、[session.go:2820](../../../internal/session/session.go#L2820)）。 <!-- b_10v0574q -->

## データ構造 <!-- b_pywvg370 -->

- `Comment` は行範囲、本文、`Anchor`、`Resolved`、`ReviewRound`、`Replies` などを持つ（[session.go:129-163](../../../internal/session/session.go#L129-L163)）。
- `FileEntry` は差分ハンクと内容を保持し、`Lazy` ファイルは `loadOnce` で一度だけ読み込む（[session.go:231-233](../../../internal/session/session.go#L231-L233)）。
- `CritJSON` は review.json の形で、`Files` はパスをキーにした `CritJSONFile` のマップである（[session.go:540-555](../../../internal/session/session.go#L540-L555)、[session.go:671-675](../../../internal/session/session.go#L671-L675)）。
- `Focus` は `FocusWorkingTree` か `FocusRange` かを `Kind` で表す（[session\_focus.go:17-23](../../../internal/session/session_focus.go#L17-L23)、[session\_focus.go:45-46](../../../internal/session/session_focus.go#L45-L46)）。 <!-- b_5sp8f9d5 -->

## 処理の流れ <!-- b_5pg8a5p6 -->

1. `AddComment` はロックを取り、対象の `FileEntry` を探す（[session.go:1283-1288](../../../internal/session/session.go#L1283-L1288)）。
2. 行範囲から `anchor` を抽出し、old 側のコメントは基準 ref の内容から取る（[session.go:1292-1303](../../../internal/session/session.go#L1292-L1303)）。
3. `StampWithFocus` で現在の focus を刻印したコメントを追加する（[session.go:1306-1321](../../../internal/session/session.go#L1306-L1321)）。
4. `scheduleWrite` で review.json への書き出しを予約する（[session.go:1322-1323](../../../internal/session/session.go#L1322-L1323)）。 <!-- b_0mq5q4gq -->

## 設定 <!-- b_xjz78w30 -->

- 環境変数 `CRIT_DEBUG` は `internal/session/session.go` で参照される（[session.go:2508-2512](../../../internal/session/session.go#L2508-L2512)）。 <!-- b_xn9rp72g -->

## エラー処理 <!-- b_sbf3mhdg -->

`ChangeBaseBranch` は変更ファイルの検出に失敗すると、`SetDefaultBranchOverride` の値と `BaseRef`、`BaseBranchName` を元に戻してエラーを返す（[session.go:2386-2419](../../../internal/session/session.go#L2386-L2419)）。ファイルモードの `NewSessionFromFiles` では差分取得に失敗しても警告を出すだけでセッションは続行する（[session.go:1072-1079](../../../internal/session/session.go#L1072-L1079)）。 <!-- b_aqdj4f9q -->

## 並行性 <!-- b_x92hgfdy -->

`Session` は `sync.RWMutex` の `mu` で状態を守り、書き出しには別の `writeMu` を使う（[session.go:487-497](../../../internal/session/session.go#L487-L497)）。`ChangeBaseBranch` は VCS 処理をロックの外で行い、ファイル一覧を差し替える直前にコメントを取り直すため、処理中のコメント変更が失われない（[session.go:2458-2466](../../../internal/session/session.go#L2458-L2466)）。 <!-- b_ymbv2j3c -->

## 落とし穴 <!-- b_wj64xw8k -->

> [!WARNING]
> **落とし穴**
> - ファイルのパスを変えるとコメントの削除墓標 `deletedCommentIDs` も新しいパスへ移す必要があり、`ChangeBaseBranch` がそれを行う（[session.go:2467-2480](../../../internal/session/session.go#L2467-L2480)）。
> - review.json のキー移行は `rewriteReviewJSONRenames` が `writeMu` の下で担う（[session.go:2489-2493](../../../internal/session/session.go#L2489-L2493)）。 <!-- b_t9m535sf -->
