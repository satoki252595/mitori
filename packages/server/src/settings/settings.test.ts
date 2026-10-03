import { describe, expect, test } from "bun:test";
import { writeFileSync } from "node:fs";
import { DEFAULT_DENY_GLOBS, type GlobalSettings, MitoriError, type SseEventPayload, type WorkspaceInfo, type WorkspaceKey } from "@mitori/core";
import { fsReader, fsSafeWriter, removeDir, silentLogger, tempDir } from "../http/test/fakes.ts";
import { checkSettingsPatch, DEFAULT_GLOBAL_SETTINGS, resolveSettings } from "./index.ts";
import { deepMerge } from "./merge.ts";
import { repoTrustHash } from "./repo.ts";
import { GLOBAL_SPEC, validate } from "./schema.ts";
import { createSettingsService, parseGlobalSettings, serializeGlobalSettings } from "./service.ts";

const WS = "ws_ssssssssssss" as WorkspaceKey;
const info: WorkspaceInfo = { key: WS, root: "/repo", kind: "git", name: "repo", docDir: ".mitori", docCommitted: false };
const code = (e: unknown) => (e instanceof MitoriError ? e.code : String(e));

describe("settings defaults and schema", () => {
  test("DEFAULT_GLOBAL_SETTINGS validates against the schema; sparse serialization round-trips", () => {
    expect(validate(DEFAULT_GLOBAL_SETTINGS, GLOBAL_SPEC)).toEqual([]);
    expect(serializeGlobalSettings(DEFAULT_GLOBAL_SETTINGS)).toBe('{\n  "schemaVersion": 1\n}\n');
    const custom = deepMerge(DEFAULT_GLOBAL_SETTINGS, { ui: { lang: "en", keymap: { "nav.next": "j" } }, limits: { jobMaxUsd: 1 } });
    const text = serializeGlobalSettings(custom);
    expect(JSON.parse(text)).toEqual({ schemaVersion: 1, ui: { lang: "en", keymap: { "nav.next": "j" } }, limits: { jobMaxUsd: 1 } });
    expect(parseGlobalSettings(text)).toEqual(custom);
  });

  test("unknown keys and wrong types ⇒ E_CFG_INVALID", () => {
    expect(() => parseGlobalSettings('{"ui":{"lang":"fr"}}')).toThrow();
    expect(code(tryParse('{"nope":1}'))).toBe("E_CFG_INVALID");
    expect(code(tryParse('{"engines":{"claude-cli":{"binary":3}}}'))).toBe("E_CFG_INVALID");
    expect(code(tryParse("{not json"))).toBe("E_CFG_INVALID");
    expect(code(tryParse('{"workspaces":{"bad-key":{}}}'))).toBe("E_CFG_INVALID");
    expect(code(tryParse('{"models":{"answer":"sonnet"}}'))).toBe("E_CFG_INVALID"); // aliases are forbidden
  });
});

function tryParse(text: string): unknown {
  try {
    return parseGlobalSettings(text);
  } catch (e) {
    return e;
  }
}

describe("SRV-I-027 / SRV-AT-06 checkSettingsPatch", () => {
  const cur = DEFAULT_GLOBAL_SETTINGS;
  test("EXEC_SETTING_KEYS paths are forbidden", () => {
    expect(checkSettingsPatch({ engines: { "claude-cli": { binary: "/tmp/evil" } } }, cur)).toEqual({ ok: false, paths: ["engines.claude-cli.binary"] });
    expect(checkSettingsPatch({ engines: { generic: { argv: ["sh", "-c", "x"] } } }, cur)).toEqual({ ok: false, paths: ["engines.generic.argv"] });
    expect(checkSettingsPatch({ security: { secretScan: false } }, cur)).toEqual({ ok: false, paths: ["security.secretScan"] });
    expect(checkSettingsPatch({ privacy: { logContent: true, keepRawStreams: true } }, cur)).toEqual({
      ok: false,
      paths: ["privacy.keepRawStreams", "privacy.logContent"],
    });
    expect(checkSettingsPatch({ review: { autoCommit: true } }, cur)).toEqual({ ok: false, paths: ["review.autoCommit"] });
    expect(checkSettingsPatch({ pins: { claude: null } }, cur)).toEqual({ ok: false, paths: ["pins.claude"] });
    expect(checkSettingsPatch({ privacy: null }, cur)).toEqual({ ok: false, paths: ["privacy"] });
    expect(checkSettingsPatch({ limits: 5 }, cur)).toEqual({ ok: false, paths: ["limits"] });
  });

  test("limits: decrease allowed, increase / non-number rejected; other keys allowed", () => {
    expect(checkSettingsPatch({ limits: { jobMaxUsd: 1 } }, cur)).toEqual({ ok: true });
    expect(checkSettingsPatch({ limits: { jobMaxUsd: 2 } }, cur)).toEqual({ ok: true });
    expect(checkSettingsPatch({ limits: { jobMaxUsd: 2.01 } }, cur)).toEqual({ ok: false, paths: ["limits.jobMaxUsd"] });
    expect(checkSettingsPatch({ limits: { jobMaxUsd: "1" } }, cur)).toEqual({ ok: false, paths: ["limits.jobMaxUsd"] });
    expect(checkSettingsPatch({ ui: { theme: "dark" }, review: { autoResolveOnAccept: false }, privacy: { dataPolicyAck: {} } }, cur)).toEqual({ ok: true });
    expect(checkSettingsPatch([], cur)).toEqual({ ok: false, paths: ["*"] });
  });
});

describe("resolveSettings", () => {
  const gates = [{ id: "fmt:prettier", kind: "format", argvTemplate: ["prettier", "--write", { var: "files" }], appliesTo: ["**/*.ts"] }];
  const repoRaw = {
    schemaVersion: 1,
    docLang: "en",
    denyGlobs: ["secret/**"],
    gates,
    rules: ["AGENTS.md"],
    engines: { "claude-cli": { binary: "/tmp/evil" } },
    defaultEngine: "generic",
    include: "not-an-array",
    modules: { "src/a": { name: "A", slug: "Bad Slug" } },
  };

  test("repo scope only; others ignored; denyGlobs union incl. a non-default docDir", () => {
    const r = resolveSettings({
      global: DEFAULT_GLOBAL_SETTINGS,
      overrides: { docDir: "docs/mitori" },
      repoRaw,
      info,
      trust: () => "pending",
      sandbox: "none",
    });
    expect(r.ignoredRepoKeys.sort()).toEqual(["defaultEngine", "engines", "include", "modules.src/a.slug"]);
    expect(r.repo).toEqual({ schemaVersion: 1, docLang: "en", denyGlobs: ["secret/**"], modules: { "src/a": { name: "A" } } });
    expect(r.repoParsed.gates).toEqual(gates as never);
    expect(r.trustedGates).toEqual([]);
    expect(r.denyGlobs.slice(0, DEFAULT_DENY_GLOBS.length)).toEqual([...DEFAULT_DENY_GLOBS]);
    expect(r.denyGlobs).toContain("secret/**");
    expect(r.denyGlobs.at(-1)).toBe("docs/mitori/**");
    expect(r.gateSandbox).toBe("none");
  });

  test("RT-05: gates and rules take effect only when their content hash is trusted", () => {
    const parsed = resolveSettings({ global: DEFAULT_GLOBAL_SETTINGS, overrides: {}, repoRaw, info, trust: () => "unknown", sandbox: "bwrap" }).repoParsed;
    const gh = repoTrustHash(parsed, "gates");
    const rh = repoTrustHash(parsed, "rules");
    expect(gh).toMatch(/^[0-9a-f]{64}$/);
    const seen: string[] = [];
    const r = resolveSettings({
      global: DEFAULT_GLOBAL_SETTINGS,
      overrides: {},
      repoRaw,
      info,
      trust: (item, hash) => {
        seen.push(item);
        return (item === "gates" && hash === gh) || (item === "rules" && hash === rh) ? "trusted" : "denied";
      },
      sandbox: "bwrap",
    });
    expect(seen.sort()).toEqual(["gates", "rules"]);
    expect(r.repo.rules).toEqual(["AGENTS.md"]);
    expect(r.trustedGates.map((g) => [g.id, g.source, g.autofix, g.executesRepoCode])).toEqual([["fmt:prettier", "repo_config", true, true]]);
    expect(r.trustedGates[0]?.trustHash).toMatch(/^[0-9a-f]{64}$/);
    const changed = resolveSettings({
      global: DEFAULT_GLOBAL_SETTINGS,
      overrides: {},
      repoRaw: { ...repoRaw, gates: [{ ...gates[0], argvTemplate: ["sh", "-c", "curl evil"] }] },
      info,
      trust: (item, hash) => (item === "gates" && hash === gh ? "trusted" : "pending"),
      sandbox: "bwrap",
    });
    expect(changed.trustedGates).toEqual([]); // new content ⇒ new hash ⇒ not trusted
  });

  test("garbage repo files are ignored, never fatal", () => {
    expect(
      resolveSettings({ global: DEFAULT_GLOBAL_SETTINGS, overrides: {}, repoRaw: "x", info, trust: () => "unknown", sandbox: "none" }).ignoredRepoKeys,
    ).toEqual(["*"]);
    expect(resolveSettings({ global: DEFAULT_GLOBAL_SETTINGS, overrides: {}, repoRaw: null, info, trust: () => "unknown", sandbox: "none" }).repo).toEqual({
      schemaVersion: 1,
    });
  });

  test("prototype keys in untrusted files are rejected, never assigned", () => {
    const repoRaw = JSON.parse('{"__proto__":{"gates":[1]},"constructor":1,"modules":{"__proto__":{"name":"x"}},"docLang":"en"}');
    const r = resolveSettings({ global: DEFAULT_GLOBAL_SETTINGS, overrides: {}, repoRaw, info, trust: () => "trusted", sandbox: "none" });
    expect(r.ignoredRepoKeys.sort()).toEqual(["__proto__", "constructor", "modules"]);
    expect(r.repo).toEqual({ schemaVersion: 1, docLang: "en" });
    expect(Object.getPrototypeOf(r.repo)).toBe(Object.prototype);
    expect(code(tryParse('{"__proto__":{"ui":{"lang":"en"}}}'))).toBe("E_CFG_INVALID");
    expect(code(tryParse('{"ui":{"keymap":{"__proto__":"x"}}}'))).toBe("E_CFG_INVALID");
    expect(checkSettingsPatch(JSON.parse('{"__proto__":{"engines":{"generic":{"enabled":true}}}}'), DEFAULT_GLOBAL_SETTINGS)).toEqual({ ok: true });
    expect(deepMerge({ a: 1 }, JSON.parse('{"__proto__":{"polluted":true}}'))).toEqual({ a: 1 });
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
  });
});

describe("SRV-I-027 settings service", () => {
  async function svc() {
    const home = tempDir();
    const published: SseEventPayload[] = [];
    const s = await createSettingsService({ home, fs: fsReader, safeWrite: fsSafeWriter(), publish: (p) => void published.push(p), log: silentLogger });
    return { home, s, published };
  }

  test("PATCH: version check, forbidden keys, schema, sparse write, settings.updated", async () => {
    const { home, s, published } = await svc();
    try {
      const v = s.view();
      expect(v.settings).toEqual(DEFAULT_GLOBAL_SETTINGS);
      expect(await s.patch({ version: v.version, patch: { engines: { "claude-cli": { binary: "/tmp/x" } } } }).then(() => "ok", code)).toBe("E_FORBIDDEN_KEY");
      expect(await s.patch({ version: v.version + 7, patch: { ui: { theme: "dark" } } }).then(() => "ok", code)).toBe("E_CONFLICT");
      expect(await s.patch({ version: v.version, patch: { ui: { nope: 1 } } }).then(() => "ok", code)).toBe("E_CFG_INVALID");
      expect(await s.patch({ version: v.version, patch: "x" }).then(() => "ok", code)).toBe("E_INVALID_INPUT");
      const after = await s.patch({ version: v.version, patch: { ui: { theme: "dark" }, limits: { jobMaxUsd: 1.5 } } });
      expect(after.version).toBe(v.version + 1);
      expect(after.settings.limits.jobMaxUsd).toBe(1.5);
      expect(await s.patch({ version: after.version, patch: { limits: { jobMaxUsd: 1.6 } } }).then(() => "ok", code)).toBe("E_FORBIDDEN_KEY");
      expect(JSON.parse(await Bun.file(s.path).text())).toEqual({ schemaVersion: 1, ui: { theme: "dark" }, limits: { jobMaxUsd: 1.5 } });
      expect(published).toEqual([{ type: "settings.updated", scope: "global" }]);
      expect(await s.reload()).toBe(false); // our own write does not re-run anything
    } finally {
      removeDir(home);
    }
  });

  test("PATCH /settings/exec: only EXEC paths; can raise limits", async () => {
    const { home, s } = await svc();
    try {
      expect(await s.patchExec({ path: "ui.theme", value: "dark", confirm: true }).then(() => "ok", code)).toBe("E_INVALID_INPUT");
      expect(await s.patchExec({ path: "limits.jobMaxUsd", value: 9, confirm: false }).then(() => "ok", code)).toBe("E_INVALID_INPUT");
      expect(await s.patchExec({ path: "engines.claude-cli.binary", value: 3, confirm: true }).then(() => "ok", code)).toBe("E_CFG_INVALID");
      expect((await s.patchExec({ path: "limits.jobMaxUsd", value: 9, confirm: true })).settings.limits.jobMaxUsd).toBe(9);
      expect((await s.patchExec({ path: "engines.claude-cli.binary", value: "/opt/claude", confirm: true })).settings.engines["claude-cli"].binary).toBe(
        "/opt/claude",
      );
    } finally {
      removeDir(home);
    }
  });

  test("SEC-01: PATCH /settings cannot smuggle a workspace docDir past the override rules", async () => {
    const { home, s } = await svc();
    try {
      for (const docDir of ["/etc", "../../x", ".", "a/./b"]) {
        const v = s.view().version;
        expect(await s.patch({ version: v, patch: { workspaces: { [WS]: { docDir } } } }).then(() => "ok", code)).toBe("E_INVALID_INPUT");
      }
      expect(s.current().workspaces[WS]).toBeUndefined();
      const ok = await s.patch({ version: s.view().version, patch: { workspaces: { [WS]: { docDir: "docs/m", readerLevel: "expert" } } } });
      expect(ok.settings.workspaces[WS]).toEqual({ docDir: "docs/m", readerLevel: "expert" });
    } finally {
      removeDir(home);
    }
  });

  test("shadow / remote-readonly docDir: absolute under <home>/repos/<ws>/ only", async () => {
    const home = tempDir();
    const s = await createSettingsService({
      home,
      fs: fsReader,
      safeWrite: fsSafeWriter(),
      publish: () => undefined,
      log: silentLogger,
      kindOf: () => "shadow",
    });
    try {
      for (const docDir of ["docs", `${home}/repos/${WS}`, `${home}/repos/${WS}/`, `${home}/repos/${WS}/../x`, `${home}/repos/ws_000000000000/doc`, "/etc"])
        expect([docDir, await s.patchWorkspace(WS, { overrides: { docDir } }).then(() => "ok", code)]).toEqual([docDir, "E_INVALID_INPUT"]);
      expect(await s.patchWorkspace(WS, { overrides: { docDir: `${home}/repos/${WS}/doc2` } })).toEqual({ docDir: `${home}/repos/${WS}/doc2` });
    } finally {
      removeDir(home);
    }
  });

  test("workspace overrides: docDir rules", async () => {
    const { home, s } = await svc();
    try {
      for (const docDir of [".", "", "../x", "/abs", "a/../b", "a\\b", "a//b", "a/"])
        expect(await s.patchWorkspace(WS, { overrides: { docDir } }).then(() => "ok", code)).not.toBe("ok");
      expect(await s.patchWorkspace(WS, { overrides: { exec: 1 } }).then(() => "ok", code)).toBe("E_CFG_INVALID");
      expect(await s.patchWorkspace(WS, { overrides: { docDir: "docs/mitori", readerLevel: "expert" } })).toEqual({
        docDir: "docs/mitori",
        readerLevel: "expert",
      });
      expect(s.current().workspaces[WS]).toEqual({ docDir: "docs/mitori", readerLevel: "expert" });
    } finally {
      removeDir(home);
    }
  });

  test("a human edit is picked up by reload (notice.settings.reloaded); a broken edit keeps the previous settings", async () => {
    const { home, s, published } = await svc();
    try {
      writeFileSync(s.path, JSON.stringify({ ui: { lang: "en" } }));
      expect(await s.reload()).toBe(true);
      expect(s.current().ui.lang).toBe("en");
      expect(published.map((p) => (p.type === "notice" ? p.key : p.type))).toEqual(["notice.settings.reloaded", "settings.updated"]);
      writeFileSync(s.path, JSON.stringify({ ui: { lang: "xx" } }));
      expect(await s.reload()).toBe(false);
      expect(s.current().ui.lang).toBe("en");
      expect(s.lastError()?.code).toBe("E_CFG_INVALID");
    } finally {
      removeDir(home);
    }
  });

  test("settings type guard: GlobalSettings stays assignable", () => {
    const g: GlobalSettings = DEFAULT_GLOBAL_SETTINGS;
    expect(g.schemaVersion).toBe(1);
  });
});
