/** Opt-in MCP setup text. The CLI never edits another application's configuration. */
export function integrationSetup(
  target: "cursor" | "antigravity" | "codex" | "grok",
  invocation: { command: string; args: string[]; workspace: string },
): string {
  const args = [...invocation.args, "mcp", "--repo", invocation.workspace];
  const quoted = (value: string) => `'${value.replaceAll("'", "'\\''")}'`;
  const cli = [invocation.command, ...invocation.args].map(quoted).join(" ");
  const generation = `\n文書生成を外部AIに依頼する場合：\n対象repoは ${JSON.stringify(invocation.workspace)} です。そこで ${cli} gen --prep --effort overview を実行し、表示されたreadmeに従って指定out/*.ndjsonへ出力してください。NEXTのmitoriは ${cli} に置き換えてgen --ingestを実行し、続きがあれば繰り返してください。対象ソースを直接編集しないでください。モデルは普段のツールで選んでください。\n`;
  const prompt = "mitori のレビューを取得し、変更案は mitori_submit_patch で提出してください。ファイルを直接変更せず、人の確認を待ってください。";
  if (target === "grok")
    return `公式 Grok Build のターミナルで次を実行し、/mcps で状態を確認してください（POSIX shell）。対象repoの .grok/config.toml へ登録します。\n\ngrok --cwd ${quoted(invocation.workspace)} mcp add mitori --scope project -- ${[invocation.command, ...args].map(quoted).join(" ")}\n\nGrok Build に依頼：${prompt}\n${generation}`;
  if (target === "codex") {
    return `Codex の全プロジェクト共通設定へ登録する場合は、次を実行してMCPを再読み込みしてください（POSIX shell）。\n\ncodex mcp add mitori -- ${[invocation.command, ...args].map(quoted).join(" ")}\n\n対象repoだけで使う場合は ${JSON.stringify(`${invocation.workspace}/.codex/config.toml`)} へ以下を追加してください。Codexで信頼済みのprojectに限り読み込まれます。共通設定の保存先は ~/.codex/config.toml です。既存のサーバー設定は残してください。\n[mcp_servers.mitori]\ncommand = ${JSON.stringify(invocation.command)}\nargs = ${JSON.stringify(args)}\n\nCodex に依頼：${prompt}\n${generation}`;
  }
  const location =
    target === "cursor"
      ? `${JSON.stringify(`${invocation.workspace}/.cursor/mcp.json`)}（プロジェクト）または ~/.cursor/mcp.json`
      : `~/.gemini/config/mcp_config.json（共通設定）または ${JSON.stringify(`${invocation.workspace}/.agents/mcp_config.json`)}（project設定に対応した版のみ）`;
  const server = { ...(target === "cursor" ? { type: "stdio" } : {}), command: invocation.command, args };
  const config = JSON.stringify({ mcpServers: { mitori: server } }, null, 2);
  const reload =
    target === "cursor" ? "Cursor の Customize / MCP で mitori を有効にするか再読み込み" : "Antigravity の Manage MCP Servers または CLI の /mcp で再読み込み";
  const register =
    target === "antigravity"
      ? `公式 CLI で登録する場合（POSIX shell）。このコマンドの登録先がproject限定であることは未確認です。アプリで接続が表示されない場合は、Manage MCP Servers / Open MCP Configで開く共通設定へ下のJSONを追加してください。Antigravity 2.12.2 / IDE 2.5.5ではproject設定の読み込みを確認できていません。\n\nagy mcp add mitori -- ${[invocation.command, ...args].map(quoted).join(" ")}\n\nアプリの設定ファイルへ追加する場合：\n`
      : "";
  return `${register}${location} の mcpServers に mitori を追加してください。既存のサーバー設定は残してください。\n\n${config}\n\n${reload}してください。\nAI に依頼：${prompt}\n${generation}`;
}
