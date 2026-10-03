# VCS 抽象化と focus 解決（internal） <!-- b_dkgtv1dq -->

- ファイル 17 · 3551 行 · 重要度 1.00
<!-- b_tgrqe4s5 -->

> [!NOTE]
> **この章で分かること**
> - `VCS` インターフェースが git・Sapling・jj の違いをどう吸収するか
> - git の diff 出力を `DiffHunk` に変換する流れ
> - `internal/focus` が PR・MR・範囲指定をどう解決するか <!-- b_hv6t7nsm -->

## 責務 <!-- b_vpwrfn5v -->

このモジュールは、バージョン管理システムごとのコマンド呼び出しを `VCS` インターフェースの背後に隠し、変更ファイル・diff・コミットログ・ブランチ情報を共通の型で返す（[vcs.go:14-137](../../../internal/vcs/vcs.go#L14-L137)）。実装は `GitVCS`、`SaplingVCS`、`JJVCS` の三つである（[git\_vcs.go:12](../../../internal/vcs/git_vcs.go#L12)、[sapling.go:13](../../../internal/vcs/sapling.go#L13)、[jj.go:22](../../../internal/vcs/jj.go#L22)）。同じ配下の `internal/focus` は、レビュー対象を表す `Focus` を PR・MR・範囲指定から解決する（[focus.go:126-128](../../../internal/focus/focus.go#L126-L128)、[focus.go:137](../../../internal/focus/focus.go#L137)）。 <!-- b_19s0dy91 -->

## 公開インターフェース <!-- b_vm2wz61h -->

- `DetectVCS` は上書き指定を受けて使う `VCS` 実装を選ぶ（[vcs.go:153](../../../internal/vcs/vcs.go#L153)）。
- `VCS` は変更ファイル、diff、`CommitLog`、`MergeBase` などの操作を定義する（[vcs.go:14-137](../../../internal/vcs/vcs.go#L14-L137)）。
- `ParseUnifiedDiff` は unified diff 文字列を `DiffHunk` の列にする（[git.go:1511](../../../internal/vcs/git.go#L1511)）。
- `CompareTargetsFor` は比較先候補（ローカルとリモート）を返す（[compare\_targets.go:11-20](../../../internal/vcs/compare_targets.go#L11-L20)）。
- `ResolveFocus` は `ChangeSpec` か範囲指定から `Focus` を作る（[focus.go:126-128](../../../internal/focus/focus.go#L126-L128)、[focus.go:137](../../../internal/focus/focus.go#L137)）。
- `ParseGeneratedRules` と `IsGenerated` は生成ファイル判定に使う（[gitattributes.go:26](../../../internal/vcs/gitattributes.go#L26)、[gitattributes.go:146](../../../internal/vcs/gitattributes.go#L146)）。 <!-- b_q7e01dp2 -->

## データ構造 <!-- b_2nvavme2 -->

- `FileChange` は `Path`、改名時の `OldPath`、`Status`（added・modified・deleted・renamed・untracked）を持つ（[git.go:21-24](../../../internal/vcs/git.go#L21-L24)）。
- `CommitInfo` は SHA、短縮 SHA、メッセージ、作者、日付を JSON タグ付きで持つ（[git.go:374-380](../../../internal/vcs/git.go#L374-L380)）。
- `ChangeResolveInfo` は PR・MR の URL、番号、base と head の oid や名前、クロスリポジトリかどうかを保持する（[pr\_hooks.go:7-19](../../../internal/focus/pr_hooks.go#L7-L19)）。 <!-- b_q4bmj4am -->

## 処理の流れ <!-- b_hwy3hhbd -->

1. `FileDiffScoped` は scope（branch・staged・unstaged）に応じた `git diff` 引数を組み立てる（[git.go:337-352](../../../internal/vcs/git.go#L337-L352)）。
2. 外部 diff の環境変数を除いた環境でコマンドを実行する（[git.go:355-358](../../../internal/vcs/git.go#L355-L358)）。
3. 終了コード 1 は差分ありとして許容し、他は `git diff failed` として返す（[git.go:360-369](../../../internal/vcs/git.go#L360-L369)）。
4. 出力を `ParseUnifiedDiff` に渡して `DiffHunk` にする（[git.go:370](../../../internal/vcs/git.go#L370)）。 <!-- b_k2scxxky -->

## エラー処理 <!-- b_09tfhhde -->

`FileDiffForCommit` は `sha^` が失敗して終了コード 128 になると、ルートコミットとみなして空ツリーとの diff に切り替える（[git.go:477-495](../../../internal/vcs/git.go#L477-L495)）。`AllTrackedFiles` は未追跡ファイルの列挙に失敗しても、追跡済みファイルだけを返して続行する（[git.go:1211-1214](../../../internal/vcs/git.go#L1211-L1214)）。`CommitLog` は出力行数が 5 の倍数でなければエラーにする（[git.go:407-410](../../../internal/vcs/git.go#L407-L410)）。 <!-- b_fdwg5y5j -->

## 並行性 <!-- b_68r1mhpk -->

`DefaultBranch` は上書き値を `RWMutex` で読み、自動検出は `sync.Once` で一度だけ行う（[git.go:104-115](../../../internal/vcs/git.go#L104-L115)）。`SaplingVCS` と `JJVCS` も同様に `sync.Once` とロックでデフォルトブランチを保護する（[sapling.go:13-18](../../../internal/vcs/sapling.go#L13-L18)、[jj.go:22-28](../../../internal/vcs/jj.go#L22-L28)）。 <!-- b_87xxdr6a -->

## 落とし穴 <!-- b_h7de60bt -->

> [!WARNING]
> **落とし穴**
> - `VCS` にメソッドを足すときは、`GitVCS`、`SaplingVCS`、`JJVCS` の三実装をすべて更新する必要がある（[vcs.go:14-137](../../../internal/vcs/vcs.go#L14-L137)）。
> - `ParseUnifiedDiff` の空行処理は `diff.suppressBlankEmpty` 対策で、hunk の範囲内に限って文脈行とみなす。境界の判定を変えると末尾の空要素を誤って行にする（[git.go:1575-1587](../../../internal/vcs/git.go#L1575-L1587)）。 <!-- b_nmsqaew9 -->
