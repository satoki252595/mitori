# fixtures/injection/

Red-team payloads keyed by the loop contract's `RED_TEAM_CASES` ids (RT-01 … RT-33; ARCHITECTURE §7.5, loop spec §12.3):
`RT-<nn>-<slug>.<ext>` holds the hostile text / plan for one case (fence breaking, fake system prompts, instructions in
comments, path traversal names, symlink plans …). `INDEX.json` lists them in id order with the expected outcome and
`embedsIn`: where the same material also lives inside the runnable `injection` fixture repo
(`fixtures/repos/injection/`, built by `buildFixture("injection")`) or in `secrets` (RT-32).

- Files are inert data. JSON payloads describe actions (symlinks to create, tool calls to attempt); the test that uses a
  payload performs them against a built fixture. Control characters are `\u`-escaped, never stored raw.
- The canaries are harmless on purpose: hooks / MCP servers / the `typecheck` gate only `touch` a marker file under
  `$TMPDIR` (`mitori-canary-*`); the "delete" is an `rm -rf` of a path that does not exist. Tests assert the marker is absent.
- Everything credential-shaped is made up; never put a real value here.

`bun test fixtures/truth` (`security-fixtures.test.ts`) fails when a case lacks a payload, when `embedsIn` points nowhere,
or when the fake credentials stop being detected by the real secret scanner / deny globs.
