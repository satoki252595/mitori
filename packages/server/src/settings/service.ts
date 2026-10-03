/**
 * Global settings file service (server spec §6): `~/.mitori/config.json` is sparse (only values that differ from
 * {@link DEFAULT_GLOBAL_SETTINGS}), schema-validated (unknown keys ⇒ `E_CFG_INVALID`), written through SafeWriter
 * (kind `home`), versioned for optimistic concurrency, and re-read when a human edits it.
 */
import {
  EXEC_SETTING_KEYS,
  type FsReader,
  type GlobalSettings,
  type Logger,
  MitoriError,
  type MitoriErrorData,
  type SafeWriter,
  type SettingsView,
  type SseEventPayload,
  toErrorData,
  type WorkspaceKey,
  type WorkspaceOverrides,
} from "@mitori/core";
import { checkSettingsPatch, DEFAULT_GLOBAL_SETTINGS } from "./index.ts";
import { deepMerge, diffFrom, isPlainObject, patchAt } from "./merge.ts";
import { GLOBAL_SPEC, OVERRIDES_SPEC, validate } from "./schema.ts";

export const CONFIG_FILE = "config.json";

export interface SettingsService {
  /** Absolute config path. */
  readonly path: string;
  current(): GlobalSettings;
  view(): SettingsView;
  /** `PATCH /settings` (web): EXEC_SETTING_KEYS ⇒ `E_FORBIDDEN_KEY` (limit decreases allowed). */
  patch(body: unknown): Promise<SettingsView>;
  /** `PATCH /settings/exec` (cli, TTY-confirmed): only paths under EXEC_SETTING_KEYS. */
  patchExec(body: unknown): Promise<SettingsView>;
  /** `PATCH /ws/:ws/settings`: replace the workspace's overrides in the global file. */
  patchWorkspace(ws: WorkspaceKey, body: unknown): Promise<WorkspaceOverrides>;
  /** Re-read after an external edit; true when the effective settings changed. */
  reload(): Promise<boolean>;
  /** Last load problem (invalid file ⇒ defaults stay in effect). */
  lastError(): MitoriErrorData | null;
  onChange(fn: (scope: "global" | "workspace", ws: WorkspaceKey | null) => void): () => void;
}

const invalid = (paths: string[]) =>
  new MitoriError("E_CFG_INVALID", `invalid settings: ${paths.slice(0, 5).join(", ")}`, { params: { paths: paths.slice(0, 20).join(",") } });

/** Parse + validate a config document; returns the full settings (defaults filled in). */
export function parseGlobalSettings(text: string): GlobalSettings {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch (e) {
    throw new MitoriError("E_CFG_INVALID", "config.json is not valid JSON", { cause: e });
  }
  const partial = validate(raw, GLOBAL_SPEC, { partial: true });
  if (partial.length > 0) throw invalid(partial);
  const merged = deepMerge(DEFAULT_GLOBAL_SETTINGS, raw);
  const full = validate(merged, GLOBAL_SPEC);
  if (full.length > 0) throw invalid(full);
  return merged;
}

/** Sparse file text for `settings`. */
export function serializeGlobalSettings(settings: GlobalSettings): string {
  const sparse = (diffFrom(settings, DEFAULT_GLOBAL_SETTINGS) ?? {}) as Record<string, unknown>;
  return `${JSON.stringify({ schemaVersion: 1, ...sparse }, null, 2)}\n`;
}

/** Overrides rules beyond the schema: docDir is repo-relative inside the tree (never `.`, no `..`) [SEC-01, SEC-02]. */
export function checkOverrides(o: unknown): WorkspaceOverrides {
  const bad = validate(o, OVERRIDES_SPEC);
  if (bad.length > 0) throw invalid(bad);
  const ov = o as WorkspaceOverrides;
  if (ov.docDir !== undefined) {
    const d = ov.docDir;
    const segs = d.split("/");
    // biome-ignore lint/suspicious/noControlCharactersInRegex: control characters are rejected
    if (d === "" || d.startsWith("/") || d.includes("\\") || /[\u0000-\u001f]/.test(d) || segs.some((s) => s === "" || s === "." || s === ".."))
      throw new MitoriError("E_INVALID_INPUT", "docDir must be a repo-relative directory (not the repo root, no `..`)", { params: { field: "docDir" } });
  }
  return ov;
}

export async function createSettingsService(opts: {
  home: string;
  fs: FsReader;
  safeWrite: SafeWriter;
  publish: (payload: SseEventPayload, ws: WorkspaceKey | null) => void;
  log: Logger;
}): Promise<SettingsService> {
  const path = `${opts.home}/${CONFIG_FILE}`;
  let settings: GlobalSettings = DEFAULT_GLOBAL_SETTINGS;
  let lastText: string | null = null;
  let error: MitoriErrorData | null = null;
  let version = 1;
  const listeners = new Set<(scope: "global" | "workspace", ws: WorkspaceKey | null) => void>();
  let chain: Promise<unknown> = Promise.resolve();
  /** Serialize read-modify-write cycles (the file write awaits, so this is not a write-queue slot). */
  const exclusive = <T>(fn: () => Promise<T>): Promise<T> => {
    const run = chain.then(fn);
    chain = run.then(
      () => undefined,
      () => undefined,
    );
    return run;
  };

  const readFile = async (): Promise<string | null> => (opts.fs.stat(path)?.isFile ? new TextDecoder().decode(await opts.fs.read(path)) : null);

  const load = async (): Promise<boolean> => {
    const text = await readFile();
    if (text === lastText) return false;
    lastText = text;
    try {
      const next = text === null ? DEFAULT_GLOBAL_SETTINGS : parseGlobalSettings(text);
      error = null;
      const changed = JSON.stringify(next) !== JSON.stringify(settings);
      settings = next;
      if (changed) version += 1;
      return changed;
    } catch (e) {
      error = toErrorData(e);
      opts.log.warn("config.json rejected; previous settings stay in effect", { code: error.code });
      return false;
    }
  };

  const changed = (scope: "global" | "workspace", ws: WorkspaceKey | null) => {
    opts.publish({ type: "settings.updated", scope }, ws);
    for (const fn of listeners) fn(scope, ws);
  };

  const commit = async (next: GlobalSettings, scope: "global" | "workspace", ws: WorkspaceKey | null) => {
    const full = validate(next, GLOBAL_SPEC);
    if (full.length > 0) throw invalid(full);
    const text = serializeGlobalSettings(next);
    await opts.safeWrite.write(opts.home, CONFIG_FILE, text, "home");
    lastText = text;
    settings = next;
    version += 1;
    changed(scope, ws);
  };

  await load();

  const view = (): SettingsView => ({ settings, path, version });

  return {
    path,
    current: () => settings,
    view,
    lastError: () => error,
    onChange(fn) {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
    patch: (body) =>
      exclusive(async () => {
        if (!isPlainObject(body) || typeof body.version !== "number" || !isPlainObject(body.patch))
          throw new MitoriError("E_INVALID_INPUT", "expected {version, patch}", { params: { field: "patch" } });
        if (body.version !== version) throw new MitoriError("E_CONFLICT", "settings changed since they were read", { params: { version } });
        const check = checkSettingsPatch(body.patch, settings);
        if (!check.ok)
          throw new MitoriError("E_FORBIDDEN_KEY", `not changeable from the web UI: ${check.paths.join(", ")}`, {
            params: { paths: check.paths.join(",") },
            hint: "use `mitori config set <path> <value>` in a terminal",
          });
        const partial = validate(body.patch, GLOBAL_SPEC, { partial: true });
        if (partial.length > 0) throw invalid(partial);
        await commit(deepMerge(settings, body.patch), "global", null);
        return view();
      }),
    patchExec: (body) =>
      exclusive(async () => {
        if (!isPlainObject(body) || typeof body.path !== "string" || body.confirm !== true || !("value" in body))
          throw new MitoriError("E_INVALID_INPUT", "expected {path, value, confirm: true}", { params: { field: "path" } });
        const p = body.path;
        if (!EXEC_SETTING_KEYS.some((k) => p === k || p.startsWith(`${k}.`)))
          throw new MitoriError("E_INVALID_INPUT", `${p} is not an execution setting (use PATCH /settings)`, { params: { field: "path" } });
        const patch = patchAt(p, body.value);
        const partial = validate(patch, GLOBAL_SPEC, { partial: true });
        if (partial.length > 0) throw invalid(partial);
        await commit(deepMerge(settings, patch), "global", null);
        return view();
      }),
    patchWorkspace: (ws, body) =>
      exclusive(async () => {
        if (!isPlainObject(body) || !("overrides" in body))
          throw new MitoriError("E_INVALID_INPUT", "expected {overrides}", { params: { field: "overrides" } });
        const overrides = checkOverrides(body.overrides);
        await commit({ ...settings, workspaces: { ...settings.workspaces, [ws]: overrides } }, "workspace", ws);
        return overrides;
      }),
    reload: () =>
      exclusive(async () => {
        const did = await load();
        if (did) {
          opts.publish({ type: "notice", level: "info", key: "notice.settings.reloaded" }, null);
          changed("global", null);
        }
        return did;
      }),
  };
}
