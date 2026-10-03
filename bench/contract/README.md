# bench/contract — contract tests against the real `claude` CLI (WP-05)

Runs on the **maintainer machine / self-hosted runner only** (ADR-0005 R1, SEC-15): never on `pull_request`.
Every case goes through the real `buildClaudeSpawn`, the real claude-cli engine + scheduler + ledger (`createAgentBridge`),
and a Bun spawner (`lib.ts`; switch to `@mitori/platform`'s Spawner when WP-01 lands — `CR-PENDING(WP-05)`).

```sh
scripts/nd bun run contract-test                         # $0 cases only (version/auth, --help flags, --bare, CC-09 control)
scripts/nd bun bench/contract/run.ts --live              # + paid cases (claude-haiku-4-5), cap --max-usd 0.05
scripts/nd bun bench/contract/run.ts --live --only CC-12 # one group; partial runs accumulate in results/<day>-<cli>.json
scripts/nd bun bench/contract/run.ts --live --record     # also rewrite fixtures/agent-streams/*.jsonl (scrubbed)
scripts/nd bun bench/contract/run.ts --suite watch       # CT-15 page hash watch ($0); --suite all = claude + watch
```

- Cost guard: each paid group has an upper-bound estimate (`CASE_USD` in `run.ts`) and starts only if it fits the cap.
  A full `--live` run costs ≈ $0.05 API-equivalent on haiku (subscription usage). Use `--model claude-sonnet-5-5` only on
  purpose (CT-08 on sonnet).
- Output: `results/<YYYYMMDD>-<cliver>.json` (`mitori.contract-result/1`); a full green `--live` run updates `last-pass.json`
  (`TESTED_CLI_VERSIONS`). `claude-help.snapshot.txt` is the `--help` text of the last run (CC-02 warns on drift).
- Event shapes: `schemas/claude/*.schema.json` (testing spec §8.4; required fields red, unknown types yellow).
- Recordings: `fixtures/agent-streams/*.jsonl` — absolute paths → `$TMP`/`$HOME`, thinking signatures (they embed
  account ids) and socket paths removed. `*.synthetic.jsonl` are hand-made until the real event is observed
  (429: replace when CC-23 sees one; refusal: O5/CT-12). A `{"type":"mitori_marker","event":"sigint"}` line marks where
  the runner sent SIGINT. `packages/agent/test/golden/agent-streams/` holds their JobEvent goldens (AGT-G-020;
  `MITORI_UPDATE_GOLDEN=1` rewrites).

## CT (loop spec §6.13) ↔ CC (testing spec §8.2)

| CT | what | CC | status |
|---|---|---|---|
| CT-01 | `--help` flags / forbidden flags | CC-02, CC-22 | implemented ($0) |
| CT-02 | `--system-prompt-file` honoured | CC-06 | implemented |
| CT-03 | canaries in cwd/worktree inert, init lean | CC-03 (cwd), CC-12 (worktree), CC-04 (control) | implemented |
| CT-04 | fake `ANTHROPIC_API_KEY` scrubbed | CC-08, CC-09 (control, $0) | implemented |
| CT-05 | agent `Edit(//abs)` permissions | CC-12 | implemented |
| CT-06 | stream-json multi-turn + `--json-schema` | CC-17, CC-21 | implemented (engine parking) |
| CT-07 | partial usage on message_start/delta | CC-14, CC-20 | implemented |
| CT-08 | lean overhead ≤ 1.0k / ≤ 4.5k | CC-20 | implemented (haiku by default) |
| CT-09 | SIGINT yields a result within 8 s | CC-16 | implemented — the result's usage is zero, see cr-requests/WP-05.md B1 |
| CT-10 | warm process idles with 0 calls, RSS | — | not implemented (warm pool is stretch, default 0) |
| CT-11 | `--max-budget-usd` overshoot | CC-15 | implemented |
| CT-12 | refusal shape (O5) | — | not implemented (no safe known trigger); `refusal.synthetic.jsonl` |
| CT-13 | `--effort low` on haiku | CC-10 (model) | effort acceptance is implicit in every haiku case |
| CT-14 | `rate_limit_event.five_hour` | CC-23 | implemented |
| CT-15 | billing/legal page hash watch | `--suite watch` (§8.5) | implemented: the `<article>`/`<main>` text of 4 pages, sha256 in `watch.json`; a change is yellow with a line diff (snapshots in `~/.cache/mitori-contract/watch/`, not committed); a person files the issue |
| — | CC-05 stdin only, CC-07 no session file, CC-13 stdin closed, CC-24 cache TTL 5m | | implemented |
| — | CC-18 `--resume` (writes the user's session store), CC-19 cache health (sonnet) | | not implemented |

Invariant ↔ CT links are data in `CLAUDE_CLI_INVARIANTS[].ct` (copied into every result file).
