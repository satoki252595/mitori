# 10. 設計判断 <!-- b_kn1kfssh -->

> [!IMPORTANT]
> **git・Sapling・jj の差異は `VCS` インターフェースの背後に隠し、実装を `GitVCS`・`SaplingVCS`・`JJVCS` に分けた。**呼び出し側は変更ファイルや diff を共通の型で受け取る（[vcs.go:14-137](../../internal/vcs/vcs.go#L14-L137)）。自動判定では、colocated な jj リポジトリや git 上の Sapling リポジトリが `.git/` も持つため、`.jj/`、`.sl/` を先に調べる（[vcs.go:177-186](../../internal/vcs/vcs.go#L177-L186)）。したがって `VCS` にメソッドを足すときは三実装すべてを更新する必要がある（[git\_vcs.go:12](../../internal/vcs/git_vcs.go#L12)、[sapling.go:13](../../internal/vcs/sapling.go#L13)、[jj.go:22](../../internal/vcs/jj.go#L22)）。 <!-- b_d2nk9czs -->

> [!IMPORTANT]
> **`DefaultBaseRef` は、git ではローカルの既定ブランチより `origin/<branch>` を優先する。**ローカルの既定ブランチは上流より古くなりやすく、既にリモートへマージ済みのコミットまで diff に混ざってしまうためである（[git.go:146-150](../../internal/vcs/git.go#L146-L150)）。ユーザーが base を明示した場合はその値をそのまま使う（[git.go:152-153](../../internal/vcs/git.go#L152-L153)）。Sapling は既定ブランチをそのまま返す（[vcs.go:43-47](../../internal/vcs/vcs.go#L43-L47)）。 <!-- b_vkgty5b8 -->

> [!IMPORTANT]
> **既定ブランチでレビューするときは、セッション開始時に `BaseRef` を HEAD に固定する。**固定しないと、複数ラウンドのレビュー中にコミットした時点で、作業ツリーと現在の HEAD だけを比べる `ChangedFilesOnDefaultInDir` の結果が空になり、ラウンド完了時にファイル一覧が消える（[session.go:779-783](../../internal/session/session.go#L779-L783)）。base を扱うコードを変えるときはこの前提を崩さないこと。 <!-- b_rh51s2t8 -->

> [!IMPORTANT]
> **git 呼び出しは環境変数を置き換えず `os.Environ` に追記し、`GIT_TERMINAL_PROMPT=0` を付ける。**既存の認証や SSH agent の設定を保ちつつ、tty のないデーモンから実行しても認証プロンプトで止まらないようにするためである（[git.go:66-68](../../internal/vcs/git.go#L66-L68)）。 <!-- b_qbf6kfey -->

> [!IMPORTANT]
> **範囲指定のコミット参照は 4〜40 桁の 16 進文字列に限定する。**`base..head` を単一の引数として git に渡すため、`-` で始まるトークンによるオプション注入を正規表現 `commitishRe` で弾く（[git.go:424-427](../../internal/vcs/git.go#L424-L427)）。 <!-- b_y0m2bk57 -->

> [!IMPORTANT]
> **Sapling には既定ブランチの代わりに「なし」を許し、存在しない `main` を仮定しない。**検出に失敗した場合は full-stack スコープを無効にし、`assignStackBases` の merge-base 検索も実在しない参照に対して走らせず、そのまま次の処理へ進む（[sapling.go:415-419](../../internal/vcs/sapling.go#L415-L419)）。また Sapling にはステージング領域がないため `HasStagingArea` は false を返す（[sapling.go:406-407](../../internal/vcs/sapling.go#L406-L407)）。 <!-- b_4btch3s7 -->

> [!IMPORTANT]
> **`Session` の状態は `sync.RWMutex` の `mu` で守り、ファイル書き出しには別の `writeMu` を使う。**サーバー側ではセッションを `atomic.Pointer[Session]` で保持し、差し替えとハンドラの読み出しが競合しないようにしている（[session.go:487-497](../../internal/session/session.go#L487-L497)）（[server.go:59](../../internal/server/server.go#L59)）。 <!-- b_x68b0yxn -->

- まだ決定はありません。スレッドの結論を「決定として残す」と、ここに並びます。
<!-- b_hem1w3ab -->
