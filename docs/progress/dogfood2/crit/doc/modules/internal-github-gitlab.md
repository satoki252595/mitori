# forge 同期（internal） <!-- b_98z5h64p -->

- ファイル 19 · 4214 行 · 重要度 0.22
<!-- b_1058q3ve -->

> [!NOTE]
> **この章で分かること**
> - `forge.Provider` が GitHub と GitLab の差をどう吸収するか
> - GitHub の pull / push が `gh` 経由でコメントをどう同期するか
> - GitLab の MR 同期とキャッシュの扱い <!-- b_92hxq6w8 -->

## 責務 <!-- b_03het2tx -->

このモジュールは、レビューコメントを GitHub の PR や GitLab の MR と同期する層である。共通の型と `Provider` 契約を `internal/forge` に置き、各 forge の実装を `internal/github` と `internal/gitlab` に分けている（[forge.go:126-136](../../../internal/forge/forge.go#L126-L136)）。GitHub 側は `gh` コマンドの出力を解析して扱い、GitLab 側は `runAPI` 経由で API を呼ぶ（[api.go:40-45](../../../internal/gitlab/api.go#L40-L45)）。 <!-- b_zqkc6679 -->

## 公開インターフェース <!-- b_rfz5z0y8 -->

- `forge.Provider`: `Detect`、`Get`、`ListOpen`、`Pull`、`Push`、`FetchFile`、`Invalidate` を持つ forge 共通のインターフェース（[forge.go:126-136](../../../internal/forge/forge.go#L126-L136)）。
- `github.Provider` と `gitlab.Provider`: どちらも `forge.Provider` を実装する（[provider.go:292](../../../internal/gitlab/provider.go#L292)、[provider.go:150](../../../internal/github/provider.go#L150)）。
- `github.ParsePRSpec`: PR 番号または URL を `forge.ChangeID` に変換する（[spec.go:21-43](../../../internal/github/spec.go#L21-L43)）。
- `github.RunPull` / `github.RunPush`: CLI の pull / push 本体（[pull\_cli.go:95-100](../../../internal/github/pull_cli.go#L95-L100)）。
- `clicmd.Exit` と `clicmd.ExitError`: エラーを終了コードに変換する（[clicmd.go:26-37](../../../internal/clicmd/clicmd.go#L26-L37)）。 <!-- b_m78b994f -->

## 処理の流れ <!-- b_kn95wm36 -->

1. `RunPull` はまず `RequireGH` で認証を確認し、フラグを解析して `ChangeID` を決める（[pull\_cli.go:96-108](../../../internal/github/pull_cli.go#L96-L108)）。
2. PR キャッシュを無効化し、コメントとスレッドの解決状態を取得する。後者の取得に失敗しても警告だけで続行する（[pull\_cli.go:110-121](../../../internal/github/pull_cli.go#L110-L121)）。
3. 既存のレビューファイルを読み、無ければ初期化して `MergeGHCommentsScoped` で統合する（[pull\_cli.go:141-158](../../../internal/github/pull_cli.go#L141-L158)）。
4. 追加が 0 件なら保存せずに終了する（[pull\_cli.go:160-167](../../../internal/github/pull_cli.go#L160-L167)）。 <!-- b_ay0eyzf7 -->

## 性能 <!-- b_zr6gext4 -->

`prMetadataCache` は PR メタデータをキャッシュし、上限 64 件を超えるとアクセスが最も古いエントリを追い出す（[pr\_cache.go:16](../../../internal/github/pr_cache.go#L16)、[pr\_cache.go:82-85](../../../internal/github/pr_cache.go#L82-L85)）。取得中に別の goroutine が先に登録していた場合は、既存エントリを優先して全呼び出し元が同じポインタに揃うようにしている（[pr\_cache.go:76-81](../../../internal/github/pr_cache.go#L76-L81)）。 <!-- b_8g30p0m1 -->

## 落とし穴 <!-- b_9c108pjq -->

> [!WARNING]
> **落とし穴**
> - 編集の検出は `LastPushedBodyHash` と現在の本文のハッシュを比べて行う。したがって push 後に `updateCritJSONWithEditedBodies` でハッシュを更新しないと、同じ編集が再送される（[github.go:1047](../../../internal/github/github.go#L1047)、[github.go:1119](../../../internal/github/github.go#L1119)）。
> - 新規コメントへの GitHub ID の書き戻しは `path:EndLine` のキーに頼っている（[github.go:1346-1347](../../../internal/github/github.go#L1346-L1347)）。 <!-- b_bdsk2r93 -->
