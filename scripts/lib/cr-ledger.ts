// CR ledger check (CONS-01 / SC-01): every change-request reference in the design docs and contracts must
// resolve to a ledger row, and every ledger row must be decided. Pure: callers pass texts.

export interface CrProblem {
  file: string;
  line: number;
  col: number;
  rule: "cr-unknown" | "cr-ambiguous" | "cr-undecided" | "cr-duplicate";
  message: string;
}

export interface LedgerRow {
  id: string;
  decision: string;
  line: number;
}

const DECIDED = /^(accepted-modified|accepted|deferred|rejected)(\b|（|\(|$)/;
const QUALIFIED = /\bCR (idx|gen|loop|ux|jdg|test|arch|m0)-([A-Za-z0-9]+)\b/g;
const BARE = /\bCR-(\d+)\b/g;
const SECTION14_3 = /§14\.3-(\d+)\b/g;

/** Table rows `| id | requester | decision | … |` of the ledger. */
export function parseLedger(md: string, file = "CR-LEDGER.md"): { rows: LedgerRow[]; problems: CrProblem[] } {
  const rows: LedgerRow[] = [];
  const problems: CrProblem[] = [];
  const seen = new Map<string, number>();
  md.split("\n").forEach((text, i) => {
    if (!text.startsWith("| ") || /^\|\s*-/.test(text)) return;
    const cells = text.split("|").map((c) => c.trim());
    const id = cells[1] ?? "";
    if (id === "id" || id === "") return;
    const decision = cells[3] ?? "";
    const line = i + 1;
    if (seen.has(id)) problems.push({ file, line, col: 1, rule: "cr-duplicate", message: `duplicate ledger id ${id} (first at line ${seen.get(id)})` });
    seen.set(id, line);
    if (!DECIDED.test(decision))
      problems.push({
        file,
        line,
        col: 1,
        rule: "cr-undecided",
        message: `${id}: decision "${decision}" is not accepted / accepted-modified / deferred / rejected`,
      });
    rows.push({ id, decision, line });
  });
  return { rows, problems };
}

/** Default scheme of a bare `CR-n` per file (the spec that numbers its own requests that way). */
export function defaultScheme(path: string): "idx" | "test" | null {
  if (/(^|\/)specs\/indexer\.md$|contracts\/indexer\.ts$|^packages\/indexer\//.test(path)) return "idx";
  if (/(^|\/)specs\/testing\.md$|contracts\/testing\.md$|^packages\/testkit\//.test(path)) return "test";
  return null;
}

export interface CrRef {
  id: string;
  line: number;
  col: number;
}

/** All CR references of one file, or an ambiguity problem for an unqualified `CR-n` that cannot be resolved. */
export function extractRefs(path: string, text: string): { refs: CrRef[]; problems: CrProblem[] } {
  const refs: CrRef[] = [];
  const problems: CrProblem[] = [];
  const lines = text.split("\n");
  // section-local tables: the requests themselves
  const sectionRules: { file: RegExp; heading: RegExp; row: RegExp; id: (n: string) => string }[] = [
    { file: /specs\/generation\.md$/, heading: /^### 17\.1 /, row: /^\| C(\d+) \|/, id: (n) => `CR gen-C${n}` },
    { file: /specs\/generation\.md$/, heading: /^### 17\.2 /, row: /^\| L(\d+) \|/, id: (n) => `gL-${n}` },
    { file: /specs\/ux\.md$/, heading: /^## 16\. /, row: /^\| R(\d+) \|/, id: (n) => `CR ux-R${n}` },
    { file: /specs\/loop\.md$/, heading: /^### 14\.3 /, row: /^(\d+)\. /, id: (n) => `CR loop-${n}` },
  ];
  const active = sectionRules.filter((r) => r.file.test(path));
  let current: (typeof sectionRules)[number][] = [];
  const scheme = defaultScheme(path);
  lines.forEach((text, i) => {
    const line = i + 1;
    if (text.includes("cr-ledger:ignore")) return; // e.g. a doc that quotes an unregistered id on purpose
    if (/^#{1,6} /.test(text)) current = active.filter((r) => r.heading.test(text));
    for (const r of current) {
      const m = r.row.exec(text);
      if (m?.[1]) refs.push({ id: r.id(m[1]), line, col: 1 });
    }
    for (const m of text.matchAll(QUALIFIED)) refs.push({ id: `CR ${m[1]}-${m[2]}`, line, col: m.index + 1 });
    for (const m of text.matchAll(SECTION14_3)) refs.push({ id: `CR loop-${m[1]}`, line, col: m.index + 1 });
    for (const m of text.matchAll(BARE)) {
      const before = text.slice(Math.max(0, m.index - 12), m.index);
      const s = /(indexer|idx)\s*$/i.test(before) ? "idx" : /(testing|test)\s*$/i.test(before) ? "test" : scheme;
      if (s) refs.push({ id: `CR ${s}-${m[1]}`, line, col: m.index + 1 });
      else
        problems.push({
          file: path,
          line,
          col: m.index + 1,
          rule: "cr-ambiguous",
          message: `"${m[0]}" cannot be resolved here: write it qualified (e.g. "CR idx-${m[1]}", "CR test-${m[1]}")`,
        });
    }
  });
  return { refs, problems };
}

/** Full check over a ledger and a set of scanned files. */
export function checkCrLedger(ledger: { path: string; text: string }, files: readonly { path: string; text: string }[]): CrProblem[] {
  const { rows, problems } = parseLedger(ledger.text, ledger.path);
  const ids = new Set(rows.map((r) => r.id));
  for (const f of files) {
    const r = extractRefs(f.path, f.text);
    problems.push(...r.problems);
    for (const ref of r.refs)
      if (!ids.has(ref.id)) problems.push({ file: f.path, line: ref.line, col: ref.col, rule: "cr-unknown", message: `${ref.id} is not in ${ledger.path}` });
  }
  return problems;
}
