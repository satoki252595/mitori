; mitori tags query — typescript (also the base of tsx). Capture contract: see docs/design/specs/indexer.md §3.4
; ---- definitions -------------------------------------------------------------
(function_declaration name: (identifier) @name) @def.function
(generator_function_declaration name: (identifier) @name) @def.function
(function_signature name: (identifier) @name) @def.function
(class_declaration name: (type_identifier) @name) @def.class
(abstract_class_declaration name: (type_identifier) @name) @def.class
(interface_declaration name: (type_identifier) @name) @def.interface
(type_alias_declaration name: (type_identifier) @name) @def.type
(enum_declaration name: (identifier) @name) @def.enum
(internal_module name: [(identifier) (nested_identifier)] @name) @def.namespace
(module name: [(identifier) (nested_identifier) (string)] @name) @def.namespace
(method_definition name: [(property_identifier) (private_property_identifier)] @name) @def.method
(method_signature name: [(property_identifier) (private_property_identifier)] @name) @def.method
(abstract_method_signature name: [(property_identifier) (private_property_identifier)] @name) @def.method
(public_field_definition name: [(property_identifier) (private_property_identifier)] @name) @def.field
(property_signature name: (property_identifier) @name) @def.field
(lexical_declaration
  (variable_declarator
    name: (identifier) @name
    value: [(arrow_function) (function_expression) (generator_function)]) @def.function)
(lexical_declaration
  (variable_declarator
    name: (identifier) @name
    value: (class) ) @def.class)
(program (lexical_declaration
  (variable_declarator
    name: (identifier) @name
    value: [(object) (array) (call_expression) (new_expression) (string) (number) (template_string) (as_expression) (satisfies_expression) (member_expression) (identifier)]) @def.const))
(program (export_statement (lexical_declaration
  (variable_declarator
    name: (identifier) @name
    value: [(object) (array) (call_expression) (new_expression) (string) (number) (template_string) (as_expression) (satisfies_expression) (member_expression) (identifier)]) @def.const)))
; ---- exports -------------------------------------------------------------------
(export_statement (export_clause (export_specifier name: (_) @export.name)))
(export_statement source: (string) @export.source)
(export_statement "default" value: (identifier) @export.name)
; ---- imports -------------------------------------------------------------------
(import_statement source: (string) @import.source)
(import_statement (import_clause (named_imports (import_specifier name: (identifier) @import.name))))
(import_statement (import_clause (identifier) @import.name))
(import_require_clause source: (string) @import.source)
(call_expression function: (import) arguments: (arguments . (string) @import.dynamic))
((call_expression function: (identifier) @_req arguments: (arguments . (string) @import.dynamic))
  (#eq? @_req "require"))
; ---- references ----------------------------------------------------------------
(call_expression function: (identifier) @ref.call)
(call_expression function: (member_expression property: (property_identifier) @ref.call))
(new_expression constructor: (identifier) @ref.new)
(type_identifier) @ref.type
(extends_clause value: (identifier) @ref.type)
(implements_clause (type_identifier) @ref.type)
