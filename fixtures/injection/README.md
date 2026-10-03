# fixtures/injection/

Red-team payloads keyed by the loop contract's `RED_TEAM_CASES` ids (RT-01…RT-33; ARCHITECTURE §7.5, loop spec
§12): `RT-<nn>-<slug>.<ext>` holds the hostile text/file for one case (fence breaking, fake system prompts,
instructions in comments, path traversal names, symlink plans …). The runnable `injection` fixture repo that
embeds them is `fixtures/repos/injection/` (WP-00b); expectations (0 out-of-scope writes, 0 secret leaks) are in
the RT table. Never put real credentials here — use obviously fake, well-formed values.
