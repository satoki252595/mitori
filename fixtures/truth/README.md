# fixtures/truth/

`<name>.json` = hand-written ground truth (`mitori.fixture-truth/1`, testkit `FixtureTruth`) for the fixture
`fixtures/repos/<name>/`: file classes, facts (+ `forbiddenFacts` traps), key symbols, every in-repo import edge,
cross-file calls (graded by `tolerances`) and module together/apart constraints. Scoring rules: testing spec §2.4,
implemented by `scoreIndex` (`packages/testkit/src/fixtures/score.ts`). Write truth from the source, never from indexer
output (golden files freeze output; truth decides correctness).

`bun test fixtures/truth` checks the truth against the fixture trees (paths exist, lines in range and pointing at the
named thing, keys unique, exhaustive file lists complete) and `security-fixtures.test.ts` checks that the red-team /
secret fixtures really contain what the RT cases need. That proves the truth is *consistent*, not *right*.

## Conventions

- **What is described**: the tip of the `fixture.json` history (what `buildFixture(name)` returns). `fixtures/repos/<name>/`
  is step 0; only go-small has later steps (retry, pagination). `dirty` / untracked content is not part of the truth.
- **Fact keys** (what `factKey()` derives from an indexer `Fact`):

| kind | `key` | `attrs` compared |
|---|---|---|
| route | `METHOD pattern` as written (`ANY` when no method; router prefixes only as `stretch`) | `framework` |
| env | variable name | `hasDefault` (default literal in the same expression) |
| cli | `prog subcommand` | `flags` (as written, order ignored), `framework` |
| schema | `source:entity` (`drizzle:books`, `sql:tags`, `prisma:Book`) | `fields` (DB column names / attribute names) |
| entry | `flavor:label` (`main:src/index.ts`, `bin:tsundoku`, `procfile:web`) — `path` is **not** compared | — |
| script | script / target name | `purpose` |
| test | test name as written | — |
| dependency | `ecosystem:name` | `dev` |
| existing_doc | role (`readme`, `agents`, `claude`, `adr`, `contributing`, `architecture`, `other`) | `title` (first heading) |
| todo | marker (`TODO`, `FIXME`, `XXX`) | — |
| config | not graded | — |

- `line` is present only where the defining statement is a single unambiguous line (no decorators, no multi-line
  expressions); then it is compared. `attrs` listed in the truth must match; extra actual attributes are ignored.
- `stretch: true` = reported, never required: it absorbs an actual fact with the same `path` + `key`, whatever its attrs.
- `forbiddenFacts` are traps (comments, strings, test code, deny-globbed files that look like facts). A hit is listed in
  `TruthScore.unexpected` with a `!` prefix. With `line` it only matches that line.
- **Symbols** are an excerpt. `start` is the line of the declaration keyword; decorators, attributes (`#[derive]`) and doc
  comments are not part of the range. Decorated Python symbols and paths containing `#` are not listed (ambiguous).
  Methods are `Type.method` (Go: receiver type, Rust: the `impl` target); a Rust impl block is
  `impl Trait for Type`.
- **Files**: `filesExhaustive: true` means every file of the materialized tree is listed (the test enforces it). Paths are
  NFC. `lang` is by extension, also for excluded files. Class / excluded follow indexer spec §2.3 rule order (R00–R20).
- **Imports** are file → file, resolved in-repo edges only, exhaustive. Go and Rust expand a package/module import to all its
  non-test, non-`//go:build ignore` files.
- **Calls** are graded at file level against `graph("file")` ref/call edges whose source file appears in the truth.

Spec conflicts that had to be decided are listed in `docs/design/cr-requests/WP-00b.md` (section A).
