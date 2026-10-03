; mitori tags query — python
; ---- definitions -------------------------------------------------------------
(function_definition name: (identifier) @name) @def.function
(class_definition name: (identifier) @name) @def.class
(module (expression_statement (assignment left: (identifier) @name) @def.const))
(class_definition body: (block (expression_statement (assignment left: (identifier) @name) @def.field)))
; docstrings (structural: first statement of module / class / function body)
(module . (expression_statement (string) @doc.module))
(function_definition body: (block . (expression_statement (string) @doc)))
(class_definition body: (block . (expression_statement (string) @doc)))
; ---- exports -------------------------------------------------------------------
((module (expression_statement (assignment left: (identifier) @_all right: (list (string) @export.name))))
  (#eq? @_all "__all__"))
; ---- imports -------------------------------------------------------------------
(import_statement name: (dotted_name) @import.source)
(import_statement name: (aliased_import name: (dotted_name) @import.source))
(import_from_statement module_name: (dotted_name) @import.source)
(import_from_statement module_name: (relative_import) @import.source)
(import_from_statement name: (dotted_name) @import.name)
(import_from_statement name: (aliased_import name: (dotted_name) @import.name))
((call function: (attribute object: (identifier) @_il attribute: (identifier) @_im) arguments: (argument_list . (string) @import.dynamic))
  (#eq? @_il "importlib") (#eq? @_im "import_module"))
; ---- references ----------------------------------------------------------------
(call function: (identifier) @ref.call)
(call function: (attribute attribute: (identifier) @ref.call))
(class_definition superclasses: (argument_list (identifier) @ref.type))
(class_definition superclasses: (argument_list (attribute attribute: (identifier) @ref.type)))
(type (identifier) @ref.type)
(decorator (identifier) @ref.call)
(decorator (attribute attribute: (identifier) @ref.call))
