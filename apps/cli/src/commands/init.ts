/**
 * `mitori init [--commit] [--lang ja|en] [--agents-md] [--doc-dir <dir>]` (`POST /ws/:ws/init`, SEC-02/SEC-04): mints the
 * doc identity in an empty or mitori-owned docDir. `--commit` opts the doc into the repository (`.gitattributes`
 * `linguist-generated`, `.mitori/.gitignore`) and needs a human at a terminal (refused for agents, exit 2).
 */
import type { DocLang } from "@mitori/core";
import { oneOf, parse } from "./args.ts";
import { helpLang } from "./help.ts";
import { type Io, usage } from "./io.ts";
import { connectWorkspace, requireTty } from "./session.ts";
import { whenReady } from "./workspace.ts";

export async function run(io: Io): Promise<number> {
  const { values, positionals } = parse(
    io.argv,
    { commit: { type: "boolean" }, lang: { type: "string" }, "agents-md": { type: "boolean" }, "doc-dir": { type: "string" } },
    "init",
  );
  if (positionals.length > 0) throw usage(`unexpected argument ${positionals[0]}`, "mitori init --help");
  const commit = values.commit === true;
  const lang = helpLang(io.env);
  if (commit) requireTty(io, "mitori init --commit");
  const s = await connectWorkspace(io);
  const docLang: DocLang =
    oneOf(values.lang, ["ja", "en"] as const, "lang", "init") ?? (await s.api.call("GET /settings", { params: {} })).settings.defaultDocLang;
  if (commit) {
    const where = values["doc-dir"] ?? s.ws.info.docDir;
    io.err(
      lang === "ja"
        ? `${where}/ を commit 対象にします（.gitattributes と ${where}/.gitignore を書きます）\n`
        : `${where}/ will be committed (writes .gitattributes and ${where}/.gitignore)\n`,
    );
    if (!(await io.confirm(lang === "ja" ? "よろしいですか？" : "Continue?"))) return 1;
  }
  const st = await whenReady(io, () =>
    s.api.call("POST /ws/:ws/init", {
      params: { ws: s.ws.info.key },
      body: { lang: docLang, commit, agentsBlock: values["agents-md"] === true, ...(values["doc-dir"] ? { docDir: values["doc-dir"] } : {}) },
    }),
  );
  io.out(`${st.info.name}: ${st.info.docDir}/ (${docLang}${st.info.docCommitted ? ", committed" : ""})\n`);
  return 0;
}
