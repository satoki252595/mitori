# WP-00a — contract change requests (found by the M0 verification, round 1)

## `@mitori/client` has no contract of its own
- contract: `apps/web/src/contract.ts` §5 — `ApiClient`, `SseClient`, `ConnectionState`, `EntityKey`; `packages/client/src/{http,sse}/index.ts` (empty, 0 exports in `briefs/INDEX.md`)
- change: move these four types to a new `packages/client/src/contract.ts` (re-exported by the web contract under the same
  names, like CR m0-1 / m0-2) and declare the two factories as M0 stubs, e.g.
  ```ts
  export declare function createApiClient(opts: { base: string; token: () => string | null; fetch?: typeof fetch }): ApiClient;
  export declare function createSseClient(opts: { base: string; token: () => string | null; fetch?: typeof fetch }): SseClient;
  ```
  (option names are a proposal; the architect fixes them).
- why: ui.ts says the API client "lives in `@mitori/client`; shared with CLI and MCP shim", but the M0 move put the
  interfaces in the web contract. `PACKAGE_DEPS` lets client import only core and cli import core/platform/client/server,
  so neither WP-09 (implementer) nor WP-11 (CLI, MCP shim) can name the type they implement / consume, and any export
  WP-09 adds changes `briefs/INDEX.md` (= a contract change) without a declared shape to match.
- workaround in place: none yet. Until applied, WP-09 can implement a structurally compatible object and WP-10a can
  assert it at the use site (`const api: ApiClient = createApiClient(...)`).
- urgency: blocks WP-09 / WP-10a agreeing on the client surface (M1); nice to settle before the first CR batch.
