// Auxiliary queries the extractor runs next to the tags query (not part of the §3.4 capture contract): decision
// nodes for `complexity` (spec §3.6), comment nodes (LOC, docs, rationale I5), test-case calls (spec §5.4) and
// ERROR/MISSING nodes (degraded files, §3.7). Part of every ExtractorVersion via `AUX_QUERIES` (versions.ts).
import type { GrammarId } from "../contract.ts";

const JS_CX = `[(if_statement) (for_statement) (for_in_statement) (while_statement) (do_statement) (switch_case) (catch_clause) (ternary_expression)] @cx
(binary_expression operator: ["&&" "||" "??"]) @cx
(comment) @comment
`;

/** Decision nodes + comments per grammar. */
export const CX_QUERIES: Readonly<Record<GrammarId, string>> = {
  typescript: JS_CX,
  tsx: JS_CX,
  javascript: JS_CX,
  python: `[(if_statement) (elif_clause) (for_statement) (while_statement) (except_clause) (conditional_expression) (boolean_operator) (case_clause)] @cx
(comment) @comment
`,
  go: `[(if_statement) (for_statement) (expression_case) (type_case) (communication_case)] @cx
(binary_expression operator: ["&&" "||"]) @cx
(comment) @comment
`,
  rust: `[(if_expression) (match_arm) (while_expression) (loop_expression) (for_expression) (try_expression)] @cx
(binary_expression operator: ["&&" "||"]) @cx
[(line_comment) (block_comment)] @comment
`,
};

const JS_TESTS = `(call_expression function: [(identifier) (member_expression)] @t.fn arguments: (arguments . [(string) (template_string)] @t.name))
`;

/** Test-case calls (run on test files only): JS/TS `describe`/`it`/`test`…, Go `t.Run("sub")`. */
export const TEST_QUERIES: Readonly<Partial<Record<GrammarId, string>>> = {
  typescript: JS_TESTS,
  tsx: JS_TESTS,
  javascript: JS_TESTS,
  go: `(call_expression function: (selector_expression field: (field_identifier) @t.fn) arguments: (argument_list . (interpreted_string_literal) @t.name) (#eq? @t.fn "Run"))
`,
};

/** ERROR / MISSING nodes (run only when the root `hasError`). */
export const ERROR_QUERY = `(ERROR) @err
(MISSING) @missing
`;

/** Everything above, concatenated per grammar (version hashing). */
export function auxQueryText(g: GrammarId): string {
  return `${CX_QUERIES[g]}\n${TEST_QUERIES[g] ?? ""}\n${ERROR_QUERY}`;
}
