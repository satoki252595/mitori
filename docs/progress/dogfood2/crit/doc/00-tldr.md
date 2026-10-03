# 0. ひとことで <!-- b_m8vaks9k -->

Crit は、計画、コード差分、フロントエンドの要素にブラウザ上でレビューコメントを付け、そのフィードバックをエージェントへ直接返すためのツールである（[README.md:8](../../README.md#L8)）。すべてはローカルで動く 1 つのバイナリにまとまっている（[README.md:23](../../README.md#L23)）。Go の CLI（`cmd/crit`）と `internal` 配下のパッケージがレビュー対象の解決とセッション管理を受け持ち、ブラウザ側の画面資産は `webassets.FS` として Go に埋め込まれる（[embed.go:1-6](../../web/embed.go#L1-L6)、[cli\_dispatch.go:3-15](../../cmd/crit/cli_dispatch.go#L3-L15)）。 <!-- b_hshye6xn -->

- 言語: go 35664 行 · javascript 20971 行 · typescript 166 行 · python 137 行
- 規模: 1219 ファイル · 64911 行
- 最終 commit: `406875dd31e0`（main）
- ライセンス: MIT
<!-- b_1jtx9rhd -->

- 読んだファイル 879 · 除外 340
- 除外の内訳: binary 299 · deny_glob 16 · fixture 13 · generated 1 · lockfile 5 · minified 3 · oversize 1 · special 2
<!-- b_xycrkv2n -->
