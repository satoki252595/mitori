# LLM とエディター連携の確認（2026-10-06）

利用者の要望は、手元の実行環境・ログインを再利用し、少ない手順で mitori を使うこと。開発用 Nix と利用者の実行条件は分ける。今回の調査は公式ドキュメント、既存実装、インストール済み CLI の `--help` と Muse launcher の読み取りのみ。インストール・有料推論・認証情報の出力は行っていない。

## 採用する接続方法

| 利用中のもの | 接続方法 | 確認できたこと / 限界 |
| --- | --- | --- |
| Claude Code | 既存 `claude-cli`。ログイン済み CLI を検出して設定 | mitori が空ディレクトリ・限定設定・無ツールで起動する既存実装を再利用。CLI の版・認証・必要能力は detect で確認する。 |
| Codex | 既存 `codex-cli` と、利用者が操作する MCP / Pull | `codex mcp add` の登録と stdio に対応。mitori 内の自動実行は既存の専用 profile に限定。任意の Codex CLI を generic へ横流ししない。 |
| Muse | 既存 `generic` / `muse-jsonl` の専用 profile | native binary と固定 argv、auth のみをコピーする一時設定を使用。自動更新 launcher を LLM の呼び出しに使用しない。 |
| Cursor | 利用者が既存の Cursor から mitori MCP / Pull を使う | `--print` は存在するが tools・MCP・hooks を残すため、無ツールの直接 backend と同一扱いしない。 |
| Antigravity | 利用者が既存の Antigravity から mitori MCP / Pull を使う | `agy --print` も実在する。設定・hooks・plugins を完全に隔離する条件は今回未検証なので、自動 backend の「対応済み」を断言しない。 |
| Grok | xAI の OpenAI 互換 Chat Completions API | 既存の xAI API key を使う。Grok のチャット契約・Grok Build のログインと API 利用を同一視しない。 |
| ローカル LLM | Ollama など既存の OpenAI 互換 endpoint | すでに起動済みの service と取得済み model を使う。モデル名・endpoint を指定し、勝手にダウンロードしない。モデル固有の品質と structured output は別に検証する。 |

MCP は外部エージェントから mitori を使う接続であり、mitori がその外部エージェントの全ツール・hook を無効化する機能ではない。変更は `mitori_submit_patch` へ提出するよう案内し、人の確認を待つ。自動 generation は既存の prep / ingest による外部セッションの手順も再利用する。

## MCP の設定先

- Cursor: プロジェクト `.cursor/mcp.json`、ユーザー `~/.cursor/mcp.json`。`mcpServers.mitori` に `type: "stdio"`、`command`、`args`。公式資料は workspace 変数もサポートするが、mitori は `mcp --repo <path>` で対象を明示する。[Cursor MCP](https://cursor.com/docs/mcp)
- Antigravity CLI / IDE: ユーザー `~/.gemini/config/mcp_config.json`、プロジェクト `.agents/mcp_config.json`。`mcpServers.mitori` に `command` と `args`。UI の Manage MCP Servers / View raw config、CLI の `/mcp` から再読み込みできる。旧資料の `~/.gemini/antigravity/mcp_config.json` を新しい既定値にしない。[Antigravity MCP](https://antigravity.google/docs/mcp)
- Codex: `codex mcp add mitori -- <command> <args...>`、または `~/.codex/config.toml` / `.codex/config.toml` の `[mcp_servers.mitori]`。`command`、`args`、任意 `cwd` を指定できる。登録 CLI はローカル `codex mcp add --help` でも確認した。[Codex MCP](https://learn.chatgpt.com/docs/extend/mcp?surface=cli)

設定ファイルは上書きせず、既存 `mcpServers` へ一項目だけ追加する手順を表示する。source 実行では絶対パスの Bun と起動元の entry（通常起動は `scripts/start.ts`）、compiled 実行では binary を使い、どちらも `mcp --repo <path>` を引数へ追加する。host の起動 cwd を対象 repo と仮定しない。

## CLI の直接実行で注意すること

- Claude は `--tools ""` と `--setting-sources`、`--strict-mcp-config`、`--disable-slash-commands` を持つ。mitori の既存 argv はこれらと起動後の能力検査を組み合わせている。[Claude Code CLI reference](https://code.claude.com/docs/en/cli-reference)
- Cursor `--print` は write / shell にもアクセス可能。`--mode ask` は読み取りを許すため無ツールとは異なる。`CURSOR_CONFIG_DIR` で CLI 設定を切り替えられるが、hooks / MCP / rules の完全隔離の証拠はない。この Mac の `cursor-agent --help` で flag を確認した。[Cursor parameters](https://cursor.com/docs/cli/reference/parameters)、[configuration](https://cursor.com/docs/cli/reference/configuration)、[using](https://cursor.com/docs/cli/using)
- Antigravity headless は text / JSON / JSONL、stdin、モデル指定に対応。permission deny は `read_file(*)`、`write_file(*)`、`command(*)`、`mcp(*)` などを持つが、deny だけで起動 hook / plugin を排除したことにはならない。この Mac の `agy --help` に `--disable-slash-commands` もある。[headless](https://antigravity.google/docs/cli/headless/)、[permissions](https://antigravity.google/docs/permissions?tab=cli)、[hooks](https://antigravity.google/docs/hooks)
- この Mac の bare `agent` は Grok Build の `~/.grok/bin/agent`。Cursor の検出で `agent` という名前だけを信頼せず、`cursor-agent` または確認済みの実体を使う。

## Muse の native binary 検出

インストール済み `~/.local/bin/muse` launcher の `resolve_install_dir` と `active_binary` を確認。launcher の実体を resolve した親ディレクトリ内の `.muse-version` を読み、検証した version から sibling `muse-bin-<version>` を選ぶ。launcher 自体を実行すると自動更新・ダウンロードを行う場合があるため、探索では実行しない。[Muse configuration](https://dev.meta.ai/docs/muse-code/configuration)、[ADR-0015](../design/adr/0015-configurable-llm.md)

この Mac の marker は `1.4.3-R5018.1`。既存の実生成・lean profile 証跡は `1.4.2-R4684.1` を対象とする。新しい binary に切り替えたことだけで同じ実検証を完了したとは扱わず、検出・pin と profile 再検証を行う。

## HTTP endpoint と料金

- xAI: `https://api.x.ai/v1/chat/completions`、Bearer API key、OpenAI 互換 messages / response。ツールを送らず、返された tool call も実行しない。[Chat Completions](https://docs.x.ai/developers/model-capabilities/legacy/chat-completions)
- 2026-10-06 に確認した現行モデルページ（更新日 2026-09-21）は `grok-4.7`、input **$2.00 / 百万 token**、output **$6.00 / 百万 token**。このモデルの既定値にはこの rates を使い、別モデルを指定するときは確認済み料金を別途指定する。cache 単価はこのページから未確定なので、推計では通常 input と同じ値を使い割引を仮定しない。provider の将来の料金変更や実請求上限を保証する値ではない。[Models & Pricing](https://docs.x.ai/developers/models)
- Ollama: `http://localhost:11434/v1/` の OpenAI 互換 endpoint。認証 key は local endpoint では不要。`/api/tags` でローカルモデルを列挙できる。互換 API は JSON mode と `response_format` を持つが、利用する model / server ごとに構造化応答を検証する。[OpenAI compatibility](https://docs.ollama.com/api/openai-compatibility)、[List models](https://docs.ollama.com/api/tags)

独自 SDK は追加せず既存 Bun の HTTP 機能で接続する。秘密情報は環境変数参照とし、引数・Git・診断出力へ key を入れない。redirect で key を別 origin へ転送せず、timeout・応答上限・既存予算・patch schema と人の確認を保つ。今回、これら各 provider の実課金品質試験は行っていない。
