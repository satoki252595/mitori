/**
 * `mitori export --html [-o|--out <file|dir>] [--no-code|--no-excerpts] [--level newcomer|standard|expert] [--lang ja|en] [--decisions]`
 * (P3, WP-13): the daemon renders the self-contained HTML (`POST /ws/:ws/export`, secrets redacted) and the CLI writes it —
 * the daemon never writes outside its SafeWriter roots [CONS-07, SEC-01]. The CLI writes through SafeWriter too
 * (atomic, no symlink target).
 */
import { realpathSync, statSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import type { DocLang, ReaderLevel } from "@mitori/core";
import { MitoriError } from "@mitori/core";
import { createSafeWriter } from "@mitori/platform";
import { oneOf, parse } from "./args.ts";
import { helpLang } from "./help.ts";
import { type Io, usage } from "./io.ts";
import { connectWorkspace } from "./session.ts";
import { whenReady } from "./workspace.ts";

const isDir = (p: string): boolean => {
  try {
    return statSync(p).isDirectory();
  } catch {
    return false;
  }
};

export async function run(io: Io): Promise<number> {
  const { values, positionals } = parse(
    io.argv,
    {
      html: { type: "boolean" },
      out: { type: "string", short: "o" },
      "no-code": { type: "boolean" },
      "no-excerpts": { type: "boolean" },
      level: { type: "string" },
      lang: { type: "string" },
      decisions: { type: "boolean" },
    },
    "export",
  );
  if (values.html !== true || positionals.length > 0) throw usage("usage: mitori export --html [-o <file|dir>] [--no-code]", "mitori export --help");
  const level: ReaderLevel = oneOf(values.level, ["newcomer", "standard", "expert"] as const, "level", "export") ?? "standard";
  const s = await connectWorkspace(io);
  const lang: DocLang = oneOf(values.lang, ["ja", "en"] as const, "lang", "export") ?? s.ws.doc.lang ?? "ja";
  const name = `${s.ws.info.name.replace(/[^A-Za-z0-9._-]+/g, "-")}.mitori.html`;
  // `-o some/dir` (an existing directory, or a path ending in `/`) means "put the file in there under its usual name"
  const asked = values.out === undefined ? null : resolve(io.cwd, values.out);
  const out = asked === null ? resolve(io.cwd, name) : /[/\\]$/.test(values.out ?? "") || isDir(asked) ? join(asked, name) : asked;
  let dir: string;
  try {
    dir = realpathSync(dirname(out));
  } catch {
    throw new MitoriError("E_NOT_FOUND", `no such directory: ${dirname(out)}`);
  }
  const res = await whenReady(io, () =>
    s.api.call("POST /ws/:ws/export", {
      params: { ws: s.ws.info.key },
      body: {
        format: "html",
        level,
        lang,
        includeDecisions: values.decisions === true,
        excerpts: values["no-excerpts"] !== true && values["no-code"] !== true,
      },
    }),
  );
  // `accept` = any relative path under the root: here the one file the user named, in a directory they chose
  await createSafeWriter().write(dir, basename(out), res.html, "accept");
  const kb = Math.max(1, Math.round(res.bytes / 1024));
  const ex = res.codeExcerpts;
  io.out(`${dir}/${basename(out)}\n`);
  io.err(
    helpLang(io.env) === "ja"
      ? `書き出しました: ${kb} KB · sha256 ${res.sha256.slice(0, 12)} · 伏せ字 ${res.redactions} 件 · コード抜粋 ${ex.count} 件（${ex.files} ファイル）\n`
      : `exported: ${kb} KB · sha256 ${res.sha256.slice(0, 12)} · ${res.redactions} redaction(s) · ${ex.count} code excerpt(s) from ${ex.files} file(s)\n`,
  );
  return 0;
}
