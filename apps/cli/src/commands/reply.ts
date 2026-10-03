/**
 * `mitori reply <th> (--done | --answer | --question) [<text> | --body-file <f> | -] [--files a,b] [--doc-update-file <f>]`
 * (loop spec §10.3): `POST /threads/:th/reply` with the body verbatim (≤ 8,000 chars). There is no way to resolve:
 * the route only knows done / answer / question, and humans resolve in the UI. `--body-file` / `--doc-update-file`
 * read only a regular file inside the repository (never one matching `DEFAULT_DENY_GLOBS`) or under `<docDir>/tmp`;
 * the daemon secret-scans the body [SEC-04].
 */
import { lstatSync, readFileSync, realpathSync } from "node:fs";
import { isAbsolute, relative, resolve } from "node:path";
import { DEFAULT_DENY_GLOBS, MitoriError, type RepoPath, type WorkspaceInfo } from "@mitori/core";
import { parse, threadArg } from "./args.ts";
import { type Io, usage } from "./io.ts";
import { agentLabelFromEnv } from "./loop-contract.ts";
import { connectWorkspace } from "./session.ts";
import { docDirOf, whenReady } from "./workspace.ts";

/** Body limit (chars) of `AgentReplyReq.body`. */
export const REPLY_MAX_CHARS = 8000;
const FILES_MAX = 20;
/** Deny globs matched case-insensitively (macOS and Windows file systems fold case: `.ENV` is `.env`). */
const DENY = DEFAULT_DENY_GLOBS.map((g) => new Bun.Glob(g.toLowerCase()));

const under = (p: string, root: string) => p === root || p.startsWith(root.endsWith("/") ? root : `${root}/`);

/**
 * Read a file an agent names (`--body-file`): a regular file (not a symlink) whose realpath is inside the repo and not
 * deny-listed — or under `<docDir>/tmp` (prep packets, scratch replies). Anything else is `E_PATH_OUTSIDE`.
 */
export function readAgentFile(info: Pick<WorkspaceInfo, "root" | "docDir">, cwd: string, file: string, maxChars: number): string {
  const abs = resolve(cwd, file);
  const refuse = (why: string): never => {
    throw new MitoriError("E_PATH_OUTSIDE", `refusing to read ${file}: ${why}`, {
      params: { path: file },
      hint: "use a regular file in the repository or under <docDir>/tmp",
    });
  };
  let st: ReturnType<typeof lstatSync>;
  try {
    st = lstatSync(abs);
  } catch {
    throw new MitoriError("E_NOT_FOUND", `no such file: ${file}`, { params: { path: file } });
  }
  if (st.isSymbolicLink() || !st.isFile()) refuse("not a regular file");
  // every check below is on the realpath: a symlinked directory cannot smuggle a file in from elsewhere
  const real = realpathSync(abs);
  const root = realpathSync(info.root);
  const tmp = (() => {
    try {
      return realpathSync(`${docDirOf(info)}/tmp`);
    } catch {
      return null;
    }
  })();
  if (!(tmp !== null && under(real, tmp))) {
    if (!under(real, root)) refuse("outside the repository");
    const rel = relative(root, real);
    if (DENY.some((g) => g.match(rel.toLowerCase()))) refuse("the path is deny-listed (secrets, CI, agent config, the doc directory)");
  }
  if (st.size > maxChars * 4) throw new MitoriError("E_PAYLOAD_TOO_LARGE", `${file} is larger than ${maxChars} characters`, { params: { maxChars } });
  const text = readFileSync(real, "utf8");
  if (text.length > maxChars) throw new MitoriError("E_PAYLOAD_TOO_LARGE", `${file} is longer than ${maxChars} characters`, { params: { maxChars } });
  return text;
}

/** `--files a,b`: repo-relative paths (absolute or cwd-relative accepted); outside the repo ⇒ `E_PATH_OUTSIDE`. */
export function repoPaths(root: string, cwd: string, list: string): RepoPath[] {
  const out: RepoPath[] = [];
  for (const raw of list
    .split(",")
    .map((p) => p.trim())
    .filter(Boolean)) {
    const rel = relative(root, resolve(cwd, raw));
    if (rel === "" || rel === ".." || rel.startsWith("../") || isAbsolute(rel))
      throw new MitoriError("E_PATH_OUTSIDE", `not inside the repository: ${raw}`, { params: { path: raw } });
    if (!out.includes(rel as RepoPath)) out.push(rel as RepoPath);
  }
  if (out.length > FILES_MAX) throw usage(`--files takes at most ${FILES_MAX} paths`);
  return out;
}

export async function run(io: Io): Promise<number> {
  const { values, positionals } = parse(
    io.argv,
    {
      done: { type: "boolean" },
      answer: { type: "boolean" },
      question: { type: "boolean" },
      "body-file": { type: "string" },
      files: { type: "string" },
      "doc-update-file": { type: "string" },
      agent: { type: "string" },
    },
    "reply",
  );
  const th = threadArg(positionals[0], "reply");
  const kinds = (["done", "answer", "question"] as const).filter((k) => values[k] === true);
  if (kinds.length !== 1) throw usage("pass exactly one of --done, --answer, --question", "mitori reply --help");
  const kind = kinds[0] as "done" | "answer" | "question";
  const rest = positionals.slice(1);
  const sources = (rest.length > 0 ? 1 : 0) + (values["body-file"] !== undefined ? 1 : 0);
  if (sources !== 1) throw usage("give the reply as one argument, `-` (stdin) or --body-file <file>", "mitori reply --help");
  if (rest.length > 1) throw usage("quote the reply text (one argument)", 'mitori reply <th> --done "what changed"');

  const s = await connectWorkspace(io, { agent: agentLabelFromEnv(values.agent, io.env) });
  const info = s.ws.info;
  let body: string;
  if (values["body-file"] !== undefined) body = readAgentFile(info, io.cwd, values["body-file"], REPLY_MAX_CHARS);
  else if (rest[0] === "-") body = await io.stdin(REPLY_MAX_CHARS * 4);
  else body = rest[0] as string;
  if (body.trim() === "") throw usage("the reply is empty");
  if (body.length > REPLY_MAX_CHARS)
    throw new MitoriError("E_PAYLOAD_TOO_LARGE", `the reply is longer than ${REPLY_MAX_CHARS} characters`, { hint: "--body-file <file> for long text" });
  const files = values.files !== undefined ? repoPaths(realpathSync(info.root), realpathSync(io.cwd), values.files) : undefined;
  const docUpdate = values["doc-update-file"] !== undefined ? readAgentFile(info, io.cwd, values["doc-update-file"], REPLY_MAX_CHARS * 4) : undefined;

  const res = await whenReady(io, () =>
    s.api.call("POST /ws/:ws/threads/:th/reply", {
      params: { ws: info.key, th },
      body: { kind, body, ...(files ? { files } : {}), ...(docUpdate !== undefined ? { docUpdate } : {}) },
    }),
  );
  io.out(`ok ${th} → ${res.state} (round ${res.round})\n`);
  return 0;
}
