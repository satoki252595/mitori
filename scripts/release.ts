// `bun scripts/release.ts [--out dist/release]` (owner: WP37): cross-builds all TARGETS (build:bin
// --target all; the non-host Bun runtime is downloaded by `bun build`), applies the size gate, packs
// `mitori-<version>-<target>.tar.gz` (binary named `mitori`, mode 755) or `mitori-<version>-windows-x64.zip`
// (binary named `mitori.exe`) and writes SHA256SUMS plus release.json (targets, sizes, digests and the pinned
// embedded assets). Signing (minisign) and the SBOM are not done here yet.
import { spawnSync } from "node:child_process";
import { copyFileSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { TARGETS, type Target } from "./build-bin.ts";
import { LOCK, sha256Hex } from "./gen-assets.ts";
import { ROOT } from "./lib/repo.ts";

/** Built binary under dist/ (`windows-x64` keeps the `.exe`). */
export function binName(target: Target): string {
  return target.startsWith("windows-") ? `mitori-${target}.exe` : `mitori-${target}`;
}

/** File name inside the archive (`mitori.exe` on Windows, `mitori` elsewhere). */
export function stageName(target: Target): string {
  return target.startsWith("windows-") ? "mitori.exe" : "mitori";
}

/** Archive file name (`.zip` on Windows, `.tar.gz` elsewhere). */
export function archiveName(target: Target, version: string): string {
  return target.startsWith("windows-") ? `mitori-${version}-${target}.zip` : `mitori-${version}-${target}.tar.gz`;
}

const argv = process.argv.slice(2);
const out = resolve(ROOT, argv.includes("--out") ? (argv[argv.indexOf("--out") + 1] ?? "dist/release") : "dist/release");
const run = (cmd: string, args: string[], cwd = ROOT) => {
  const r = spawnSync(cmd, args, { cwd, stdio: "inherit" });
  if (r.status !== 0) process.exit(r.status ?? 1);
};

if (import.meta.main) {
  run("bun", ["scripts/build-bin.ts", "--target", "all"]);
  run("bun", ["apps/cli/src/build/size.ts"]);

  const version = (JSON.parse(readFileSync(join(ROOT, "apps/cli/package.json"), "utf8")) as { version: string }).version;
  rmSync(out, { recursive: true, force: true });
  mkdirSync(out, { recursive: true });
  const sums: string[] = [];
  const targets = TARGETS.map((t) => {
    const bin = join(ROOT, "dist", binName(t));
    const stage = join(out, ".stage", t);
    const inner = stageName(t);
    mkdirSync(stage, { recursive: true });
    copyFileSync(bin, join(stage, inner));
    const archive = archiveName(t, version);
    if (t.startsWith("windows-")) {
      run("python3", [
        "-c",
        "import sys, zipfile; zipfile.ZipFile(sys.argv[1], 'w', zipfile.ZIP_DEFLATED).write(sys.argv[2], sys.argv[3])",
        join(out, archive),
        join(stage, inner),
        inner,
      ]);
    } else {
      run("chmod", ["755", join(stage, inner)]);
      run("tar", ["-czf", join(out, archive), "-C", stage, inner]);
    }
    const binSha = sha256Hex(readFileSync(bin));
    const archiveSha = sha256Hex(readFileSync(join(out, archive)));
    sums.push(`${archiveSha}  ${archive}`);
    return { target: t, bytes: statSync(bin).size, sha256: binSha, archive, archiveBytes: statSync(join(out, archive)).size, archiveSha256: archiveSha };
  });
  rmSync(join(out, ".stage"), { recursive: true, force: true });
  writeFileSync(join(out, "SHA256SUMS"), `${sums.join("\n")}\n`);
  const lock = JSON.parse(readFileSync(join(ROOT, LOCK), "utf8")) as { assets: unknown[] };
  writeFileSync(join(out, "release.json"), `${JSON.stringify({ version, targets, embedded: lock.assets }, null, 2)}\n`);
  for (const t of targets) console.log(`release: ${t.archive} ${(t.archiveBytes / 1e6).toFixed(1)} MB (binary ${(t.bytes / 1e6).toFixed(1)} MB)`);
  console.log(`release: ${out}/SHA256SUMS`);
}
