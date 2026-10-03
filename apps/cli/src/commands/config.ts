/**
 * `mitori config set <path> <value>` — execution settings (`EXEC_SETTING_KEYS`: engines, limits, pins, security, …)
 * that the browser may not change (`PATCH /settings` refuses them, SEC-06). Shows current → new and asks on a TTY;
 * refused for agents (`E_TTY_REQUIRED`, exit 2). Everything else is changed in the settings screen.
 */
import { EXEC_SETTING_KEYS } from "@mitori/core";
import { parse } from "./args.ts";
import { helpLang } from "./help.ts";
import { type Io, usage } from "./io.ts";
import { connect, requireTty } from "./session.ts";

/** `<value>` as JSON when it parses (numbers, booleans, null, quoted strings, objects), else the raw string. */
export function parseValue(raw: string): unknown {
  try {
    return JSON.parse(raw);
  } catch {
    return raw;
  }
}

/** True when `path` is (under) one of the execution keys. */
export function isExecPath(path: string): boolean {
  return EXEC_SETTING_KEYS.some((k) => path === k || path.startsWith(`${k}.`));
}

function get(obj: unknown, path: string): unknown {
  let at: unknown = obj;
  for (const k of path.split(".")) at = at !== null && typeof at === "object" ? (at as Record<string, unknown>)[k] : undefined;
  return at;
}

export async function run(io: Io): Promise<number> {
  const { positionals } = parse(io.argv, {}, "config");
  const [verb, path, value, ...rest] = positionals;
  if (verb !== "set" || path === undefined || value === undefined || rest.length > 0)
    throw usage("usage: mitori config set <path> <value>", "mitori config --help");
  if (!/^[A-Za-z0-9_-]+(\.[A-Za-z0-9_-]+)*$/.test(path)) throw usage(`not a settings path: ${path}`);
  if (!isExecPath(path)) throw usage(`${path} is not an execution setting`, "change it in the settings screen (mitori open → 設定)");
  requireTty(io, "mitori config set");
  const lang = helpLang(io.env);
  const next = parseValue(value);
  const s = await connect(io);
  const cur = get((await s.api.call("GET /settings", { params: {} })).settings, path);
  io.err(`${path}: ${JSON.stringify(cur) ?? "(unset)"} → ${JSON.stringify(next)}\n`);
  if (!(await io.confirm(lang === "ja" ? "変更しますか？" : "Apply?"))) return 1;
  const view = await s.api.call("PATCH /settings/exec", { params: {}, body: { path, value: next, confirm: true } });
  io.out(`ok ${path} = ${JSON.stringify(get(view.settings, path))}\n`);
  return 0;
}
