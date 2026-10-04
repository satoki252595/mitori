#!/usr/bin/env bash
# linux-ci — run mitori's checks in an Ubuntu 24.04 container (OrbStack / Docker), repeatably.
#
#   scripts/linux-ci.sh [--arch arm64|amd64] [--steps install,check,unit,bin,watch,sandbox] [--corpus] [--keep]
#                       [--out <dir>] [--seccomp default|unconfined]
#
# - The image is scripts/linux/Dockerfile (bun / node / go pinned to flake.nix's versions, python3 + rust from apt,
#   bubblewrap). It is built once per arch and cached by Docker.
# - The repository is exported as it is on disk (tracked + untracked, not ignored: `git ls-files -co
#   --exclude-standard`) into a scratch copy that becomes a fresh one-commit repository in the container; the
#   developer's checkout is never mounted writable and node_modules are installed inside (linux-native binaries).
# - --corpus mounts ~/.cache/mitori-corpus read-only (the corpus-dependent tests then run instead of skipping).
# - --seccomp unconfined (default) lets bwrap create its user / network namespaces like on a developer's Linux box;
#   `--seccomp default` keeps Docker's profile, under which the gate-sandbox probe must answer "none" (verified by the
#   sandbox step: detection degrades instead of breaking the gates).
# - Output (logs, results JSON) goes to --out (default: <scratch>/out), printed at the end.
# - Docker credentials: only public images are pulled. When the user's docker config uses a credential store
#   (osxkeychain), a headless run can hang on the keychain; a scratch DOCKER_CONFIG without credsStore is used unless
#   MITORI_DOCKER_CONFIG=keep.
set -euo pipefail

ARCH="arm64"
STEPS="install,check,unit,bin,watch,sandbox"
CORPUS=0
KEEP=0
OUT=""
SECCOMP="unconfined"
while [ $# -gt 0 ]; do
  case "$1" in
    --arch) ARCH="$2"; shift 2 ;;
    --steps) STEPS="$2"; shift 2 ;;
    --corpus) CORPUS=1; shift ;;
    --keep) KEEP=1; shift ;;
    --out) OUT="$2"; shift 2 ;;
    --seccomp) SECCOMP="$2"; shift 2 ;;
    -h|--help) sed -n '2,22p' "$0"; exit 0 ;;
    *) echo "linux-ci: unknown argument $1" >&2; exit 2 ;;
  esac
done
case "$ARCH" in arm64|amd64) ;; *) echo "linux-ci: --arch must be arm64 or amd64" >&2; exit 2 ;; esac

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd -P)"
WORK="$(mktemp -d "${TMPDIR:-/tmp}/mitori-linux-ci.XXXXXX")"
OUT="${OUT:-$WORK/out}"
mkdir -p "$OUT"
cleanup() { [ "$KEEP" = 1 ] || rm -rf "$WORK/src" "$WORK/docker"; }
trap cleanup EXIT

if [ "${MITORI_DOCKER_CONFIG:-}" != "keep" ]; then
  host="$(docker context inspect --format '{{.Endpoints.docker.Host}}' 2>/dev/null || true)"
  [ -n "$host" ] && export DOCKER_HOST="${DOCKER_HOST:-$host}"
  # an empty credsStore is not enough: the CLI then picks the platform default (osxkeychain) on its own. A helper that
  # knows no credentials makes every pull anonymous. Plugins (buildx) stay reachable through cliPluginsExtraDirs.
  mkdir -p "$WORK/docker/bin"
  printf '#!/bin/sh\n[ "$1" = list ] && { echo "{}"; exit 0; }\necho "credentials not found in native keychain"\nexit 1\n' > "$WORK/docker/bin/docker-credential-mitori-none"
  chmod +x "$WORK/docker/bin/docker-credential-mitori-none"
  export PATH="$WORK/docker/bin:$PATH"
  printf '{"auths":{},"credsStore":"mitori-none","cliPluginsExtraDirs":["%s"]}\n' "$HOME/.docker/cli-plugins" > "$WORK/docker/config.json"
  export DOCKER_CONFIG="$WORK/docker"
fi
if ! docker info >/dev/null 2>&1; then
  echo "linux-ci: the Docker daemon is not reachable (OrbStack: \`orb start\`)" >&2
  exit 3
fi

IMAGE="mitori-linux:$ARCH"
echo "linux-ci: building $IMAGE (cached after the first time)"
docker build --platform "linux/$ARCH" --build-arg "TARGETARCH=$ARCH" --build-arg "UID=$(id -u)" -t "$IMAGE" "$ROOT/scripts/linux" > "$OUT/image-$ARCH.log" 2>&1 || { tail -30 "$OUT/image-$ARCH.log" >&2; exit 4; }
[ "$STEPS" = image ] && { echo "linux-ci: image ready"; exit 0; }

echo "linux-ci: exporting the working tree"
mkdir -p "$WORK/src"
git -C "$ROOT" ls-files -z --cached --others --exclude-standard | (cd "$ROOT" && tar --null -T - -cf -) | tar -xf - -C "$WORK/src"

CORPUS_MOUNT=()
if [ "$CORPUS" = 1 ] && [ -d "$HOME/.cache/mitori-corpus" ]; then
  CORPUS_MOUNT=(-v "$HOME/.cache/mitori-corpus:/home/mitori/.cache/mitori-corpus:ro")
fi
SEC=()
[ "$SECCOMP" = unconfined ] && SEC=(--security-opt seccomp=unconfined --security-opt apparmor=unconfined --security-opt systempaths=unconfined)

echo "linux-ci: running steps $STEPS ($ARCH, seccomp $SECCOMP)"
set +e
docker run --rm --platform "linux/$ARCH" ${SEC[@]+"${SEC[@]}"} \
  -v "$WORK/src:/src" -v "$OUT:/out" ${CORPUS_MOUNT[@]+"${CORPUS_MOUNT[@]}"} \
  -v "mitori-linux-bun-cache-$ARCH:/home/mitori/.bun/install/cache" \
  -e "STEPS=$STEPS" -e "ARCH=$ARCH" -e "SECCOMP=$SECCOMP" \
  "$IMAGE" bash /src/scripts/linux/in-container.sh
code=$?
set -e
echo "linux-ci: exit $code — logs and results in $OUT"
exit $code
