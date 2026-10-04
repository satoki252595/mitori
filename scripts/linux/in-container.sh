#!/usr/bin/env bash
# Runs inside the mitori-linux image (scripts/linux-ci.sh). /src = scratch export of the working tree, /out = results.
# STEPS (comma separated): install, check, unit, bin, watch, sandbox. Every step logs to /out/<step>.log; a summary
# line per step goes to /out/summary.txt. The script continues after a failing step and exits non-zero at the end.
set -uo pipefail
cd /src
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
} | tee /out/env.txt

# a one-commit repository of the exported tree (scripts list files through git; tests build fixtures with git)
git init -q && git add -A && git -c commit.gpgsign=false commit -qm "linux-ci snapshot" || { echo "git snapshot failed"; exit 1; }

if has install; then
  if ! step install bun install --frozen-lockfile; then
    # diagnostics for the failing lifecycle script, then continue without scripts (mitori loads the wasm grammars only)
    { cd node_modules/tree-sitter-typescript 2>/dev/null && node -e "console.log(require('node-gyp-build').path(process.cwd()))"; } > /out/install-diag.log 2>&1
    cd /src
    step install-ignore-scripts bun install --frozen-lockfile --ignore-scripts
  fi
fi
has check && step check bun run check
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

echo "---- summary"; cat "$SUMMARY"
exit $failed
