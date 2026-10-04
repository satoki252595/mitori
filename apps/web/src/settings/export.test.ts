/** ux.md §4.13 export dialog helpers: the download name and the size label. */
import { describe, expect, test } from "bun:test";
import { exportFileName, fmtBytes } from "./export.ts";

describe("export dialog", () => {
  const at = new Date(2026, 9, 4, 12, 0, 0);
  test("file name: the doc title made safe, the tool and the date", () => {
    expect(exportFileName("m3e-canvas", at)).toBe("m3e-canvas-mitori-2026-10-04.html");
    expect(exportFileName('a/b:c*d?"e<f>|g', at)).toBe("a-b-c-d-e-f-g-mitori-2026-10-04.html");
    expect(exportFileName("見取り図 の 設計書", at)).toBe("見取り図-の-設計書-mitori-2026-10-04.html");
    expect(exportFileName("../..", at)).toBe("mitori-mitori-2026-10-04.html");
  });
  test("sizes in decimal units", () => {
    expect(fmtBytes(920)).toBe("920 B");
    expect(fmtBytes(4_200)).toBe("4.2 KB");
    expect(fmtBytes(412_000)).toBe("412 KB");
    expect(fmtBytes(1_580_000)).toBe("1.58 MB");
  });
});
