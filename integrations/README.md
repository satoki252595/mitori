# integrations/ — エージェント連携のテンプレート（生成物）

`mitori install` が書くファイルと同じ内容を、リポジトリから直接使える形で置いています。正本は
`packages/loop/src/contract.ts` の `INTEGRATION_TEMPLATES`（バイト固定）で、ここはそのレンダリング結果です。
手で編集しないでください: `packages/loop/src/install/install.golden.test.ts` が一致を検査し、
`MITORI_UPDATE_GOLDEN=1 scripts/nd bun test packages/loop/src/install` で書き直します。

| ディレクトリ | 中身 | `mitori install` での相当 |
|---|---|---|
| `claude-code/` | ローカル marketplace `mitori-local` と plugin `mitori`（`/mitori:review`・`/mitori:gen`・PostToolUse の touch hook） | `mitori install claude-code`（`~/.mitori/integrations/claude-code/`） |
| `claude-code-project/` | project scope の skill（`/mitori-review`。hook は書かない） | `mitori install claude-code --scope project` |
| `codex/` | Codex 用 skill（`--wait-sec 540` で区切って回す） | `mitori install codex` |
| `agents-md/` | AGENTS.md / CLAUDE.md の管理ブロック（marker の間だけを mitori が書き換える） | `mitori install agents-md` |

hook と `.mcp.json` の `{mitoriBin}` は、ここでは PATH 上の `mitori`、`mitori install` では install 時の realpath に
なります。MCP は opt-in なので、ここには `.mcp.json` を置きません（`mitori install claude-code --mcp`）。

Plugin を検証する: `claude plugin validate ./integrations/claude-code`。
