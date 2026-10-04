import { describe, expect, test } from "bun:test";
import { FORMAT } from "@mitori/core";
import type { ExportPayload } from "@mitori/doc";
import { MODE_CAPABILITIES, type ViewerPayload } from "../../apps/web/src/contract.ts";

/** Mutual assignability: `@mitori/doc` writes exactly what the viewer chunk reads (web contract §16). */
type Same<A, B> = [A] extends [B] ? ([B] extends [A] ? true : never) : never;
const writerIsReader: Same<ExportPayload, ViewerPayload> = true;
const _unused: [typeof writerIsReader] = [true];
void _unused;

describe("EXP-U-05 the exporter and the viewer agree on the payload", () => {
  test("format tag and the viewer's capabilities", () => {
    expect(FORMAT.export).toBe("mitori.export/1");
    const probe: ViewerPayload["format"] = FORMAT.export;
    expect(probe).toBe("mitori.export/1");
    // the viewer mode has no daemon-only features (the components hide controls instead of branching on mode)
    expect(MODE_CAPABILITIES.viewer).toMatchObject({ jobs: false, generate: false, settings: false, liveCitePeek: false, inbox: false });
  });
});
