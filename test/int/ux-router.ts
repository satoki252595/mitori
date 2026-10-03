/**
 * The scripted engine of the ux finishing-pass scenarios (`ux.test.ts`, `shots/ux.ts`), keyed on the rendered loop
 * bundle like `routeLoop` (INT-06): an answer for questions; for the token Fix a `patch/1` on `config.go` plus the
 * env row's doc update; for the retry Fix the INT-06 patch plus the doc update of the sentence that asked for it.
 */
import { routeLoop } from "./router.ts";

export const CONFIG = "internal/config/config.go";
export const ASK = "TSUNDOKU_API_TOKEN の既定値を dev にして";
export const TOKEN_LINE = '\t\tAPIToken:    os.Getenv("TSUNDOKU_API_TOKEN"),';
export const RETRY_ASK = "回数を設定可能に";
/** The cited sentence a human writes into the doc (file form: the ja cite group around the link). */
export const CITED_MD = "`Fetch` は失敗した取得を 1 回だけ再試行する（[fetch.go:46-61](../../internal/meta/fetch.go#L46-L61)）。";
/** The AI's rewrite of that sentence after the retry Fix. */
export const CITED_MD_AI = "`Fetch` は失敗した取得を `MaxRetries` 回まで再試行する（[fetch.go:46-61](../../internal/meta/fetch.go#L46-L61)）。";

export function routeUx(prompt: string): { kind: "answer"; text: string } | { kind: "patch"; patch: unknown } | null {
  const head = /^MBF\/1 mode=(\w+)/m.exec(prompt);
  if (!head) return null;
  const thread = /^TASK (th_\w+) /m.exec(prompt)?.[1] ?? "th_unknown";
  if (head[1] === "answer") return { kind: "answer", text: `\`Load\` が環境変数を起動時に 1 回だけ読む [[${CONFIG}:19-38]]。未設定なら空文字のまま動く。` };
  const doc = /^DOC (b_\w{8}) /m.exec(prompt)?.[1];
  if (prompt.includes(`ASK\n> ${RETRY_ASK}`)) {
    const r = routeLoop(prompt);
    if (r?.kind !== "patch") return null;
    return { kind: "patch", patch: { ...(r.patch as object), doc_updates: doc ? [{ block: doc, md: CITED_MD_AI }] : [] } };
  }
  if (!prompt.includes(ASK)) return null;
  const table = [...prompt.matchAll(/^> (\|.*)$/gm)].map((m) => m[1] as string).join("\n");
  return {
    kind: "patch",
    patch: {
      summary: "TSUNDOKU_API_TOKEN の既定値を dev にした",
      edits: [{ path: CONFIG, start: 36, end: 36, first_line: TOKEN_LINE, new_text: '\t\tAPIToken:    cmp.Or(os.Getenv("TSUNDOKU_API_TOKEN"), "dev"),' }],
      doc_updates: doc ? [{ block: doc, md: table.replace("| `TSUNDOKU_API_TOKEN` | なし |", "| `TSUNDOKU_API_TOKEN` | `dev` |") }] : [],
      threads: [{ id: thread, status: "done", body: "既定値を dev にしました。" }],
    },
  };
}
