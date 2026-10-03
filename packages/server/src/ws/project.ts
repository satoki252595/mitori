/**
 * Workspace identity and the open guards: key derivation, GitHub target parsing [SEC-14] and the
 * "is this a project?" check that keeps `mitori ~` from indexing a home directory [UXP-23].
 */
import { base32, type FsReader, type Hasher, MitoriError, type WorkspaceKey } from "@mitori/core";

/** `ws_` + base32(sha256(realpath(root) or remote URL))[:12]. */
export function workspaceKey(hasher: Hasher, identity: string): WorkspaceKey {
  const hex = hasher.sha256(identity);
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < bytes.length; i++) bytes[i] = Number.parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  return `ws_${base32(bytes).slice(0, 12)}`;
}

/** A GitHub repository target. */
export interface GithubTarget {
  owner: string;
  repo: string;
  /** Canonical `https://github.com/<owner>/<repo>`. */
  url: string;
}

const OWNER_RE = /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})$/;
const REPO_RE = /^[A-Za-z0-9._-]{1,100}$/;

/** `https://github.com/<owner>/<repo>[.git][/]`; null when `target` is not a GitHub URL; throws when it is one but malformed. */
export function parseGithubTarget(target: string): GithubTarget | null {
  if (!/^https?:\/\//i.test(target)) return null;
  let url: URL;
  try {
    url = new URL(target);
  } catch {
    throw new MitoriError("E_INVALID_INPUT", "not a valid URL", { params: { field: "target" } });
  }
  if (url.hostname.toLowerCase() !== "github.com" && url.hostname.toLowerCase() !== "www.github.com")
    throw new MitoriError("E_INVALID_INPUT", "only https://github.com/<owner>/<repo> URLs can be opened", { params: { field: "target" } });
  const parts = url.pathname.replace(/\/+$/, "").split("/").filter(Boolean);
  const owner = parts[0] ?? "";
  const repo = (parts[1] ?? "").replace(/\.git$/, "");
  if (parts.length !== 2 || url.protocol !== "https:" || url.search || url.hash || url.username || url.password || url.port)
    throw new MitoriError("E_INVALID_INPUT", "expected https://github.com/<owner>/<repo>", { params: { field: "target" } });
  if (!OWNER_RE.test(owner) || !REPO_RE.test(repo) || repo === "." || repo === "..")
    throw new MitoriError("E_INVALID_INPUT", "invalid GitHub owner or repository name", { params: { field: "target" } });
  return { owner, repo, url: `https://github.com/${owner}/${repo}` };
}

/** Project markers at depth 1 (`.git` included: a repository is a project even without the usual files). */
const MARKERS = ["package.json", "go.mod", "pyproject.toml", "Cargo.toml", "Makefile", ".git"];

/**
 * `E_WS_NOT_PROJECT` for `$HOME`, `/`, `/Users`, `~/Desktop|Documents|Downloads`, anything under `~/Library`, and
 * directories without a project marker at depth 1 (`*.sln`, `src/`, `README*` count too) [UXP-23].
 */
export function checkProject(real: string, home: string, fs: FsReader): void {
  const h = home.replace(/\/+$/, "");
  const reject = (why: string) =>
    new MitoriError("E_WS_NOT_PROJECT", `${real} does not look like a project (${why})`, {
      params: { path: real, why },
      hint: "open a repository directory, or pass --force",
    });
  if (real === "/" || real === "/Users" || real === "/home" || real === h) throw reject("system or home directory");
  if (["Desktop", "Documents", "Downloads"].some((d) => real === `${h}/${d}`)) throw reject("personal folder");
  if (real === `${h}/Library` || real.startsWith(`${h}/Library/`)) throw reject("system library");
  const names = fs.readdir(real);
  if (names === null) throw new MitoriError("E_INVALID_INPUT", "not a directory", { params: { field: "target" } });
  const marker = names.some((n) => MARKERS.includes(n) || n.endsWith(".sln") || /^readme/i.test(n) || (n === "src" && fs.stat(`${real}/src`)?.isDir === true));
  if (!marker) throw reject("no project marker");
}
