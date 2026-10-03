/**
 * Fact candidate queries (spec §5.3; `docs/design/specs/indexer/queries/facts/*.scm` + the concatenation, binding and
 * entry patterns the extractors need). One query per grammar family; captures are dispatched by name.
 */

export const GO_FACTS = `
(package_clause (package_identifier) @pkg)
(call_expression
  function: (selector_expression operand: (_) @route.recv field: (field_identifier) @route.method)
  arguments: (argument_list . [(interpreted_string_literal) (raw_string_literal) (binary_expression) (identifier)] @route.path . (_)? @route.handler)
  (#match? @route.method "^(HandleFunc|Handle)$")) @route
(short_var_declaration
  left: (expression_list . (identifier) @bind.name)
  right: (expression_list . (call_expression function: (_) @bind.fn)))
(const_spec name: (identifier) @const.name value: (expression_list . (interpreted_string_literal) @const.value))
(call_expression function: (selector_expression operand: (identifier) @_os field: (field_identifier) @_f) arguments: (argument_list . (interpreted_string_literal) @env.name)
  (#eq? @_os "os") (#match? @_f "^(Getenv|LookupEnv|Setenv|Unsetenv)$")) @env.call
(literal_value
  (keyed_element (literal_element (identifier) @_k) (literal_element (interpreted_string_literal) @cli.reg))
  (keyed_element (literal_element (identifier) @_h) (literal_element (identifier)))
  (#match? @_k "^(name|Name|Use|command|Command|cmd)$") (#match? @_h "^(handler|Handler|Run|RunE|Action|action|run|fn|Fn)$")) @cli.table
(function_declaration name: (identifier) @test.name (#match? @test.name "^(Test|Benchmark|Fuzz|Example)[A-Z_0-9]"))
(function_declaration name: (identifier) @entry.main (#eq? @entry.main "main"))
`;

export const JS_FACTS = `
(call_expression
  function: (member_expression object: (_) @route.recv property: (property_identifier) @route.method)
  arguments: (arguments . [(string) (template_string) (binary_expression)] @route.path)
  (#match? @route.method "^(get|post|put|patch|delete|options|head|all|use|on|route|basePath)$")) @route
(variable_declarator name: (identifier) @bind.name value: [(call_expression function: (_) @bind.fn) (new_expression constructor: (_) @bind.fn)])
(member_expression object: (member_expression object: (identifier) @_p property: (property_identifier) @_e) property: (property_identifier) @env.name (#eq? @_p "process") (#eq? @_e "env"))
(subscript_expression object: (member_expression object: (identifier) @_p property: (property_identifier) @_e) index: (string) @env.name (#eq? @_p "process") (#eq? @_e "env"))
(member_expression object: (member_expression object: (meta_property) property: (property_identifier) @_e) property: (property_identifier) @env.name (#eq? @_e "env"))
(member_expression object: (member_expression object: (identifier) @_b property: (property_identifier) @_e) property: (property_identifier) @env.name (#eq? @_b "Bun") (#eq? @_e "env"))
(call_expression function: (member_expression object: (member_expression object: (identifier) @_d property: (property_identifier) @_e) property: (property_identifier) @_g) arguments: (arguments . (string) @env.name)
  (#eq? @_d "Deno") (#eq? @_e "env") (#eq? @_g "get"))
(variable_declarator name: (object_pattern) @env.destructure value: (member_expression object: (identifier) @_p property: (property_identifier) @_e) (#eq? @_p "process") (#eq? @_e "env"))
(call_expression function: (member_expression property: (property_identifier) @cli.call) arguments: (arguments . (string) @cli.arg) (#eq? @cli.call "command")) @cli.cmd
(object
  (pair key: (property_identifier) @_k value: (string) @cli.reg)
  (pair key: (property_identifier) @_h value: (identifier))
  (#match? @_k "^(name|command|cmd)$") (#match? @_h "^(handler|run|action|fn)$")) @cli.table
(call_expression function: [(identifier) @test.fn (member_expression object: (identifier) @test.obj property: (property_identifier) @test.prop)] arguments: (arguments . [(string) (template_string)] @test.name)) @test.call
`;

export const PY_FACTS = `
(decorated_definition
  (decorator (call function: (attribute object: (_) @route.recv attribute: (identifier) @route.method) arguments: (argument_list . (string) @route.path) @route.args))
  definition: (function_definition name: (identifier) @route.handler)) @route
(call function: (attribute object: (_) @route.recv attribute: (identifier) @route.method) arguments: (argument_list . (string) @route.path) @route.args
  (#match? @route.method "^(add_url_rule|add_api_route)$")) @route.call
(assignment left: (identifier) @bind.name right: (call function: (_) @bind.fn))
(subscript value: (attribute object: (identifier) @_os attribute: (identifier) @_env) subscript: (string) @env.name (#eq? @_os "os") (#eq? @_env "environ")) @env.sub
(call function: (attribute object: (attribute object: (identifier) @_os attribute: (identifier) @_env) attribute: (identifier) @_get) arguments: (argument_list . (string) @env.name) @env.args
  (#eq? @_os "os") (#eq? @_env "environ") (#eq? @_get "get"))
(call function: (attribute object: (identifier) @_os attribute: (identifier) @_g) arguments: (argument_list . (string) @env.name) @env.args (#eq? @_os "os") (#eq? @_g "getenv"))
(function_definition name: (identifier) @test.name (#match? @test.name "^test_"))
(if_statement condition: (comparison_operator (identifier) @_n (string) @_m) (#eq? @_n "__name__")) @entry.ifmain
`;

export const RUST_FACTS = `
(call_expression function: (scoped_identifier path: [(identifier) (scoped_identifier)] @_p name: (identifier) @_f) arguments: (arguments . (string_literal) @env.name)
  (#match? @_f "^(var|var_os)$") (#match? @_p "env$")) @env.call
(macro_invocation macro: (identifier) @_m (token_tree . (string_literal) @env.name) (#match? @_m "^(env|option_env)$")) @env.macro
(function_item name: (identifier) @entry.main (#eq? @entry.main "main"))
`;
