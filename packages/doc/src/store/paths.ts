// docDir resolution and the doc file layout [SEC-01, SEC-02, ADR-0014]. Persisted `file` fields and slugs from
// the sidecar / repo settings are never trusted as paths: files are recomputed from DOC_TEMPLATE + SLUG_RE.
import { DOC_TEMPLATE, type FsReader, MitoriError, type SectionId, SLUG_RE, type TopSectionId, type WorkspaceInfo } from "@mitori/core";

/** Where the doc lives. `rootReal` is the SafeWriter root (kind `doc`). */
export interface DocDir {
  /** Absolute docDir (realpath when it exists). */
  rootReal: string;
}

const segs = (p: string): string[] => p.split("/").filter((s) => s !== "" && s !== ".");
const join = (...parts: string[]): string => `/${parts.flatMap(segs).join("/")}`;

/**
 * Validate and resolve the workspace docDir. git / remote-readonly: repo-relative, inside the root, never the
 * root itself, no `..`, no symlink component (RT-25, RT-27). shadow: an absolute docDir (under `~/.mitori/repos/<ws>`,
 * chosen by the server) is accepted as given but must not be the root. Without an FsReader the symlink checks
 * are left to the SafeWriter.
 */
export function resolveDocDir(ws: WorkspaceInfo, fs: FsReader | undefined): DocDir {
  const raw = ws.docDir;
  const abs = raw.startsWith("/") ? raw : join(ws.root, raw);
  const root = join(ws.root);
  if (raw.includes("\0") || raw.includes("\\") || raw.split("/").includes(".."))
    throw new MitoriError("E_PATH_OUTSIDE", "docDir must not contain '..', '\\' or NUL");
  if (abs === root) throw new MitoriError("E_PATH_OUTSIDE", "the repository root cannot be the doc directory");
  const inside = abs.startsWith(`${root}/`);
  if (ws.kind !== "shadow" && !inside) throw new MitoriError("E_PATH_OUTSIDE", "docDir must be inside the working tree", { params: { docDir: raw } });
  if (!fs) return { rootReal: abs };
  // no symlink anywhere: the deepest existing ancestor (or docDir itself) must be its own realpath
  let probe = abs;
  while (fs.stat(probe) === null && probe.lastIndexOf("/") > 0) probe = probe.slice(0, probe.lastIndexOf("/"));
  const st = fs.stat(probe);
  if (st?.isSymlink || (st && fs.realpath(probe) !== probe))
    throw new MitoriError("E_PATH_SYMLINK", "docDir or one of its parents is a symbolic link", { params: { path: probe } });
  if (st && !st.isDir) throw new MitoriError("E_PATH_OUTSIDE", "docDir is not a directory", { params: { path: probe } });
  return { rootReal: abs };
}

/** Slug check; an invalid one is re-derived from itself, else from `fallback` (notice `notice.slug.rewritten`). */
export function safeSlug(slug: string, fallback: string): { slug: string; rewritten: boolean } {
  if (SLUG_RE.test(slug)) return { slug, rewritten: false };
  const own = slugify(slug);
  return { slug: own.startsWith("m-") ? slugify(fallback) : own, rewritten: true };
}

/** Make `slug` unique among `taken` (`-2`, `-3` … within the 48-char limit). */
export function uniqueSlug(slug: string, taken: ReadonlySet<string>): string {
  if (!taken.has(slug)) return slug;
  for (let i = 2; ; i++) {
    const tail = `-${i}`;
    const s = `${slug.slice(0, 48 - tail.length).replace(/-+$/, "")}${tail}`;
    if (!taken.has(s)) return s;
  }
}

/** Deterministic slug: lowercase ASCII, runs of other characters → `-`, ≤ 48 chars. */
export function slugify(s: string): string {
  const out = s
    .normalize("NFKD")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48)
    .replace(/-+$/g, "");
  return SLUG_RE.test(out) ? out : `m-${out.replace(/[^a-z0-9]/g, "").slice(0, 40) || "x"}`;
}

const TEMPLATE_FILE = new Map<string, string>(DOC_TEMPLATE.map((t) => [t.id, t.file]));

/** Top section of a section id. */
export const topOf = (id: SectionId): TopSectionId => id.split("/", 1)[0] as TopSectionId;

/** Docdir-relative file of a section (module pages use their validated slug). */
export function fileOfSection(id: SectionId, slugOf: (id: SectionId) => string | undefined): string {
  const top = topOf(id);
  if (top === "s6" && id !== "s6") return `doc/modules/${slugOf(id) ?? slugify(id.slice(3))}.md`;
  return TEMPLATE_FILE.get(top) as string;
}

/** Files the doc kind of SafeWriter may write (mirror of the platform allowlist, checked before every write). */
export function allowedDocFile(rel: string): boolean {
  if (DOC_TEMPLATE.some((t) => t.file === rel)) return true;
  if (["mitori.json", "doc.index.json", "README.md", ".gitignore"].includes(rel)) return true;
  const m = /^doc\/modules\/([^/]+)\.md$/.exec(rel);
  if (m) return SLUG_RE.test(m[1] as string);
  const o = /^orphaned\/([^/]+)\.md$/.exec(rel);
  if (o) return SLUG_RE.test(o[1] as string);
  return /^decisions\/dc_[0-9a-hjkmnp-tv-z]{8}\.md$/.test(rel);
}
