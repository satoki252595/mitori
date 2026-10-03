// Per-language test-file heuristics (LanguagePlugin.isTestFile; indexer spec §2.3 R16, §5.4).
import type { SourceLang } from "@mitori/core";
import { basename } from "./detect.ts";

const JS_TEST = /\.(test|spec)\.[cm]?[jt]sx?$/i;
const PY_TEST = /^(test_.*|.*_test|conftest)\.pyi?$/;

/** True when the file name itself marks a test of `lang` (directory rules are R16's `TEST_SEGMENTS`). */
export function isTestFile(path: string, lang: SourceLang): boolean {
  const b = basename(path);
  switch (lang) {
    case "go":
      return b.endsWith("_test.go");
    case "python":
      return PY_TEST.test(b);
    case "typescript":
    case "tsx":
    case "javascript":
    case "jsx":
      return JS_TEST.test(b) || path.includes("/__tests__/") || path.startsWith("__tests__/");
    default:
      return false;
  }
}
