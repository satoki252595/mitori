; decorators: @<recv>.<method>("<path>", ...)   (flask route/get/post..., fastapi get/post/api_route...)
(decorated_definition
  (decorator (call function: (attribute object: (_) @route.recv attribute: (identifier) @route.method)
                   arguments: (argument_list . (string) @route.path)))
  definition: (function_definition name: (identifier) @route.handler)) @route
; app.add_url_rule("/p", ...) / app.add_api_route("/p", fn)
(call function: (attribute attribute: (identifier) @route.method) arguments: (argument_list . (string) @route.path)
  (#match? @route.method "^(add_url_rule|add_api_route|add_api_websocket_route)$")) @route.call
; django: path("p/", view) / re_path(r"...", view)
(call function: (identifier) @route.method arguments: (argument_list . (string) @route.path)
  (#match? @route.method "^(path|re_path|url)$")) @route.django
; env
(subscript value: (attribute object: (identifier) @_os attribute: (identifier) @_env) subscript: (string) @env.name (#eq? @_os "os") (#eq? @_env "environ"))
(call function: (attribute object: (attribute object: (identifier) @_os attribute: (identifier) @_env) attribute: (identifier) @_get) arguments: (argument_list . (string) @env.name) (#eq? @_os "os") (#eq? @_env "environ") (#eq? @_get "get"))
(call function: (attribute object: (identifier) @_os attribute: (identifier) @_g) arguments: (argument_list . (string) @env.name) (#eq? @_os "os") (#eq? @_g "getenv"))
; cli: @click.command / @click.option("--x") / add_argument("--x") / add_parser("x")
(decorator (call function: (attribute object: (_) @cli.recv attribute: (identifier) @cli.call) arguments: (argument_list . (string)? @cli.arg)))
(call function: (attribute attribute: (identifier) @cli.call) arguments: (argument_list . (string) @cli.arg) (#match? @cli.call "^(add_argument|add_parser)$"))
; tests
(function_definition name: (identifier) @test.name (#match? @test.name "^test_"))
