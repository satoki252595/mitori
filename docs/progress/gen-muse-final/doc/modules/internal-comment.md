# コメント管理（internal） <!-- b_00bsahjc -->

- ファイル 15 · 2318 行 · 重要度 0.15
<!-- b_3ff43epa -->

**変更の手引き**
- 影響が及ぶ先（このモジュールを使う）: [変更連携基盤](internal-github-gitlab.md)・[CLI 入口と統合管理](cmd-crit.md)・[設定と共有と live 中継](internal-share-config-live.md)・[レビュー用 HTTP サーバ](internal-server.md)・[版管理抽象と差分取得](internal-vcs.md)・[plan 審査と daemon 管理](internal-session-plan-cli.md)
- 使っているもの: [レビューセッション管理](internal-session-session.md)・[plan 審査と daemon 管理](internal-session-plan-cli.md)・[変更連携基盤](internal-github-gitlab.md)・[版管理抽象と差分取得](internal-vcs.md)・[設定と共有と live 中継](internal-share-config-live.md)
- テスト: `internal/comment/list_test.go`（22 件）・`internal/comment/comment_json_input_test.go`（18 件）・`internal/comment/daemon_config_precedence_test.go`（8 件）・`internal/comment/comment_scope_test.go`（5 件） ほか 13 · 実行: `go test ./internal/comment ./internal/review ./internal/reviewpath`
- 入口から: `ANY /api/comment/`（`internal/server/server.go:209`）・`ANY /api/review-comment/`（`internal/server/server.go:201`）・`ANY /api/events`（`internal/server/server.go:188`）・`ANY /api/share/upsert-payload`（`internal/server/server.go:180`）・`ANY /api/files/list`（`internal/server/server.go:202`）
- よく使われる宣言（変えると波及する）: `LoadCritJSON` `internal/review/review_file.go:325`（9 ファイル）・`SaveCritJSON` `internal/review/review_file.go:373`（8 ファイル）・`ResolveReviewPath` `internal/review/review_file.go:37`（6 ファイル）・`ResolveCommandReviewPathWithSession` `internal/review/review_file.go:79`（5 ファイル）・`CritJSON` `internal/review/types.go:10`（5 ファイル）
- 一緒に変わりやすいファイル: 履歴を読めません（浅いクローンか git の外）
- 注意: ハブ（多くから使われ、多くを使う）・循環依存（[CLI 入口と統合管理](cmd-crit.md)・[変更連携基盤](internal-github-gitlab.md)・[レビューセッション管理](internal-session-session.md) ほか 4 と）
<!-- b_09npvky6 -->

> [!NOTE]
> **この章で分かること**
> - コメント CLI の入口と保存先の関係
> - レビューファイル特定と適用範囲解決の分担
> - 一括投入と一覧表示の扱う形式 <!-- b_zmhkhx8k -->

## 責務 <!-- b_fxzbkpja -->

`RunComment` と `RunComments` がコメントの追加・返信・一覧という CLI 入口を受け持つ（[run.go:19](../../../internal/comment/run.go#L19)、[list\_cli.go:136](../../../internal/comment/list_cli.go#L136)）。
対象レビューファイルの特定は `ResolveReviewPath` 系と `FindReviewFileByBranch` 系が担う（[review\_file.go:37-39](../../../internal/review/review_file.go#L37-L39)、[export.go:19](../../../internal/review/export.go#L19)）。
独自の永続型は定義せず、`CritJSON` は `session` の別名である（[types.go:9](../../../internal/comment/types.go#L9)）。 <!-- b_xc4bxv90 -->

## 公開インターフェース <!-- b_xwdsv6jx -->

- `RunComment` はコメント操作の CLI 入口である（[run.go:19](../../../internal/comment/run.go#L19)）。
- `RunComments` はコメント一覧の CLI 入口である（[list\_cli.go:136](../../../internal/comment/list_cli.go#L136)）。
- `LoadCritJSON` はレビューファイルの読み込みと初期生成を担う（[review\_file.go:325-357](../../../internal/review/review_file.go#L325-L357)）。
- `ResolveReviewPath` は出力先から所在を決める（[review\_file.go:37-39](../../../internal/review/review_file.go#L37-L39)、[review\_file.go:116-119](../../../internal/review/review_file.go#L116-L119)）。
- `ResolveCommentScope` は明示と自動で適用範囲を決める（[scope.go:79](../../../internal/comment/scope.go#L79)、[scope.go:108](../../../internal/comment/scope.go#L108)、[scope.go:124](../../../internal/comment/scope.go#L124)）。
- `BulkAddCommentsToCritJSONScoped` は JSON 一括投入の公開口である（[export.go:21](../../../internal/comment/export.go#L21)、[comment\_cli.go:269-276](../../../internal/comment/comment_cli.go#L269-L276)）。 <!-- b_y38qhrzs -->

## データ構造 <!-- b_kmpq6be2 -->

- `BulkCommentEntry` は一括投入の 1 件で、`File` と `Body` と `Scope` を持つ（[comment\_cli.go:269-278](../../../internal/comment/comment_cli.go#L269-L278)）。
- `ListedComment` は表示用で、`Scope` と `Path` を付けた `Comment` である（[list.go:13-16](../../../internal/comment/list.go#L13-L16)）。
- `SnapshotsFile` は `RoundSnapshots` にラウンド別スナップショットを持つ（[review\_file.go:273-274](../../../internal/review/review_file.go#L273-L274)）。 <!-- b_rsngf64z -->

## 処理の流れ <!-- b_tf9qnayw -->

1. `RunComment` が引数を受けて振り分ける（[run.go:19](../../../internal/comment/run.go#L19)、[run.go:108](../../../internal/comment/run.go#L108)、[run.go:192](../../../internal/comment/run.go#L192)、[run.go:231](../../../internal/comment/run.go#L231)）。
2. `resolveCommentReviewPath` がパスを確定する（[run.go:108](../../../internal/comment/run.go#L108)）。
3. `ResolveCommentScope` が適用範囲を確定する（[scope.go:79](../../../internal/comment/scope.go#L79)）。
4. `appendCommentScoped` 系が足し、`SaveCritJSON` で保存する（[comment\_cli.go:56](../../../internal/comment/comment_cli.go#L56)、[review\_file.go:373-375](../../../internal/review/review_file.go#L373-L375)）。 <!-- b_b6jr7x0a -->

## 設定 <!-- b_zq6t1wr1 -->

- `commentFlags` の `sessionID` と `plan` が対象指定を受け持つ（[flags.go:8-23](../../../internal/comment/flags.go#L8-L23)）。
- `commentsListFlags` の `jsonOutput` と `all` が出力を切り替える（[list\_cli.go:14-21](../../../internal/comment/list_cli.go#L14-L21)）。
- `CommentScopeOverrideFromFlag` が範囲指定文字列を解釈する（[scope.go:24](../../../internal/comment/scope.go#L24)）。 <!-- b_xv631m29 -->

## テスト <!-- b_ztmg850f -->

`TestReadCommentJSONInputFile` と `TestParseCommentJSONEntriesValid` がファイル入力とパースを確かめる（[comment\_json\_input\_test.go:21](../../../internal/comment/comment_json_input_test.go#L21)、[comment\_json\_input\_test.go:71](../../../internal/comment/comment_json_input_test.go#L71)）。
`TestResolveCommentScope` と `TestRunCommentDaemonThenConfiguredOutputPrecedence` がスコープと優先順位を確かめる（[comment\_scope\_test.go:47](../../../internal/comment/comment_scope_test.go#L47)、[daemon\_config\_precedence\_test.go:22](../../../internal/comment/daemon_config_precedence_test.go#L22)）。
`TestExportWrappers_PersistComments` が公開口経由の保存を確かめる（[export\_wrappers\_test.go:44](../../../internal/comment/export_wrappers_test.go#L44)）。 <!-- b_m3pmt01b -->

## エラー処理 <!-- b_t2tx9sjy -->

複数セッションが一致したとき `AmbiguousSessionsError` で --session 指定を求める（[review\_file.go:192-194](../../../internal/review/review_file.go#L192-L194)）。
`findReviewFileByBranch` は壊れた JSON を警告付きで読み飛ばす（[review\_file.go:498-512](../../../internal/review/review_file.go#L498-L512)）。
保管庫の根が無いとき `MatchingLiveSessions` は空を返して続ける（[review\_file.go:204-216](../../../internal/review/review_file.go#L204-L216)）。 <!-- b_m5mjh8s1 -->

> [!TIP]
> **まとめ**
> コメント操作の入口と所在解決を束ね、保存の実体は上位層に委ねる。 <!-- b_pqeybz7z -->
