/**
 * `mitori <command> --help` (CLI-G-001, ja / en by locale: `MITORI_LANG` > `LC_ALL` > `LC_MESSAGES` > `LANG`).
 * Agent-facing output elsewhere stays English and byte-stable; only help and human summaries are localized.
 */

export type HelpLang = "ja" | "en";

/** `ja` when the locale says Japanese. */
export function helpLang(env: Readonly<Record<string, string | undefined>>): HelpLang {
  const loc = env.MITORI_LANG || env.LC_ALL || env.LC_MESSAGES || env.LANG || "";
  return /^ja/i.test(loc) ? "ja" : "en";
}

type Help = Record<HelpLang, string>;

/** Help per command (first line = synopsis). */
export const HELP: Readonly<Record<string, Help>> = {
  review: {
    ja: `mitori review [--round N] [--wait-sec S] [--no-open] [--agent <label>]
  レビューの 1 ラウンドを待ち受けます（人が「まとめて送る」まで block）。stdout に mitori.review/1、stderr の最後の行に
  approved: true|false。--wait-sec を過ぎたら pending（exit 11）、daemon 停止は exit 10。
  --round N   前のラウンド N-1 を完了にしてから N を待つ（NEXT: の行をそのまま実行）
`,
    en: `mitori review [--round N] [--wait-sec S] [--no-open] [--agent <label>]
  Wait for one review round (blocks until a human presses Finish). stdout: mitori.review/1; the last stderr line is
  approved: true|false. Past --wait-sec: pending (exit 11); daemon stopped: exit 10.
  --round N   complete round N-1 first, then wait for N (run the NEXT: line as printed)
`,
  },
  bundle: {
    ja: `mitori bundle <th_id> [--budget N] [--lines] [--mode pull|copy] [--target claude-code|codex|generic]
  thread 1 件の最小コンテキスト（MBF/1）を stdout に出します。既定 4,000 token、最大 12,000。
  --lines  コードに行番号を付ける
`,
    en: `mitori bundle <th_id> [--budget N] [--lines] [--mode pull|copy] [--target claude-code|codex|generic]
  Print the minimal context of one thread (MBF/1). Default 4,000 tokens, max 12,000.
  --lines  number the code lines
`,
  },
  reply: {
    ja: `mitori reply <th_id> (--done | --answer | --question) [<text> | --body-file <file> | -] [--files a,b] [--doc-update-file <file>]
  thread に返信します（--done=コードを直した、--answer=答えた、--question=人に聞きたい）。thread を閉じる手段はありません。
  --body-file  repo か <docDir>/tmp の通常ファイルだけ。-  は stdin から読む（≤ 8,000 文字）
`,
    en: `mitori reply <th_id> (--done | --answer | --question) [<text> | --body-file <file> | -] [--files a,b] [--doc-update-file <file>]
  Reply to a thread (--done: you changed code, --answer: answered, --question: needs the human). Agents cannot resolve.
  --body-file  a regular file in the repo or <docDir>/tmp only. -  reads stdin (≤ 8,000 chars)
`,
  },
  touch: {
    ja: `mitori touch --stdin [--source claude-hook|codex-hook|cli]
  PostToolUse hook 用。編集されたファイルを cite する block を古い印にします。何も出力せず、常に exit 0。
`,
    en: `mitori touch --stdin [--source claude-hook|codex-hook|cli]
  PostToolUse hook: marks the doc blocks citing the edited files stale. Prints nothing, always exits 0.
`,
  },
  open: {
    ja: `mitori open [<docId>[#<block>]] [--no-open]
  設計書をブラウザで開きます。docId（可搬 permalink）を渡すと、それを持つ手元の workspace を開きます。
`,
    en: `mitori open [<docId>[#<block>]] [--no-open]
  Open the design doc in the browser. With a docId (portable permalink), the local workspace holding it.
`,
  },
  check: {
    ja: `mitori check <file> [--kind gen-output|repo-config|doc]
  ファイルを検証し、誤りを ≤ 20 行（<at>: expected <x>, got <y> [<CODE>]）で出します。exit 0=妥当 / 1=誤り / 2=使い方。
`,
    en: `mitori check <file> [--kind gen-output|repo-config|doc]
  Validate a file; prints ≤ 20 lines \`<at>: expected <x>, got <y> [<CODE>]\`. Exit 0 valid / 1 errors / 2 usage.
`,
  },
  digest: {
    ja: `mitori digest [--max-tokens N]
  1 行の状況（doc の版・未解決 thread・古い block）。SessionStart hook 用。daemon が無ければ何も出しません。
`,
    en: `mitori digest [--max-tokens N]
  One status line (doc revision, open threads, stale blocks) for a SessionStart hook. Prints nothing without a daemon.
`,
  },
  gen: {
    ja: `mitori gen [--effort overview|standard|complete] [--scope <section>…]      見積りを出して TTY で確認してから生成
mitori gen --prep [--effort E] [--scope <section>…] [--continue <pr_id>]   この session の agent が書く packet を作る
mitori gen --ingest <pr_id> [--partial] [--model <model id>]             agent が書いた out/*.ndjson を取り込む
  --repo /absolute/repo は起動元フォルダに関係なく対象repoを指定します。
  --prep / --ingest は mitori 自身は API を使いません。exit 0=妥当 / 1=誤り（直して再実行）/ 3=期限切れ・fingerprint 不一致。
`,
    en: `mitori gen [--effort overview|standard|complete] [--scope <section>…]      estimate, confirm on a TTY, generate
mitori gen --prep [--effort E] [--scope <section>…] [--continue <pr_id>]   build a packet for the agent of this session
mitori gen --ingest <pr_id> [--partial] [--model <model id>]             take in the agent's out/*.ndjson
  --repo /absolute/repo selects the repository regardless of the working directory.
  --prep / --ingest make no API calls of their own. Exit 0 valid / 1 errors (fix and re-run) / 3 expired or fingerprint.
`,
  },
  install: {
    ja: `mitori install <claude-code|claude|codex|agents-md> [--scope user|project] [--mcp] [--force] [--yes]
  agent との連携ファイルを書きます。既存の編集済みファイルは上書きしません（--force は TTY で確認）。
  claude-code（user）: ~/.mitori/integrations/claude-code の plugin（/mitori:review・/mitori:gen・touch hook）
  agents-md: AGENTS.md（と CLAUDE.md）の管理ブロック（≤ 80 token）
  --mcp  MCP server も登録（opt-in）   --yes  表示した claude plugin コマンドも実行
`,
    en: `mitori install <claude-code|claude|codex|agents-md> [--scope user|project] [--mcp] [--force] [--yes]
  Write the agent integration files. Files you edited are never overwritten (--force asks on a TTY).
  claude-code (user): the plugin in ~/.mitori/integrations/claude-code (/mitori:review, /mitori:gen, touch hook)
  agents-md: the managed block of AGENTS.md (and CLAUDE.md), ≤ 80 tokens
  --mcp  also register the MCP server (opt-in)   --yes  also run the printed claude plugin commands
`,
  },
  mcp: {
    ja: `mitori mcp [--repo <path>]
  --repo  MCP host の起動ディレクトリにかかわらず、このリポジトリに接続します。
  stdio の MCP server（opt-in）。8 tool: mitori_status / list_threads / get_bundle / get_doc / find_symbol / reply /
  submit_patch / propose_resolution。登録: claude mcp add mitori -- mitori mcp
`,
    en: `mitori mcp [--repo <path>]
  --repo  Bind to this repository regardless of the MCP host's working directory.
  stdio MCP server (opt-in). 8 tools: mitori_status / list_threads / get_bundle / get_doc / find_symbol / reply /
  submit_patch / propose_resolution. Register: claude mcp add mitori -- mitori mcp
`,
  },
  setup: {
    ja: `mitori setup <claude|muse|grok|ollama|lmstudio|openai|codex|cursor|antigravity> [options]
  既存のLLMを設定し、TTYで1回確認して保存します。インストール・モデル呼出しは行いません。
  --model ID                     ローカル/任意APIのモデル（Grok既定grok-4.7、Muse既定contributor）
  --repo /absolute/repo          Codex/Cursor/Antigravity/Grokの外部セッションとMCP対象
  --api                         Grokで外部セッションの代わりに有料APIを選択
  --binary /absolute/path        Claude/Museの実行ファイル（Museはnative binary）
  --base-url URL --key-env NAME  OpenAI互換APIのURLとキーの環境変数名（キー自体は保存しない）
  --in-price N --out-price N     任意remoteモデルのUSD/百万token単価
  --effort low|medium|high|xhigh|max  Museの推論強度（既定max、HTTPへは送らない）
  --print                        設定・連携手順の表示だけ（保存・接続しない）
  例: mitori setup grok --repo /absolute/repo（既存セッション） / mitori setup grok --api（XAI_API_KEY）
`,
    en: `mitori setup <claude|muse|grok|ollama|lmstudio|openai|codex|cursor|antigravity> [options]
  Configure an existing provider after one terminal confirmation. No installs or model calls.
  --model ID                     Required for local/custom APIs; Grok defaults to grok-4.7, Muse to contributor
  --repo /absolute/repo          External Codex/Cursor/Antigravity/Grok session and MCP workspace
  --api                         Select metered Grok API instead of an existing external session
  --binary /absolute/path        Claude/Muse executable (Muse: native binary)
  --base-url URL --key-env NAME  OpenAI-compatible URL and credential environment variable name
  --in-price N --out-price N     Custom remote model prices in USD per million tokens
  --effort low|medium|high|xhigh|max  Muse reasoning effort (default max; HTTP does not send effort)
  --print                        Preview settings/instructions without saving or connecting
  Examples: mitori setup grok --repo /absolute/repo (existing session) / mitori setup grok --api (XAI_API_KEY)
`,
  },
  auth: {
    ja: `mitori auth <claude|muse|codex|cursor|antigravity|grok|ollama> [--binary /absolute/path]
  人のTTYで実行ファイルとSHA-256を確認し、公式のログイン専用コマンドを開始します。
  認証情報は公式ツールが管理します。インストール・モデル呼出し・mitoriの設定変更は行いません。
  Cursorはcursor-agent、Muse/Grokはnative binaryを使用。Antigravityは公式アプリでサインインしてください。
  Museは確認後にlogout → login。既存のサインインと保存済みAPIキーを解除してアカウント認証へ切り替えます。
  Ollamaのローカルモデルは認証不要。signinはクラウド用で、利用枠・クレジットを消費します。
`,
    en: `mitori auth <claude|muse|codex|cursor|antigravity|grok|ollama> [--binary /absolute/path]
  Review the executable and SHA-256 on a human TTY, then start the official login-only command.
  Credentials stay with the official tool. No installs, model calls, or mitori configuration changes.
  Uses cursor-agent for Cursor and native Muse/Grok binaries. Sign into Antigravity in its official app.
  Muse uses logout then login after confirmation, clearing saved sign-in/API keys to switch to account authentication.
  Local Ollama models need no authentication; cloud usage consumes Ollama allowances or credits.
`,
  },
  config: {
    ja: `mitori config set <path> <value>
  実行系の設定（engines.* / limits.* / pins / security.* など）を変えます。TTY での確認が必須です。<value> は JSON（数値・真偽・"文字列"）か文字列。
`,
    en: `mitori config set <path> <value>
  Change an execution setting (engines.*, limits.*, pins, security.*, …). Needs a TTY confirmation. <value> is JSON or a string.
`,
  },
  share: {
    ja: `mitori share --server <HTTPS origin> [--ttl-days 1..30] [--code] [--decisions] [-o viewer.html]
  設計書を暗号化して期限付きリンクで共有します（TTY確認）。コード抜粋は --code で追加。リンクの鍵はブラウザ履歴・同期に残ります。
  -o は CLI に固定した viewer を保存し、表示した SHA-256 で viewer の同一性を確認できます。
`,
    en: `mitori share --server <HTTPS origin> [--ttl-days 1..30] [--code] [--decisions] [-o viewer.html]
  Publish an encrypted, expiring doc snapshot after human TTY confirmation. --code opts in to excerpts. Keys remain in browser history/sync.
  -o saves the CLI-pinned viewer; compare the displayed script SHA-256 for integrity.
`,
  },
  export: {
    ja: `mitori export --html [-o|--out <file|dir>] [--no-code] [--level newcomer|standard|expert] [--lang ja|en] [--decisions]
  ネットワーク不要・読み取り専用の 1 ファイルの HTML を書きます（目次・読者レベル・出典の抜粋・図・⌘K 検索つき。秘密らしき文字列は伏せ字にして件数を表示）。
  -o にディレクトリを渡すとその中に <名前>.mitori.html を書きます。--no-code はコードの抜粋を入れません（出典は path:行 だけ）。--decisions は決定事項の一覧を含めます。
`,
    en: `mitori export --html [-o|--out <file|dir>] [--no-code] [--level newcomer|standard|expert] [--lang ja|en] [--decisions]
  Write a self-contained, read-only HTML file that opens offline (contents, reader levels, cite excerpts, diagrams, ⌘K search; secret-like strings redacted and counted).
  -o with a directory writes <name>.mitori.html into it. --no-code leaves out the code excerpts (cites show path:line only). --decisions includes the decisions list.
`,
  },
  init: {
    ja: `mitori init [--commit] [--lang ja|en] [--agents-md]
  設計書の置き場所を用意します。--commit は .gitattributes と .mitori/.gitignore を書き、設計書を commit 対象にします（TTY 確認）。
`,
    en: `mitori init [--commit] [--lang ja|en] [--agents-md]
  Prepare the doc directory. --commit writes .gitattributes and .mitori/.gitignore so the doc is committed (TTY confirmation).
`,
  },
  scan: {
    ja: `mitori scan [--force]
  リポジトリを読み直します（token は使いません）。
`,
    en: `mitori scan [--force]
  Re-scan the repository (no tokens).
`,
  },
  usage: {
    ja: `mitori usage [--range today|7d|30d|month|all]
  token と API 換算の使用量を出します。
`,
    en: `mitori usage [--range today|7d|30d|month|all]
  Show token usage and its API-equivalent cost.
`,
  },
  stop: {
    ja: `mitori stop
  daemon を止めます（待機中の mitori review には approved: false が返ります）。
`,
    en: `mitori stop
  Stop the daemon (waiting mitori review calls get approved: false).
`,
  },
  doctor: {
    ja: `mitori doctor [--calibrate] [--reset-cache] [--rotate-session]
  daemon・engine・連携ファイルの状態を点検します。
`,
    en: `mitori doctor [--calibrate] [--reset-cache] [--rotate-session]
  Check the daemon, the engines and the integration files.
`,
  },
  pr: {
    ja: `mitori pr <job_id>
  job の PR ダイアログをブラウザで開きます（作成は画面で。TTY 必須）。
`,
    en: `mitori pr <job_id>
  Open the job's PR dialog in the browser (you create it there; needs a TTY).
`,
  },
};

/** One-screen overview (`mitori help`-style) built from the synopsis lines. */
export function overview(lang: HelpLang): string {
  const head =
    lang === "ja" ? "使い方: mitori [<path>] [--no-open] [--force]   リポジトリを開く\n" : "usage: mitori [<path>] [--no-open] [--force]   open a repository\n";
  const lines = Object.values(HELP).map((h) => `       ${h[lang].split("\n")[0]}`);
  return `${head}${lines.join("\n")}\n`;
}
