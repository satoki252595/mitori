import { afterAll, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { t } from "./i18n.ts";

const root = mkdtempSync(join(tmpdir(), "mitori-e2e-i18n-"));
afterAll(() => rmSync(root, { recursive: true, force: true }));
mkdirSync(join(root, "apps/web/src/i18n"), { recursive: true });
writeFileSync(
  join(root, "apps/web/src/i18n/ja.json"),
  JSON.stringify({ "composer.send": "送信", "inbox.count.other": "{count} 件", "job.title": "{name} を修正" }),
);
writeFileSync(
  join(root, "apps/web/src/i18n/en.json"),
  JSON.stringify({ "composer.send": "Send", "inbox.count.one": "{count} item", "inbox.count.other": "{count} items" }),
);

describe("E2EH-U-04 t(key) for selectors (testing spec §5.1)", () => {
  test("looks keys up in the web catalog and fills {params}", () => {
    expect(t("composer.send", {}, "ja", root)).toBe("送信");
    expect(t("composer.send", {}, "en", root)).toBe("Send");
    expect(t("job.title", { name: "fetch.go" }, "ja", root)).toBe("fetch.go を修正");
  });

  test("count selects the plural form: ja always .other, en by plural rules", () => {
    expect(t("inbox.count", { count: 1 }, "ja", root)).toBe("1 件");
    expect(t("inbox.count", { count: 1 }, "en", root)).toBe("1 item");
    expect(t("inbox.count", { count: 3 }, "en", root)).toBe("3 items");
  });

  test("a missing key or parameter throws instead of matching nothing", () => {
    expect(() => t("composer.nope", {}, "ja", root)).toThrow('no key "composer.nope"');
    expect(() => t("job.title", {}, "ja", root)).toThrow("{name}");
  });
});
