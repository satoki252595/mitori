# 版管理抽象と差分取得（internal） <!-- b_hpj738ey -->

- ファイル 17 · 3551 行 · 重要度 1.00
<!-- b_vq45td6x -->

**変更の手引き**
- 影響が及ぶ先（このモジュールを使う）: [レビューセッション管理](internal-session-session.md)・[レビュー用 HTTP サーバ](internal-server.md)・[CLI 入口と統合管理](cmd-crit.md)・[変更連携基盤](internal-github-gitlab.md)・[plan 審査と daemon 管理](internal-session-plan-cli.md)・[設定と共有と live 中継](internal-share-config-live.md) ほか 1
- 使っているもの: [レビューセッション管理](internal-session-session.md)・[plan 審査と daemon 管理](internal-session-plan-cli.md)・[コメント管理](internal-comment.md)
- テスト: `internal/vcs/git_test.go`（62 件）・`internal/vcs/jj_methods_test.go`（30 件）・`internal/vcs/git_vcs_test.go`（19 件）・`internal/vcs/sapling_test.go`（17 件） ほか 44 · 実行: `go test ./internal/focus ./internal/vcs`
- 入口から: `ANY /api/comment/`（`internal/server/server.go:209`）・`ANY /api/review-comment/`（`internal/server/server.go:201`）・`ANY /api/events`（`internal/server/server.go:188`）・`ANY /api/share/upsert-payload`（`internal/server/server.go:180`）・`ANY /api/files/list`（`internal/server/server.go:202`）
- よく使われる宣言（変えると波及する）: `VCS` `internal/vcs/vcs.go:14`（17 ファイル）・`FileChange` `internal/vcs/git.go:21`（13 ファイル）・`DetectVCS` `internal/vcs/vcs.go:153`（13 ファイル）・`DiffHunk` `internal/vcs/git.go:28`（11 ファイル）・`NumstatEntry` `internal/vcs/git.go:1443`（8 ファイル）
- 一緒に変わりやすいファイル: 履歴を読めません（浅いクローンか git の外）
- 注意: ハブ（多くから使われ、多くを使う）・大きいファイル `internal/vcs/git.go`（1,609 行）・循環依存（[CLI 入口と統合管理](cmd-crit.md)・[変更連携基盤](internal-github-gitlab.md)・[レビューセッション管理](internal-session-session.md) ほか 4 と）
<!-- b_yph2rmpx -->

**大きなファイルの中身（1,500 行を超えるファイル）**
- `internal/vcs/git.go`（1,609 行）
  - `internal/vcs/git.go:21-31` 型（3）: `FileChange`・`DiffHunk`・`DiffLine`
  - `internal/vcs/git.go:38-371` 関数（22）: `stripExternalDiffEnv`・`runGit`・`IsGitRepo`・`RepoRoot`
  - `internal/vcs/git.go:374-381` 型: `CommitInfo`
  - `internal/vcs/git.go:388-422` 関数: `CommitLog`
  - `internal/vcs/git.go:427-427` 定数・変数: `commitishRe`
  - `internal/vcs/git.go:430-575` 関数（9）: `isCommitish`・`SplitCommitRange`・`ChangedFilesForCommit`・`FileDiffForCommit`
  - `internal/vcs/git.go:577-582` 型: `gitStatusSnapshot`
  - `internal/vcs/git.go:588-933` 関数（16）: `initialGitChangesAndScopes`・`gitStatusSnapshotInDir`・`parseGitStatusSnapshot`・`appendGitStatusXY`
  - `internal/vcs/git.go:936-939` 型: `BranchEntry`
  - `internal/vcs/git.go:944-1226` 関数（13）: `RemoteBranchTips`・`remoteBranchTipsGit`・`remoteBranchTipsJJ`・`remoteBranchTipsSapling`
  - `internal/vcs/git.go:1230-1241` 定数・変数: `SkipDirs`
  - `internal/vcs/git.go:1246-1440` 関数（9）: `WalkFiles`・`parseNameStatus`・`fileStatusInRepo`・`dedup`
  - `internal/vcs/git.go:1443-1446` 型: `NumstatEntry`
  - `internal/vcs/git.go:1450-1506` 関数（4）: `DiffNumstatDir`・`DiffNumstatBetweenSHAs`・`runDiffNumstat`・`parseNumstatOutput`
  - `internal/vcs/git.go:1508-1508` 定数・変数: `hunkHeaderRe`
  - `internal/vcs/git.go:1511-1609` 関数（2）: `ParseUnifiedDiff`・`WorkingTreeFingerprint`
<!-- b_767byddt -->

> [!NOTE]
> **この章で分かること**
> - 3 系統の版管理を束ねる考え方が分かる
> - 差分と変更一覧の入口が分かる
> - 対象決定の流れが分かる <!-- b_gkpzxj92 -->

## 責務 <!-- b_ycgxyfk7 -->

`VCS` は変更ファイルと差分取得の統一口である（[vcs.go:14-16](../../../internal/vcs/vcs.go#L14-L16)、[vcs.go:50-63](../../../internal/vcs/vcs.go#L50-L63)）。`GitVCS` と `JJVCS` と `SaplingVCS` が 3 系統の具象である（[git\_vcs.go:12-14](../../../internal/vcs/git_vcs.go#L12-L14)、[jj.go:22-30](../../../internal/vcs/jj.go#L22-L30)、[sapling.go:13-20](../../../internal/vcs/sapling.go#L13-L20)）。`ResolveFocus` は変更指定から `Focus` を組み立てる（[focus.go:126-131](../../../internal/focus/focus.go#L126-L131)）。forge からの実取得は `SetPRResolveHooks` と `SetMRResolveHooks` で注入された関数に委ねる（[pr\_hooks.go:32-35](../../../internal/focus/pr_hooks.go#L32-L35)、[pr\_hooks.go:42-45](../../../internal/focus/pr_hooks.go#L42-L45)）。 <!-- b_ag9aqdre -->

## 公開インターフェース <!-- b_0af6v844 -->

- `DetectVCS` は `VCS` を返す（[vcs.go:153](../../../internal/vcs/vcs.go#L153)）。
- `ChangedFilesScoped` は領域別に `FileChange` 列を返す（[git.go:282-293](../../../internal/vcs/git.go#L282-L293)）。
- `FileDiffScoped` は指定域の差分を `DiffHunk` 列で返す（[git.go:339-347](../../../internal/vcs/git.go#L339-L347)）。
- `ParseUnifiedDiff` は統一差分を `DiffHunk` に変換する（[git.go:1511-1515](../../../internal/vcs/git.go#L1511-L1515)）。
- `CommitLog` は範囲内の `CommitInfo` 列を返す（[git.go:388-395](../../../internal/vcs/git.go#L388-L395)）。
- `ResolveFocus` は `ChangeSpec` から `Focus` を決める（[focus.go:126-131](../../../internal/focus/focus.go#L126-L131)）。
- `EnsureSHAFetched` は不足分の取得を担う（[fetch\_sha.go:14](../../../internal/vcs/fetch_sha.go#L14)）。
- `IsGenerated` は `GeneratedRule` 列で生成物を判定する（[gitattributes.go:146](../../../internal/vcs/gitattributes.go#L146)）。 <!-- b_vsgmwxhr -->

## 依存関係 <!-- b_g37fcnxa -->

- `internal/session` とは `DiffHunk` 系を介して相互に結ぶ（推測）。
- ほかに `internal/comment` の `AddCommentToCritJSONScoped` 系と計画系の `RunReviewClient` 系を使う（推測）。
- `internal/server` の `FS` 系と `cmd/crit` の `Config` 系と forge 系の `ExitError` 系から使われる（推測）。 <!-- b_ckpms9ar -->

## データ構造 <!-- b_gte5ftck -->

- `FileChange` は `Path` と `OldPath` と `Status` を持つ（[git.go:21-24](../../../internal/vcs/git.go#L21-L24)）。
- `CommitInfo` は `SHA` と `Message` と `Author` ほかを保持する（[git.go:374-380](../../../internal/vcs/git.go#L374-L380)）。
- `NumstatEntry` は `Additions` と `Deletions` を数える（[git.go:1443-1445](../../../internal/vcs/git.go#L1443-L1445)）。
- `CompareTargets` は `VCS` と `Local` と `Remote` を束ねる（[compare\_targets.go:11-15](../../../internal/vcs/compare_targets.go#L11-L15)）。
- `ChangeResolveInfo` は `BaseRefOid` と `HeadRefOid` で両端を示す（[pr\_hooks.go:7-15](../../../internal/focus/pr_hooks.go#L7-L15)）。 <!-- b_pdwnry81 -->

## 処理の流れ <!-- b_apsgxpgx -->

1. `FileDiffScoped` は `scope` で枝と待機域と作業域を振り分ける（[git.go:339-354](../../../internal/vcs/git.go#L339-L354)）。
2. 基本引数は `diffBaseArgs` で作り対象パスを添える（[git.go:339-351](../../../internal/vcs/git.go#L339-L351)）。
3. 終了符号 1 は差分ありとして正常復帰する（[git.go:360-366](../../../internal/vcs/git.go#L360-L366)）。
4. 出力は `ParseUnifiedDiff` が `DiffHunk` 列に変える（[git.go:339-340](../../../internal/vcs/git.go#L339-L340)、[git.go:370-371](../../../internal/vcs/git.go#L370-L371)）。 <!-- b_1skj5ch0 -->

## テスト <!-- b_9h6rnyhz -->

PR と MR と範囲とスコープの構文解析を確認する（[focus\_cli\_test.go:10](../../../internal/focus/focus_cli_test.go#L10)、[focus\_cli\_test.go:38](../../../internal/focus/focus_cli_test.go#L38)、[focus\_cli\_test.go:60](../../../internal/focus/focus_cli_test.go#L60)、[focus\_cli\_test.go:88](../../../internal/focus/focus_cli_test.go#L88)）。変更指定と範囲指定の排他と取得元解決を確認する（[focus\_cli\_test.go:115](../../../internal/focus/focus_cli_test.go#L115)、[focus\_mr\_test.go:9](../../../internal/focus/focus_mr_test.go#L9)、[focus\_pr\_test.go:9](../../../internal/focus/focus_pr_test.go#L9)、[focus\_pr\_mergebase\_test.go:13](../../../internal/focus/focus_pr_mergebase_test.go#L13)）。既定枝の解決と世代走査と枝先取得を確認する（[picker\_test.go:9](../../../internal/session/picker_test.go#L9)、[picker\_test.go:27](../../../internal/session/picker_test.go#L27)、[picker\_test.go:41](../../../internal/session/picker_test.go#L41)、[picker\_test.go:63](../../../internal/session/picker_test.go#L63)）。 <!-- b_2t1tddq2 -->

## 不変条件 <!-- b_sg9g1yss -->

- 終了符号 1 は差分ありの正常系として扱う（[git.go:360-366](../../../internal/vcs/git.go#L360-L366)、[git.go:477-478](../../../internal/vcs/git.go#L477-L478)）。
- 最初のハンク見出しより前の行は捨てる（[git.go:1547-1549](../../../internal/vcs/git.go#L1547-L1549)）。
- 空の `baseRef` に対する `CommitLog` は `nil` を返す（[git.go:388-391](../../../internal/vcs/git.go#L388-L391)）。 <!-- b_5qkfjnne -->

## エラー処理 <!-- b_8kxtgd00 -->

`FileDiffForCommit` は親なしの際に空ツリーとの差分に切り替える（[git.go:467-482](../../../internal/vcs/git.go#L467-L482)）。`MergeBase` は接頭辞付きで再試行する（[git.go:230-239](../../../internal/vcs/git.go#L230-L239)）。失敗は文脈付きのエラーとして包んで返す（[git.go:367-368](../../../internal/vcs/git.go#L367-L368)、[git.go:400-402](../../../internal/vcs/git.go#L400-L402)）。 <!-- b_4rp0csqz -->

## 並行性 <!-- b_vy6h6jqx -->

`SaplingVCS` と `JJVCS` は `sync.Once` と `sync.RWMutex` で既定枝を守る（[sapling.go:13-17](../../../internal/vcs/sapling.go#L13-L17)、[jj.go:22-27](../../../internal/vcs/jj.go#L22-L27)）。`DefaultBranch` は読み取り錠と一度きりの初期化で共有値を読む（[git.go:111-120](../../../internal/vcs/git.go#L111-L120)）。 <!-- b_906q1mm1 -->

## 性能 <!-- b_0h7ymn56 -->

`DefaultBranch` は検出結果を使い回して重い検出を避ける（[git.go:111-121](../../../internal/vcs/git.go#L111-L121)）。`WalkAncestors` は `maxDepth` で呼び出し側が深さを絞れる（[git.go:844](../../../internal/vcs/git.go#L844)）。 <!-- b_pf2n5dw8 -->

## 落とし穴 <!-- b_ychq92e9 -->

> [!WARNING]
> **落とし穴**
> - `VCS` に手法を足す際は `GitVCS` と `JJVCS` と `SaplingVCS` を同時に直す（[vcs.go:14-16](../../../internal/vcs/vcs.go#L14-L16)、[git\_vcs.go:12-14](../../../internal/vcs/git_vcs.go#L12-L14)、[jj.go:22-30](../../../internal/vcs/jj.go#L22-L30)、[sapling.go:13-20](../../../internal/vcs/sapling.go#L13-L20)）。
> - `SetDefaultBranchOverride` 後の自動検出は上書きが優先され検査時は初期化の巻き戻しが要る（[git.go:111-122](../../../internal/vcs/git.go#L111-L122)、[git.go:126-133](../../../internal/vcs/git.go#L126-L133)）。 <!-- b_37pmbgcs -->

> [!TIP]
> **まとめ**
> 3 系統の差分操作を一つの口で扱い対象決定を添える置き場である。 <!-- b_39yfnbm4 -->
