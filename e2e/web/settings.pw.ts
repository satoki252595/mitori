/** @wp10a S9 settings (ux.md §2.2, §4.3.6 ⇧O, §8.5): changes are saved with one debounced PATCH /settings. */
import { expect, test } from "@playwright/test";
import { genericProviderPatch, MUSE_ARGS } from "../../apps/web/src/settings/provider.ts";
import { DEFAULTS, settings } from "./support/fixture.ts";
import { configure, mockLog, WS, waitMark } from "./support/helpers.ts";

test("@wp10a official sign-in is an explicit click and Grok defaults to the subscription session", async ({ page }) => {
  await configure({});
  const view = structuredClone(settings(DEFAULTS));
  await page.route("**/api/v1/settings", async (route) => {
    if (route.request().method() === "GET") await route.fulfill({ json: view });
    else await route.continue();
  });
  const requests: unknown[] = [];
  await page.route("**/api/v1/settings/provider-login", async (route) => {
    requests.push(route.request().postDataJSON());
    await route.fulfill({ json: { opened: requests.length === 1 } });
  });
  await page.goto(`/w/${WS}/settings`);
  await waitMark(page, "mitori:section:rendered");
  expect(requests).toHaveLength(0);
  await page.getByRole("button", { name: "公式Claude Codeにログイン", exact: true }).click();
  await expect(page.getByRole("status").filter({ hasText: "認証用のターミナルを開きました" })).toBeVisible();
  expect(requests).toEqual([{ provider: "claude" }]);
  await page.getByRole("combobox", { name: "使うAI", exact: true }).selectOption("grok");
  await expect(page.getByLabel("接続先URL（/v1）").first()).not.toBeVisible();
  await page.getByRole("button", { name: "公式Grok Buildにログイン", exact: true }).click();
  await expect(page.locator("form pre").first()).toContainText("auth grok");
  expect(requests).toEqual([{ provider: "claude" }, { provider: "grok" }]);
  await page.getByRole("button", { name: "接続コマンドを作る" }).click();
  await expect(page.locator("form pre").last()).toContainText("setup grok --repo");
  // An external session retains old direct-engine model settings; those must not replace the selected tool.
  view.settings.defaultGenEngine = "session";
  view.settings.models.genModule = "generic:muse-spark-1.3-contributor";
  await page.getByRole("button", { name: "設定を再読み込み", exact: true }).click();
  await expect(page.getByRole("combobox", { name: "使うAI", exact: true })).toHaveValue("grok");
  await page.getByLabel("APIキーで接続する（料金と利用枠を別途確認）").check();
  await expect(page.getByLabel("接続先URL（/v1）").first()).toBeVisible();
  await expect(page.getByRole("button", { name: "公式Grok Buildにログイン", exact: true })).not.toBeVisible();
  await page.getByRole("button", { name: "接続コマンドを作る" }).click();
  await expect(page.locator("form pre").first()).toContainText("setup grok --api");
  await page.getByRole("combobox", { name: "使うAI", exact: true }).selectOption("ollama");
  await expect(page.getByText(/ローカルモデルはログイン不要です/)).toBeVisible();
  await page.getByRole("combobox", { name: "使うAI", exact: true }).selectOption("antigravity");
  await expect(page.getByRole("link", { name: "公式ログイン手順を開く" })).toHaveAttribute("href", "https://antigravity.google/docs/cli/install/");
  expect(requests).toHaveLength(2);
});

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

test("@wp10a Codex guided setup defaults to bounded native execution and retains the external MCP choice", async ({ page }) => {
  await configure({});
  const view = structuredClone(settings(DEFAULTS));
  await page.route("**/api/v1/settings", async (route) => {
    if (route.request().method() === "GET") await route.fulfill({ json: view });
    else await route.continue();
  });
  await page.goto(`/w/${WS}/settings`);
  await waitMark(page, "mitori:section:rendered");
  await page.getByRole("combobox", { name: "使うAI", exact: true }).selectOption("codex");
  const native = page.getByLabel("mitoriの画面から直接実行する");
  await expect(native).toBeChecked();
  await expect(page.getByLabel("モデル名（任意）", { exact: true })).toHaveValue("gpt-6.1-sol");
  await expect(page.getByLabel("1ターンのAPI換算推計上限（USD）")).toHaveValue("1");
  await page.getByRole("button", { name: "接続コマンドを作る" }).click();
  await expect(page.locator("form pre").first()).toContainText("setup codex --native --max-estimated-usd '1' --model 'gpt-6.1-sol'");
  await native.uncheck();
  await page.getByLabel("対象リポジトリのパス").fill("/repo/example");
  await page.getByRole("button", { name: "接続コマンドを作る" }).click();
  await expect(page.locator("form pre").first()).toContainText("setup codex --repo '/repo/example'");
  await expect(page.locator("form pre").first()).not.toContainText("--native");
  await page.getByText("詳細設定（独自CLI・API）", { exact: true }).click();
  const advanced = page.getByRole("combobox", { name: "生成の既定エンジン", exact: true });
  await expect(advanced.locator('option[value="codex-cli"]')).toHaveCount(0);
  view.settings.defaultGenEngine = "codex-cli";
  view.settings.engines["codex-cli"].enabled = true;
  view.settings.engines["codex-cli"].maxEstimatedSpendUsd = 1;
  await page.getByRole("button", { name: "設定を再読み込み", exact: true }).click();
  await expect(advanced).toHaveValue("codex-cli");
  await expect(advanced.locator('option[value="codex-cli"]')).toHaveJSProperty("disabled", true);
  await expect(page.getByText("Codexのモデルと実行設定は、上の「使うAI」でCodexを選び、接続コマンドから設定してください。", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "エンジン設定を保存", exact: true })).toBeDisabled();
  expect((await mockLog()).filter((r) => r.method === "PATCH")).toHaveLength(0);
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
