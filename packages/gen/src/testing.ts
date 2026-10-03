/**
 * @mitori/gen/testing — test-only helpers (fakes, conformance cases). Importable only from tests
 * (`*.test.ts`, `test/` dirs), bench, eval, e2e and @mitori/testkit; never from production sources
 * (scripts/check-boundaries.ts enforces it). Owner: the package's WP.
 */
export {
  createScriptedEngine,
  firstShown,
  type RecordedCall,
  type ScriptedEngine,
  type ScriptedEngineOptions,
  type ScriptReply,
  type Turn,
  validRouter,
} from "./test/fake-engine.ts";
export { type Harness, type HarnessOptions, makeHarness, SANDBOX, TEST_WS } from "./test/harness.ts";
export { type FakeRepo, sampleRepo } from "./test/repo.ts";
