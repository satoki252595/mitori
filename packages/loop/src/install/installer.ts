/**
 * `mitori install` (spec §11, CONS-22): global installer over SafeWriter. Plans the files of a target × scope,
 * writes the ones that are missing or still exactly what mitori wrote last (`outdated`), leaves user-edited ones
 * alone unless `force`, edits AGENTS.md / CLAUDE.md only between the markers, and records every file it wrote in
 * `~/.mitori/integrations.json` (0600) for the freshness check of §11.4.
 */
import { type FsReader, type Hasher, type Logger, MitoriError, type SafeWriter, type Sha256 } from "@mitori/core";
import type { Installer, IntegrationFile, IntegrationState, IntegrationTarget } from "../contract.ts";
import { blockInner, type FileSpec, fileSpecs, findBlock, PLUGIN_ROOT, type RenderVars, renderTemplate, withBlock } from "./templates.ts";

/** Default doc directory when the caller names none (core `WorkspaceInfo.docDir` default). */
const DEFAULT_DOC_DIR = ".mitori";
const RECORDS = "integrations.json";
const RECORDS_FORMAT = "mitori.integrations/1";

/**
 * Options the contract's `plan` / `install` accept beyond `{mcp[, force]}`. CR-PENDING(WP-11): the contract has no way
 * to name the project (repo root + docDir) for `scope: "project"` and `agents-md` (cr-requests/WP-11.md #2); callers
 * pass `project` in the same options object until it does.
 */
export interface InstallOptions {
  mcp: boolean;
  force?: boolean;
  project?: { root: string; docDir: string };
}

/** One row of `~/.mitori/integrations.json`. */
interface InstallRecord {
  target: IntegrationTarget;
  scope: "project" | "user";
  /** Absolute path of the file. */
  path: string;
  /** `<id>@<n>` it was rendered from. */
  template: string;
  /** sha256 of what was written (managed block: of the text between the markers). */
  sha256: Sha256;
  /** Scope root (`~` or the repo) the path is relative to. */
  root: string;
  /** docDir the block was rendered with (agents-md). */
  docDir?: string;
}

export interface InstallerDeps {
  safeWrite: SafeWriter;
  hasher: Hasher;
  home: string;
  userHome: string;
  mitoriBin: string;
  log: Logger;
  fs: FsReader;
}

const dec = new TextDecoder();

export function makeInstaller(deps: InstallerDeps): Installer {
  const real = (p: string) => deps.fs.realpath(p) ?? p;
  const userRoot = () => real(deps.userHome);
  const homeRoot = () => real(deps.home);
  let chain: Promise<unknown> = Promise.resolve();
  const serial = <T>(fn: () => Promise<T>): Promise<T> => {
    const run = chain.then(fn, fn);
    chain = run.catch(() => undefined);
    return run;
  };

  const rootOf = (scope: "project" | "user", o: InstallOptions): string => {
    if (scope === "user") return userRoot();
    if (!o.project?.root?.startsWith("/"))
      throw new MitoriError("E_INVALID_INPUT", "a project install needs the workspace root", { params: { field: "project" } });
    return real(o.project.root);
  };

  const varsOf = (o: InstallOptions): RenderVars => ({ mitoriBin: deps.mitoriBin, docDir: o.project?.docDir ?? DEFAULT_DOC_DIR });

  const hashOf = (spec: Pick<FileSpec, "mode">, content: string): Sha256 => deps.hasher.sha256(spec.mode === "managed-block" ? blockInner(content) : content);

  /** CLAUDE.md gets the block too unless it is (a symlink to) AGENTS.md — the `@AGENTS.md` include is checked on install. */
  const withClaudeMd = (root: string, specs: FileSpec[]): FileSpec[] => {
    if (!specs.some((s) => s.template === "agents-md/block@1")) return specs;
    const claude = `${root}/CLAUDE.md`;
    const st = deps.fs.stat(claude);
    if (!st) return specs;
    if (st.isSymlink && deps.fs.realpath(claude) === deps.fs.realpath(`${root}/AGENTS.md`)) return specs;
    return [...specs, { template: "agents-md/block@1", rel: "CLAUDE.md", kind: "repo_meta", mode: "managed-block" }];
  };

  const specsFor = (target: IntegrationTarget, scope: "project" | "user", o: InstallOptions) => {
    const root = rootOf(scope, o);
    if (target === "agents-md" && (o.project?.docDir ?? "").startsWith("/"))
      throw new MitoriError("E_PRECONDITION", "the design doc of this workspace lives outside the repository; AGENTS.md is not written", {
        params: { docDir: o.project?.docDir ?? "" },
      });
    return { root, specs: withClaudeMd(root, fileSpecs(target, scope, o.mcp)) };
  };

  const toFile = (target: IntegrationTarget, scope: "project" | "user", spec: FileSpec, vars: RenderVars): IntegrationFile => {
    const content = renderTemplate(spec.template, vars);
    return { target, scope, path: spec.rel, content, template: spec.template, hash: hashOf(spec, content), mode: spec.mode };
  };

  async function readText(abs: string): Promise<string | null> {
    const st = deps.fs.stat(abs);
    if (!st) return null;
    if (st.isDir) throw new MitoriError("E_INVALID_INPUT", `${abs} is a directory`, { params: { path: abs } });
    return dec.decode(await deps.fs.read(abs));
  }

  async function readRecords(): Promise<InstallRecord[]> {
    let text: string | null;
    try {
      text = await readText(`${homeRoot()}/${RECORDS}`);
    } catch {
      return [];
    }
    if (text === null) return [];
    try {
      const doc = JSON.parse(text) as { v?: string; files?: InstallRecord[] };
      return Array.isArray(doc.files) ? doc.files.filter((r) => typeof r?.path === "string" && typeof r.sha256 === "string") : [];
    } catch {
      deps.log.warn("install.records.unreadable", { file: RECORDS });
      return [];
    }
  }

  const writeRecords = (records: InstallRecord[]) =>
    deps.safeWrite.write(homeRoot(), RECORDS, `${JSON.stringify({ v: RECORDS_FORMAT, files: records }, null, 2)}\n`, "home");

  /** Hash of what is on disk for this spec (managed block: inside the markers; null when the block is absent). */
  function diskHash(spec: Pick<FileSpec, "mode">, text: string): Sha256 | null {
    if (spec.mode === "create") return deps.hasher.sha256(text);
    const at = findBlock(text);
    return at.kind === "one" ? deps.hasher.sha256(at.inner) : null;
  }

  function nextCommands(target: IntegrationTarget, scope: "project" | "user", mcp: boolean, update: boolean): string[] {
    const bin = deps.mitoriBin;
    if (target === "claude-code" && scope === "user") {
      const dir = `${userRoot()}/${PLUGIN_ROOT}`;
      const shown = dir.startsWith(`${userRoot()}/`) ? `~/${PLUGIN_ROOT}` : dir;
      return update
        ? ["claude plugin marketplace update mitori-local", "claude plugin update mitori@mitori-local"]
        : [`claude plugin marketplace add ${shown}`, "claude plugin install mitori@mitori-local"];
    }
    if (target === "claude-code") return [...(mcp ? [`claude mcp add mitori -- ${bin} mcp`] : []), "mitori install agents-md"];
    if (target === "codex" && mcp) return [`codex mcp add mitori -- ${bin} mcp`];
    return [];
  }

  return {
    plan(target, scope, opts) {
      const o = opts as InstallOptions;
      const { specs } = specsFor(target, scope, o);
      const vars = varsOf(o);
      return specs.map((s) => toFile(target, scope, s, vars));
    },

    install(target, scope, opts) {
      return serial(async () => {
        const o = opts as InstallOptions;
        const { root, specs } = specsFor(target, scope, o);
        const vars = varsOf(o);
        const records = await readRecords();
        const recorded = new Map(records.map((r) => [r.path, r]));
        const written: string[] = [];
        const skipped: string[] = [];
        let changed = false;
        const marketplace = `${root}/${PLUGIN_ROOT}/.claude-plugin/marketplace.json`;
        const update = recorded.has(marketplace) && deps.fs.stat(marketplace) !== null;
        for (const spec of specs) {
          const file = toFile(target, scope, spec, vars);
          const abs = `${root}/${spec.rel}`;
          const text = await readText(abs);
          if (spec.rel === "CLAUDE.md" && text !== null && /(^|\s)@AGENTS\.md\b/.test(text)) continue;
          let next: string | null = null;
          if (text === null) next = spec.mode === "create" ? file.content : withBlock(null, file.content, spec.rel);
          else {
            const onDisk = diskHash(spec, text);
            if (spec.mode === "managed-block" && findBlock(text).kind === "many") withBlock(text, file.content, spec.rel); // throws E_CONFLICT
            const pristine = onDisk !== null && recorded.get(abs)?.sha256 === onDisk;
            if (onDisk === file.hash) next = null;
            else if (spec.mode === "managed-block" && onDisk === null) next = withBlock(text, file.content, spec.rel);
            else if (pristine || o.force === true) next = spec.mode === "create" ? file.content : withBlock(text, file.content, spec.rel);
            else skipped.push(abs);
          }
          if (next !== null) {
            await deps.safeWrite.write(root, spec.rel, next, spec.kind);
            written.push(abs);
          }
          if (next !== null || (text !== null && diskHash(spec, text) === file.hash && recorded.get(abs)?.sha256 !== file.hash)) {
            const rec: InstallRecord = { target, scope, path: abs, template: spec.template, sha256: file.hash, root };
            if (spec.template === "agents-md/block@1") rec.docDir = vars.docDir;
            recorded.set(abs, rec);
            changed = true;
          }
        }
        if (changed) await writeRecords([...recorded.values()]);
        deps.log.info("install", { target, scope, written: written.length, skipped: skipped.length });
        return { written, skipped, nextCommands: written.length > 0 ? nextCommands(target, scope, o.mcp, update) : [] };
      });
    },

    async status() {
      const out: { file: IntegrationFile; state: IntegrationState }[] = [];
      for (const r of await readRecords()) {
        const rel = r.path.startsWith(`${r.root}/`) ? r.path.slice(r.root.length + 1) : null;
        let spec: FileSpec | undefined;
        try {
          spec = rel === null ? undefined : fileSpecs(r.target, r.scope, true).find((s) => s.rel === rel);
        } catch {
          spec = undefined;
        }
        if (!spec && rel === "CLAUDE.md" && r.target === "agents-md") spec = { template: "agents-md/block@1", rel, kind: "repo_meta", mode: "managed-block" };
        if (!spec || rel === null) continue; // a target this mitori no longer knows
        const file = toFile(r.target, r.scope, spec, { mitoriBin: deps.mitoriBin, docDir: r.docDir ?? DEFAULT_DOC_DIR });
        let text: string | null;
        try {
          text = await readText(r.path);
        } catch {
          text = null;
        }
        let state: IntegrationState;
        if (text === null) state = "missing";
        else {
          const onDisk = diskHash(spec, text);
          // still exactly what mitori wrote, but an older template version or another mitoriBin/docDir ⇒ safe to rewrite
          if (onDisk === file.hash) state = "current";
          else if (onDisk !== null && onDisk === r.sha256) state = "outdated";
          else state = "modified";
        }
        out.push({ file, state });
      }
      return out;
    },
  };
}
