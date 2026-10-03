# コメント操作とレビュー解決（internal） <!-- b_6aycyb2g -->

- ファイル 15 · 2318 行 · 重要度 0.15
<!-- b_kqfjxb5x -->

> [!NOTE]
> **この章で分かること**
> - レビューファイル（crit.json）のパスを解決する方法
> - `crit comment` / `crit comments` がコメントを追記・一覧する流れ
> - 古いレビューの掃除と、スコープの継承 <!-- b_0cdjn6hq -->

## 責務 <!-- b_s9mx3rab -->

このモジュールは、レビューファイルへのコメント・返信の追加、コメント一覧の整形、レビューファイルの場所の解決を担う。`internal/comment` は CLI の `comment` / `comments` を実装し（[run.go:19](../../../internal/comment/run.go#L19)、[list\_cli.go:136](../../../internal/comment/list_cli.go#L136)）、`internal/review` はレビューファイルの読み書きとパス解決、`internal/reviewpath` は保存先ディレクトリの算出を受け持つ（[review\_file.go:37-39](../../../internal/review/review_file.go#L37-L39)）。データ型そのものは持たず、`session` の型の別名として使う（[types.go:9-15](../../../internal/comment/types.go#L9-L15)）。 <!-- b_0hswv8hj -->

## 公開インターフェース <!-- b_c4ycm8y0 -->

- `RunComment` / `RunComments`: CLI のエントリポイント（[run.go:19](../../../internal/comment/run.go#L19)、[list\_cli.go:136](../../../internal/comment/list_cli.go#L136)）。
- `AddCommentToCritJSONScoped` ほか `export.go` のラッパー: 外部パッケージ向けに内部関数を公開する（[export.go:9-13](../../../internal/comment/export.go#L9-L13)）。
- `BulkCommentEntry`: JSON 一括入力の 1 件（[comment\_cli.go:269-278](../../../internal/comment/comment_cli.go#L269-L278)）。
- `ResolveCommentScope`: コメントに継承させるスコープを決める（[scope.go:79](../../../internal/comment/scope.go#L79)）。
- `ResolveReviewPath` 系: 出力先・セッション・ファイル引数からレビューパスを返す（[review\_file.go:37-39](../../../internal/review/review_file.go#L37-L39)、[review\_file.go:100](../../../internal/review/review_file.go#L100)）。
- `LoadCritJSON` / `SaveCritJSON`: レビューファイルの読み書き（[review\_file.go:325](../../../internal/review/review_file.go#L325)、[review\_file.go:373-375](../../../internal/review/review_file.go#L373-L375)）。
- `RunCleanup`: 古いレビューの削除（[cleanup\_cli.go:18](../../../internal/review/cleanup_cli.go#L18)）。 <!-- b_gbdz9cas -->

## 処理の流れ <!-- b_553ch94k -->

1. `ResolveReviewPathWithArgs` は `outputDir` があればそれを基準にする（[review\_file.go:116-119](../../../internal/review/review_file.go#L116-L119)）。
2. なければ cwd と現在のブランチから `MatchingLiveSessions` で稼働中セッションを探す（[review\_file.go:246-257](../../../internal/review/review_file.go#L246-L257)）。
3. 複数一致すれば `AmbiguousSessionsError` で `--session` の指定を促す（[review\_file.go:192-194](../../../internal/review/review_file.go#L192-L194)、[review\_file.go:261-264](../../../internal/review/review_file.go#L261-L264)）。
4. 一致しなければ `sessionKeyForArgs` のキーから `daemon.ReviewFilePath` に至る（[review\_file.go:134-135](../../../internal/review/review_file.go#L134-L135)）。
5. `LoadCritJSON` がファイルを読み、無ければブランチ・基点・ラウンド 1 の新規 `CritJSON` を作る（[review\_file.go:333-357](../../../internal/review/review_file.go#L333-L357)）。 <!-- b_5ymz0zj5 -->

## エラー処理 <!-- b_jmkgyf49 -->

同じブランチに複数のレビューファイルがあると `findReviewFileByBranch` は `errReviewFileAmbiguousForBranch` を返し、無ければ `errReviewFileNotFoundForBranch` を返す（[review\_file.go:514-531](../../../internal/review/review_file.go#L514-L531)）。壊れた JSON は警告を stderr に出してスキップする（[review\_file.go:507-513](../../../internal/review/review_file.go#L507-L513)）。 <!-- b_6937wh0r -->

## 落とし穴 <!-- b_2ssdcw1m -->

> [!WARNING]
> **落とし穴**
> `LoadCritJSON` は読み込みの前に v3 から v4 へのフォルダ移行を起こし、ファイルが無いときは cwd を記録する（[review\_file.go:328-356](../../../internal/review/review_file.go#L328-L356)）。読み取りに副作用があるため、変更時は `crit resume` との整合に注意が要る。 <!-- b_tgtq1q2h -->
