# VCS抽象化層（internal） <!-- b_kvpjstzj -->

- ファイル 13 · 3209 行 · 重要度 1.00
<!-- b_s4vcvw3h -->

> [!NOTE]
> **この章で分かること**
> - `VCS` インターフェースが何を抽象化しているか
> - git・jj・Sapling の各実装の違い
> - 差分取得と SHA 解決の入口となる関数群 <!-- b_sa6h5nde -->

## 責務 <!-- b_0cpzgvc5 -->

このモジュールは git・Sapling・jj の差異を `VCS` インターフェースの背後に隠し、変更ファイル一覧・ファイル差分・コミットログ・マージベースを共通の形で返す（[vcs.go:14-137](../../../internal/vcs/vcs.go#L14-L137)）。実装は `GitVCS`・`SaplingVCS`・`JJVCS` の3つである（[git\_vcs.go:12](../../../internal/vcs/git_vcs.go#L12)、[sapling.go:13](../../../internal/vcs/sapling.go#L13)、[jj.go:22](../../../internal/vcs/jj.go#L22)）。`DetectVCS` が実装を選ぶ（[vcs.go:153](../../../internal/vcs/vcs.go#L153)）。 <!-- b_snz2wxyw -->

## 公開インターフェース <!-- b_6k0j48sp -->

- `VCS`: 変更一覧、差分、`CommitLog`、`MergeBase`、`UserName` などを持つインターフェース（[vcs.go:14-104](../../../internal/vcs/vcs.go#L14-L104)）。
- `DetectVCS`: オーバーライド文字列から実装を返す（[vcs.go:153](../../../internal/vcs/vcs.go#L153)）。
- `CompareTargetsFor`: 比較対象のローカル・リモート候補を返す（[compare\_targets.go:20](../../../internal/vcs/compare_targets.go#L20)）。
- `EnsureSHAFetched`: 指定 SHA が無ければ取得する（[fetch\_sha.go:14](../../../internal/vcs/fetch_sha.go#L14)）。
- `ParseUnifiedDiff`: unified diff を `DiffHunk` に変換する（[git.go:1511](../../../internal/vcs/git.go#L1511)）。 <!-- b_p5d5n3m7 -->

## データ構造 <!-- b_3cee8wpa -->

- `FileChange`: `Path`、改名時の `OldPath`、`Status`（added、modified、deleted、renamed、untracked）（[git.go:21-24](../../../internal/vcs/git.go#L21-L24)）。
- `CommitInfo`: SHA、短縮 SHA、メッセージ、作者、日付、`Virtual` フラグ（[git.go:374-380](../../../internal/vcs/git.go#L374-L380)）。
- `CompareTargets`: `VCS`、`Detected`、`Local`、`Remote`（[compare\_targets.go:11-15](../../../internal/vcs/compare_targets.go#L11-L15)）。
- `NumstatEntry`: `Additions` と `Deletions`（[git.go:1443-1445](../../../internal/vcs/git.go#L1443-L1445)）。 <!-- b_e96a6kcr -->

## 並行性 <!-- b_67q65xe2 -->

`SaplingVCS` と `JJVCS` は `sync.Once` と `sync.RWMutex` でデフォルトブランチの検出値とオーバーライドを保護する（[sapling.go:13-18](../../../internal/vcs/sapling.go#L13-L18)）（[jj.go:22-28](../../../internal/vcs/jj.go#L22-L28)）。 <!-- b_xcz6jaxb -->

## 落とし穴 <!-- b_vraeshjc -->

> [!WARNING]
> **落とし穴**
> - `HasStagingArea` は `GitVCS` のみ true で、他は false を返す（[git\_vcs.go:143](../../../internal/vcs/git_vcs.go#L143)、[sapling.go:407](../../../internal/vcs/sapling.go#L407)、[jj.go:421](../../../internal/vcs/jj.go#L421)）。
> - `SkipDirNames` は実装ごとに異なる（`.git`、`.sl`、`.jj`）（[git\_vcs.go:145](../../../internal/vcs/git_vcs.go#L145)、[sapling.go:411](../../../internal/vcs/sapling.go#L411)、[jj.go:423](../../../internal/vcs/jj.go#L423)）。
> - `FileDiffBetweenSHAs` は Sapling と jj で `oldPath` を無視する（[sapling.go:367](../../../internal/vcs/sapling.go#L367)、[jj.go:374](../../../internal/vcs/jj.go#L374)）。 <!-- b_gct1k6d0 -->
