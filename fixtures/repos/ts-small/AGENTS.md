# AGENTS.md

Guidance for coding agents working on tsundoku-web.

## Commands

- `bun test` — unit tests (they must not touch the network)
- `bun run typecheck` — `tsc --noEmit`
- `bun run lint` / `bun run format`

## Conventions

- TypeScript strict; import in-repo modules with the `@app/*` alias or relative paths with the `.ts` extension.
- `src/db/repo.ts` and `src/services/metadata.ts` stay dependency-free: the tests import them without installing anything.
- Do not edit `src/generated/` or `dist/`; they are build output.
- A failed metadata lookup is retried exactly once (`MAX_RETRIES`).
