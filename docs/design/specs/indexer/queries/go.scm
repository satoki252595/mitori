; mitori tags query — go
; ---- definitions -------------------------------------------------------------
(package_clause (package_identifier) @name) @def.package
(function_declaration name: (identifier) @name) @def.function
(method_declaration name: (field_identifier) @name) @def.method
(type_declaration (type_spec name: (type_identifier) @name type: (struct_type)) @def.struct)
(type_declaration (type_spec name: (type_identifier) @name type: (interface_type)) @def.interface)
(type_declaration (type_spec name: (type_identifier) @name type: [(type_identifier) (qualified_type) (pointer_type) (map_type) (slice_type) (array_type) (function_type) (channel_type) (generic_type)]) @def.type)
(type_declaration (type_alias name: (type_identifier) @name) @def.type)
(source_file (const_declaration (const_spec name: (identifier) @name) @def.const))
(source_file (var_declaration (var_spec name: (identifier) @name) @def.var))
(field_declaration_list (field_declaration name: (field_identifier) @name) @def.field)
(interface_type (method_elem name: (field_identifier) @name) @def.method)
; ---- imports -------------------------------------------------------------------
(import_spec path: (interpreted_string_literal) @import.source)
(import_spec name: (package_identifier) @import.name path: (interpreted_string_literal))
; ---- references ----------------------------------------------------------------
(call_expression function: (identifier) @ref.call)
(call_expression function: (selector_expression field: (field_identifier) @ref.call))
(selector_expression operand: (identifier) @ref.qual.pkg field: (field_identifier) @ref.qual.name)
(qualified_type package: (package_identifier) @ref.qual.pkg name: (type_identifier) @ref.qual.name)
(type_identifier) @ref.type
(composite_literal type: (type_identifier) @ref.new)
