# Linux check image for mitori (scripts/linux-ci.sh): ubuntu 24.04 + the devShell's toolchain versions
# (bun / node / go pinned to flake.nix's; python3 / rust from apt) + bubblewrap (the gate sandbox on Linux, ADR-0013).
# Built for linux/arm64 natively on Apple silicon; linux/amd64 builds under emulation (Rosetta / qemu) for the binary check.
# The repository is NOT copied in: linux-ci.sh mounts a clean export of HEAD at /src.
FROM ubuntu:24.04

ARG TARGETARCH
ARG BUN_VERSION=1.4.2
ARG NODE_VERSION=22.23.3
ARG GO_VERSION=1.26.8

ENV DEBIAN_FRONTEND=noninteractive \
    LANG=C.UTF-8 \
    TZ=Asia/Tokyo

RUN apt-get update \
 && apt-get install -y --no-install-recommends \
      ca-certificates curl unzip xz-utils git bubblewrap procps jq \
      python3 python3-venv cargo rustc rustfmt \
 && rm -rf /var/lib/apt/lists/*

# bun: the x64 baseline build (no AVX2) also runs under Rosetta / qemu
RUN set -eux; \
    case "${TARGETARCH:-arm64}" in arm64) b=bun-linux-aarch64 n=arm64 g=arm64 ;; amd64) b=bun-linux-x64-baseline n=x64 g=amd64 ;; *) exit 1 ;; esac; \
    curl -fsSL -o /tmp/bun.zip "https://github.com/oven-sh/bun/releases/download/bun-v${BUN_VERSION}/${b}.zip"; \
    unzip -q /tmp/bun.zip -d /tmp; install -m 0755 "/tmp/${b}/bun" /usr/local/bin/bun; ln -s bun /usr/local/bin/bunx; rm -rf /tmp/bun.zip "/tmp/${b}"; \
    curl -fsSL "https://nodejs.org/dist/v${NODE_VERSION}/node-v${NODE_VERSION}-linux-${n}.tar.xz" | tar -xJ -C /opt; \
    ln -s "/opt/node-v${NODE_VERSION}-linux-${n}/bin/node" /usr/local/bin/node; \
    ln -s "/opt/node-v${NODE_VERSION}-linux-${n}/bin/npm" /usr/local/bin/npm; \
    curl -fsSL "https://go.dev/dl/go${GO_VERSION}.linux-${g}.tar.gz" | tar -xz -C /opt; \
    ln -s /opt/go/bin/go /usr/local/bin/go; ln -s /opt/go/bin/gofmt /usr/local/bin/gofmt; \
    bun --version; node --version; go version; bwrap --version

# a non-root user: bwrap's unprivileged user namespace and the 0600 state-DB checks behave as on a developer machine
# (UID = the host user's, so the bind-mounted scratch copy and /out stay writable; ubuntu's own uid-1000 user is removed)
ARG UID=1000
RUN (userdel -r ubuntu 2>/dev/null || true) \
 && useradd -m -u "${UID}" -s /bin/bash mitori \
 && mkdir -p /home/mitori/.bun/install/cache /home/mitori/go \
 && chown -R mitori:mitori /home/mitori
USER mitori
ENV GOPATH=/home/mitori/go GOFLAGS=-modcacherw GOTOOLCHAIN=local MITORI_CI=1
RUN git config --global user.email ci@mitori.invalid \
 && git config --global user.name "mitori linux ci" \
 && git config --global init.defaultBranch main \
 && git config --global --add safe.directory '*'
WORKDIR /src
