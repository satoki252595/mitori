/** One confirmed terminal command configures an existing provider; it never installs tools or calls a model. */
import { existsSync, readFileSync, realpathSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import type { DeepPartial, GlobalSettings } from "@mitori/core";
import { oneOf, parse } from "./args.ts";
import { type Io, usage } from "./io.ts";
import { selfCommand } from "./process-io.ts";
import { connect, requireTty } from "./session.ts";
import { integrationSetup } from "./setup-integrations.ts";
import { prepareClaudePin } from "./setup-pin.ts";
import { PROVIDERS, type Provider, SESSION_PROVIDERS, setupPatch } from "./setup-presets.ts";

export function binaryOf(provider: Provider, explicit?: string): string | undefined {
  if (provider !== "claude" && provider !== "muse") return undefined;
  const found = explicit ? resolve(explicit) : Bun.which(provider);
  if (!found) throw usage(`${provider} is not on PATH; use --binary /absolute/path or install/login with its official instructions`);
  let binary = realpathSync(found);
  if (provider === "muse" && !/\/muse-bin(?:-[^/]+)?$/.test(binary)) {
    const marker = join(dirname(binary), ".muse-version");
    const version = existsSync(marker) ? readFileSync(marker, "utf8").trim() : "";
    if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,100}$/.test(version)) throw usage("Muse native binary was not found; use --binary /absolute/path/muse-bin-version");
    binary = join(dirname(binary), `muse-bin-${version}`);
  }
  if (!statSync(binary).isFile()) throw usage("the provider binary is not a regular file");
  return binary;
}

export async function run(io: Io): Promise<number> {
  const { values, positionals } = parse(
    io.argv,
    {
      model: { type: "string" },
      binary: { type: "string" },
      "base-url": { type: "string" },
      "key-env": { type: "string" },
      effort: { type: "string" },
      "in-price": { type: "string" },
      "out-price": { type: "string" },
      repo: { type: "string" },
      print: { type: "boolean" },
      api: { type: "boolean" },
    },
    "setup",
  );
  const provider = oneOf(positionals[0], PROVIDERS, "provider", "setup");
  if (!provider || positionals.length !== 1) throw usage(`choose ${PROVIDERS.join(" | ")}`, "mitori setup --help");
  const preview = values.print === true;
  if (!preview) requireTty(io, "mitori setup");
  if (values.api && provider !== "grok") throw usage("--api is only needed to select Grok API instead of its official Build session");
  if (
    provider === "grok" &&
    !values.api &&
    [values.model, values["base-url"], values["key-env"], values["in-price"], values["out-price"]].some((v) => v !== undefined)
  )
    throw usage("Grok Build uses its own model and subscription; add --api for explicit API settings");
  if (values["key-env"] && !/^[A-Za-z_][A-Za-z0-9_]{0,127}$/.test(values["key-env"])) throw usage("--key-env names an environment variable, not a key");
  if ((values["in-price"] === undefined) !== (values["out-price"] === undefined)) throw usage("provide both --in-price and --out-price");
  const binary = binaryOf(provider, values.binary);
  const effort = oneOf(values.effort, ["low", "medium", "high", "xhigh", "max"] as const, "effort", "setup");
  const patch = setupPatch({
    provider,
    api: values.api === true,
    ...(binary ? { binary } : {}),
    ...(values.model ? { model: values.model } : {}),
    ...(values["base-url"] ? { baseUrl: values["base-url"] } : {}),
    ...(values["key-env"] ? { keyEnv: values["key-env"] } : {}),
    ...(effort ? { effort } : {}),
    ...(values["in-price"] !== undefined
      ? { pricing: { inPerMTok: Number(values["in-price"]), outPerMTok: Number(values["out-price"]), cacheReadPerMTok: Number(values["in-price"]) } }
      : {}),
  });
  if (provider === "claude" && !preview && binary) patch.pins = { claude: await prepareClaudePin(binary, io) };
  let instructions = "";
  if (SESSION_PROVIDERS.has(provider) && !values.api) {
    if (!values.repo) throw usage("external sessions need --repo /absolute/path/to/your/repository");
    const workspace = realpathSync(resolve(io.cwd, values.repo));
    if (!statSync(workspace).isDirectory()) throw usage("--repo must name a directory");
    const [command, ...args] = selfCommand();
    instructions = integrationSetup(provider as "codex" | "cursor" | "antigravity" | "grok", { command, args, workspace });
  }
  io.out(`${JSON.stringify(patch, null, 2)}\n`);
  if (preview) {
    if (instructions) io.out(instructions);
    return 0;
  }
  if (!(await io.confirm("このLLM設定を保存しますか？ / Save this provider?"))) return 1;
  const s = await connect(io);
  if (patch.pins?.claude) await s.api.call("PATCH /settings/exec", { params: {}, body: { path: "pins.claude", value: patch.pins.claude, confirm: true } });
  for (const [key, value] of Object.entries(patch.engines ?? {}))
    await s.api.call("PATCH /settings/exec", { params: {}, body: { path: `engines.${key}`, value, confirm: true } });
  const regular: DeepPartial<GlobalSettings> = { ...patch };
  delete regular.engines;
  delete regular.pins;
  const current = await s.api.call("GET /settings", { params: {} });
  await s.api.call("PATCH /settings", { params: {}, body: { version: current.version, patch: regular } });
  io.out("保存しました。ブラウザの設定を再読み込みしてください。モデルの呼び出しは行っていません。\n");
  if (provider === "grok" && values.api)
    io.out("GrokにはXAI_API_KEY（または指定した環境変数）が必要です。既存daemonは環境を引き継ぎません。キーを設定したターミナルから再起動してください。\n");
  if (provider === "muse") io.out("Museの認証とlean起動条件を確認してください。新しいnativeバージョンは実検証記録と区別してください。\n");
  if (instructions) io.out(instructions);
  return 0;
}
