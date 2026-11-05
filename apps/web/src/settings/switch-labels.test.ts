/** WP39c-1: the two model-switch save buttons have distinct labels (browsers e2e strict-mode fix). */
import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const dir = join(import.meta.dir, "../../i18n");
const webDir = join(import.meta.dir, "../../../..");
const ja = JSON.parse(readFileSync(join(dir, "settings.ja.json"), "utf8")) as Record<string, string>;
const en = JSON.parse(readFileSync(join(dir, "settings.en.json"), "utf8")) as Record<string, string>;
const page = readFileSync(join(import.meta.dir, "SettingsPage.svelte"), "utf8");
const e2e = readFileSync(join(webDir, "e2e/web/settings.pw.ts"), "utf8");

test("WP39c-1 model-switch save buttons have distinct labels in both languages", () => {
  for (const cat of [ja, en]) {
    const gen = cat["settings.modelSwitchSaveGen"];
    const answer = cat["settings.modelSwitchSaveAnswer"];
    expect(gen).toBeTruthy();
    expect(answer).toBeTruthy();
    expect(gen).not.toBe(cat["settings.providerSave"]);
    expect(answer).not.toBe(cat["settings.providerSave"]);
    expect(gen).not.toBe(answer);
  }
  expect(ja["settings.modelSwitchSaveGen"]).not.toBe(en["settings.modelSwitchSaveGen"]);
  expect(ja["settings.modelSwitchSaveAnswer"]).not.toBe(en["settings.modelSwitchSaveAnswer"]);
  // the guided model select stays findable by the optional label
  expect(ja["settings.quickModelOptional"]).toBeTruthy();
  expect(en["settings.quickModelOptional"]).toBeTruthy();
});

test("WP39d-1 model-switch lead reads as a screen sentence in both languages", () => {
  expect(ja["settings.modelSwitchLead"]).toBe(
    "設定済みのLLMの中から、生成と回答・修正のそれぞれでモデルと推論の強さを選べます。起動のしかたや単価は変わりません。",
  );
  expect(en["settings.modelSwitchLead"]).toBe(
    "Choose the model and reasoning effort for generation and for answers & fixes from your configured LLMs. Launch setup and pricing stay the same.",
  );
});

test("WP39d-2 model-switch groups are labelled groups for assistive tech and e2e", () => {
  for (const id of ["gen-switch-t", "answer-switch-t"]) {
    expect(page).toContain(`role="group" aria-labelledby="${id}"`);
    expect(page).toContain(`id="${id}"`);
  }
});

test("WP39d-3 settings e2e scopes the switch selects by group role, not div.group", () => {
  expect(e2e).toContain('getByRole("group"');
  expect(e2e).not.toContain("div.group");
});
