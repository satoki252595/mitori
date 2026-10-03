# 1. これは何か・誰のためか・なぜあるか <!-- b_01h81r4b -->

## 解決する課題 <!-- b_h6b7agff -->

エージェントにとって計画もコードも単なるテキストだが、人間にとって生成された計画のレビューと Web アプリのレビューはまったく別の作業である（[README.md:14](../../README.md#L14)）。Crit は出力の種類ごとに専用のレビュー画面を用意し、問題のある箇所を直接指してエージェント向けのコメントを残せるようにする（[README.md:16](../../README.md#L16)）。 <!-- b_pq5w2nxt -->

## 利用者 <!-- b_9kk3bdyr -->

- 計画をレビューする人は、`crit plan.md` で markdown を整形表示し、行にコメントを付ける（[README.md:18](../../README.md#L18)）。
- ローカルのコード変更をレビューする人は、引数なしの `crit` で git の変更を自動検出し、シンタックスハイライト付きの diff を見る（[README.md:19](../../README.md#L19)）。
- フロントエンドを確認する人は、`crit http://localhost:3000` で実行中のアプリをプロキシ経由で開き、静的な HTML なら `crit landing.html` で開く（[README.md:20-21](../../README.md#L20-L21)）。
- AI コーディングツールの利用者は、`crit install <tool>` で各ツール向けのスキルやコマンドを導入し、エージェントに Crit を使わせる（[README.md:3-9](../../integrations/README.md#L3-L9)）。
- GitHub の PR や GitLab の MR で作業する人は、`crit pull` と `crit push` でレビューコメントを forge と往復させる（[README.md:3](../../test/roundtrip/README.md#L3)）。
- 5 分で試すには、`brew install crit` でバイナリを入れ、変更のある git リポジトリで `crit` を実行して表示された diff の行にコメントを付ける。エージェントと組み合わせるなら、続けて `crit install claude-code` のように使っているツール名で連携を入れる（[README.md:28-31](../../README.md#L28-L31)、[README.md:19](../../README.md#L19)、[README.md:18](../../integrations/README.md#L18)）。 <!-- b_vmhkf3b0 -->

## 範囲 <!-- b_mpe38fng -->

- 扱う対象は、markdown の計画、git のコード差分、実行中の Web アプリ、静的 HTML の 4 種類である（[README.md:18-21](../../README.md#L18-L21)）。
- レビューコメントを GitHub の PR や GitLab の MR と同期する層を持ち、共通の `Provider` 契約の下に各 forge の実装がある（[forge.go:126-136](../../internal/forge/forge.go#L126-L136)）。
- レビューを共有サービスへ公開する `share` と、それを取り下げる `unpublish` のサブコマンドがある（[cli\_dispatch.go:24](../../cmd/crit/cli_dispatch.go#L24)、[cli\_dispatch.go:39](../../cmd/crit/cli_dispatch.go#L39)）。
- ローカル HTTP サーバーには認証がない。そのため外部からの到達は前提にせず、ループバックのみで待ち受ける（[README.md:9](../../integrations/docker/README.md#L9)）。 <!-- b_8cc107gn -->

## 制約 <!-- b_k1cw71gm -->

- 全体がローカルで動く単一バイナリで、Homebrew のほか Go、Nix、Windows 向けの導入手段がある（[README.md:23](../../README.md#L23)、[README.md:32-37](../../README.md#L32-L37)）。
- HTTP サーバーは `127.0.0.1` にだけ bind する。API はリポジトリのファイルを読め、`agent_cmd` を設定すればシェルも実行できるため、ループバック限定にしている（[README.md:9](../../integrations/docker/README.md#L9)）。
- Docker 内で使う場合は、コンテナ内の `socat` ブリッジを介し、ホスト側も `-p 127.0.0.1:8080:8080` のようにループバックで公開する（[README.md:11-17](../../integrations/docker/README.md#L11-L17)）。
- バージョン管理は `VCS` インターフェースで抽象化されており、git・Sapling・jj の 3 実装を持つ（[vcs.go:14-137](../../internal/vcs/vcs.go#L14-L137)、[git\_vcs.go:12](../../internal/vcs/git_vcs.go#L12)、[sapling.go:13](../../internal/vcs/sapling.go#L13)、[jj.go:22](../../internal/vcs/jj.go#L22)）。
- forge との往復テストは、GitHub では `gh`、GitLab では `glab` の CLI と認証済みのサンドボックスリポジトリを前提とする（[README.md:5-8](../../test/roundtrip/README.md#L5-L8)、[README.md:21-22](../../test/roundtrip/README.md#L21-L22)）。 <!-- b_z2dyv898 -->
