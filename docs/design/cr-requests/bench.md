# cr-requests/bench.md — 残課題パスの bench トラックから他トラックへの依頼（2026-10-04）

bench トラックは計測と Linux を担当し、下の項目は **所有外なので直していない**。どれも計測か Linux 実機で見つけた事実で、
数字は `docs/progress/bench-baseline.md`、Linux は `docs/progress/rem-bench.md` §3 にある。台帳の行は `packages/core/CR-LEDGER.md` §8。

## 1. safety / platform: Linux の gate sandbox 検出が、実際の profile より緩い（ADR-0013）

- 契約: `packages/platform/src/spawn/sandbox.ts` `probeGateSandbox`、`packages/loop/src/gates/sandbox.ts` `sandboxed("bwrap", …)`
- 観察: 検出は `bwrap --unshare-user --ro-bind / / --dev /dev true` だけを試す。gate の profile は加えて `--proc /proc --unshare-pid
  --unshare-net --tmpfs /tmp` を使う。`/proc` が masked のコンテナ（Docker / OrbStack で seccomp・apparmor だけを外した状態）では
  検出が **"bwrap" を返し、gate はすべて `bwrap: Can't mount proc on /newroot/proc: Operation not permitted` で失敗する**
  （`docs/progress/linux/sandbox-arm64-masked-proc.json`）。devcontainer・CI コンテナで同じになる。
  失敗は「同意を待つ」ではなく gate の error になり、ReadyCard は検査の失敗を出す。
- 確認できたこと: `/proc` も外した（`systempaths=unconfined`）コンテナ = 素の Linux 相当では、検出 "bwrap" と profile の 10 項目が
  すべて期待どおり（`sandbox-arm64-unconfined.json`）。Docker 既定の seccomp では検出が "none" に落ちる（`sandbox-arm64-default-seccomp.json`）。
- 変更案: 検出の argv を profile と同じ名前空間の組にする:
  `bwrap --unshare-user --unshare-pid --unshare-net --die-with-parent --ro-bind / / --dev /dev --proc /proc --tmpfs /tmp true`。
  これが通らない環境は `"none"`（同意の経路）に落ちる。回帰試験は `sandbox.test.ts` の Linux 行に「profile と同じ flag を probe が使う」。
- ループバック（agent CR #8）: Linux の bwrap は `--unshare-net` で **lo が up の private netns** を作るので、`httptest` を使う
  go test は sandbox 内で通る（`sandbox-check.ts` の 1 行目。外向きの TCP・DNS は失敗する）。macOS の `sandbox-exec` だけが
  ループバックも拒否している。macOS 側を (b) にするかは safety トラックの判断（このトラックは Linux で確かめただけ）。
- urgency: high（Linux で gate が動かない環境がある）。

## 2. web: 「scan の要約を表示した」時点の mark が無い（`ui.scanSummary`）

- 契約: `apps/web/src/contract.ts` `PERF_MARKS`
- 変更案: `mitori:scan:summary`（S1 の strip に「スキャン完了 · N files を s 秒で索引」が描かれた後、`markAfterPaint`）。
  入ったら `e2e/perf/lib/ui.ts` `firstUse` に 1 行、budget の `unmeasured` を外す。
- urgency: low。

## 3. cli: ログイン URL が scan の後にしか出ないので、`ui.shellPaint`（300 ms）は構造的に満たせない

- 観察: `mitori <crit> --no-open` は S0–S4 と静的文書が終わってから URL を出す（crit で spawn → URL 1.4 s 前後、負荷下）。
  外枠の描画（`mitori:shell:painted`）はその後なので、bench の `ui.shellPaint` は 1.48 s、`ui.firstUseful.100k` は 1.57 s。
  testing spec E2E-01 は「外枠 ≤ 300 ms、その後に scan 要約と地図」を想定している。
- 変更案: daemon が listen した時点で URL を出し、scan の進捗は SSE（`scan.progress`）で外枠に出す。
- urgency: medium（初見者が最初に待つ時間）。

## 4. indexer: 変化の無い warm scan が S2–S4 をやり直す（`idx.warm.rescan`）

- 観察: daemon は `{kind:"git"}`（commit・checkout・`git add`）のたびに `scan({reason:"git"})` を全段で走らせる。
  変化が無くても S2 18 ms・S3 13 ms・S4 15 ms を毎回計算し、合計 120〜190 ms（crit、負荷 15 前後。budget 10 / 25 ms）。
  gostd（shadow）は 1.4 s。S0–S1 だけなら crit 13 ms（`idx.warm.rescan.s01`）。
- 変更案: S1 の結果（index digest）が前回と同じなら S2–S4 と後段を省く。`bench/runners/idx-warm-probe.ts` が段ごとの内訳を出す。
- urgency: medium。

## 5. testkit: `startTestDaemon` の `login` は `mitori <repo>` の印字 URL を使い、セッションが作れない

- 観察: `e2e/harness/fixtures.ts` の `mitori.login(page, path)` で開いた tab は「このタブの認証が切れました」になる（印字の URL を
  token として扱っている）。`e2e/a11y/screens.ts` は `POST /auth/nonce`（registry の bearer）で nonce を取り直して回避した。
- 変更案: `packages/testkit/src/server/daemon.ts` の `login` を同じ方法にする（`daemon.json` の token → `/auth/nonce`）。
- urgency: medium（実 daemon を相手にする e2e はこれ以外に書けない）。

## 6. platform: git 2.43（Ubuntu 24.04）で PLAT-I-008 の partial clone が `E_GIT_FAILED` になる

- 観察: promisor にだけある blob を読むと、新しい git では `E_NOT_FOUND`、2.43 では `E_GIT_FAILED`（`cat-file` の文言の違い）。
  lazy fetch しないこと（sshCommand が走らないこと）は 2.43 でも守られている。
- 検証パスで原因を特定（reader と同じ env・`-c` で素の git 2.43 を叩いた。`docker run mitori-linux:arm64`）: 2.43 の
  `cat-file --batch` は promisor にだけある object で `<oid> missing` を返さず、**`warning: lazy fetching disabled` →
  `fatal: could not fetch <oid> from promisor remote` で exit 128** する。batch プロセスごと落ちるので reader は
  「cat-file --batch exited」（`E_GIT_FAILED`、retryable）を返し、次の要求で batch を起こし直す（同じ test の「the batch
  survived」は通る）。marker は作られない = sshCommand は走らない。
- 変更案（具体）: `catfile.ts` で、batch が exit 128 で落ちる直前の stderr が `could not fetch .* from promisor remote` なら、
  待っていた要求を `E_NOT_FOUND`（その blob だけ）にする。
- 変更案: `packages/platform/src/git/reader.ts` の分類に 2.43 の文言を足すか、`--batch-check` の `missing` を見て分類する。
- urgency: low（Ubuntu 24.04 の既定の git で 1 テストが落ちる）。

## 7. root（依存）: Linux の `bun install --frozen-lockfile` が `tree-sitter-typescript` の install script で止まる

- 観察: `trustedDependencies: []` なのに、Linux arm64 の初回 install で `tree-sitter-typescript@0.23.2`（indexer の依存。mitori は
  同梱の `.wasm` しか読まない）の install script `node-gyp-build` が走る。**原因は upstream の package**: `prebuilds/linux-arm64/
  tree-sitter-typescript.node` の中身が x86-64 の ELF（`file` で確認。linux-x64 と同じ BuildID）で、arm64 の node は読めない
  （`ERR_DLOPEN_FAILED`）→ node-gyp-build がソースからの build に落ち → `node-gyp` が無くて失敗（`docs/progress/linux/install-diag-arm64.log`）。
  x64（ubuntu-24.04 の CI と同じ）と macOS は prebuild が正しいので表に出ない。`--ignore-scripts` なら arm64 でも install・check・test が通る。
- 変更案: native binding を使わないので、(a) 依存を wasm の取得だけにする（assets.lock の `grammar.*` は既に wasm を固定している）か、
  (b) install を `--ignore-scripts` に統一する（`ci.yml`・README・`scripts/linux-ci.sh`）。Bun が `trustedDependencies: []` でも
  この script を走らせた理由は未確認（Bun の既定の信頼リストの扱い）。
- urgency: high（素の Linux で `bun install` が通らない）。

## 8. web: 計測で見つかった UI の予算超過（参考）

- `ui.cls.boot` 0.049（limit 0.01）: 起動時の CLS。e2e/web でも既知（HANDOFF §0、base でも同じ）。
- `ui.a11y.axe`: S1（地図）に serious 1 件 `nested-interactive`（操作できる要素の中に操作できる要素）。light / dark とも。
- `ui.fetch.readerOpen` 29 件（max 6 [仮]）: Reader の 1 回の読み込みで document・chunk・API・SSE を合わせた件数。
  [仮] の上限を実測に合わせて決め直すか、初期 chunk をまとめる（F5 と同じ論点）。

## 9. indexer: 1 ファイルの `update()` が daemon の部品では 49 ms（`idx.update.1file` 15 / 30 ms）

- 観察: WP-02 の bench（test 用の deps: in-memory DB・`cliGit`）では 2.3 ms。daemon と同じ部品（SQLite ファイル・platform の GitReader・
  daemon の parse Worker）の `bench/idx.bench.ts#update1` では median 49 ms / p95 67 ms（負荷 17）。INT-02 の save → `doc.freshness` は
  go-small で 30 ms、crit で 73 ms（`idx.freshness`）。
- 次の手: 段ごとの内訳を `update()` にも出す（`ScanTimings` 相当）か、`bench/runners/idx-warm-probe.ts` に update の内訳を足して
  GitReader / S2–S4 / 書込のどれかを切り分ける。
- urgency: medium（保存 → 鮮度バッジ 50 ms の大半）。

## 10. indexer: 大きな葉の sig skeleton が 63k tokens（`idx.module.sig.tokens` 24k / 32k）

- 観察: excalidraw の `excalidraw-components-app`（10,842 LOC の葉）。葉の LOC の上端（9k）を超える葉ができていることと同じ原因。
  hono `src` 30.6k、react `compiler-react-compiler-ast` 35.7k も target を超える（`docs/progress/bench-baseline.md` の corpus 表）。
- 変更案: S3 で LOC 上限を超える葉を分ける、または skeleton の degradation（spec §7.2）が `budget` 無しでも上限を守る。
- urgency: medium（生成の入力 token と費用に直結）。

## 11. web: 保存しても Reader に鮮度バッジが出ない（`ui.staleBadge`、E2E-13）— 再読み込みするまで「古い」が見えない

- 契約: `apps/web/src/stores/doc.svelte.ts` `applyFreshness` / `applyClaims`、`apps/web/src/reader/BlockHost.svelte`・`decorate.ts`
- 観察（検証パスで `ui.staleBadge` の bench case を実装して見つけた。`bench/ui.bench.ts#stale-badge`、go-small、in-process daemon +
  Chromium）: 人が出典をつけた block を表示したまま、出典の範囲内の行を保存する → daemon 側は block が `stale`、claim が `stale`
  になり、SSE（`doc.freshness`・`doc.claims`）がページに届く（同じ save で「提案 · 再生成」が本文に出るので SSE は動いている）。
  しかし **10 s 待っても DOM は `.mb[data-fresh="fresh"]`・`.mc[data-verdict="cited"]` のまま**。再読み込みすると
  `data-fresh="stale"`・`data-verdict="stale"` になる。
- 原因: `applyFreshness` は `doc.freshness`（SvelteMap）に書くだけで、**それを読む component が無い**。`applyClaims` は cache した
  section の `claimViews` を差し替えるが、`.mc[data-verdict]` は server の HTML の属性で、`decorateBlock` は「mount か html の
  変化」でしか走らない（verdict だけの変化では block の html は変わらない）。
- 影響（コンセプト）: 「コードを直しながら設計書を読む」人に、いま読んでいる文が古くなったことが見えない。E2E-13 の
  「保存 → バッジ ≤ 50 ms（上限 1 s）」は現状 ∞（再読み込みまで）。
- 変更案: Reader の block の wrapper（`.blk[data-b]`）に `data-fresh={s.doc.freshness.get(id) ?? b.freshness}` を出し、
  `applyClaims` の後に該当 block の `.mc[data-claim]` の `data-verdict` を claimViews から書き直す（`decorateBlock` を verdict 変化でも
  走らせる）。入ったら `bun run bench --id ui.staleBadge` が数値を返す（今は「no stale badge in the Reader 10 s after the save」で
  case error になる）。
- urgency: high（鮮度は「確かさ」の表示の根幹。表示が嘘になる）。
