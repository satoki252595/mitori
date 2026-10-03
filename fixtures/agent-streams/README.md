# fixtures/agent-streams/

Raw `claude -p --output-format stream-json` recordings, one scenario per file: `<scenario>.jsonl`
(e.g. `success-2turn.jsonl`, `sigint.jsonl`, `refusal.jsonl`, `rate-limit.jsonl`, `max-budget.jsonl`). Used by
the normalizer, scheduler and job-runner tests (WP-05, WP-08b) through the replay Spawner; secrets and
absolute home paths are scrubbed before commit. Event-shape drift: testing spec §8.4. Cassettes for gen/loop
(`mitori.cassette/1`) live in `fixtures/cassettes/<suite>/` (testing spec §3), not here.
