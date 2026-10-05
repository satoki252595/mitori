# mitori

> 見取り図 — リポジトリ全体を「見て取れる」設計書に変換し、人間と AI エージェントが同じ設計書の上でレビュー・修正指示・議論を行うためのツール。

Status: M0 — 契約凍結済み、実装中 (pre-alpha)

本体はリポジトリをcloneしてローカルで起動するツールです。Cloudflareへのデプロイは不要です。Cloudflareは、生成文書をURLで共有する任意の追加機能にだけ使います。

```sh
scripts/nd bun install --frozen-lockfile
scripts/nd bun run check     # typecheck + lint + boundaries + CR ledger + contract index + svelte-check
scripts/nd bun test
scripts/nd bun run build:bin && ./dist/mitori-darwin-arm64 --version
./dist/mitori-darwin-arm64 <repo-path>
```

ブラウザを自動で開かない場合は、起動コマンドに `--no-open` を付けます。

設計: `docs/design/`（作業分割 `MILESTONES.md`、各 WP の brief `docs/design/briefs/`）。開発規約: `CLAUDE.md`。
