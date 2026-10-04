/**
 * Scenario router for the fake engines of INT-04 / INT-05: answers a rendered gen prompt (the user message) with a
 * valid compact NDJSON reply, keyed on the TASK line (a text port of `@mitori/gen/testing` `validRouter`, which keys
 * on the call object the fake spawner does not see). Cites point at the first numbered line the prompt shows.
 */

/** First `N|` line under a `=== <path>` header (to build valid cites). */
export function firstShown(message: string, pathPrefix = ""): { path: string; line: number } | null {
  let file: string | null = null;
  for (const l of message.split("\n")) {
    const h = /^=== (\S+)/.exec(l);
    if (h) {
      file = h[1] as string;
      continue;
    }
    const n = /^(\d+)\|/.exec(l);
    if (n && file?.startsWith(pathPrefix)) return { path: file, line: Number(n[1]) };
  }
  return null;
}

const j = (o: unknown) => JSON.stringify(o);
const end = (n: number) => j({ t: "end", blocks: n });

/** NDJSON lines for one gen prompt (unit message). Retries and unknown prompts end with zero blocks. */
export function routeGen(message: string): string[] {
  if (/^TASK: Fix your previous reply/m.test(message)) return [end(0)];
  const shown = firstShown(message);
  const behavior = shown ? `behavior ${shown.path}:${shown.line}-${shown.line}` : "behavior";
  let m = /^TASK: Write the page for module (md_\w{8})/m.exec(message);
  if (m) {
    const mod = m[1] as string;
    return [
      j({ t: "block", id: "new:1", aspect: "responsibility", md: "このモジュールの責務を説明する[[1]]。", claims: { "1": behavior } }),
      j({ t: "block", id: "new:2", aspect: "interface", md: "- 公開関数を提供する[[1]]。", claims: { "1": behavior } }),
      j({ t: "module", module: mod, name: `部品${mod.slice(-2)}`, summary: "要約" }),
      end(2),
    ];
  }
  m = /^TASK: Write the page for parent module (md_\w{8})/m.exec(message);
  if (m)
    return [
      j({ t: "block", id: "new:1", aspect: "responsibility", md: "子モジュールをまとめる[[1]]。", claims: { "1": "architecture" } }),
      j({ t: "block", id: "new:2", aspect: "structure", md: "- 子がある[[1]]。", claims: { "1": "architecture" } }),
      j({ t: "module", module: m[1], name: "中核", summary: "中核の部品" }),
      end(2),
    ];
  if (/^TASK: Write the opening of the design document/m.test(message)) {
    const readme = firstShown(message, "README");
    const existing = (aspect: string) => new RegExp(`^> (b_\\w{8}) aspect=${aspect} `, "m").exec(message)?.[1];
    return [
      j({
        t: "block",
        id: existing("tldr") ?? "new:1",
        aspect: "tldr",
        md: "このリポジトリは本の一覧を管理する[[1]]。",
        claims: { "1": readme ? `fact ${readme.path}:${readme.line}` : "fact" },
      }),
      j({ t: "block", id: existing("problem") ?? "new:2", aspect: "problem", md: "読みたい本を忘れないようにする[[1]]。", claims: { "1": "architecture" } }),
      end(2),
    ];
  }
  m = /^TASK: Describe the (\d+) to \d+ most important flows/m.exec(message);
  if (m) {
    const out = [j({ t: "block", id: "new:1", aspect: "intro", md: "入口から処理が流れる。", claims: {} })];
    let n = 1;
    for (let k = 0; k < Math.max(1, Number(m[1])); k++) {
      out.push(j({ t: "flow", key: `flow${k + 1}`, title: `流れ${k + 1}` }));
      out.push(j({ t: "block", id: `new:${++n}`, aspect: "summary", md: `流れ${k + 1}の概要だ。`, claims: {} }));
      out.push(j({ t: "block", id: `new:${++n}`, aspect: "steps", md: "1. 受け付ける[[1]]", claims: { "1": behavior } }));
    }
    return [...out, end(n)];
  }
  // go-small's migrations/0001_init.up.sql is a schema in the real daemon too (its `.sql` files are generic sources,
  // whose text-only detectors now run — CR rdoc-7), so the plan has the §7 data-model task
  if (/^TASK: Explain the data model/m.test(message))
    return [j({ t: "block", id: "new:1", aspect: "overview", md: "本とタグが多対多でつながる[[1]]。", claims: { "1": "architecture" } }), end(1)];
  if (/^TASK: Build the glossary/m.test(message))
    return [j({ t: "term", term: "ハンドラ", yomi: "はんどら", en: "handler", def: "リクエストを処理する関数。" }), end(0)];
  if (/^TASK: Name the modules/m.test(message)) {
    const ids = [...message.matchAll(/^> (md_\w{8}) paths=/gm)].map((x) => x[1] as string);
    return [...ids.map((id) => j({ t: "module", module: id, name: `ラベル${id.slice(-2)}` })), end(0)];
  }
  return [end(0)];
}

/* ---- loop jobs (INT-06) --------------------------------------------------------------------------------------- */

/** Edits the "make the retry count configurable" scenario applies to go-small `internal/meta/fetch.go` (HEAD). */
export const RETRY_FILE = "internal/meta/fetch.go";
/** The retry loop of `Fetch` (the thread's anchor). */
export const RETRY_ANCHOR = { start: 49, end: 59 } as const;

/**
 * The scripted engine reply for a rendered loop bundle (`MBF/1 mode=<m> …`), or null for a prompt it does not know
 * (the gen router answers). `answer` ⇒ Markdown with a cite; `patch` ⇒ a valid `patch/1` whose `new_text` is
 * deliberately badly formatted (the gofmt gate must put it right).
 */
export function routeLoop(prompt: string): { kind: "answer"; text: string } | { kind: "patch"; patch: unknown } | null {
  const head = /^MBF\/1 mode=(\w+) out=(\S+)/m.exec(prompt);
  if (!head) return null;
  const thread = /^TASK (th_\w+) /m.exec(prompt)?.[1] ?? "th_unknown";
  if (head[1] === "answer") {
    return {
      kind: "answer",
      text: `\`Fetch\` は失敗した取得を \`maxRetries\` 回だけ繰り返し、最後のエラーを返す [[${RETRY_FILE}:${RETRY_ANCHOR.start}-${RETRY_ANCHOR.end}]]。回数は定数 \`maxRetries\` (= 1) で固定されている。`,
    };
  }
  if (head[1] === "patch" && prompt.includes("READMEも書き換えて")) {
    // an injection-shaped reply: the edit names a file the thread's WRITE does not list
    return {
      kind: "patch",
      patch: {
        summary: "README も直した",
        edits: [{ path: "README.md", start: 1, end: 1, first_line: "# tsundoku", new_text: "# tsundoku (edited)" }],
        doc_updates: [],
        threads: [{ id: thread, status: "done", body: "README を直しました。" }],
      },
    };
  }
  if (head[1] === "patch") {
    return {
      kind: "patch",
      patch: {
        summary: "再試行回数を MaxRetries 変数にして設定可能にした",
        edits: [
          {
            path: RETRY_FILE,
            start: 17,
            end: 19,
            first_line: "// maxRetries is how many times a failed lookup is repeated.",
            // `var MaxRetries  =  1` is not gofmt-clean on purpose
            new_text: "// MaxRetries is how many times a failed lookup is repeated; callers may change it (default 1).\nvar MaxRetries  =  1",
          },
          {
            path: RETRY_FILE,
            start: 50,
            end: 50,
            first_line: "\tfor attempt := 0; attempt <= maxRetries; attempt++ {",
            new_text: "\tfor attempt := 0; attempt <= MaxRetries; attempt++ {",
          },
        ],
        doc_updates: [],
        threads: [{ id: thread, status: "done", body: "MaxRetries を変数にしました。" }],
      },
    };
  }
  return null;
}
