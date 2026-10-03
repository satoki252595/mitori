// `bun scripts/release.ts [--out dist/release]` (owner: WP-11a): cross-builds darwin-arm64 + linux-x64 (build:bin
// --target all; the non-host Bun runtime is downloaded by `bun build`), applies the size gate, packs
// `mitori-<version>-<target>.tar.gz` (binary named `mitori`, mode 755) and writes SHA256SUMS plus release.json
// (targets, sizes, digests and the pinned embedded assets). Signing (minisign) and the SBOM are not done here yet.
import { spawnSync } from "node:child_process";
import { copyFileSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { TARGETS } from "./build-bin.ts";
import { LOCK, sha256Hex } from "./gen-assets.ts";
import { ROOT } from "./lib/repo.ts";

const argv = process.argv.slice(2);
const out = resolve(ROOT, argv.includes("--out") ? (argv[argv.indexOf("--out") + 1] ?? "dist/release") : "dist/release");
const run = (cmd: string, args: string[], cwd = ROOT) => {
  const r = spawnSync(cmd, args, { cwd, stdio: "inherit" });
  if (r.status !== 0) process.exit(r.status ?? 1);
};

run("bun", ["scripts/build-bin.ts", "--target", "all"]);
run("bun", ["apps/cli/src/build/size.ts"]);

const version = (JSON.parse(readFileSync(join(ROOT, "apps/cli/package.json"), "utf8")) as { version: string }).version;
rmSync(out, { recursive: true, force: true });
mkdirSync(out, { recursive: true });
const sums: string[] = [];
const targets = TARGETS.map((t) => {
  const bin = join(ROOT, "dist", `mitori-${t}`);
  const stage = join(out, ".stage", t);
  mkdirSync(stage, { recursive: true });
  copyFileSync(bin, join(stage, "mitori"));
  run("chmod", ["755", join(stage, "mitori")]);
  const archive = `mitori-${version}-${t}.tar.gz`;
  run("tar", ["-czf", join(out, archive), "-C", stage, "mitori"]);
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
