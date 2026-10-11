/**
 * `mitori export --html [-o|--out <file|dir>] [--no-code|--no-excerpts] [--level newcomer|standard|expert] [--lang ja|en] [--decisions]`
 * (P3, WP-13): the daemon renders the self-contained HTML (`POST /ws/:ws/export`, secrets redacted) and the CLI writes it —
 * the daemon never writes outside its SafeWriter roots [CONS-07, SEC-01]. The CLI writes through SafeWriter too
 * (atomic, no symlink target).
 */
import { realpathSync, statSync } from "node:fs";
import { basename, dirname, resolve } from "node:path";
import type { DocLang, ReaderLevel } from "@mitori/core";
import { MitoriError } from "@mitori/core";
import { createSafeWriter } from "@mitori/platform";
import { oneOf, parse } from "./args.ts";
import { readRegistry, stopDaemon } from "./daemon-client.ts";
import { helpLang } from "./help.ts";
import { type Io, usage } from "./io.ts";
import { connect } from "./session.ts";
import { openWorkspace, whenReady } from "./workspace.ts";

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
  const requestedLang = oneOf(values.lang, ["ja", "en"] as const, "lang", "export");
  // Validate CLI-only input before starting a workspace scan (which itself keeps the daemon busy).
  const asked = values.out === undefined ? null : resolve(io.cwd, values.out);
  const inDir = asked !== null && (/[/\\]$/.test(values.out ?? "") || isDir(asked));
  const outputDir = asked === null ? io.cwd : inDir ? asked : dirname(asked);
  let dir: string;
  try {
    dir = realpathSync(outputDir);
    if (!isDir(dir)) throw new Error("not a directory");
  } catch {
    throw new MitoriError("E_NOT_FOUND", `no such directory: ${outputDir}`);
  }
  const s = await connect(io, { restart: false });
  try {
    const ws = await openWorkspace(io, s.api);
    const lang: DocLang = requestedLang ?? ws.doc.lang ?? "ja";
    const name = `${ws.info.name.replace(/[^A-Za-z0-9._-]+/g, "-")}.mitori.html`;
    // `-o some/dir` (an existing directory, or a path ending in `/`) means "put the file in there under its usual name"
    const file = asked === null || inDir ? name : basename(asked);
    const res = await whenReady(io, () =>
      s.api.call("POST /ws/:ws/export", {
        params: { ws: ws.info.key },
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
    await createSafeWriter().write(dir, file, res.html, "accept");
    const kb = Math.max(1, Math.round(res.bytes / 1024));
    const ex = res.codeExcerpts;
    io.out(`${dir}/${file}\n`);
    io.err(
      helpLang(io.env) === "ja"
        ? `書き出しました: ${kb} KB · sha256 ${res.sha256.slice(0, 12)} · 伏せ字 ${res.redactions} 件 · コード抜粋 ${ex.count} 件（${ex.files} ファイル）\n`
        : `exported: ${kb} KB · sha256 ${res.sha256.slice(0, 12)} · ${res.redactions} redaction(s) · ${ex.count} code excerpt(s) from ${ex.files} file(s)\n`,
    );
    return 0;
  } finally {
    const current = readRegistry(s.home);
    if (s.daemon.startedHere && current?.pid === s.daemon.registry.pid && current.token === s.daemon.registry.token)
      await stopDaemon(io, s.daemon, "export", s.home, { onlyIfIdle: true });
  }
}
