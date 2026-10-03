# PR/MR 同期とレビュー経路（internal） <!-- b_a06sh5m1 -->

- ファイル 17 · 4023 行 · 重要度 0.26
<!-- b_c81aqe29 -->

> [!NOTE]
> **この章で分かること**
> - GitHub と GitLab のプロバイダ実装がどう分かれているか
> - PR/MR のコメントを crit.json に取り込む pull と、送り返す push の流れ
> - レビュー用ファイルのパスを決める `ReviewPathsFor` の役割 <!-- b_pd1cfknz -->

## 責務 <!-- b_xnzzkrnb -->

このモジュールは、`forge.Provider` インタフェースの GitHub 版と GitLab 版を実装し、PR/MR とレビューコメントを相互に同期する（[forge.go:126-136](../../../internal/forge/forge.go#L126-L136)、[provider.go:150](../../../internal/github/provider.go#L150)、[provider.go:292](../../../internal/gitlab/provider.go#L292)）。GitHub 側は `gh` コマンド、GitLab 側は `glab` を経由した API 呼び出しで通信する（[api.go:15-17](../../../internal/gitlab/api.go#L15-L17)、[github.go:108](../../../internal/github/github.go#L108)）。あわせて、レビューフォルダ内のパスを組み立てる `session.ReviewPathsFor` を持つ（[review\_paths.go:3-12](../../../internal/session/review_paths.go#L3-L12)）。 <!-- b_cbkreaay -->

## 公開インターフェース <!-- b_pw03tvac -->

- `github.Provider` / `gitlab.Provider` は `Kind`、`Detect`、`Get`、`ListOpen`、`Pull`、`Push`、`FetchFile`、`Invalidate` を実装する（[forge.go:126-136](../../../internal/forge/forge.go#L126-L136)、[provider.go:53](../../../internal/gitlab/provider.go#L53)）。
- `gitlab.NewProvider` はホストを指定して GitLab プロバイダを作る（[provider.go:25](../../../internal/gitlab/provider.go#L25)）。
- `github.ParsePRSpec` と `gitlab.ParseMRSpec` は番号や URL から `forge.ChangeID` を得る（[spec.go:17](../../../internal/github/spec.go#L17)、[spec.go:14](../../../internal/gitlab/spec.go#L14)）。
- `github.RunPull` と `github.RunPush` は GitHub 用の CLI 入口である（[pull\_cli.go:95](../../../internal/github/pull_cli.go#L95)、[push\_cli.go:469](../../../internal/github/push_cli.go#L469)）。
- `session.ReviewPathsFor` は identity から `ReviewPaths` を返す（[review\_paths.go:15](../../../internal/session/review_paths.go#L15)）。 <!-- b_j9zqm883 -->

## データ構造 <!-- b_hsb1kt36 -->

- `ReviewPaths` は `Folder`、`Review`、`Snapshots`、`Attachments`、`ShareLock` の 5 つのパスを持つ（[review\_paths.go:6-11](../../../internal/session/review_paths.go#L6-L11)）。
- `pushBuckets` は push 対象を `Postable`、`FullStack`、`Unmapped`、`ReviewLevel` に分類する（[push\_buckets.go:41-45](../../../internal/github/push_buckets.go#L41-L45)）。
- `bucketReason` は分類理由で、full-stack scope、no anchor、stale head の 3 種がある（[push\_buckets.go:16-21](../../../internal/github/push_buckets.go#L16-L21)）。
- `ghComment` は GitHub のレビューコメント 1 件を表す（[github.go:54-68](../../../internal/github/github.go#L54-L68)）。 <!-- b_22wv6816 -->

## 落とし穴 <!-- b_rg6pxd0v -->

> [!WARNING]
> **落とし穴**
> - GitHub 側の `export.go` は非公開シンボルの公開ラッパーなので、内部名を変えるとここも直す必要がある（[export.go:9-15](../../../internal/github/export.go#L9-L15)）。
> - `fetchPRComments` の近くに todo が残っている（[github.go:466](../../../internal/github/github.go#L466)）。 <!-- b_h6rb2dgm -->
