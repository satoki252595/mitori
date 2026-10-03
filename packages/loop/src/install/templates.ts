/**
 * Rendering of the byte-exact integration templates (`INTEGRATION_TEMPLATES`, spec §11 R1): `{docDir}` /
 * `{mitoriBin}` substitution, the project/codex skill variants, the per-target file table and the AGENTS.md
 * managed-block edit. Pure.
 */
import { MitoriError } from "@mitori/core";
import { AGENTS_BLOCK_MARKERS, INTEGRATION_TEMPLATES, type IntegrationTarget } from "../contract.ts";

/** Template ids of {@link INTEGRATION_TEMPLATES} plus the two variants derived from the plugin skill. */
export type TemplateId = keyof typeof INTEGRATION_TEMPLATES | "claude-code/project/skills/mitori-review/SKILL.md@1" | "codex/skills/mitori-review/SKILL.md@1";

/** What a template is rendered with. */
export interface RenderVars {
  /** mitori's realpath at install time (hooks, `.mcp.json`) [SEC-21]. */
  mitoriBin: string;
  /** Workspace doc directory (repo-relative), for the AGENTS.md block. */
  docDir: string;
}

const PLUGIN_SKILL = INTEGRATION_TEMPLATES["claude-code/skills/review/SKILL.md@1"];
const CODEX_DESCRIPTION =
  "description: Run one mitori design-doc review round and address its threads. Use only when the user explicitly asks to use mitori or mitori review; a generic review request does not count.";
const CODEX_STEP1 =
  "1. Run `mitori review --wait-sec 540` and wait. Relay the URL it prints on stderr to the user. Do not read files or ask questions until it exits.";
const CODEX_STEP5 = "5. Run the `NEXT:` command from stdout (add `--wait-sec 540`) and continue from step 2.";

function replaceLine(text: string, startsWith: string, line: string): string {
  const lines = text.split("\n");
  const i = lines.findIndex((l) => l.startsWith(startsWith));
  if (i < 0) throw new MitoriError("E_INTERNAL", `skill template has no line starting with ${JSON.stringify(startsWith)}`);
  lines[i] = line;
  return lines.join("\n");
}

/** The review skill in its three installed forms (spec §11.1–§11.2; the contract comment of `renderSkill`). */
export function skillVariant(variant: "plugin" | "project" | "codex"): string {
  if (variant === "plugin") return PLUGIN_SKILL;
  if (variant === "project") return PLUGIN_SKILL.replace("\nname: review\n", "\nname: mitori-review\n").replaceAll("/mitori:review", "/mitori-review");
  const end = PLUGIN_SKILL.indexOf("\n---\n", 4);
  if (!PLUGIN_SKILL.startsWith("---\n") || end < 0) throw new MitoriError("E_INTERNAL", "skill template has no frontmatter");
  // Codex: frontmatter is `name` + `description` only; no background execution, so the review blocks ≤ 540 s per call.
  let body = PLUGIN_SKILL.slice(end + "\n---\n".length);
  body = replaceLine(body, "1. ", CODEX_STEP1);
  body = replaceLine(body, "5. ", CODEX_STEP5);
  return `---\nname: mitori-review\n${CODEX_DESCRIPTION}\n---\n${body}`;
}

/** Shell-safe form of a path for the hook's command string (single quotes when it has anything unusual). */
export function shellWord(p: string): string {
  return /^[A-Za-z0-9_@%+=:,./-]+$/.test(p) ? p : `'${p.replaceAll("'", "'\\''")}'`;
}

/** A string as the inside of a JSON string literal. */
const jsonInner = (s: string) => JSON.stringify(s).slice(1, -1);

/** Render one template. JSON templates get `{mitoriBin}` JSON-escaped (the hook additionally shell-quoted). */
export function renderTemplate(id: TemplateId, vars: RenderVars): string {
  switch (id) {
    case "claude-code/project/skills/mitori-review/SKILL.md@1":
      return skillVariant("project");
    case "codex/skills/mitori-review/SKILL.md@1":
      return skillVariant("codex");
    case "claude-code/hooks/hooks.json@1":
      return INTEGRATION_TEMPLATES[id].replaceAll("{mitoriBin}", jsonInner(shellWord(vars.mitoriBin)));
    case "claude-code/.mcp.json@1":
      return INTEGRATION_TEMPLATES[id].replaceAll("{mitoriBin}", jsonInner(vars.mitoriBin));
    case "agents-md/block@1":
      return INTEGRATION_TEMPLATES[id].replaceAll("{docDir}", vars.docDir.replace(/\/+$/, ""));
    default:
      return INTEGRATION_TEMPLATES[id];
  }
}

/** One file of a target × scope. `rel` is relative to the scope root (`~` or the repo). */
export interface FileSpec {
  template: TemplateId;
  rel: string;
  kind: "integration" | "repo_meta";
  mode: "create" | "managed-block";
}

/** The plugin tree inside `~` (paths are platform `INTEGRATION_PATHS`). */
export const PLUGIN_ROOT = ".mitori/integrations/claude-code";
const PLUGIN = `${PLUGIN_ROOT}/plugins/mitori`;

/** Files of `target` × `scope` (spec §11.1–§11.3); `mcp` adds the plugin `.mcp.json`. */
export function fileSpecs(target: IntegrationTarget, scope: "project" | "user", mcp: boolean): FileSpec[] {
  const file = (template: TemplateId, rel: string): FileSpec => ({ template, rel, kind: "integration", mode: "create" });
  switch (target) {
    case "claude-code":
      if (scope === "project") return [file("claude-code/project/skills/mitori-review/SKILL.md@1", ".claude/skills/mitori-review/SKILL.md")];
      return [
        file("claude-code/.claude-plugin/marketplace.json@1", `${PLUGIN_ROOT}/.claude-plugin/marketplace.json`),
        file("claude-code/.claude-plugin/plugin.json@1", `${PLUGIN}/.claude-plugin/plugin.json`),
        file("claude-code/skills/review/SKILL.md@1", `${PLUGIN}/skills/review/SKILL.md`),
        file("claude-code/skills/gen/SKILL.md@1", `${PLUGIN}/skills/gen/SKILL.md`),
        file("claude-code/agents/mitori-gen-writer.md@1", `${PLUGIN}/agents/mitori-gen-writer.md`),
        file("claude-code/hooks/hooks.json@1", `${PLUGIN}/hooks/hooks.json`),
        ...(mcp ? [file("claude-code/.mcp.json@1", `${PLUGIN}/.mcp.json`)] : []),
      ];
    case "codex":
      return [file("codex/skills/mitori-review/SKILL.md@1", ".agents/skills/mitori-review/SKILL.md")];
    case "agents-md":
      if (scope !== "project") throw new MitoriError("E_INVALID_INPUT", "agents-md is a project integration (it writes the repository's AGENTS.md)");
      return [{ template: "agents-md/block@1", rel: "AGENTS.md", kind: "repo_meta", mode: "managed-block" }];
    default:
      throw new MitoriError("E_UNSUPPORTED", `mitori install ${target} is not available yet`, { params: { target } });
  }
}

/* ---- managed block (spec §11.3) --------------------------------------------------------------------------- */

const { begin: BEGIN, end: END } = AGENTS_BLOCK_MARKERS;

/** Text between the markers of a rendered block (what the block hash covers). */
export function blockInner(block: string): string {
  const b = block.indexOf(BEGIN);
  const e = block.indexOf(END);
  if (b < 0 || e < b) throw new MitoriError("E_INTERNAL", "managed block without markers");
  return block
    .slice(b + BEGIN.length, e)
    .replace(/^\r?\n/, "")
    .replace(/\r?\n$/, "");
}

/** Where the managed block sits in a file: absent, exactly one pair, or ambiguous (`E_CONFLICT` for the caller). */
export function findBlock(text: string): { kind: "none" } | { kind: "one"; start: number; end: number; inner: string } | { kind: "many" } {
  const begins = text.split(BEGIN).length - 1;
  const ends = text.split(END).length - 1;
  if (begins === 0 && ends === 0) return { kind: "none" };
  if (begins !== 1 || ends !== 1) return { kind: "many" };
  const start = text.indexOf(BEGIN);
  const endAt = text.indexOf(END);
  if (endAt < start) return { kind: "many" };
  const end = endAt + END.length;
  return { kind: "one", start, end, inner: blockInner(text.slice(start, end)) };
}

/**
 * `text` with `block` in place: between the markers when they exist, else appended after one blank line (a new file
 * is the block alone). `E_CONFLICT` when the markers appear more than once (fixed by hand) [spec §11.3].
 */
export function withBlock(text: string | null, block: string, file: string): string {
  if (text === null || text === "") return `${block}\n`;
  const at = findBlock(text);
  if (at.kind === "many")
    throw new MitoriError("E_CONFLICT", `${file} has more than one mitori block (${BEGIN} … ${END}); keep one and run again`, { params: { file } });
  if (at.kind === "one") return text.slice(0, at.start) + block + text.slice(at.end);
  const base = text.replace(/\n*$/, "");
  return `${base}\n\n${block}\n`;
}
