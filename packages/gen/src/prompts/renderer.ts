/**
 * Deterministic prompt renderer (gen spec §5.1, §8.1). `system()` renders a system prompt and REMEMBERS it per
 * (system id, lang, workdir): `render()` uses the remembered one, so a run pins its system prompt + repo pack
 * once (PT-05) and every task of the run shares the same cache prefix bytes.
 * User message = [DATA sections in spec order] + unit TASK/RULES/OUTPUT (+ regen addendum when EXISTING lists
 * blocks). Cache key (§3.8 R1, CONS-30) = xxh3(promptVer ‖ systemVer ‖ regenVer ‖ retryVer ‖ model ‖ effort ‖
 * lang ‖ xxh3(subject bytes)), where the subject bytes are the user message rendered WITHOUT the regeneration
 * parts (EXISTING, CHANGES, gen.regen): a regeneration of unchanged inputs replays the cached output (AC-28).
 */
import { type DocLang, type Hasher, MitoriError, type PromptVersion, type SecretScanner } from "@mitori/core";
import type { Indexer } from "@mitori/indexer";
import {
  type DataLabel,
  GEN_ESTIMATE_PARAMS,
  GEN_LIMITS,
  GEN_PROMPTS,
  GEN_SYSTEM_VERSIONS,
  type GenPromptId,
  type PlannedTask,
  type PromptRenderer,
  type RenderedTask,
  type RetryPlan,
  type SystemPromptId,
  type TaskInputs,
} from "../contract.ts";
import { buildContext } from "./context.ts";
import { type DataSection, fenceSections, prepareLines } from "./fence.ts";
import { ADDENDUM_TEMPLATES, fill, LANG_TEXT, OVERVIEW_MODE_SENTENCES, RETRY_PREVIOUS_CLAUSE, SYSTEM_TEMPLATES, UNIT_TEMPLATES } from "./templates.ts";

/** Labels that only exist for regeneration (excluded from the cache-key subject). */
const REGEN_LABELS: ReadonlySet<DataLabel> = new Set(["EXISTING", "CHANGES"]);

/** Ports of the renderer. */
export interface RendererDeps {
  /** Hasher. */
  hasher: Hasher;
  /** Secret scanner (CONS-05). */
  secrets: SecretScanner;
  /** Index (line counts, symbols, token estimates). */
  indexer: Pick<Indexer, "file" | "symbols" | "estimateTokens">;
  /** Workspace salt (gen_meta) for DATA nonces. */
  salt: () => string;
  /** Version overrides (tests: "bump the system version"). */
  versions?: { prompts?: Partial<Record<GenPromptId, PromptVersion>>; systems?: Partial<Record<keyof typeof GEN_SYSTEM_VERSIONS, PromptVersion>> };
}

/** The renderer plus what the orchestrator needs to pin and to reason about inputs. */
export interface GenPromptRenderer extends PromptRenderer {
  /** The remembered system prompt bytes for (id, lang, workdir), when one was rendered. */
  pinned(id: SystemPromptId, lang: DocLang, workdir: string): { system: string; pack: string | null; bytes: string } | null;
  /** Version of a prompt (overrides applied). */
  version(prompt: GenPromptId): PromptVersion;
}

const round100 = (x: number) => Math.round(x / 100) * 100;

/** Factory. */
export function createPromptRenderer(deps: RendererDeps): GenPromptRenderer {
  const remembered = new Map<string, { system: string; pack: string | null; bytes: string; packLines: string[] }>();
  const key = (id: SystemPromptId, lang: DocLang, workdir: string) => `${id}\0${lang}\0${workdir}`;
  const promptVersion = (p: GenPromptId): PromptVersion => deps.versions?.prompts?.[p] ?? GEN_PROMPTS[p].version;
  const systemVersion = (k: keyof typeof GEN_SYSTEM_VERSIONS): PromptVersion => deps.versions?.systems?.[k] ?? GEN_SYSTEM_VERSIONS[k];
  const tokens = (text: string) => deps.indexer.estimateTokens(text, "code", "claude-v5");

  function renderSystem(id: SystemPromptId, lang: DocLang, workdir: string, repoPack: string | null) {
    const lt = LANG_TEXT[lang];
    const template = SYSTEM_TEMPLATES[id];
    const cutAt = template.indexOf("\nREPOSITORY CONTEXT");
    const head = cutAt < 0 ? template : template.slice(0, cutAt);
    const system = fill(head, { workdir, lang_name: lt.name, lang_style: lt.style });
    if (cutAt < 0 || repoPack === null) return { system, pack: null, packLines: [] as string[] };
    const { lines } = prepareLines(repoPack.split("\n"), deps.secrets);
    const { nonce } = fenceSections([{ label: "REPO_PACK", lines }], deps.hasher, deps.salt());
    const pack = fill(template.slice(cutAt + 1), { pack_nonce: nonce, repo_pack: lines.join("\n") });
    return { system, pack, packLines: lines };
  }

  function unitVars(task: PlannedTask, sections: ReadonlyMap<string, string[]>, dataTokens: number, lang: DocLang): Record<string, string | number> {
    const lt = LANG_TEXT[lang];
    const charsPerTok = GEN_ESTIMATE_PARAMS.mdCharsPerOutToken[lang];
    const o = GEN_ESTIMATE_PARAMS.outTargets;
    const label = (sections.get("MODULE") ?? []).find((l) => l.startsWith("> label: "))?.slice("> label: ".length) ?? task.target.id;
    const seeds = (sections.get("SEEDS") ?? []).filter((l) => /^> seed\d+ /.test(l)).length;
    const modulesSeen = Number(/^> candidates from (\d+) module pages/.exec((sections.get("CANDIDATES") ?? [])[0] ?? "")?.[1] ?? 0);
    const outTarget = task.prompt === "gen.module" ? Math.min(o.moduleMax, Math.max(o.moduleBase, o.moduleBase + o.moduleSlope * dataTokens)) : o.parent;
    return {
      module_id: task.target.id,
      module_label: label,
      section: task.sections[0] ?? "",
      name_max: GEN_LIMITS.nameChars[lang],
      summary_max: GEN_LIMITS.summaryChars[lang],
      target_chars: round100(outTarget * charsPerTok),
      mode_sentence: task.mode === "early" ? OVERVIEW_MODE_SENTENCES.early : OVERVIEW_MODE_SENTENCES.final,
      flow_min: Math.min(3, seeds),
      flow_max: Math.min(5, seeds),
      title_max: GEN_LIMITS.flowTitleChars[lang],
      max_terms: Math.min(60, 4 * modulesSeen + 10),
      lang_name: lt.name,
      def_max: GEN_LIMITS.termDefChars[lang],
      yomi_rule: lt.yomiRule,
      term_fields: lt.termFields,
    };
  }

  function errorsLines(retry: RetryPlan): string[] {
    return retry.errors.map((e) => {
      const m = /^L(\d+)(.*)$/.exec(e.at);
      const [rule, ...rest] = e.expected.split(" ");
      return `> L${m?.[1] ?? "?"} ${rule} ${m?.[2] || "/"}: expected ${rest.join(" ")}; got ${e.actual}`;
    });
  }

  function retryText(retry: RetryPlan, salt: string): string {
    const prev = retry.previous.map((p, i) => `> L${i + 1} ${p.slice(0, GEN_LIMITS.previousLineChars)}`);
    const data: DataSection[] = [
      { label: "ERRORS", lines: prepareLines(errorsLines(retry), deps.secrets).lines },
      { label: "PREVIOUS", lines: prepareLines(prev, deps.secrets).lines },
      {
        label: "MISSING",
        lines: prepareLines(
          retry.missing.map((m) => `> ${m}`),
          deps.secrets,
        ).lines,
      },
    ];
    const fenced = fenceSections(data, deps.hasher, salt);
    const task = fill(ADDENDUM_TEMPLATES["gen.retry"], { previous_clause: retry.previous.length > 0 ? RETRY_PREVIOUS_CLAUSE : "" });
    return fenced.text === "" ? task : `${fenced.text}\n\n${task}`;
  }

  return {
    system(id, lang, workdir, repoPack) {
      const r = renderSystem(id, lang, workdir, repoPack);
      const bytes = r.pack === null ? r.system : `${r.system}\n${r.pack}`;
      remembered.set(key(id, lang, workdir), { system: r.system, pack: r.pack, bytes, packLines: r.packLines });
      return { system: r.system, pack: r.pack };
    },
    pinned(id, lang, workdir) {
      const r = remembered.get(key(id, lang, workdir));
      return r ? { system: r.system, pack: r.pack, bytes: r.bytes } : null;
    },
    version: promptVersion,
    render(task: PlannedTask, inputs: TaskInputs, opts: { lang: DocLang; workdir: string; retry?: RetryPlan }): RenderedTask {
      const spec = GEN_PROMPTS[task.prompt];
      const template = UNIT_TEMPLATES[task.prompt];
      if (template === undefined)
        throw new MitoriError("E_UNSUPPORTED", `prompt ${task.prompt} is not available in this milestone`, { params: { prompt: task.prompt } });
      const salt = deps.salt();
      let sys = remembered.get(key(spec.system, opts.lang, opts.workdir));
      if (!sys) {
        const r = renderSystem(spec.system, opts.lang, opts.workdir, null);
        sys = { system: r.system, pack: null, bytes: r.system, packLines: [] };
      }
      let redactions = 0;
      const sections = new Map<string, string[]>();
      for (const label of spec.data) {
        const raw = inputs[label];
        if (!raw || raw.length === 0) continue;
        const p = prepareLines(raw, deps.secrets);
        redactions += p.redactions;
        sections.set(label, p.lines);
      }
      const all: DataSection[] = [...sections].map(([label, lines]) => ({ label, lines }));
      const subject = all.filter((s) => !REGEN_LABELS.has(s.label as DataLabel));
      const subjectData = fenceSections(subject, deps.hasher, salt);
      const dataTokens = tokens(subjectData.text);
      const instructions = fill(template, unitVars(task, sections, dataTokens, opts.lang));
      const regen = (sections.get("EXISTING") ?? []).length > 0;
      const join = (data: string) => (data === "" ? instructions : `${data}\n\n${instructions}`);
      const fenced = fenceSections(all, deps.hasher, salt);
      const unit = regen ? `${join(fenced.text)}\n\n${ADDENDUM_TEMPLATES["gen.regen"]}` : join(fenced.text);
      const subjectBytes = join(subjectData.text);
      const retry = opts.retry && opts.retry.kind === "diff" ? retryText(opts.retry, salt) : null;
      const model = task.model;
      const effort = task.effort ?? "-";
      const cacheKey = deps.hasher.xxh3(
        [
          promptVersion(task.prompt),
          systemVersion(spec.system),
          systemVersion("gen.regen"),
          systemVersion("gen.retry"),
          model,
          effort,
          opts.lang,
          deps.hasher.xxh3(subjectBytes),
        ].join("\n"),
      );
      const ctx = buildContext(
        task,
        sections,
        opts.lang,
        {
          fileLines: (p) => {
            const f = deps.indexer.file(p);
            return f && !f.excluded ? f.lines : null;
          },
          symbolRanges: (p) => deps.indexer.symbols(p),
        },
        [sys.packLines],
      );
      return {
        layout: { systemId: spec.system, system: sys.system, pack: sys.pack, shared: null, unit, retry, nonce: fenced.nonce },
        systemBytes: sys.bytes,
        userBytes: unit,
        fanoutKey: deps.hasher.xxh3(`${sys.bytes}\n${model}\n${effort}`),
        cacheKey,
        tokens: { prefix: tokens(sys.bytes), tail: tokens(unit) },
        redactions,
        ctx,
      };
    },
  };
}
