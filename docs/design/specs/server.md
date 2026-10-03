# server spec — daemon・composition root・配線（`@mitori/server` / `@mitori/client` / platform の port）

- 版: 1.0（2026-10-03、レビュー R1 で新設: CONS-02 / SC-05） / 所有: lead architect（実装は WP-09 と integrator）
- 契約: `contracts/server.ts`（本書の §n は同ファイルの節番号に対応）、`contracts/api.ts`（route・SSE・DTO）、`contracts/core.ts` §18（port）
- 原則: server は**ドメインロジックを持たない**。認証、route の振り分け、書き込みの直列化、event の刻印と配信、パッケージ間の配線（gen ⟂ loop）だけを行う。

---

## 1. daemon の寿命

### 1.1 起動

1. CLI が `~/.mitori/daemon.json`（`DaemonRegistry`）を読む。無い／PID が死んでいる／`GET /health?challenge=<32hex>` が `DAEMON.healthTimeoutMs`（1.5 s）以内に返らない、または `proof ≠ HMAC-SHA256(token, challenge)` なら「daemon なし」と判定する（PID 再利用・偽の listener 対策、SEC-06）。
2. `mitori _serve` を headless で spawn する。daemon は (a) `~/.mitori/daemon.lock` を `O_CREAT|O_EXCL` で作成（失敗時: 中の PID が生きていて health も通れば終了、死んでいれば `lockStaleProbes`=2 回確認後に奪取）、(b) `resolveSafePath()` で SAFE_PATH を作り、`chdir(~/.mitori/run/empty)`、(c) `claude`/`git`/`gh` を SAFE_PATH から 1 回解決し `GlobalSettings.pins` と比較（差異は `E_ENGINE_BINARY_CHANGED` を engine card に出し、その engine は使わない、SEC-10）、(d) `state.sqlite` を開き migration（`MIGRATION_ORDER.state`）、(e) port: `srv_ports` の前回値を `Bun.serve` で試し、使えなければ OS 割り当て（localStorage の origin を保つため前回値を強く優先、UXP-07）、(f) 256 bit の bearer token を生成し registry を 0600 で atomic write。
3. CLI は `POST /auth/nonce {to}` で nonce URL を得て、`WorkspaceStatus.connectedTabs === 0` のときだけブラウザを開く（UXP-01）。

### 1.2 version 不一致（`decideVersionAction`）

| CLI と daemon | daemon の状態 | 動作 |
|---|---|---|
| version 同じ | 任意 | use |
| version 違い・apiVersion 同じ | idle（job・待機中 review・生成なし） | restart（`POST /daemon/shutdown` → 起動）。開いているタブは reload banner だけ（session は生き残る） |
| version 違い・apiVersion 同じ | busy | use + stderr に警告 |
| apiVersion 違い | idle | restart |
| apiVersion 違い | busy | `E_VERSION_MISMATCH`（exit 1。「実行中の job が終わってから再実行」） |

### 1.3 終了

- 全 workspace が idle（SSE client 0・job 0・waiter 0・生成 0）のまま `DAEMON.idleExitMs`（**4 時間**、UXP-07）で自動終了。workspace 単位は `workspaceUnloadMs`（30 分）で unload。
- `mitori stop` / shutdown: (1) 新規 job を拒否（`E_SHUTTING_DOWN`）、(2) SSE `server.shutdown`、(3) 待機中 `mitori review` に `approved:false`、(4) `AgentScheduler.drain()`（SIGINT → result 待ち `DAEMON.drainMs` 10 s → SIGKILL）、(5) 各 workspace の `doc.flush({force:true})`、(6) DB close、lock 削除。

### 1.4 計測（[仮]、M1 で確定）

idle RSS は `srv.rss.idleEmpty ≤ 30MB`（workspace なし）と `srv.rss.idleLoaded ≤ 150MB`（100k LOC を 1 つ load、60 s idle、PT-14）に分けて budgets に置く。

## 2. platform の port（server だけが使うもの）

| port | 規則 |
|---|---|
| `FsWatcher` | macOS/Windows は recursive `fs.watch`、Linux は WP-01 の O3 実測で決定。`WATCH_BATCH` = leading 5 ms + max-wait 30 ms（保存 → stale バッジ 50 ms 予算、indexer CR-10）。docDir では `DOC_WATCH_IGNORE`（`cache/**`, `tmp/**`）を無視（session engine の書き込みで再読込しない、CONS-20）。`.git/index`・`HEAD`・refs の変化は `{kind:"git"}` |
| SAFE_PATH | `resolveSafePath`: 空・相対・登録済み workspace 配下・CLI 起動時 cwd 配下・`node_modules/.bin`・`.venv/bin` の PATH 要素を除去。全子プロセスの PATH はこれ |
| `SafeWriter`（core） | ADR-0014。daemon の全ファイル書き込みが通る。lint で他を禁止 |
| `WorkerPool`（core） | parse（indexer）、ELK（専用 1 本、`elk-api.js` + 埋め込み `elk-worker.min.js`）、compute（Shiki・大きな diff、UI 接続中は 1 本 warm、PT-16） |

## 3. runtime と write queue

### 3.1 2 種類の writer（CONS-03）

- **workspace ごと**: `WorkspaceRuntime.write(label, fn)`。promise chain の mutex。`fn` の中で `db.tx()`（IMMEDIATE）を開き、in-memory の変更と docDir の変更予約を行う。`fn` は同期関数（`<T>(label, fn: () => T) => Promise<T>`）なので LLM・git・network・Worker を待てない（型で強制）。commit 後、`fn` 中に `events.emit` された payload に次の `rev` を刻んで hub に渡す（rev は event を出した write だけ進む）。
- **daemon 全体で 1 つ**: `StateRuntime.stateWrite`。`state.sqlite`（ledger・calibration・trust・sessions・workspace 登録・port）の唯一の writer。agent bridge・trust・installer・session service はこれを注入される。
- dev ビルドでは DocStore / ReviewEngine / JobRunner の mutator が write slot の外で呼ばれると `E_INTERNAL "mutation outside write queue"` を投げる（SRV-U-018）。

### 3.2 WorkspaceManager

| 状態 | 入る条件 | 出る条件 |
|---|---|---|
| `loading` | `get()`/`open()` | DB open → `MIGRATION_ORDER.workspace` → settings 解決 → `doc.load()`（なければ `ensureManifest()` は最初の applyStatic で） |
| `scanning` | load 完了 | `indexer.scan({reason:"open"})` 完了 → watcher 開始 |
| `ready` | scan 完了 | — |
| `error` | 任意段階の例外 | `POST /ws/:ws/scan {force}` で再試行 |

- `open(target, {force})`: path は realpath 化。`$HOME`・`/`・`/Users`・Desktop/Documents/Downloads・`~/Library` 配下、または深さ 1 に project marker（package.json, go.mod, pyproject.toml, Cargo.toml, *.sln, Makefile, src/, README*）が無ければ `E_WS_NOT_PROJECT`（UXP-23）。GitHub URL は owner/repo の正規表現（api `OpenWorkspaceReq`）を通してから `gh repo clone … -- --depth 1 --no-tags`（`GIT_LFS_SKIP_SMUDGE=1`、submodule なし、SEC-14）。
- `registered(toplevel)`: hook の `touch` 用。**開かない・scan しない**。未登録なら `{staleBlocks:0, registered:false}` を即返す（≤ 20 ms、SEC-21 / UXP-32）。

### 3.3 workspace の種類と git

- `git`: ユーザーの repo は**読むだけ**。mitori の object・ref・worktree は `~/.mitori/repos/<ws>/side.git`（`objects/info/alternates` にユーザーの objects、ADR-0012）。
- `shadow`: `GIT_DIR=~/.mitori/repos/<ws>/shadow.git`、`GIT_WORK_TREE=<dir>`。side repo は不要（shadow 自体が mitori 専用）。
- `remote-readonly`: `~/.mitori/clones/<o>/<r>`。gate の trust 既定は denied、accept は `.patch` を書くだけ（`AcceptRes.kind:"patch"`）。

### 3.4 migration

`MIGRATION_ORDER` の package 順、package 内は version 昇順、前進のみ。`srv_migrations(pkg, version, applied_at)`。失敗は workspace `error`（state DB なら daemon 起動失敗）。

## 4. 配線（DOMAIN_WIRING）

### 4.1 なぜここか

gen と loop は互いに import できない。indexer は anchor を知らない。doc は gen を知らない。これらの相互作用は全て server の `DOMAIN_WIRING` 表だけで起こる（表にない呼び出しは実装しない）。

### 4.2 表（`server.ts` が正本。ここでは順序と理由）

**index.delta**（watcher → `indexer.update` → `IndexDelta`）

1. `assembleAnchoredItems`（queue 外・純関数）: delta の `changed` / `renames` にある path を cite する全 claim cite（claim id → cite index 順）と、code member の path が変わった未解決 thread（thread id 順）。doc 主の thread は code member を明示的に取ったときだけ含める（それ以外は claim に追従）。
2. `anchors.reanchor(items, delta, ctx)`（queue 外）。`ctx.blobText` は `indexer.blobText`（pin store 込み、CONS-13）。
3. `distributeReanchor` → **同じ 1 slot** で `doc.setClaimChecks`（moved の cite 更新、overlapped は verdict `stale`）+ `review.applyReanchor(updates, ownThreads=[])` + `doc.setFreshness`（W1・W2）。
4. 同 slot 直後の own slot で `indexer.pinBlobs(新 anchor の blob)` / `unpinBlobs(旧)`。
5. `gen.onIndexDelta({delta, claims})`（queue 外、≤ 30 ms）→ suggestion は 6 で publish（W3）。
6. `publishSuggestions`（own slot）: `gen_suggestions` を置き換え、SSE `gen.suggestions`。
7. palette の情報源 digest が変われば `palette.changed`（PT-15）。

**job.accepted**（loop の `LoopDomainEvent`）

1. `docCommitted && review.autoCommit` のとき: accept と**同じ slot** の中で `doc.flush({force:true})` を予約し、変更された docDir ファイルを同じ commit の path 集合に加える（CONS-36）。
2. `review.markStale(hunks, ownThreads)`。
3. `gen.syncBlocks(docTargets − docUpdated の stale 部分, {kind:"job", id}, {confirm:false})`（見積りのみ）→ suggestion として publish（D12、CONS-09）。

**round.completed**: `indexer.update(files)` → index.delta 連鎖 → `gen.syncBlocks(blocksOf(doneThreads), {kind:"round"}, {confirm:false})` → publish。
**checkpoint.undone**: `doc.undoAccept(proposals)` → `indexer.update(files)` → 連鎖。
**files.touched**: `doc.setFreshness(blocksCiting(paths), "stale")` のみ（再 index は watcher に任せる）。
**doc.external_edit**（docDir の watcher）: `doc.load()`（§10.4 の取り込み。所有台帳と違うファイルは notice、SEC-02）。
**settings.changed**: resolver を再実行。include/exclude/denyGlobs が変われば `indexer.scan({reason:"settings"})`。
**trust.decided**: 承認待ちの gate がある job を再評価。

### 4.3 順序不変条件

- W1: 1 delta につき `AnchorEngine.reanchor` は 1 回（claim と thread をまとめる）。stale 判定はその後。
- W2: 同じ delta の claim 更新と thread 更新は同じ slot（読み手が「claim は動いたが thread は動いていない」を見ない）。
- W3: gen の計算は queue 外、結果の反映だけ own slot。
- W4: accept の path lock（`job_locks`）は write slot に**入る前**に取り、slot を出てから外す（slot の中で lock を待たない）。

### 4.4 Composer 用の補足（ux R22）

- `doc_edit` の draft thread は Finish で送らない（UI の下書き）。`POST /jobs/estimate` は draft thread も受け、本文を `targetDocMd` として 2 択の費用を返す。

## 5. SSE hub（CONS-04 / PT-01 / SEC-06）

- **seq**: daemon 全体で単調増加。全 event の `id:`。envelope は `{seq, ws, rev, at}`（rev は workspace event だけ）。
- **transport**: `fetch()` stream（`authorization: Mitori-Session <token>`）。`GET /events?ws=<ws>&last=<seq>`。最初に `:\n\n`、続けて `hello {version, apiVersion, resumedFrom, boot}`。
- **replay**: replayable event だけを全体リング（`ringBufferEvents` 4,096）に保持。`last` がリングより古い、または client が覚えている `boot` と違えば `resync {reason}`。
- **coalesce**: `SSE_EVENT_META[type].coalesce` に従う。`key:"entity"` は `entityKey` のパスの値ごとに独立。`job.event` は text delta を job ごとに連結し、text 以外の job event（phase/tool/result/usage final/window/gate/error）は合体せず、届いた時点で保留 text を先に flush してから送る。fuzz 試験（3 job × 200 delta × 1 ms）で client 側の再構成が byte 一致（SRV-I-016）。
- **scope**: global event（notice・engines・scheduler・usage・workspace.updated・settings）は全接続へ、workspace event は `ws` 一致の接続へ。
- heartbeat `: hb` 15 s。backpressure: 1 接続の未送信が 1 MiB を超えたら切断（client は `last` で再接続）。

## 6. settings resolver

1. 既定値（`DEFAULT_GLOBAL_SETTINGS`）← `~/.mitori/config.json`（schema 検証、未知キーは `E_CFG_INVALID`）← `workspaces[<ws>]` override ← `<docDir>/config.json` の**repo スコープのキーだけ**（`SETTING_SCOPES` で `repo` を含む行）。
2. repo ファイルのそれ以外のキーは `ignoredRepoKeys` + `notice.settings.ignoredRepoKeys`。
3. `denyGlobs` = `DEFAULT_DENY_GLOBS` ∪ `security.denyGlobs` ∪ repo `denyGlobs` ∪ `<docDir>/**`（docDir が既定以外でも agent から守る、SEC-02）。
4. `gates` と `rules` は `TrustState === "trusted"` のものだけ有効（`rules.trust = true`、SEC-22。単体試験は RT-05 を反映）。`trustedGates` は template（CONS-12）。
5. `PATCH /settings`（web のみ）: `checkSettingsPatch` が `EXEC_SETTING_KEYS` 配下を `E_FORBIDDEN_KEY` で拒否。ただし `limits.*` の**減少**は許可。
6. `PATCH /settings/exec`（cli のみ）: `mitori config set <path> <value>` が差分を表示し、TTY で `yes` を求める。CLAUDECODE / CODEX_* が env にあるか非 TTY なら CLI 側で `E_TTY_REQUIRED`（exit 2）。daemon は global config を SafeWriter（kind `home`）で書き、`settings.updated`。
7. 人が `~/.mitori/config.json` を直接編集した場合は watcher が検知し再読込（`notice.settings.reloaded`）。

## 7. trust・session・inbox

### 7.1 trust（`TrustService`）

- 状態: `unknown → pending`（内容を初めて見た。`trust.request` を 1 hash につき 1 回）→ `trusted | denied` → 内容 hash が変われば `pending`。
- 決定は `POST /ws/:ws/trust/:tr`（web のみ）。**作成から 60 s 未満の session からの決定は拒否**（`DAEMON.trustMinSessionAgeMs`、SEC-19）。
- `remote-readonly` の `gates` は最初から `denied`（opt-in のみ）。`git_config`（SEC-05）は trusted になるまで該当キーを `-c key=` で無効化する。
- ダイアログ文言は事実どおり（gate: 「あなたの権限で実行されます。sandbox が無い環境ではネットワークとホームにアクセスできます。AI が書いたコードがここで実行されます」、SEC-03）。

### 7.2 session（ADR-0009 R1）

- `~/.mitori/session.key`（0600、256 bit）。session token は 256 bit 乱数、DB には `HMAC(session.key, token)` だけを保存（`srv_sessions(id, mac, created_at, last_seen_at, ua_hash)`）。
- `POST /auth/exchange {nonce}`（`auth:"nonce"`）→ `{token, session, expiresAt}`。nonce は 60 s・1 回限り。
- 検証は定数時間比較、`last_seen_at` を更新（30 日 sliding）。daemon 再起動後も有効（UXP-07）。`mitori doctor --rotate-session` で key を回転し全 session 失効。
- `x-mitori-client` は自己申告。`clients` 制限は誤用防止であり、境界ではない（SEC-19）。

### 7.3 Inbox（`buildInbox`）

- 情報源: loop（thread・job）、doc（proposal）、trust（pending）、gen（実行中・失敗 run）、suggestion。
- tag の付け方（`InboxFilter`）: `mine` = 人の番（answered・proposed・needs_input・failed・stale・outdated・pending proposal・trust）、`working` = queued/running/gating/repairing・実行中 run、`review` = ready job、`failed`、`outdated` = anchorHealth outdated、`draft`（本文あり draft のみ、UXP-22）、`resolved`、`proposals`、`trust`、`suggestions`、`uncommitted` = applied かつ `Checkpoint.commit` なし（UXP-19）、`all`。
- 並び: `updatedAt` 降順 → kind 順（thread < job < proposal < trust < gen_run < suggestion）→ id。

### 7.4 review の待機（UXP-01）

- `GET /review/wait` は `x-mitori-waiter`（CLI process ごとに固定の乱数）で waiter を数え、最後の poll から 35 s までは在席とみなす。数か agent label が変わると `review.waiting`。
- `/w/:ws/review` の解決は ui.ts `PullBarProps` 注記のとおり。

## 8. route の所有（`ROUTE_OWNERS`）

- 全 109 route に owner（server / indexer / doc / gen / loop / agent）。handler は owner の公開 API を呼ぶ薄い adapter で、DTO 変換（例: `AnchorInput` → `Anchor` は `AnchorEngine` で）だけを行う。
- 未実装の route は `501 E_UNSUPPORTED`（`ROUTE_META.stretch` の route は MVP では 501 でよい）。CI は「全 RouteKey に owner と handler（または明示的な 501）」を検査する。
- 主な server 所有: health・daemon・auth・events・settings・workspaces・ws status/init/settings/trust/git・inbox・prompt 以外の横断。`POST /ws/:ws/check` は gen（gen-output 判定）と doc（doc / repo-config）を server が振り分ける。

## 9. HTTP

- 順序（`HTTP_PIPELINE`）: host（421）→ route（404）→ auth（401）→ CSRF（403）→ client kind（403）→ content-type（415）→ body size（413）→ idempotency（409）→ workspace（404）。
- CSRF: session token 付きの変更系は `sec-fetch-site` があれば `same-origin` 必須。bearer 付きは `sec-fetch-site: cross-site` を拒否。CORS header は一切出さない。
- 全応答に `SECURITY_HEADERS`。コード・doc 本文を返す API（files/content、cite、doc、bundle、diff、prompt、export）は `Cache-Control: no-store`（SEC-17）。
- idempotency: `idempotency-key` を workspace route は `srv_idempotency`、global route は state DB の `srv_idempotency_global` に 10 分保存。同じ key + 同じ body hash ⇒ 同じ応答、違う body ⇒ 409。
- エラー: `ERROR_META[code].http`、body `ApiErrorBody`（見積りずれは `estimate` 同梱、CONS-33）、`requestId`。

## 10. composition root（`createServer`）

- `packages/server/src/compose.ts` の 1 ファイルが全実装を組み立てる（**integrator の所有**、SC-06）。順序: state runtime → session/trust → agent bridge（scheduler・ledger・engines）→ anchor engine → renderer/layouter → WorkspaceManager（workspace ごとに indexer → doc（stamper は後で gen の Verifier を差し込む lazy 参照）→ gen → loop）→ installer → HTTP。
- テスト: 同じ `ServerDeps` に `@mitori/<pkg>/testing` の fake（in-memory SQLite、録画再生 Spawner、FakeClock、seeded Random、inline WorkerPool）を渡す。`build:"test"` のとき `/__test/*`（metrics・時計・fault 注入）が有効、release では DCE で消える。

## 11. `GET /ws/:ws/doc/text`

- `ref`: section id（子を含む）、block id、`*`（全体、読書順）。`depth`: 0〜3（その Depth 以下）。
- 出力: file 形 Markdown。各 block の前に `<!-- b_xxxxxxxx §<section> L<depth> -->`。block 間は空行 1 つ。≤ 400k 文字（超過は末尾に `<!-- truncated -->`）。MCP 経由では UNTRUSTED_FENCE で包む（SEC-04）。

## 12. 受け入れ試験（WP-09 / integrator）

| ID | 内容 |
|---|---|
| SRV-AT-01 | 不正 Host → 421、`Sec-Fetch-Site: cross-site` の POST → 403、token なし → 401、web から cli 専用 route → 403、CORS header 0、全応答に `SECURITY_HEADERS` |
| SRV-AT-02 | `ROUTE_META` と `ROUTE_OWNERS` の全 route に handler（または 501）（網羅テスト） |
| SRV-AT-03 | SSE: 200 接続で publish → 配信 p99 ≤ 5 ms、切断 → `last` 再接続で欠落 0、リング超過で resync、別 boot で resync、PT-01 fuzz の byte 一致 |
| SRV-AT-04 | write queue: 並行 100 書き込みで rev が単調・欠番なし、slot 外 mutation の dev assert、state DB を 3 workspace + agent bridge から同時に書いて SQLITE_BUSY 0 |
| SRV-AT-05 | daemon 再起動後、開いていたタブが 401 なしで ≤ 5 s で live（AC-U09） |
| SRV-AT-06 | `PATCH /settings` に `engines.claude-cli.binary` を含めると `E_FORBIDDEN_KEY`、`limits.jobMaxUsd` の減少は成功・増加は拒否 |
| SRV-AT-07 | 未登録 repo への touch 100 回で scan 0・各 ≤ 20 ms |
| SRV-AT-08 | DOMAIN_WIRING: fixture repo で 1 ファイル保存 → claim と thread が同じ rev で更新、suggestion が `gen.suggestions` で届く、LLM 呼び出し 0 |
| SRV-AT-09 | `GET /health?challenge` の proof 不一致で CLI が token を送らない（偽 listener 試験） |
| SRV-AT-10 | idle RSS（empty / loaded）と外枠描画 ≤ 0.3 s |
