; route candidates: <recv>.<method>("<path>", ...)  (express / hono / fastify / koa-router / chi-like)
(call_expression
  function: (member_expression object: (_) @route.recv property: (property_identifier) @route.method)
  arguments: (arguments . [(string) (template_string)] @route.path)) @route
; fastify object form: fastify.route({ method: 'GET', url: '/x' })
(call_expression
  function: (member_expression property: (property_identifier) @_r)
  arguments: (arguments . (object) @route.obj)
  (#eq? @_r "route")) @route.objform
; env: process.env.X / process.env["X"] / import.meta.env.X / Bun.env.X
(member_expression object: (member_expression object: (identifier) @_p property: (property_identifier) @_e) property: (property_identifier) @env.name (#eq? @_p "process") (#eq? @_e "env"))
(subscript_expression object: (member_expression object: (identifier) @_p property: (property_identifier) @_e) index: (string) @env.name (#eq? @_p "process") (#eq? @_e "env"))
(member_expression object: (member_expression object: (meta_property) property: (property_identifier) @_e) property: (property_identifier) @env.name (#eq? @_e "env"))
(member_expression object: (member_expression object: (identifier) @_b property: (property_identifier) @_e) property: (property_identifier) @env.name (#eq? @_b "Bun") (#eq? @_e "env"))
(variable_declarator name: (object_pattern) @env.destructure value: (member_expression object: (identifier) @_p property: (property_identifier) @_e) (#eq? @_p "process") (#eq? @_e "env"))
; CLI: program.command('x') / .option('-f, --flag')
(call_expression function: (member_expression property: (property_identifier) @cli.call) arguments: (arguments . (string) @cli.arg))
; tests: describe/it/test("name")
(call_expression function: [(identifier) @test.fn (member_expression object: (identifier) @test.fn)] arguments: (arguments . [(string) (template_string)] @test.name))
