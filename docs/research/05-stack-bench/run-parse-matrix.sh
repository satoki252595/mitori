#!/usr/bin/env bash
cd "$(dirname "$0")"
out=results/parse.jsonl; : > $out
run() { # rt adapter corpus reps mode
  echo "[$(date +%T)] $*" >&2
  $1 parse-bench.mjs $2 $3 $4 $5 2>/dev/null | tail -1 >> $out
}
for corpus in "crit-go" "crit-ts,m3e-ts,hono-ts" "crit-go,crit-js,crit-ts,m3e-ts" ; do
  for mode in extract parse; do
    for rt in bun node; do
      for a in wts native astgrep oxc tsc; do
        run $rt $a $corpus 5 $mode
      done
    done
  done
done
# large: Go stdlib (Go only) and hono for TS-only parsers
for mode in extract parse; do
  for rt in bun node; do
    for a in wts native astgrep; do run $rt $a gostd-go 3 $mode; done
  done
done
echo DONE >&2
