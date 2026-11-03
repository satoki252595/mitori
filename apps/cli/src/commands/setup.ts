/** One confirmed terminal command configures an existing provider; it never installs tools or calls a model. */
import { existsSync, readFileSync, realpathSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import type { DeepPartial, GlobalSettings } from "@mitori/core";
import { oneOf, parse } from "./args.ts";
import { helpLang } from "./help.ts";
import { type Io, usage } from "./io.ts";
import { selfCommand } from "./process-io.ts";
import { connect, requireTty } from "./session.ts";
import { integrationSetup } from "./setup-integrations.ts";
import { prepareProviderPin } from "./setup-pin.ts";
import { listModelsTable, PROVIDERS, type Provider, SESSION_PROVIDERS, setupPatch } from "./setup-presets.ts";

export function binaryOf(provider: Provider, explicit?: string, opts: { cli?: boolean; path?: string } = {}): string | undefined {
  if (provider !== "claude" && provider !== "muse" && provider !== "codex" && !(provider === "grok" && opts.cli) && !(provider === "antigravity" && opts.cli))
    return undefined;
  // the Antigravity CLI executable is `agy`, not `antigravity` (host 2026-11-04: ~/.local/bin/agy)
  const command = provider === "antigravity" ? "agy" : provider;
  // PATH comes from the caller so tests can point at a fixture dir (bare Bun.which ignores a reassigned process.env.PATH)
  const found = explicit ? resolve(explicit) : opts.path === undefined ? Bun.which(command) : Bun.which(command, { PATH: opts.path });
  if (!found) throw usage(`${command} is not on PATH; use --binary /absolute/path or install/login with its official instructions`);
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
      native: { type: "boolean" },
      "max-estimated-usd": { type: "string" },
      cli: { type: "boolean" },
      "list-models": { type: "boolean" },
    },
    "setup",
  );
  const provider = oneOf(positionals[0], PROVIDERS, "provider", "setup");
  if (!provider || positionals.length !== 1) throw usage(`choose ${PROVIDERS.join(" | ")}`, "mitori setup --help");
  if (values["list-models"] === true) {
    io.out(listModelsTable(provider, { api: values.api === true, cli: values.cli === true }, helpLang(io.env)));
    return 0;
  }
  const preview = values.print === true;
  if (!preview) requireTty(io, "mitori setup");
  if (values.api && provider !== "grok") throw usage("--api is only needed to select Grok API instead of its official Build session");
  if (values.cli && provider !== "grok" && provider !== "antigravity")
    throw usage("--cli is only needed to select the Grok Build CLI or Antigravity CLI engine instead of its session");
  if (values.api && values.cli) throw usage("--api and --cli cannot be combined");
  if (values.native && provider !== "codex") throw usage("--native is supported for Codex only");
  if (values["max-estimated-usd"] !== undefined && !values.native) throw usage("--max-estimated-usd requires Codex --native");
  if (
    provider === "grok" &&
    !values.api &&
    !values.cli &&
    [values.model, values["base-url"], values["key-env"], values["in-price"], values["out-price"]].some((v) => v !== undefined)
  )
    throw usage("Grok Build uses its own model and subscription; add --api for explicit API settings or --cli for the CLI engine");
  if (values["key-env"] && !/^[A-Za-z_][A-Za-z0-9_]{0,127}$/.test(values["key-env"])) throw usage("--key-env names an environment variable, not a key");
  if ((values["in-price"] === undefined) !== (values["out-price"] === undefined)) throw usage("provide both --in-price and --out-price");
  const binary =
    provider === "codex" && !values.native
      ? undefined
      : binaryOf(provider, values.binary, {
          cli: values.cli === true,
          ...(typeof io.env.PATH === "string" ? { path: io.env.PATH } : {}),
        });
  const effort = oneOf(values.effort, ["low", "medium", "high", "xhigh", "max"] as const, "effort", "setup");
  const patch = setupPatch({
    provider,
    api: values.api === true,
    native: values.native === true,
    cli: values.cli === true,
    ...(values["max-estimated-usd"] !== undefined ? { maxEstimatedUsd: Number(values["max-estimated-usd"]) } : {}),
    ...(binary ? { binary } : {}),
    ...(values.model ? { model: values.model } : {}),
    ...(values["base-url"] ? { baseUrl: values["base-url"] } : {}),
    ...(values["key-env"] ? { keyEnv: values["key-env"] } : {}),
    ...(effort ? { effort } : {}),
    ...(values["in-price"] !== undefined
      ? { pricing: { inPerMTok: Number(values["in-price"]), outPerMTok: Number(values["out-price"]), cacheReadPerMTok: Number(values["in-price"]) } }
      : {}),
  });
  if (!preview && binary) {
    if (provider === "claude") patch.pins = { claude: await prepareProviderPin(binary, io, "Claude") };
    if (provider === "codex" && values.native) patch.pins = { codex: await prepareProviderPin(binary, io, "Codex") };
    if (provider === "grok" && values.cli) patch.pins = { grok: await prepareProviderPin(binary, io, "Grok") };
    if (provider === "antigravity" && values.cli) patch.pins = { agy: await prepareProviderPin(binary, io, "Antigravity") };
  }
  // WP36h: grok reasons for 10+ minutes per task on medium+ (host-measured); warn but do not stop.
  if (provider === "grok" && values.cli === true && (effort ?? "low") !== "low")
    io.err("Grok の medium 以上の effort は生成が非常に長くなります（1タスク 10 分以上）。\n");
  let instructions = "";
  if (SESSION_PROVIDERS.has(provider) && !values.api && !values.native && !values.cli) {
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
  let execSaved = false;
  try {
    for (const [key, value] of Object.entries(patch.pins ?? {}))
      await s.api.call("PATCH /settings/exec", { params: {}, body: { path: `pins.${key}`, value, confirm: true } });
    for (const [key, value] of Object.entries(patch.engines ?? {}))
      await s.api.call("PATCH /settings/exec", { params: {}, body: { path: `engines.${key}`, value, confirm: true } });
    execSaved = true;
    const regular: DeepPartial<GlobalSettings> = { ...patch };
    delete regular.engines;
    delete regular.pins;
    const current = await s.api.call("GET /settings", { params: {} });
    await s.api.call("PATCH /settings", { params: {}, body: { version: current.version, patch: regular } });
  } catch (e) {
    io.err(
      execSaved
        ? "エンジンの実行ファイルは保存済みですが、モデルの割り当ては未保存です。同じコマンドを再実行すれば揃います。\n"
        : "設定の保存が途中で止まりました。同じコマンドを再実行すれば続きから揃います。\n",
    );
    throw e;
  }
  io.out("保存しました。ブラウザの設定を再読み込みしてください。モデルの呼び出しは行っていません。\n");
  if (provider === "grok" && values.api)
    io.out("GrokにはXAI_API_KEY（または指定した環境変数）が必要です。既存daemonは環境を引き継ぎません。キーを設定したターミナルから再起動してください。\n");
  if (provider === "muse") io.out("Museの認証とlean起動条件を確認してください。新しいnativeバージョンは実検証記録と区別してください。\n");
  if (provider === "codex" && values.native)
    io.out("Codexのサブスク認証を使います。表示額はAPI換算の推計で、native reasoningの厳密な費用上限ではありません。\n");
  if (provider === "grok" && values.cli)
    io.out("Grok Build CLIを使います。未ログインなら端末で `grok login` を実行してください。単発のテキスト生成のみで、agent/patchやツール実行は行いません。\n");
  if (provider === "antigravity" && values.cli)
    io.out(
      "Antigravity CLIを使います。未ログインなら `mitori auth antigravity` の案内に従ってサインインしてください。単発のテキスト生成のみで、agent/patchやツール実行は行いません。\n",
    );
  if (instructions) io.out(instructions);
  return 0;
}
