; axum: .route("/p", get(h).post(h2)) / .nest("/api", r)
(call_expression function: (field_expression field: (field_identifier) @route.method) arguments: (arguments . (string_literal) @route.path)
  (#match? @route.method "^(route|nest|nest_service|route_service|resource|scope|service)$")) @route
; actix attribute: #[get("/p")]
(attribute_item (attribute (identifier) @route.method arguments: (token_tree (string_literal) @route.path))
  (#match? @route.method "^(get|post|put|patch|delete|head|options|trace|connect|route)$")) @route.attr
; env: std::env::var("X") / env::var_os("X")
(call_expression function: (scoped_identifier path: [(identifier) (scoped_identifier)] @_p name: (identifier) @_f) arguments: (arguments . (string_literal) @env.name)
  (#match? @_f "^(var|var_os|set_var|remove_var)$") (#match? @_p "env$"))
(macro_invocation macro: (identifier) @_m (token_tree . (string_literal) @env.name) (#match? @_m "^(env|option_env)$"))
; clap derive / builder
(attribute_item (attribute (identifier) @cli.attr) (#match? @cli.attr "^(command|arg|clap)$"))
(call_expression function: (scoped_identifier path: (identifier) @_c name: (identifier) @_n) arguments: (arguments . (string_literal) @cli.arg) (#match? @_c "^(Command|Arg|App|SubCommand)$") (#eq? @_n "new"))
; tests
(attribute_item (attribute (identifier) @test.attr) (#eq? @test.attr "test"))
; entry
(function_item name: (identifier) @entry.main (#eq? @entry.main "main"))
