// 「なぜ除外?」: the rule that classified a path, with the glob / segment / threshold that matched (English detail;
// the UI maps `rule` to `idx.rule.<id>`).
import { INVENTORY_LIMITS, type InventoryExplanation } from "../contract.ts";
import type { CompiledSettings } from "../inventory/classify.ts";
import { FIXTURE_SEGMENTS, GENERATED_SEGMENTS, SECRET_GLOBS, VENDOR_SEGMENTS } from "../inventory/sets.ts";
import type { FileRec } from "./model.ts";

const DETAIL: Readonly<Record<string, string>> = {
  "R00.special": "submodule, symlink, nested repository or unreadable file",
  "R01.deny": "matches a deny glob (never read, never packed)",
  "R02.user_exclude": "matches an exclude glob of the repo / workspace settings",
  "R04.secret_name": "secret-bearing file name",
  "R05.lockfile": "lockfile",
  "R06.binary_ext": "binary file extension",
  "R07.oversize": `larger than ${INVENTORY_LIMITS.oversizeBytes} bytes`,
  "R08.vendored": "vendored code",
  "R09.generated_path": "generated code (path or linguist-generated)",
  "R10.minified_name": "minified file name",
  "R11.binary_content": "binary content (NUL byte or invalid UTF-8)",
  "R12.minified_content": `minified content (more than ${INVENTORY_LIMITS.minifiedAvgLineBytes} bytes per line)`,
  "R13.generated_header": "generated-file header comment",
  "R14.fixture": "test fixture / snapshot",
  "R15.data_large": `data file larger than ${INVENTORY_LIMITS.dataLargeBytes} bytes`,
  "R16.test": "test file",
  "R17.docs": "documentation",
  "R18.config": "configuration",
  "R19.source": "source code",
  "R20.fallback": "other text file",
};

function segment(path: string, set: ReadonlySet<string>): string | undefined {
  return path
    .split("/")
    .slice(0, -1)
    .find((s) => set.has(s));
}

export function explainRecord(r: FileRec, s: CompiledSettings): InventoryExplanation {
  const out: InventoryExplanation = { path: r.path, class: r.class, rule: r.rule, detail: DETAIL[r.rule] ?? r.rule };
  if (r.excluded !== undefined) out.excluded = r.excluded;
  if (r.note === "unreadable") out.detail = "unreadable file";
  let matched: string | null | undefined;
  switch (r.rule) {
    case "R01.deny":
      matched = s.deny.which(r.path);
      break;
    case "R02.user_exclude":
      matched = s.exclude.which(r.path);
      break;
    case "R04.secret_name":
      matched = SECRET_GLOBS.which(r.path) ?? "SECRET_NAME_RE";
      break;
    case "R08.vendored":
      matched = r.attrs.vendored === true ? "linguist-vendored" : segment(r.path, VENDOR_SEGMENTS);
      break;
    case "R09.generated_path":
      matched = r.attrs.generated === true ? "linguist-generated" : (segment(r.path, GENERATED_SEGMENTS) ?? "GENERATED_NAME_RE");
      break;
    case "R14.fixture":
      matched = segment(r.path, FIXTURE_SEGMENTS) ?? "*.snap";
      break;
    case "R07.oversize":
    case "R15.data_large":
      matched = `${r.size} bytes`;
      break;
  }
  if (r.include && r.excluded === undefined) out.detail += " (include glob)";
  if (matched !== null && matched !== undefined) out.matched = matched;
  return out;
}
