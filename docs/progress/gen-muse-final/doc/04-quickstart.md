# 4. 動かしてみる <!-- b_18fxn1cv -->

**手順（コードから読み取った 0 tok の手順）**
1. 必要なもの: Go `1.26.0`（`go.mod:3`）
2. 依存を入れる: `npm install`（`package-lock.json` から判断）
3. 起動する: `go run ./cmd/crit`（`cmd/crit/main.go:21`）
4. 開く: http://localhost:3000（`README.md:20`）
<!-- b_nxgxntyw -->

**スクリプト**
| 用途 | 名前 | コマンド | 定義 |
|---|---|---|---|
| test | `e2e` | `cd test/e2e && bash run.sh` | `Makefile:87` |
| test | `e2e-failed` | `cd test/e2e && npx playwright test --last-failed` | `Makefile:90` |
| test | `e2e-gitlab-roundtrip` | `./scripts/e2e-gitlab-roundtrip.sh` | `Makefile:74` |
| test | `e2e-live-utils` | `node --test web/__tests__/*.test.js` | `Makefile:96` |
| test | `e2e-report` | `cd test/e2e && npx playwright show-report` | `Makefile:93` |
| test | `e2e-roundtrip` | `./scripts/e2e-roundtrip.sh` | `Makefile:71` |
| test | `e2e-share` | `./scripts/e2e-share.sh` | `Makefile:68` |
| test | `test` | `go test ./...` | `Makefile:29` |
| test | `test` | `npx playwright test` | `test/e2e/package.json:5` |
| test | `test-daemon` | `./test/shell/test-daemon-reuse.sh` | `Makefile:77` |
| test | `test-diff` | `./test/shell/test-diff.sh` | `Makefile:56` |
| test | `test-frontend` | `npm run test:frontend` | `Makefile:32` |
| test | `test-live-cdp` | `go test -tags integration -run TestLiveCDPIntegration -v -count=1 ./internal/live/...` | `Makefile:65` |
| test | `test-plan-daemon` | `./test/shell/test-plan-daemon.sh` | `Makefile:80` |
| test | `test-preview` | `@echo "Starting preview mode with sample page..."` | `Makefile:99` |
| test | `test-share-sync` | `go test -tags integration -run TestShareSync -v -count=1 ./...` | `Makefile:59` |
| test | `test-share-sync-selfhosted` | `@./scripts/run-selfhosted-tests.sh` | `Makefile:62` |
| test | `test:debug` | `npx playwright test --debug` | `test/e2e/package.json:7` |
| test | `test:frontend` | `node --test web/__tests__/*.test.js` | `package.json:17` |
| test | `test:headed` | `npx playwright test --headed` | `test/e2e/package.json:6` |
| test | `test:perf` | `node --test web/__tests__/perf/*.perf.test.mjs` | `package.json:18` |
| build | `build` | `go build -ldflags "$(LDFLAGS)" -o crit ./cmd/crit` | `Makefile:6` |
| build | `build-all` | `mkdir -p dist` | `Makefile:16` |
| other | `bench` | `go test -run='^$' -bench=. -benchmem -count=6 ./internal/diff/ ./internal/session/` | `Makefile:46` |
| other | `bench-compare` | `benchstat bench-old.txt bench-new.txt \| tee benchstat.txt` | `Makefile:49` |
| other | `clean` | `rm -f crit` | `Makefile:83` |
| other | `generate` | `go generate ./...` | `Makefile:9` |
| other | `record-assets` | `node scripts/record-vendored-assets.mjs` | `package.json:13` |
| other | `report` | `npx playwright show-report` | `test/e2e/package.json:8` |
| other | `setup-hooks` | `git config core.hooksPath .githooks` | `Makefile:53` |
| other | `update-deps` | `npm install --ignore-scripts` | `Makefile:25` |
| other | `update-deps` | `node copy-deps.js` | `package.json:12` |
| other | `verify-assets` | `npm run verify-assets:installed` | `Makefile:35` |
| other | `verify-assets` | `node scripts/verify-vendored-assets.mjs` | `package.json:14` |
| other | `verify-assets:installed` | `node scripts/verify-vendored-assets.mjs --installed` | `package.json:15` |
| other | `verify-assets:npm` | `node scripts/verify-vendored-assets.mjs --npm` | `package.json:16` |
| other | `verify-generate` | `go generate ./...` | `Makefile:12` |
<!-- b_kzh55zq3 -->

**環境変数**
| 名前 | 既定値 | 読む場所 |
|---|---|---|
| `BRIDGE_PORT` | なし | `integrations/docker/Dockerfile:24` |
| `CODEX_HOME` | なし | `cmd/crit/cli_install.go:1091` `internal/testutil/testutil.go:111` |
| `CRIT_AUTH_TOKEN` | なし | `internal/auth/auth.go:368` `internal/auth/auth.go:645` `internal/config/share_targets.go:230` `internal/server/share_targets.go:123` `internal/share/share.go:1132` |
| `CRIT_DEBUG` | なし | `internal/session/session.go:2510` |
| `CRIT_HOST` | なし | `internal/config/cli_resolve.go:64` |
| `CRIT_NO_INTEGRATION_CHECK` | なし | `cmd/crit/cli_serve.go:47` `cmd/crit/integrations.go:684` `internal/session/daemon_cli.go:57` |
| `CRIT_NO_UPDATE_CHECK` | なし | `cmd/crit/cli_serve.go:283` |
| `CRIT_PLAN_REVIEW` | なし | `internal/session/plan_cli.go:355` |
| `CRIT_PORT` | なし | `integrations/docker/Dockerfile:24` `internal/config/cli_resolve.go:51` `internal/server/daemon_cli.go:409` |
| `CRIT_PUBLIC_URL` | なし | `internal/config/public_url.go:17` |
| `CRIT_SHARE_URL` | なし | `internal/config/cli_resolve.go:75` `internal/config/share_targets.go:198` `internal/server/daemon_cli.go:194` `internal/server/daemon_cli.go:198` `internal/server/daemon_cli.go:277` `internal/share/share.go:1096` |
| `GOBIN` | なし | `internal/server/install_source.go:31` |
| `GOPATH` | なし | `internal/server/install_source.go:31` |
| `HOME` | なし | `internal/testutil/testutil.go:109` |
| `USERPROFILE` | なし | `internal/testutil/testutil.go:110` |
| `WSL_DISTRO_NAME` | なし | `internal/browser/browser.go:105` |
| `WSL_INTEROP` | なし | `internal/browser/browser.go:105` |
| `_CRIT_READY_STDOUT` | なし | `internal/daemon/daemon.go:940` `internal/daemon/daemon.go:943` |
<!-- b_2y9360h7 -->

**入口**
| 入口 | 種類 | 場所 |
|---|---|---|
| cmd/crit/gen_integration_hashes.go | main | `cmd/crit/gen_integration_hashes.go:16` |
| cmd/crit | main | `cmd/crit/main.go:21` |
| /usr/local/bin/entrypoint.sh | dockerfile | `integrations/docker/Dockerfile:28` |
| bash | dockerfile | `integrations/docker/Dockerfile:29` |
| scripts/bench-compare.py | main | `scripts/bench-compare.py:169` |
<!-- b_3twpt9qk -->
