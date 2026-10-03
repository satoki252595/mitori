/**
 * `mitori doctor [--calibrate] [--reset-cache] [--rotate-session]`: a read-only check of this machine — version and
 * home, the daemon (without starting one), the engines, and the freshness of every installed integration file
 * (spec §11.4: outdated → `mitori install <target>` updates it; modified files are left alone). Exit 1 when
 * something needs attention. The three maintenance flags have no daemon route yet (cr-requests/WP-11.md #5).
 */
import { existsSync, statSync } from "node:fs";
import { type IntegrationStatusView, MitoriError } from "@mitori/core";
import { parse } from "./args.ts";
import { apiOf, findDaemon, readRegistry } from "./daemon-client.ts";
import { helpLang } from "./help.ts";
import { type Io, usage } from "./io.ts";
import { homeOf } from "./session.ts";

export async function run(io: Io): Promise<number> {
  const { values, positionals } = parse(
    io.argv,
    { calibrate: { type: "boolean" }, "reset-cache": { type: "boolean" }, "rotate-session": { type: "boolean" } },
    "doctor",
  );
  if (positionals.length > 0) throw usage(`unexpected argument ${positionals[0]}`, "mitori doctor --help");
  for (const flag of ["calibrate", "reset-cache", "rotate-session"] as const)
    if (values[flag]) throw new MitoriError("E_UNSUPPORTED", `mitori doctor --${flag} is not served by the daemon yet`);
  const ja = helpLang(io.env) === "ja";
  const home = homeOf(io);
  let problems = 0;
  /** ✓ fine, ! needs attention (counted), · for information only. */
  const line = (ok: boolean | "info", text: string) => {
    if (ok === false) problems++;
    io.out(`${ok === "info" ? "·" : ok ? "✓" : "!"} ${text}\n`);
  };
  line(true, `mitori ${io.version} · home ${home}`);
  const regPath = `${home}/daemon.json`;
  if (existsSync(regPath) && (statSync(regPath).mode & 0o077) !== 0)
    line(false, ja ? `${regPath} が他のユーザーから読めます` : `${regPath} is readable by other users`);
  const d = await findDaemon(io, home);
  if (!d) {
    line(
      true,
      readRegistry(home)
        ? ja
          ? "daemon: 応答なし（古い registry）"
          : "daemon: not answering (stale registry)"
        : ja
          ? "daemon: 停止中"
          : "daemon: not running",
    );
    return problems > 0 ? 1 : 0;
  }
  const api = apiOf(io, d);
  const st = await api.call("GET /daemon", { params: {} });
  line(
    st.version === io.version,
    `daemon v${st.version} · pid ${st.pid} · port ${st.port} · ${Math.round(st.uptimeSec / 60)} min · ${Math.round(st.rssMb)} MB · ${st.workspaces.length} workspace(s)${st.version === io.version ? "" : ja ? "（CLI と版が違います）" : " (differs from this CLI)"}`,
  );
  // only the engines mitori is set to use count as problems; the others are listed for information
  const settings = await api.call("GET /settings", { params: {} }).catch(() => null);
  const used = new Set([settings?.settings.defaultEngine, settings?.settings.defaultGenEngine].filter(Boolean));
  for (const e of st.engines) {
    const problem = e.problems[0];
    const fine = e.installed && !problem;
    line(
      fine || (!used.has(e.engine) && settings !== null ? "info" : false),
      `${e.engine}: ${e.installed ? `${e.version ?? "?"} · ${e.auth}${e.plan ? ` · ${e.plan}` : ""}` : ja ? "見つかりません" : "not found"}${problem ? ` — ${problem.code}: ${problem.message}` : ""}`,
    );
  }
  let views: IntegrationStatusView[] = [];
  try {
    views = await api.call("GET /integrations", { params: {} });
  } catch {
    line(true, ja ? "連携ファイル: この daemon では確認できません" : "integrations: this daemon cannot report them yet");
  }
  for (const v of views)
    for (const f of v.files) {
      const hint =
        f.state === "outdated"
          ? ja
            ? ` — mitori install ${v.target} で更新できます`
            : ` — mitori install ${v.target} updates it`
          : f.state === "missing"
            ? ja
              ? ` — mitori install ${v.target} で入れ直せます`
              : ` — mitori install ${v.target} reinstalls it`
            : f.state === "modified"
              ? ja
                ? "（編集済み・そのまま）"
                : " (edited by you, left alone)"
              : "";
      line(f.state === "current" || f.state === "modified", `${v.target} (${v.scope}) ${f.state}: ${f.path}${hint}`);
    }
  return problems > 0 ? 1 : 0;
}
