/**
 * CR-PENDING(WP-11) cr-requests/WP-11.md #1: the MCP `tools/list` result as rendered by loop `mcpToolsList()` from
 * `MCP_TOOLS` — a copy because the CLI may not import @mitori/loop. `JSON.stringify(TOOLS_LIST)` must equal
 * `fixtures/golden/mcp/tools-list.json` byte for byte (tested); regenerate from that golden, never edit by hand.
 */
export const TOOLS_LIST = {
  tools: [
    {
      name: "mitori_status",
      description: "Design-doc revision, open thread count and stale block count for this repository.",
      inputSchema: {
        type: "object",
        properties: {},
        additionalProperties: false,
      },
      annotations: {
        readOnlyHint: true,
      },
    },
    {
      name: "mitori_list_threads",
      description: "List review threads, one line each: id, state, intent, anchor, first 40 chars.",
      inputSchema: {
        type: "object",
        properties: {
          state: {
            type: "string",
            enum: ["open", "queued", "needs_input", "answered", "all"],
            default: "open",
          },
          limit: {
            type: "integer",
            minimum: 1,
            maximum: 50,
            default: 20,
          },
        },
        additionalProperties: false,
      },
      annotations: {
        readOnlyHint: true,
      },
    },
    {
      name: "mitori_get_bundle",
      description: "Minimal context for one thread as tagged text (ASK, DOC, CODE, WRITE, ACCEPT). Default 4000 tokens, max 12000.",
      inputSchema: {
        type: "object",
        properties: {
          thread_id: {
            type: "string",
            pattern: "^th_[0-9a-z]{8}$",
          },
          budget_tokens: {
            type: "integer",
            minimum: 500,
            maximum: 12000,
          },
          line_numbers: {
            type: "boolean",
          },
        },
        required: ["thread_id"],
        additionalProperties: false,
      },
      annotations: {
        readOnlyHint: true,
      },
    },
    {
      name: "mitori_get_doc",
      description: "Design-doc section or block as Markdown; depth=0 returns the outline only.",
      inputSchema: {
        type: "object",
        properties: {
          ref: {
            type: "string",
            description: "section id (s3/login-flow) or block id (b_…)",
          },
          depth: {
            type: "integer",
            minimum: 0,
            maximum: 3,
          },
        },
        required: ["ref"],
        additionalProperties: false,
      },
      annotations: {
        readOnlyHint: true,
      },
    },
    {
      name: "mitori_find_symbol",
      description: "Find symbols by name, one line each: name kind path:start-end signature. Use instead of grep.",
      inputSchema: {
        type: "object",
        properties: {
          query: {
            type: "string",
            minLength: 1,
          },
          limit: {
            type: "integer",
            minimum: 1,
            maximum: 20,
          },
        },
        required: ["query"],
        additionalProperties: false,
      },
      annotations: {
        readOnlyHint: true,
      },
    },
    {
      name: "mitori_reply",
      description: "Reply to a thread: done (you changed code), answer, or question (needs the human). Cannot resolve threads.",
      inputSchema: {
        type: "object",
        properties: {
          thread_id: {
            type: "string",
            pattern: "^th_[0-9a-z]{8}$",
          },
          kind: {
            type: "string",
            enum: ["done", "answer", "question"],
          },
          body: {
            type: "string",
            minLength: 1,
            maxLength: 8000,
          },
          files: {
            type: "array",
            items: {
              type: "string",
            },
            maxItems: 20,
          },
        },
        required: ["thread_id", "kind", "body"],
        additionalProperties: false,
      },
      annotations: {
        readOnlyHint: false,
      },
    },
    {
      name: "mitori_submit_patch",
      description: "Submit line-range edits for a thread. mitori applies them in an isolated worktree and runs gates; your files are not touched.",
      inputSchema: {
        type: "object",
        properties: {
          thread_id: {
            type: "string",
            pattern: "^th_[0-9a-z]{8}$",
          },
          edits: {
            type: "array",
            maxItems: 40,
            items: {
              type: "object",
              properties: {
                path: {
                  type: "string",
                },
                start: {
                  type: "integer",
                  minimum: 1,
                },
                end: {
                  type: "integer",
                  minimum: 0,
                },
                first_line: {
                  type: "string",
                },
                new_text: {
                  type: "string",
                },
                base: {
                  type: "string",
                },
              },
              required: ["path", "start", "first_line", "new_text"],
              additionalProperties: false,
            },
          },
          doc_update: {
            type: ["string", "null"],
          },
        },
        required: ["thread_id", "edits"],
        additionalProperties: false,
      },
      annotations: {
        readOnlyHint: false,
      },
    },
    {
      name: "mitori_propose_resolution",
      description: "Propose resolving a thread; a human confirms in the mitori UI.",
      inputSchema: {
        type: "object",
        properties: {
          thread_id: {
            type: "string",
            pattern: "^th_[0-9a-z]{8}$",
          },
          resolution: {
            type: "string",
            enum: ["applied", "answered", "wontfix", "duplicate", "obsolete", "needs_human"],
          },
          note: {
            type: "string",
            maxLength: 500,
          },
        },
        required: ["thread_id", "resolution"],
        additionalProperties: false,
      },
      annotations: {
        readOnlyHint: false,
      },
    },
  ],
} as const;
