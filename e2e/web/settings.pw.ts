/** @wp10a S9 settings (ux.md §2.2, §4.3.6 ⇧O, §8.5): changes are saved with one debounced PATCH /settings. */
import { expect, test } from "@playwright/test";
import { genericProviderPatch, MUSE_ARGS } from "../../apps/web/src/settings/provider.ts";
import { DEFAULTS, settings } from "./support/fixture.ts";
import { configure, mockLog, WS, waitMark } from "./support/helpers.ts";

test("@wp10a Muse setup keeps execution registration on the CLI and saves only model settings in the browser", async ({ page }) => {
  await configure({});
  const view = settings(DEFAULTS);
  const patch = genericProviderPatch({
    model: "generic:muse-spark-1.3-contributor",
    argv: JSON.stringify(["/nix/store/example/muse-bin", ...MUSE_ARGS]),
    reasoning: "max",
    protocol: "muse-jsonl",
    turnMs: 600_000,
    pricing: { inPerMTok: 0.1, outPerMTok: 0.2, cacheReadPerMTok: 0.002 },
  });
  await page.route("**/api/v1/settings", async (route) => {
    if (route.request().method() === "GET") await route.fulfill({ json: view });
    else await route.continue();
  });
  await page.goto(`/w/${WS}/settings`);
  await waitMark(page, "mitori:section:rendered");
  await page.getByText("詳細設定（独自CLI・API）", { exact: true }).click();
  await page.getByRole("button", { name: "Muse Spark 1.3 Contributor / maxを入力" }).click();
  await page.getByLabel("実行ファイルと引数（JSON配列）").fill(JSON.stringify(patch.engines?.generic?.argv));
  await page.getByRole("button", { name: "エンジン設定を保存" }).click();
  await expect(page.locator("details pre")).toContainText("bun run start -- config set engines.generic");
  expect((await mockLog()).filter((r) => r.method === "PATCH")).toHaveLength(0);
  Object.assign(view.settings.engines.generic, patch.engines?.generic);
  await page.getByRole("button", { name: "エンジン設定を保存" }).click();
  await expect.poll(async () => (await mockLog()).filter((r) => r.method === "PATCH").length).toBe(1);
  const saved = (await mockLog()).find((r) => r.method === "PATCH")?.body as { patch: Record<string, unknown> };
  expect(saved.patch.engines).toBeUndefined();
  expect(saved.patch.models).toEqual(patch.models);
  expect(saved.patch.reasoning).toEqual(patch.reasoning);
  expect(saved.patch.privacy).toBeUndefined();
});

test("@wp10a guided setup gives local and external commands without saving browser execution settings", async ({ page }) => {
  await configure({});
  await page.goto(`/w/${WS}/settings`);
  await waitMark(page, "mitori:section:rendered");
  await page.getByRole("combobox", { name: "使うAI", exact: true }).selectOption("ollama");
  await page.getByLabel("モデル名", { exact: true }).fill("qwen3:8b");
  await page.getByRole("button", { name: "接続コマンドを作る" }).click();
  await expect(page.locator("form pre").first()).toContainText("bun run start -- setup ollama --model 'qwen3:8b'");
  await page.getByRole("button", { name: "登録コマンドをコピー" }).click();
  expect((await mockLog()).filter((r) => r.method === "PATCH")).toHaveLength(0);
  await page.getByRole("combobox", { name: "使うAI", exact: true }).selectOption("cursor");
  await page.getByLabel("対象リポジトリのパス").fill("/repo/it's $(literal)");
  await page.getByRole("button", { name: "接続コマンドを作る" }).click();
  await expect(page.locator("form pre").first()).toContainText("bun run start -- setup cursor --repo '/repo/it'\\''s $(literal)'");
  expect((await mockLog()).filter((r) => r.method === "PATCH")).toHaveLength(0);
  await expect(page.locator("details")).not.toHaveAttribute("open");
});

test("@wp10a settings: editor (⇧O target) and single-key switch are saved in one debounced PATCH", async ({ page }) => {
  await configure({});
  await page.goto(`/w/${WS}/settings`);
  await waitMark(page, "mitori:section:rendered");
  await page.getByLabel("エディタ（⇧Oで開く）").selectOption("vscode");
  await page.getByLabel("1文字のショートカットを使う").uncheck();
  await expect.poll(async () => (await mockLog()).filter((r) => r.method === "PATCH" && r.path.endsWith("/settings")).length, { timeout: 4000 }).toBe(1);
  const patch = (await mockLog()).find((r) => r.method === "PATCH")?.body as { patch: { ui: Record<string, unknown> } };
  expect(patch.patch.ui).toEqual({ editor: "vscode", singleKeyShortcuts: false });
});
