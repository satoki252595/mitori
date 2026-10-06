#!/usr/bin/env bash
# Runs inside the mitori-linux image (scripts/linux-ci.sh). /src = exported source, /out = results.
# STEPS (comma separated): install, check, unit, bin, watch, sandbox, onboarding. Every step logs to /out/<step>.log; a summary
# line per step goes to /out/summary.txt. The script continues after a failing step and exits non-zero at the end.
set -uo pipefail
# Compile on Linux's own filesystem: Mac bind-mount metadata latency is not a native cold-check measurement.
WORK="$(mktemp -d /tmp/mitori-linux-work.XXXXXX)" || exit 1
trap 'rm -rf "$WORK"' EXIT
cp -a /src/. "$WORK/" || exit 1
cd "$WORK"
STEPS="${STEPS:-install,check,unit,bin,watch,sandbox}"
ARCH="${ARCH:-$(uname -m)}"
SUMMARY=/out/summary.txt
: > "$SUMMARY"
failed=0
has() { case ",$STEPS," in *",$1,"*) return 0 ;; *) return 1 ;; esac; }
step() {
  local name="$1"; shift
  local t0=$SECONDS
  echo "== $name: $*"
  "$@" > "/out/$name.log" 2>&1
  local code=$?
  local line="$name exit=$code $((SECONDS - t0))s"
  echo "$line" | tee -a "$SUMMARY"
  [ $code -eq 0 ] || { failed=1; tail -40 "/out/$name.log"; }
  return $code
}

{
  echo "uname: $(uname -srm)"
  echo "os: $(. /etc/os-release && echo "$PRETTY_NAME")"
  echo "bun $(bun --version) · node $(node --version) · $(go version) · $(git --version) · $(bwrap --version)"
  echo "nproc $(nproc) · loadavg $(cut -d' ' -f1-3 /proc/loadavg) · seccomp ${SECCOMP:-?}"
  echo "inotify max_user_watches $(cat /proc/sys/fs/inotify/max_user_watches 2>/dev/null || echo ?)"
  echo "workdir filesystem: native container; full exported source copied before frozen install"
} | tee /out/env.txt

# a one-commit repository of the exported tree (scripts list files through git; tests build fixtures with git)
git init -q && git add -A && git -c commit.gpgsign=false commit -qm "linux-ci snapshot" || { echo "git snapshot failed"; exit 1; }
git rev-parse HEAD^{tree} > /out/source-tree.txt

if has install; then
  if ! step install bun install --frozen-lockfile; then
    # diagnostics for the failing lifecycle script, then continue without scripts (mitori loads the wasm grammars only)
    {
      echo "-- which prebuild node-gyp-build picks, and whether node can load it (what its install script tests)"
      cd node_modules/tree-sitter-typescript 2>/dev/null &&
        node -e "const p = require('node-gyp-build').path(process.cwd()); console.log(p); require(p); console.log('loads ok')"
      echo "-- node-gyp on PATH: $(command -v node-gyp || echo none)"
      echo "-- the install script itself"
      npm_config_build_from_source= node "$(dirname "$(node -p "require.resolve('node-gyp-build/package.json')")")/bin.js"
      echo "exit $?"
    } > /out/install-diag.log 2>&1
    cd "$WORK"
    step install-ignore-scripts bun install --frozen-lockfile --ignore-scripts
  fi
fi
if has check; then
  rm -rf node_modules/.cache/tsc node_modules/.cache/tsc-semantic || exit 1
  printf '{"filesystem":"native-container","declarationCacheAbsent":true,"semanticCacheAbsent":true,"hardLimitSeconds":30}\n' > /out/check-cold.json
  step check bun run check --verbose
fi
if has unit; then
  # the whole bun test suite (unit + golden + int; e2e specs are Playwright's, not bun's)
  step unit bun test
  grep -E "^\s*[0-9]+ (pass|fail|skip|todo)|^Ran " /out/unit.log | tee -a "$SUMMARY"
  grep -E "^\(fail\)" /out/unit.log > /out/unit-failures.txt || true
fi
if has bin; then
  # build:bin targets darwin-arm64 and linux-x64 (MILESTONES §11): the compiled-binary checks run in the amd64 image
  # (Rosetta / qemu on Apple silicon: `scripts/linux-ci.sh --arch amd64 --steps install,bin`)
  if [ "$(uname -m)" = x86_64 ]; then
    step bin-build bun run build:bin
    BIN="$PWD/dist/mitori-linux-x64"
    step bin-version "$BIN" --version
    step bin-skeleton env MITORI_BIN="$BIN" bun test test/skeleton test/int/int00.test.ts
    grep -E "^\s*[0-9]+ (pass|fail|skip)" /out/bin-skeleton.log | tee -a "$SUMMARY"
  else
    echo "bin skipped: build:bin does not target linux-$(uname -m) — run with --arch amd64" | tee -a "$SUMMARY"
  fi
fi
if has watch; then
  # O3 (platform-watch.md): Bun recursive fs.watch (A) vs git-status polling (B) on the synthetic 923 / 2,800-dir trees
  step watch-bench bun packages/platform/bench/watch.bench.ts --trees small,large --cands A,B --json "/out/o3-linux-$ARCH.json"
  step watch-int bun test packages/platform/src/watch
fi
has sandbox && step sandbox bun scripts/linux/sandbox-check.ts --out "/out/sandbox-${SECCOMP:-unknown}.json"
has onboarding && step onboarding bun scripts/linux/onboarding-check.ts --out /out/onboarding.json

echo "---- summary"; cat "$SUMMARY"
exit $failed
