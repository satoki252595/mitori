// Generates docs/design/briefs/WP-xx.md (SC-12): the MILESTONES section verbatim + resolved reading list (exact
// headings, line ranges, size) + the M0 stubs the WP owns + its CR ledger rows + hand-written notes.
// Inputs: docs/design/MILESTONES.md, docs/design/briefs/notes/WP-xx.md, packages/core/CR-LEDGER.md, sources.
// Usage: bun scripts/gen-briefs.ts [--check]   (--check: exit 1 when a brief is stale or over 12k tokens)
import { readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { CHARS_PER_TOKEN } from "@mitori/core";
import ts from "typescript";
import { parseLedger } from "./lib/cr-ledger.ts";
import { listFiles, ROOT, read } from "./lib/repo.ts";

const MAX_TOKENS = 12_000;
const CJK = /[　-ヿ㐀-䶿一-鿿豈-﫿＀-￯가-힯]/g;

/** Same shape as the indexer's raw estimate (claude-v5, markdown): CJK at 0.8 tok/char, the rest at 2.87 char/tok. */
export function estimateTokens(text: string): number {
  const cjk = text.match(CJK)?.length ?? 0;
  const c = CHARS_PER_TOKEN["claude-v5"];
  return Math.ceil((text.length - cjk) / c.markdown_en + cjk / c.markdown_ja);
}

interface Heading {
  line: number;
  level: number;
  text: string;
}
/** Markdown headings outside fenced code. */
export function headings(md: string): Heading[] {
  const out: Heading[] = [];
  let fenced = false;
  md.split("\n").forEach((l, i) => {
    if (/^(```|~~~)/.test(l)) fenced = !fenced;
    const m = !fenced && /^(#{1,6}) (.*)$/.exec(l);
    if (m) out.push({ line: i + 1, level: (m[1] as string).length, text: (m[2] as string).trim() });
  });
  return out;
}

/** Section banners of a contract `.ts`: a `/* ====` block whose next line is ` * 6. Title` (level 1), and one-line `/* ---- B2. Title ----` banners (level 2). */
export function tsBanners(src: string): Heading[] {
  const out: Heading[] = [];
  const lines = src.split("\n");
  lines.forEach((l, i) => {
    const big = /^ \* ((?:\d+|[A-Z])\. .*?)\s*$/.exec(l);
    if (big && /^\/\* =+/.test(lines[i - 1] ?? "")) out.push({ line: i, level: 1, text: big[1] as string });
    const small = /^\/\* ---- ([A-Z]\d+[a-z]?\. .*?) -*\s*\*\/\s*$/.exec(l);
    if (small) out.push({ line: i + 1, level: 2, text: small[1] as string });
    const dashed = /^\/\* -{8,} (\d+\. .*?) \*\/\s*$/.exec(l); // testkit style: /* ------ 3. fixtures */
    if (dashed) out.push({ line: i + 1, level: 1, text: dashed[1] as string });
  });
  return out;
}

export interface Resolved {
  path: string;
  title: string;
  from: number;
  to: number;
  tokens: number;
}
/** `path | selector` → the section whose heading text starts with the selector (`3.2`, `改訂 R1`, `付録 A`); `*` = whole file. */
export function resolveRead(entry: string): Resolved {
  const [path = "", sel = "*"] = entry.split("|").map((s) => s.trim());
  const text = read(path);
  const lines = text.split("\n");
  if (sel === "*") return { path, title: "(whole file)", from: 1, to: lines.length, tokens: estimateTokens(text) };
  const hs = path.endsWith(".ts") ? tsBanners(text) : headings(text);
  const esc = sel.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const re = new RegExp(`^${esc}(?=$|[\\s.．（(:：—-])`);
  const idx = hs.findIndex((h) => re.test(h.text.replace(/^§/, "")));
  if (idx < 0) throw new Error(`gen-briefs: no heading "${sel}" in ${path}`);
  const h = hs[idx] as Heading;
  const next = hs.slice(idx + 1).find((n) => n.level <= h.level);
  const to = next ? next.line - 1 : lines.length;
  return { path, title: h.text, from: h.line, to, tokens: estimateTokens(lines.slice(h.line - 1, to).join("\n")) };
}

interface Notes {
  read: string[];
  crs: string[];
  owns: string[];
  body: string;
}
export function parseNotes(md: string): Notes {
  const m = /^---\n([\s\S]*?)\n---\n?/.exec(md);
  const notes: Notes = { read: [], crs: [], owns: [], body: md };
  if (!m) return notes;
  notes.body = md.slice(m[0].length);
  type ListKey = "read" | "crs" | "owns";
  let key: ListKey | null = null;
  for (const l of (m[1] as string).split("\n")) {
    const k = /^(read|crs|owns):\s*(.*)$/.exec(l);
    if (k) {
      const current = k[1] as ListKey;
      key = current;
      const inline = (k[2] ?? "").split(",").map((s) => s.trim());
      notes[current].push(...inline.filter(Boolean));
      continue;
    }
    const item = /^\s+-\s+(.*)$/.exec(l);
    if (item && key) (notes[key] as string[]).push((item[1] as string).trim());
  }
  return notes;
}

/** `### WP-xx …` sections (and WP-INT's `## 5.`) of MILESTONES, keyed by WP id. */
export function milestoneSections(md: string): Map<string, { title: string; text: string }> {
  const out = new Map<string, { title: string; text: string }>();
  const lines = md.split("\n");
  const hs = headings(md);
  hs.forEach((h, i) => {
    const m = /^(?:☆ )?(WP-[0-9A-Za-z]+)\b/.exec(h.text) ?? (/結合 WP（(WP-INT)/.exec(h.text) as RegExpExecArray | null);
    if (!m) return;
    const next = hs.slice(i + 1).find((n) => n.level <= h.level);
    out.set(m[1] as string, {
      title: h.text,
      text: lines
        .slice(h.line, next ? next.line - 1 : lines.length)
        .join("\n")
        .trim(),
    });
  });
  return out;
}

interface Stub {
  name: string;
  file: string;
  line: number;
  sig: string;
}
/** M0 stubs (bodies calling `unsupported(`, consts initialised with `[]` / `unsupportedValue`) under the owned paths. */
export function stubsIn(owns: readonly string[]): Stub[] {
  const out: Stub[] = [];
  for (const file of listFiles(...owns).filter((p) => /\.ts$/.test(p) && !p.endsWith(".test.ts"))) {
    const text = read(file);
    if (!text.includes("unsupported")) continue;
    const sf = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true);
    const overloads = new Map<string, number>();
    const line = (n: ts.Node) => sf.getLineAndCharacterOfPosition(n.getStart(sf)).line + 1;
    const flat = (t: string) => t.replace(/\s+/g, " ").replace(/\( /g, "(").replace(/,? \)/g, ")").trim();
    for (const st of sf.statements) {
      if (ts.isFunctionDeclaration(st) && st.name) {
        const name = st.name.text;
        if (!st.body) {
          overloads.set(name, (overloads.get(name) ?? 0) + 1);
          continue;
        }
        if (!st.body.getText(sf).includes("unsupported(")) continue;
        const n = overloads.get(name);
        const sig = n ? `${name}(…) — ${n} overloads, see the file` : flat(text.slice(st.name.getStart(sf), st.body.getStart(sf)));
        out.push({ name, file, line: line(st), sig });
      } else if (ts.isVariableStatement(st)) {
        for (const d of st.declarationList.declarations) {
          const init = d.initializer?.getText(sf) ?? "";
          if (init !== "[]" && !init.startsWith("unsupportedValue")) continue;
          const name = d.name.getText(sf);
          out.push({
            name,
            file,
            line: line(st),
            sig: `const ${name}: ${flat(d.type?.getText(sf) ?? "?")} (stub: ${init === "[]" ? "[] until implemented" : "throws on use"})`,
          });
        }
      }
    }
  }
  return out;
}

function ledgerRows(patterns: readonly string[]): string[] {
  const md = read("packages/core/CR-LEDGER.md");
  const { rows } = parseLedger(md);
  const lines = md.split("\n");
  const match = (id: string) =>
    patterns.some((p) => {
      const re = new RegExp(`^${p.replace(/[.+?^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*")}$`);
      return re.test(id) || re.test(id.replace(/^CR /, ""));
    });
  return rows.filter((r) => match(r.id)).map((r) => lines[r.line - 1] as string);
}

const HOW_TO_WORK = `## How to work (every WP)

- **Write only inside 所有** (MILESTONES §1.2 is the authority). Shared things are pre-split: budgets per package (\`bench/budgets/<pkg>.json\`), i18n per namespace, fixtures per WP (add-only). Every package's \`src/index.ts\` is integrator-only and already re-exports every planned sub-directory — so export public names from **your sub-directory's \`index.ts\`**, and only contract names (helpers stay in sibling files; intra-package imports are relative).
- **Contract gaps**: never edit \`packages/core\` or another owner's code. Write the request to \`docs/design/cr-requests/<WP-id>.md\` (what / why / proposed shape) and use a clearly marked local workaround (\`// CR-PENDING(<WP-id>): …\`). The architect batches requests weekly into \`packages/core/CR-LEDGER.md\` (48 h SLA).
- **Depend on contracts, not on other WPs**. The shared fakes (\`@mitori/platform/testing\`, \`@mitori/agent/testing\`, \`@mitori/testkit\`) are themselves M0 stubs until WP-01 / WP-05 / WP-00b+WP-12 land: write the minimal fake you need in your own test files (a \`Hasher\` over \`Bun.hash\`, a \`Random\` over fixed bytes, \`bun:sqlite\` \`:memory:\` for \`SqlDb\`, an in-thread \`WorkerPool\`) and switch when the shared ones exist.
- **Boundaries** (\`scripts/check-boundaries.ts\`, part of \`check\`): imports follow \`PACKAGE_DEPS\` (type-only too; only \`@mitori/core\` types are free); no deep imports (\`@mitori/x/src/…\`) and no \`../\` out of your package; \`Bun.*\` / \`bun:*\` / \`node:*\` / \`process.*\` only in platform, server, cli; direct \`writeFile\`/\`rename\`/\`mkdir\`/spawn/\`Bun.write\`/\`Bun.spawn\`, \`crypto.getRandomValues\`, \`Math.random\`, \`Date.now\` only in platform (the browser app is exempt from the last three) — use the SafeWriter / Spawner / Random / Clock ports; \`@mitori/testkit\` and \`@mitori/<pkg>/testing\` only from tests (\`*.test.ts\`, \`test/\`, \`src/testing.ts\`, bench, eval, e2e).
- **Commands** (always via \`scripts/nd\`): \`scripts/nd bun run check\` (tsc -b, biome, boundaries, CR ledger, budgets lint, contract index, svelte-check — parallel, ≈ 1 s at M0), \`scripts/nd bun test <path>\`, \`scripts/nd bun run fmt\`. Tests sit next to the code (\`foo.test.ts\`) or under \`packages/<pkg>/test/{unit,golden,int}/\`; put the spec ID first in the name (\`describe("IDX-AT-12 …")\`). Unit test files stay ≤ 500 ms.
- **Public surface** changes show up in \`docs/design/briefs/INDEX.md\` (\`bun run contract:index\`; \`check\` fails when it is stale). An INDEX diff in your PR = a contract change → CR.
- **Done** = the acceptance tests in §1 pass with the exact commands, \`check\` is green, commits are conventional and end with the Co-Authored-By line; never push, never rewrite history, no paid LLM calls unless the WP says so.`;

export function buildBrief(wp: string, section: { title: string; text: string }, notes: Notes): string {
  const reads = notes.read.map(resolveRead);
  const readTokens = reads.reduce((a, r) => a + r.tokens, 0);
  const stubs = notes.owns.length ? stubsIn(notes.owns) : [];
  const crs = ledgerRows(notes.crs);
  const out: string[] = [
    `# ${wp} brief — ${section.title.replace(/^(☆ )?WP-[0-9A-Za-z]+ /, "")}`,
    "",
    `> Generated by \`bun run briefs\` (scripts/gen-briefs.ts) from \`docs/design/MILESTONES.md\`, \`packages/core/CR-LEDGER.md\`, the M0 package stubs and \`docs/design/briefs/notes/${wp}.md\` — edit those, not this file. Read this first; it is self-sufficient for starting the WP. Precedence: package contracts (\`packages/*/src/contract.ts\`, \`packages/core/src/{domain,api}.ts\`) > REVIEW-LOG > ARCHITECTURE/ADRs > specs (each spec's 改訂 R1 section overrides its body).`,
    "",
    "## 1. Work package (MILESTONES, verbatim)",
    "",
    section.text,
    "",
    `## 2. Read exactly these sections (≈ ${readTokens.toLocaleString("en")} tokens)`,
    "",
    ...reads.map((r) => `- \`${r.path}\` L${r.from}–${r.to} — ${r.title} (≈ ${r.tokens.toLocaleString("en")} tok)`),
    "",
  ];
  if (stubs.length) {
    out.push(
      `## 3. M0 stubs you own (${stubs.length}) — implement in place, keep the signatures`,
      "",
      "Each throws `E_UNSUPPORTED` today (`unsupported()` / `unsupportedValue()` from `@mitori/core`). The doc comment above each stub is the contract text. Changing a signature is a contract change (CR batch).",
      "",
      ...stubs.map((s) => `- \`${s.file}:${s.line}\` — \`${s.sig}\``),
      "",
    );
  }
  out.push(`## ${stubs.length ? 4 : 3}. CR ledger rows that concern this WP (${crs.length})`, "");
  out.push(crs.length ? ["| id | requester | 決定 | 適用先 | 理由・備考 |", "|---|---|---|---|---|", ...crs].join("\n") : "(none)");
  out.push("", notes.body.trim(), "", HOW_TO_WORK, "");
  return `${out
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trimEnd()}\n`;
}

if (import.meta.main) {
  const sections = milestoneSections(read("docs/design/MILESTONES.md"));
  const notesDir = join(ROOT, "docs/design/briefs/notes");
  const check = process.argv.includes("--check");
  let bad = 0;
  const summary: string[] = [];
  for (const f of readdirSync(notesDir)
    .filter((n) => /^WP-.*\.md$/.test(n))
    .sort()) {
    const wp = f.replace(/\.md$/, "");
    const section = sections.get(wp);
    if (!section) throw new Error(`gen-briefs: ${wp} has notes but no MILESTONES section`);
    const brief = buildBrief(wp, section, parseNotes(read(`docs/design/briefs/notes/${f}`)));
    const tokens = estimateTokens(brief);
    const rel = `docs/design/briefs/${wp}.md`;
    if (tokens > MAX_TOKENS) {
      console.error(`gen-briefs: ${rel} is ≈ ${tokens} tokens (> ${MAX_TOKENS})`);
      bad++;
    }
    if (check) {
      let cur = "";
      try {
        cur = read(rel);
      } catch {}
      if (cur !== brief) {
        console.error(`gen-briefs: ${rel} is stale (run \`bun run briefs\`)`);
        bad++;
      }
    } else writeFileSync(join(ROOT, rel), brief);
    summary.push(`${wp} ≈${tokens}`);
  }
  for (const wp of sections.keys()) {
    if (summary.some((s) => s.startsWith(`${wp} `))) continue;
    console.error(`gen-briefs: no notes for ${wp}`);
    bad++;
  }
  console.log(`gen-briefs: ${summary.join(" · ")}`);
  process.exit(bad ? 1 : 0);
}
