/**
 * `mitori open [<docId>[#<block>]] [--no-open]` — the portable permalink (ARCHITECTURE §2.2, UXP-13): a doc id from a
 * committed `.mitori/mitori.json` or a shared link opens the local workspace that holds that doc (the daemon resolves
 * `/d/<docId>/b/<block>`); without an id, the workspace of the cwd. The plain URL goes to stdout; the browser opens
 * through a one-time login URL unless `--no-open` / `ui.openBrowser = false` / a tab is already connected.
 */
import { type BlockId, type DocId, HREFS, MitoriError, type WorkspaceKey } from "@mitori/core";
import { parse } from "./args.ts";
import { openInBrowser } from "./browser.ts";
import { helpLang } from "./help.ts";
import { type Io, usage } from "./io.ts";
import { connect, connectWorkspace, type Session } from "./session.ts";

const DOC_RE = /^doc_[0-9a-z]{12}$/;
const BLOCK_RE = /^b_[0-9a-z]{8}$/;

/** `doc_…[#b_…]` (also `/d/doc_…/b/b_…` and full permalink URLs). */
export function parsePermalink(raw: string): { doc: DocId; block: BlockId | null } {
  const m = /(doc_[0-9a-z]{12})(?:(?:#|\/b\/)(b_[0-9a-z]{8}))?\/?$/.exec(raw.trim());
  if (!m || !DOC_RE.test(m[1] ?? "") || (m[2] !== undefined && !BLOCK_RE.test(m[2])))
    throw usage(`not a doc id: ${raw}`, "doc ids look like doc_0123456789ab[#b_k3f9a2cq]");
  return { doc: m[1] as DocId, block: (m[2] as BlockId | undefined) ?? null };
}

/**
 * After `mitori <path>` opened a workspace: a one-time login URL on stderr, the browser (same rules as above), and the
 * install freshness notice of spec §11.4 (outdated / missing integration files; modified ones are the user's).
 */
export async function afterOpen(io: Io, s: Session, ws: WorkspaceKey, open: boolean): Promise<void> {
  const to = HREFS.map(ws);
  const nonce = await s.api.call("POST /auth/nonce", { params: {}, body: { to } });
  io.err(`mitori: open ${nonce.url}\n`);
  if (open) await openInBrowser(io, s, ws, to);
  const ja = helpLang(io.env) === "ja";
  try {
    const never: string[] = [];
    for (const v of await s.api.call("GET /integrations", { params: {}, query: { ws } }))
      for (const state of ["outdated", "missing"] as const) {
        const n = v.files.filter((f) => f.state === state).length;
        if (n === 0) continue;
        // NC-18 / F14: an integration never installed is a hint, not five warnings — one line for all of them
        if (state === "missing" && n === v.files.length) {
          never.push(v.target);
          continue;
        }
        const cmd = `mitori install ${v.target}${v.scope === "project" ? " --scope project" : ""}`;
        io.err(
          ja
            ? `mitori: ${v.target} の連携ファイルが ${n} 件${state === "outdated" ? "古くなっています" : "見つかりません"}（${cmd} で更新できます）\n`
            : `mitori: ${n} ${v.target} integration file(s) ${state === "outdated" ? "are outdated" : "are missing"} (\`${cmd}\` updates them)\n`,
        );
      }
    if (never.length > 0)
      io.err(
        ja
          ? `mitori: ヒント — \`mitori install\` で自分のエージェント（${[...new Set(never)].join(" / ")}）から設計書のレビューを受け取れます\n`
          : `mitori: hint — \`mitori install\` lets your own agent (${[...new Set(never)].join(" / ")}) take reviews from the design doc\n`,
      );
  } catch {
    // a daemon without the installer routes: nothing to report
  }
}

export async function run(io: Io): Promise<number> {
  const { values, positionals } = parse(io.argv, { "no-open": { type: "boolean" } }, "open");
  if (positionals.length > 1) throw usage(`unexpected argument ${positionals[1]}`, "mitori open --help");
  const noOpen = values["no-open"] === true;
  if (positionals[0] === undefined) {
    const s = await connectWorkspace(io);
    const path = HREFS.map(s.ws.info.key);
    io.out(`${s.daemon.origin}${path}\n`);
    if (!noOpen) await openInBrowser(io, s, s.ws.info.key, path);
    return 0;
  }
  const { doc, block } = parsePermalink(positionals[0]);
  const s = await connect(io);
  const ws = (await s.api.call("GET /workspaces", { params: {} })).find((w) => w.info.docId === doc);
  if (!ws) throw new MitoriError("E_NOT_FOUND", `no local workspace holds ${doc}`, { params: { doc }, hint: "open the repository once with `mitori <path>`" });
  const path = block ? HREFS.portable(doc, block) : HREFS.map(ws.info.key);
  io.out(`${s.daemon.origin}${path}\n`);
  if (!noOpen) await openInBrowser(io, s, block ? null : ws.info.key, path);
  return 0;
}
