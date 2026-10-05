import { type GitOid, type HunkId, type JobId, MitoriError } from "@mitori/core";
import { runToExit } from "@mitori/platform";
import type { GitSafetyDeps } from "./safety.ts";
import type { GitWorkspace } from "./side.ts";
import { jobCommits, selectionCommit } from "./tree.ts";

export interface PullRequestInput {
  title: string;
  body: string;
  draft: boolean;
  slug: string;
  threadIds: string[];
  trailers: Record<string, string>;
  accept?: HunkId[] | "all";
}
const part = "[A-Za-z0-9][A-Za-z0-9_.-]{0,99}";
const github = new RegExp(`^(?:https://github\\.com/|git@github\\.com:)(${part})/(${part}?)(?:\\.git)?$`, "u");
const quoted = (s: string) => `'${s.replaceAll("'", "'\\''")}'`;

/** User-triggered GitHub export: all writes/objects/refs stay in side.git; only the selected reviewed delta is published. */
export async function createPullRequest(g: GitWorkspace, deps: GitSafetyDeps, job: JobId, req: PullRequestInput): Promise<{ url: string; branch: string }> {
  if (deps.ws.kind === "shadow") throw new MitoriError("E_UNSUPPORTED", "PR creation requires an existing GitHub repository");
  if (!deps.gh?.startsWith("/")) throw new MitoriError("E_UNSUPPORTED", "GitHub CLI was not resolved on SAFE_PATH");
  if (!req.title.trim() || req.title.length > 200 || req.body.length > 20_000 || /[\r\n\0]/u.test(req.title))
    throw new MitoriError("E_INVALID_INPUT", "invalid pull request title/body");
  if (deps.secrets.scan(`${req.title}\n${req.body}`).length) throw new MitoriError("E_SECRET_DETECTED", "pull request text contains a secret-looking value");
  await g.ready();
  const remote = github.exec((await g.user(["remote", "get-url", "origin"])).out.trim());
  if (!remote) throw new MitoriError("E_UNSUPPORTED", "origin must name a GitHub repository");
  const owner = remote[1] as string,
    repo = (remote[2] as string).replace(/\.git$/u, ""),
    origin = `${owner}/${repo}`;
  const gh = async (argv: string[]): Promise<string> => {
    const r = await runToExit(deps.spawner, {
      command: deps.gh as string,
      argv,
      cwd: g.repoDir,
      env: { PATH: deps.env.PATH ?? "/usr/bin:/bin", HOME: deps.env.HOME ?? deps.home, GH_HOST: "github.com", GH_PROMPT_DISABLED: "1", GH_PAGER: "cat" },
      stdin: "",
      keepStdinOpen: false,
      processGroup: true,
      timeoutMs: 60_000,
    });
    if (r.code !== 0 || r.timedOut || r.cancelled)
      throw new MitoriError("E_GIT_FAILED", `GitHub ${argv[0]} failed; check authentication and repository access`);
    return r.stdout.join("\n").trim();
  };
  await gh(["auth", "status", "--hostname", "github.com"]);
  let info: { push: boolean; base: string };
  try {
    info = JSON.parse(await gh(["api", `repos/${origin}`, "--jq", "{push:.permissions.push,base:.default_branch}"]));
  } catch {
    throw new MitoriError("E_AGENT_PROTOCOL", "invalid GitHub repository metadata");
  }
  if (typeof info.push !== "boolean" || typeof info.base !== "string" || !/^[A-Za-z0-9][A-Za-z0-9_./-]{0,199}$/u.test(info.base) || info.base.includes(".."))
    throw new MitoriError("E_AGENT_PROTOCOL", "invalid GitHub default branch");
  const parent = await gh(["api", `repos/${origin}/git/ref/heads/${info.base}`, "--jq", ".object.sha"]);
  if (!/^[a-f0-9]{40,64}$/u.test(parent) || !(await g.rev(`${parent}^{commit}`)))
    throw new MitoriError("E_PRECONDITION", "GitHub base has advanced; refresh the repository before creating the PR");
  const { base } = await jobCommits(g, job);
  const { commit } = await selectionCommit(g, job, req.accept ?? "all");
  const changes = await g.rawDiff(base, commit);
  if (!changes.length) throw new MitoriError("E_PRECONDITION", "no accepted changes to publish");
  const original = new Map(
    (
      await g.lsTree(
        parent as GitOid,
        changes.map((c) => c.path),
      )
    ).map((e) => [e.path, e]),
  );
  for (const c of changes) {
    const old = original.get(c.path);
    if ((old?.oid ?? null) !== c.oldOid || (old?.mode ?? "000000") !== c.oldMode)
      throw new MitoriError("E_PRECONDITION", "the reviewed delta has a different GitHub base; rebase and review it before publishing", {
        params: { path: c.path },
      });
    if (c.newOid && deps.secrets.scan(await g.text(c.newOid)).length)
      throw new MitoriError("E_SECRET_DETECTED", "the accepted change contains a secret-looking value", { params: { path: c.path } });
    if (c.newOid && c.newMode !== "100644" && c.newMode !== "100755")
      throw new MitoriError("E_SCOPE_VIOLATION", "PR export only accepts regular files", { params: { path: c.path } });
  }
  const tree = await g.treeWith(
    parent as GitOid,
    changes.map((c) => ({ path: c.path, oid: c.newOid, mode: c.newMode })),
  );
  const trailers = Object.entries(req.trailers)
    .map(([k, v]) => `${k}: ${v}`)
    .join("\n");
  const published = await g.commitTree(tree, [parent as GitOid], `${req.title}\n\n${req.body}\n${trailers ? `\n${trailers}\n` : ""}`);
  const suffix = Array.from(deps.random.bytes(4), (x) => x.toString(16).padStart(2, "0")).join("");
  const slug =
    req.slug
      .toLowerCase()
      .replace(/[^a-z0-9-]+/gu, "-")
      .replace(/^-+|-+$/gu, "")
      .slice(0, 40) || "change";
  const branch = `mitori/${job}-${slug}-${suffix}`;
  let pushOwner = owner;
  if (!info.push) {
    await gh(["repo", "fork", origin, "--clone=false", "--remote=false"]);
    pushOwner = await gh(["api", "user", "--jq", ".login"]);
    if (!new RegExp(`^${part}$`, "u").test(pushOwner)) throw new MitoriError("E_AGENT_PROTOCOL", "invalid GitHub fork owner");
  }
  // Clear inherited helpers/config; the sole credential executable is the resolved trusted gh. No user refs are written.
  await g.updateRef(`refs/heads/${branch}`, published);
  await g.side(["push", "--no-verify", `https://github.com/${pushOwner}/${repo}.git`, `${published}:refs/heads/${branch}`], {
    config: [
      ["credential.helper", ""],
      ["credential.helper", `!${quoted(deps.gh)} auth git-credential`],
    ],
    env: { GIT_CONFIG_GLOBAL: "/dev/null" },
    timeoutMs: 60_000,
  });
  const tmp = g.tempPath("pr-body");
  try {
    await deps.safeWrite.write(deps.home, tmp.rel, req.body, "home");
    const url = await gh([
      "pr",
      "create",
      "--repo",
      origin,
      "--head",
      `${pushOwner}:${branch}`,
      "--base",
      info.base,
      "--title",
      req.title,
      "--body-file",
      tmp.abs,
      ...(req.draft ? ["--draft"] : []),
    ]);
    const prefix = `https://github.com/${origin}/pull/`;
    if (!url.startsWith(prefix) || !/^\d+$/u.test(url.slice(prefix.length)))
      throw new MitoriError("E_AGENT_PROTOCOL", "GitHub did not return the expected PR URL");
    return { url, branch };
  } finally {
    await g.dropTemp(tmp.rel);
  }
}
