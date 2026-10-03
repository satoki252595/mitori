# 1. これは何か・誰のためか・なぜあるか <!-- b_dxn5whjx -->

## 解決する課題 <!-- b_8xd69e0b -->

エージェントから見れば、計画もコードもただのテキストである。しかし人間にとっては、生成された計画を読むことと Web アプリケーションを確かめることはまったく別の作業である（[README.md:14](../../README.md#L14)）。Crit は出力の種類ごとに専用のレビュー画面を用意する。利用者は問題の箇所を直接指し示し、エージェントに直させるためのコメントを残せる（[README.md:16](../../README.md#L16)）。 <!-- b_4x2nwdwq -->

## 利用者 <!-- b_p09h51ph -->

- AI コーディングエージェントを使う開発者は、計画、コード差分、フロントエンド要素をレビューし、そのフィードバックをエージェントへ送る（[README.md:8](../../README.md#L8)）。
- Claude Code、Cursor、Codex、Gemini CLI などのエージェントツールは、`crit install <tool>` で導入した設定ファイルを読み、Crit を使ってレビューを依頼する（[README.md:3-10](../../integrations/README.md#L3-L10)、[README.md:16-32](../../integrations/README.md#L16-L32)）。
- コンテナ内のサンドボックスでエージェントを動かす利用者は、ホストのブラウザからレビュー UI を開く（[README.md:3-5](../../integrations/docker/README.md#L3-L5)）。
- GitHub の PR や GitLab の MR でレビューする利用者は、`crit pull` と `crit push` でコメントを同期する（[README.md:3](../../test/roundtrip/README.md#L3)）。 <!-- b_kk78n3x5 -->

## 範囲 <!-- b_r5v3zrhy -->

- `crit plan.md` は、markdown ファイルを整形して表示し、レビュー UI を付ける（[README.md:18](../../README.md#L18)）。
- 引数なしの `crit` は git の変更を自動で検出し、ローカルレビュー用にシンタックスハイライト付きの差分を表示する（[README.md:19](../../README.md#L19)）。
- `crit http://localhost:3000` は、実行中のアプリをプロキシしてレビュー画面を重ねる。`crit landing.html` は静的な HTML 成果物をレビュー対象として表示する（[README.md:20-21](../../README.md#L20-L21)）。
- PR・MR のコメントを `crit pull` と `crit push` で GitHub・GitLab と同期する（[README.md:3](../../test/roundtrip/README.md#L3)）。
- エージェントツール向けの統合ファイルを `crit install` で導入する（[README.md:5-12](../../integrations/README.md#L5-L12)）。
- HTTP サーバーは認証を持たず、`127.0.0.1` にだけ bind する（[README.md:9](../../integrations/docker/README.md#L9)）。 <!-- b_bks3p89p -->

## 制約 <!-- b_rd09zbwp -->

- すべてがローカルで動き、配布物は1つのバイナリである（[README.md:23](../../README.md#L23)）。
- インストール手段として Brew、`go install`、Nix、Windows が案内されている（[README.md:28-40](../../README.md#L28-L40)）。
- VCS は git、Sapling、jj の3種類に対応し、それぞれ別の実装を持つ（[git\_vcs.go:12](../../internal/vcs/git_vcs.go#L12)、[sapling.go:13](../../internal/vcs/sapling.go#L13)、[jj.go:22](../../internal/vcs/jj.go#L22)）。
- GitHub との通信は `gh` コマンドを、GitLab との通信は `glab` を経由する（[forge.go:126-136](../../internal/forge/forge.go#L126-L136)、[provider.go:150](../../internal/github/provider.go#L150)、[api.go:15-17](../../internal/gitlab/api.go#L15-L17)）。
- Docker で使う場合は、loopback にだけ bind するサーバーへ外部から届かないため、コンテナ内の `socat` ブリッジで中継する（[README.md:9-11](../../integrations/docker/README.md#L9-L11)）。 <!-- b_z08j5dp4 -->
