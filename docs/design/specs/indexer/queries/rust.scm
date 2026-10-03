; mitori tags query — rust
; ---- definitions -------------------------------------------------------------
(function_item name: (identifier) @name) @def.function
(function_signature_item name: (identifier) @name) @def.function
(struct_item name: (type_identifier) @name) @def.struct
(enum_item name: (type_identifier) @name) @def.enum
(union_item name: (type_identifier) @name) @def.struct
(type_item name: (type_identifier) @name) @def.type
(trait_item name: (type_identifier) @name) @def.trait
(impl_item type: (_) @name) @def.impl
(mod_item name: (identifier) @name) @def.module
(macro_definition name: (identifier) @name) @def.macro
(const_item name: (identifier) @name) @def.const
(static_item name: (identifier) @name) @def.var
(field_declaration_list (field_declaration name: (field_identifier) @name) @def.field)
(enum_variant_list (enum_variant name: (identifier) @name) @def.field)
; doc comments (structural: `///` and `//!` carry a doc marker child)
(line_comment (outer_doc_comment_marker)) @doc
(line_comment (inner_doc_comment_marker)) @doc.module
(block_comment (outer_doc_comment_marker)) @doc
; ---- imports -------------------------------------------------------------------
(use_declaration argument: (_) @import.source)
(extern_crate_declaration name: (identifier) @import.source)
(mod_item name: (identifier) @import.mod !body)
; ---- references ----------------------------------------------------------------
(call_expression function: (identifier) @ref.call)
(call_expression function: (scoped_identifier name: (identifier) @ref.call))
(call_expression function: (field_expression field: (field_identifier) @ref.call))
(macro_invocation macro: (identifier) @ref.call)
(impl_item trait: (type_identifier) @ref.type)
(type_identifier) @ref.type
(struct_expression name: (type_identifier) @ref.new)
(scoped_identifier path: (identifier) @ref.qual.pkg name: (identifier) @ref.qual.name)
