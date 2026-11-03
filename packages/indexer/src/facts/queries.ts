/**
 * Fact candidate queries (spec §5.3; `docs/design/specs/indexer/queries/facts/*.scm` + the concatenation, binding and
 * entry patterns the extractors need). Split per concern so that a file only pays for the queries whose cheap text
 * precheck matched (S1 runs them for every source file); each runs at most once per tree.
 */

export interface FactQuery {
  id: string;
  src: string;
}

const q = (id: string, src: string): FactQuery => ({ id, src });

export const GO = {
  route: q(
    "go.route",
    `
(call_expression
  function: (selector_expression operand: (_) @route.recv field: (field_identifier) @route.method)
  arguments: (argument_list . [(interpreted_string_literal) (raw_string_literal) (binary_expression) (identifier)] @route.path . (_)? @route.handler)
  (#match? @route.method "^(HandleFunc|Handle)$")) @route
(short_var_declaration
  left: (expression_list . (identifier) @bind.name)
  right: (expression_list . (call_expression function: (_) @bind.fn)))
(const_spec name: (identifier) @const.name value: (expression_list . (interpreted_string_literal) @const.value))`,
  ),
  env: q(
    "go.env",
    `
(call_expression function: (selector_expression operand: (identifier) @_os field: (field_identifier) @_f) arguments: (argument_list . (interpreted_string_literal) @env.name)
  (#eq? @_os "os") (#match? @_f "^(Getenv|LookupEnv|Setenv|Unsetenv)$")) @env.call`,
  ),
  registry: q(
    "go.registry",
    `
(literal_value
  (keyed_element (literal_element (identifier) @_k) (literal_element (interpreted_string_literal) @cli.reg))
  (keyed_element (literal_element (identifier) @_h) (literal_element (identifier)))
  (#match? @_k "^(name|Name|Use|command|Command|cmd)$") (#match? @_h "^(handler|Handler|Run|RunE|Action|action|run|fn|Fn)$")) @cli.table`,
  ),
  entry: q("go.entry", `(source_file (function_declaration name: (identifier) @entry.main (#eq? @entry.main "main")))`),
};

export const JS = {
  route: q(
    "js.route",
    `
(call_expression
  function: (member_expression object: (_) @route.recv property: (property_identifier) @route.method)
  arguments: (arguments . [(string) (template_string) (binary_expression)] @route.path)
  (#match? @route.method "^(get|post|put|patch|delete|options|head|all|on)$")) @route`,
  ),
  binds: q(
    "js.binds",
    `(variable_declarator name: (identifier) @bind.name value: [(call_expression function: (_) @bind.fn) (new_expression constructor: (_) @bind.fn)])`,
  ),
  commander: q(
    "js.commander",
    `(call_expression function: (member_expression property: (property_identifier) @cli.call) arguments: (arguments . (string) @cli.arg) (#eq? @cli.call "command")) @cli.cmd`,
  ),
  mcp: q(
    "js.mcp",
    `
(call_expression
  function: (member_expression object: (_) @mcp.recv property: (property_identifier) @mcp.method)
  arguments: (arguments . (string) @mcp.name)
  (#match? @mcp.method "^(tool|registerTool)$")) @mcp`,
  ),
};

export const PY = {
  route: q(
    "py.route",
    `
(decorated_definition
  (decorator (call function: (attribute object: (_) @route.recv attribute: (identifier) @route.method) arguments: (argument_list . (string) @route.path) @route.args))
  definition: (function_definition name: (identifier) @route.handler)) @route
(call function: (attribute object: (_) @route.recv attribute: (identifier) @route.method) arguments: (argument_list . (string) @route.path) @route.args
  (#match? @route.method "^(add_url_rule|add_api_route)$")) @route.call
(assignment left: (identifier) @bind.name right: (call function: (_) @bind.fn))`,
  ),
  env: q(
    "py.env",
    `
(subscript value: (attribute object: (identifier) @_os attribute: (identifier) @_env) subscript: (string) @env.name (#eq? @_os "os") (#eq? @_env "environ")) @env.sub
(call function: (attribute object: (attribute object: (identifier) @_os attribute: (identifier) @_env) attribute: (identifier) @_get) arguments: (argument_list . (string) @env.name) @env.args
  (#eq? @_os "os") (#eq? @_env "environ") (#eq? @_get "get"))
(call function: (attribute object: (identifier) @_os attribute: (identifier) @_g) arguments: (argument_list . (string) @env.name) @env.args (#eq? @_os "os") (#eq? @_g "getenv"))`,
  ),
  tests: q("py.tests", `(function_definition name: (identifier) @test.name (#match? @test.name "^test_"))`),
  entry: q("py.entry", `(if_statement condition: (comparison_operator (identifier) @_n (string) @_m) (#eq? @_n "__name__")) @entry.ifmain`),
};

export const RUST = {
  env: q(
    "rust.env",
    `
(call_expression function: (scoped_identifier path: [(identifier) (scoped_identifier)] @_p name: (identifier) @_f) arguments: (arguments . (string_literal) @env.name)
  (#match? @_f "^(var|var_os)$") (#match? @_p "env$")) @env.call
(macro_invocation macro: (identifier) @_m (token_tree . (string_literal) @env.name) (#match? @_m "^(env|option_env)$")) @env.macro`,
  ),
  entry: q("rust.entry", `(source_file (function_item name: (identifier) @entry.main (#eq? @entry.main "main")))`),
};
