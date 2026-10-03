; mitori tags query — javascript / jsx (the JS grammar parses JSX natively)
; ---- definitions -------------------------------------------------------------
(function_declaration name: (identifier) @name) @def.function
(generator_function_declaration name: (identifier) @name) @def.function
(class_declaration name: (identifier) @name) @def.class
(method_definition name: [(property_identifier) (private_property_identifier)] @name) @def.method
(field_definition property: [(property_identifier) (private_property_identifier)] @name) @def.field
(lexical_declaration
  (variable_declarator
    name: (identifier) @name
    value: [(arrow_function) (function_expression) (generator_function)]) @def.function)
(variable_declaration
  (variable_declarator
    name: (identifier) @name
    value: [(arrow_function) (function_expression) (generator_function)]) @def.function)
(lexical_declaration
  (variable_declarator name: (identifier) @name value: (class)) @def.class)
(program (lexical_declaration
  (variable_declarator
    name: (identifier) @name
    value: [(object) (array) (call_expression) (new_expression) (string) (number) (template_string) (member_expression) (identifier)]) @def.const))
(program (export_statement (lexical_declaration
  (variable_declarator
    name: (identifier) @name
    value: [(object) (array) (call_expression) (new_expression) (string) (number) (template_string) (member_expression) (identifier)]) @def.const)))
; CommonJS: module.exports.foo = function () {} / exports.foo = () => {}
(assignment_expression
  left: (member_expression object: [(identifier) (member_expression)] property: (property_identifier) @name)
  right: [(arrow_function) (function_expression)]) @def.function
; ---- exports -------------------------------------------------------------------
(export_statement (export_clause (export_specifier name: (_) @export.name)))
(export_statement source: (string) @export.source)
(export_statement "default" value: (identifier) @export.name)
; ---- imports -------------------------------------------------------------------
(import_statement source: (string) @import.source)
(import_statement (import_clause (named_imports (import_specifier name: (identifier) @import.name))))
(import_statement (import_clause (identifier) @import.name))
(call_expression function: (import) arguments: (arguments . (string) @import.dynamic))
((call_expression function: (identifier) @_req arguments: (arguments . (string) @import.dynamic))
  (#eq? @_req "require"))
; ---- references ----------------------------------------------------------------
(call_expression function: (identifier) @ref.call)
(call_expression function: (member_expression property: (property_identifier) @ref.call))
(new_expression constructor: (identifier) @ref.new)
(class_heritage (identifier) @ref.type)
(jsx_opening_element name: (identifier) @ref.jsx)
(jsx_self_closing_element name: (identifier) @ref.jsx)
(jsx_opening_element name: (member_expression property: (property_identifier) @ref.jsx))
(jsx_self_closing_element name: (member_expression property: (property_identifier) @ref.jsx))
