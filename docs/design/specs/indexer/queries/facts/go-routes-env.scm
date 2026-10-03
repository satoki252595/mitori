; <recv>.<Method>("<path>", ...): net/http HandleFunc/Handle, gin/echo GET.., chi Get.., Group/Route/Mount
(call_expression
  function: (selector_expression operand: (_) @route.recv field: (field_identifier) @route.method)
  arguments: (argument_list . (interpreted_string_literal) @route.path)
  (#match? @route.method "^(HandleFunc|Handle|GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS|Any|Get|Post|Put|Patch|Delete|Head|Options|Group|Route|Mount|Method|MethodFunc)$")) @route
; env
(call_expression function: (selector_expression operand: (identifier) @_os field: (field_identifier) @_f) arguments: (argument_list . (interpreted_string_literal) @env.name)
  (#eq? @_os "os") (#match? @_f "^(Getenv|LookupEnv|Setenv|Unsetenv)$"))
; cobra: &cobra.Command{Use: "x"}
(composite_literal type: (qualified_type package: (package_identifier) @_c name: (type_identifier) @_t)
  body: (literal_value (keyed_element (literal_element (identifier) @_k) (literal_element (interpreted_string_literal) @cli.use)))
  (#eq? @_c "cobra") (#eq? @_t "Command") (#eq? @_k "Use"))
; switch os.Args[1] { case "x": }
(expression_switch_statement value: (index_expression operand: (selector_expression operand: (identifier) @_os field: (field_identifier) @_a))
  (expression_case value: (expression_list (interpreted_string_literal) @cli.case))
  (#eq? @_os "os") (#eq? @_a "Args"))
; tests
(function_declaration name: (identifier) @test.name (#match? @test.name "^(Test|Benchmark|Fuzz|Example)[A-Z_0-9]"))
; entry
(function_declaration name: (identifier) @entry.main (#eq? @entry.main "main"))
; command-registry tables: {name: "x", handler: fn} / {Name: "x", Action: fn}
(literal_value
  (keyed_element (literal_element (identifier) @_k) (literal_element (interpreted_string_literal) @cli.reg))
  (keyed_element (literal_element (identifier) @_h) (literal_element (identifier)))
  (#match? @_k "^(name|Name|Use|command|Command|cmd)$") (#match? @_h "^(handler|Handler|Run|RunE|Action|action|run|fn|Fn)$"))
