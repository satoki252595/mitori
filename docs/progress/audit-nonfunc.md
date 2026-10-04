# 監査: 非機能・ループの健全性（nonfunc lens、2026-10-04）

対象は main `772cdcd`（4 トラック統合後）と、そこから作った `dist/mitori-darwin-arm64`（09:23 ビルド、コード変更なし）。
測定機は Apple M5 Max（18 コア）。他の監査エージェントと同時に動いていたため、**ロードアベレージは 8.6〜16.5**。時間の数字は
混んだ機械でのもので、静かな機械ではもっと速い。**新しい LLM 消費は $0**（`claude` CLI はログアウト状態のまま。ジョブは 1 本も送っていない）。

測り方（再現用スクリプトは scratchpad の `audit-nonfunc/{measure,interact,assets,type,shot}.mjs`）:
- 起動 → 最初の有用な画面: repo ごとに新しい `MITORI_HOME`、`mitori <repo> --no-open` を spawn した時刻から、
  ヘッドレス Chrome（ウォーム済み）で `mitori:map:painted` と `mitori:facts:painted` の両方が付くまで。
- 配信 JS: 実際に読まれた `/assets/*.js` の `content-length`（br）と、同じファイルを gzip で取り直した値。
- メモリ: `/usr/bin/time -l`（max RSS・peak memory footprint）と `footprint <pid>`（macOS の実際の使用量）。
- 操作の遅さ: `mitori:level:applied` / `mitori:palette:results` のマーク（キー押下の直前からの差）と、Event Timing API（16 ms 以上の操作）。
- 1,000 ブロック超の Reader: crit のコピーの §3 に、dogfood2 の生成済みモジュールページから作った 1,201 ブロックを入れて開いた。

スクリーンショットは `docs/progress/audit/nonfunc/`。

---

## 1. 測定結果

### 1.1 開く → 最初の有用な画面（新しい MITORI_HOME、コールド）

| repo | ファイル（取り込み） | module | S0–S4 + 静的文書 | URL 表示 | **最初の有用な画面** | 予算 target / limit | 地図の DOM |
|---|---|---|---|---|---|---|---|
| m3e-canvas | 87 | 5 | 360 ms | 454 ms | **0.63 s** | 3 s / 5 s ✅ | 548 |
| hono | 552 | 5 | 598 ms | 719 ms | **0.88 s** | ✅ | 506 |
| crit | 879 | 16 | 810 ms | 995 ms | **1.16 s** | ✅ | 773 |
| excalidraw | 956 | 29 | 1,210 ms | 1,398 ms | **1.63 s** | ✅ | 1,111 |
| react | 2,845（7,252 中） | 78 | 2,614 ms | 2,862 ms | **3.35 s** | target 超・limit 内 | 589 |

- react の S0–S4 は 2.6 s（`idx.s04.cold.react` 1.5 / 3.0 s）。2 回目以降の open は 0.81〜1.13 s（索引を再利用）。
- コンソールエラー 0、4xx/5xx 0（全 repo）。

### 1.2 初期 JS（地図の画面で実際に読まれたもの）

| chunk | br | gzip |
|---|---|---|
| entry | 51.4 KB | 58.2 KB |
| i18n-ja（UI 文言の全カタログ） | 15.9 KB | 18.3 KB |
| map | 14.2 KB | 15.8 KB |
| **loop**（Composer・ジョブ・Review の store） | 17.2 KB | 19.3 KB |
| gen | 6.8 KB | 7.8 KB |
| boot・levels・visibility | 1.0 KB | 1.1 KB |
| **合計** | **104 KB** | **117.7 KB** |

`asset.js.initial.gz` は target 60 / limit 150 KB。M1 の記録（83〜84 KB）から **+40 %** 増えたが、どこも警告を出していない（§2 F4）。

### 1.3 Reader と操作

| 項目 | 予算 | 結果 |
|---|---|---|
| 読者レベルの切り替え（`-` `=` `0`） | `ui.level` 50 / 100 ms | 2〜17 ms ✅（1,201 ブロックの節でも同じ） |
| ⌘K の 1 打鍵 → 結果の描画 | `ui.palette` 16 / 33 ms | **26〜33 ms**（どの repo でも。m3e の 87 ファイルでも同じ）。1 打鍵目だけ 5〜22 ms |
| 操作の遅延（Event Timing、16 ms 以上の操作の最大） | `ui.inp` 100 / 200 ms | 16〜32 ms ✅ |
| 静的文書の節（4 ブロック）の描画 | `ui.section` 100 / 150 ms | 36〜150 ms ✅ |
| **1,201 ブロックの節**: 描画まで | `ui.section` 150 ms・`doc.render.2000.cold` 1.0 / 1.5 s | **1,016 ms**（API のコールド 659 ms、ウォーム 120 ms） |
| 〃 DOM ノード | `ui.dom.max` 15,000 | **1,058**（スクロール後 1,578）✅ 仮想化が効いている。マウントされたブロック 100 |
| 〃 40 回のホイールスクロール | — | long task 0 ✅ |
| 〃 節の JSON | — | **1.5 MB、gzip を受け付けても非圧縮** |

### 1.4 メモリ

| repo | max RSS（daemon） | peak footprint | idle の footprint |
|---|---|---|---|
| 空の daemon（`_serve`） | 287 MB | — | **34 MB** |
| m3e-canvas | 550 MB | 366 MB | 144〜154 MB |
| hono | 700 MB | 419 MB | 196 MB |
| crit | 968 MB | 473 MB | 223 MB |
| excalidraw | **1,006 MB** | 471 MB | 230 MB |
| react | **1,104 MB** | 689 MB | 243 MB |
| crit + 1,201 ブロックの節 | **1,443 MB** | **902 MB** | 265〜269 MB |

- 予算: `idx.rss.peak` 700 / **1,000 MB**、`srv.rss.idleEmpty` 30 / **50 MB**、`srv.rss.idleLoaded` 150 / **250 MB**。
  RSS で見ると 3 つとも超えている。footprint（Activity Monitor の「メモリ」と同じ）で見ると idle は収まっている。
  macOS の RSS は JavaScriptCore が解放済みでまだ OS に返していないページ（`footprint` の Reclaimable 400 MB 前後）を含むので、
  予算をどちらで判定するか決まっていない — そして **この 3 つを測る bench は存在しない**（§2 F4）。
- m3e（87 ファイル）でも、ブラウザを繋がなくても開いてから約 1.4 s で RSS が 305 → 530 MB に跳ねる（footprint は 154 → 148 MB で変わらない）。
  ログ上は claude CLI の検出（`agent.claude.first_run_pin`）と同じ時刻。
- 1,201 ブロックの節を 1 回コールドで描画すると RSS +540 MB（footprint は +40 MB 程度）。

### 1.5 トークン・費用（記録済みの台帳から。新しい消費なし）

| タスク | 予算 | 実測（台帳） | 見積り → 実測 |
|---|---|---|---|
| Explain（answer） | XS bundle 0.4〜0.7k | 入力 1,958・出力 389・$0.0088・4.7 s | 入力 1,249 → 1,958（**+57 %**）、$ +3 % |
| Fix（patch、1 ファイル） | `loop.patch.in` ≤ **3,000**、`loop.patch.usd` ≤ $0.05 | 入力 **3,386**（+13 % 超過）・出力 756・$0.0141・7.9 s | 入力 ≈2k → 3,386（**+69 %**）、$ −17 % |
| Fix（patch、run 4） | 同上 | 入力 3,281・$0.0145 | 入力 2,039 → 3,281（**+61 %**）、$ −24 % |
| Fix（agent、3 ファイル） | context ≤ 30k、$0.04〜0.06 | context 7.7k（累積 33.7k）・**$0.048 / $0.053**・17〜21 s | $0.036 → $0.048 / $0.053（**+34 % / +47 %**） |
| 標準生成 m3e / crit | `gen.firstBlock` ≤ 30 s、見積誤差 ±40 % | $0.69 / $1.65、最初のブロック 3.2 / 2.8 s | $ −3 % / +10 % ✅ |
| 標準生成の入力 / フィルタ後 source | `gen.ratio.inputFiltered` 0.5 / **0.6** | m3e 345k / 531k = **0.65**、crit 877k / 1,351k = **0.65** | — |
| 〃 / naive 全文 | `gen.ratio.inputNaive` 0.2 / 0.3 | m3e 0.26、crit 0.17 ✅ | — |

ほかの repo の標準生成の見積り（`POST /gen/estimate`、LLM 呼び出しなし、既定の並列 2）:
hono **$0.86**・136〜184 s（入力 / フィルタ後 = **0.86**）、excalidraw **$2.53**・6〜8 分（0.45）、react **$4.40**・10〜13 分（0.35）。
complete は react で **$24.66・67〜90 分**。

### 1.6 daemon の露出（問題なし）

| 試験 | 結果 |
|---|---|
| listen | `127.0.0.1` のみ |
| Host `evil.com` / `x.nip.io` / `[::1]` | 421 |
| token なしの `/api/v1/*` | 401（`/health` 以外） |
| bearer + `sec-fetch-site: cross-site` の POST | 403 `E_CSRF` |
| CORS preflight | 404（許可ヘッダなし）、`text/plain` の POST は 415 |
| ログイン nonce | 1 回限り・TTL 60 s、URL の fragment（ログ・Referer に出ない）、ログに token / nonce 0 件 |
| `files/content` の `..`・絶対パス・`.git/config`・`.env` | 拒否 / not found |
| repo 内の symlink（`docs/notes.md -> /etc/hosts`、`etcdir -> /etc`） | 索引で `special` として除外、`files/content` も拒否 |
| 静的配信の `..` | SPA の index.html を返すだけ |
| CSP | `script-src 'self' + hash`、`connect-src 'self'`、`frame-ancestors 'none'`、markdown-it は `html: false` |
| export（tracked の `sk_live_…`・`ghp_…`・Slack webhook・DB パスワードを入れた repo） | HTML・`.mitori/` とも 0 件（ただしこの repo では excerpt が該当ファイルを含まなかった） |

---

## 2. 指摘（重い順）

### F1 〔高〕agent mode は秘密情報の伏せ字を素通りし、Composer の同意文は事実と違う

- **どこ**: `packages/loop/src/git/snapshot.ts:79-117`（tracked ファイルは deny / SECRET_PATH_GLOBS だけで除外、内容の秘密検査は untracked だけ）、
  `packages/agent/src/claude/argv.ts:17-19,99`（`Read` / `Glob` / `Grep` は無条件、deny は argv に入らない）、
  `apps/web/i18n/composer.ja.json:66`（全モード共通の「選んだ範囲と依頼文だけ · 秘密情報は伏せ字」）。
- **何が起きるか**: patch / answer は bundle を `secrets.redact` に通すが、agent mode（複数ファイルの Fix で自動的に選ばれる R6）は
  ワークツリーのファイルを Read でそのまま読む。`config/settings.js` に `sk_live_…` が書かれた repo（よくある）で Fix を頼むと、
  キーは伏せ字なしでモデルに送られる。その直前に UI は「秘密情報は伏せ字」と表示して同意を取っている。fixture `injection/config/aws.ts`
  （tracked の AKIA）はあるが、agent mode でこれを読めないことを確かめる試験は無い。さらにワークツリーには依存の symlink
  （`node_modules` / `.venv` → ユーザーの実ディレクトリ）と tracked の symlink が agent のターン中から存在し、`--restricted` の
  confinement が realpath で判定するかは未確認（HANDOFF §0.3-7 でも未確認のまま）。
- **直し方**: (1) スナップショット作成時に tracked のテキストファイルにも `hasSecret` をかけ、ヒットしたファイルは agent のワークツリーから外す
  （deny と同じ `git rm --cached`）。書き込み範囲に入っていれば patch mode に落とす（patch は伏せ字が効く）。ジョブカードに「AI から隠したファイル N」。
  (2) 依存リンクは agent のターンの後、ゲートを走らせる直前に作る。tracked の symlink のうちワークツリーの外を指すものは agent の木から外す。
  (3) 同意文をモードごとに分ける（agent:「AI は作業コピーの中のファイルを読みます。秘密情報を含むファイルは除外します」）。
  (4) 回帰試験: INT-08 に「tracked の秘密を含むファイルが agent の cwd に無い」「依存リンクがターン中に無い」、contract test に
  「`--restricted` で cwd 内の symlink 経由の Read が拒否される」。

### F2 〔高〕出荷バイナリでは「検査で確かめる」が動かない（gated が名目だけ）

- **どこ**: `apps/cli/src/daemon/server.ts:107`（`gateSandbox: "none"` 固定）、`packages/loop/src/gates/runner.ts:127`、`gates/job.ts:269`。
- **何が起きるか**: typecheck / test / lint はすべて `executesRepoCode: true` なので、sandbox が無いと毎回 `pending_consent`。
  実際のアプリでは AI の修正は formatter 以外 **未検証のまま ready** になり、検査の失敗 → 修復ターンという設計の中心が人のクリック待ちになる。
  INT-08 の sandbox 部分は daemon に `sandbox-exec` を直接渡して測ったもので、出荷構成では再現しない（HANDOFF §0.3-2 と同じ）。
- **直し方**: platform に `detectGateSandbox()`（macOS: `/usr/bin/sandbox-exec -p '(version 1)(allow default)' /usr/bin/true` が通る、
  Linux: `bwrap --unshare-user --ro-bind / / true` が通る）を足し、`server.ts` から渡す。CLI 起動の単体試験で値が `"none"` 以外になることを固定。
  ループバックの扱い（ADR-0013 / agent.md #8）は「listen は許可、外向き connect は拒否」を推す（`httptest` が base でも落ちる現状は検査を ⚠ に固定する）。

### F3 〔高〕「この章で分かること」の箇条に inline code があると 1 文字ずつ縦に並ぶ

- **どこ**: `apps/web/src/shell/styles/prose.css:530-537`（`.blk[data-kind="learn"] li { display: grid; grid-template-columns: 22px minmax(0, 1fr) }`）。
  スクショ `audit/nonfunc/03-learn-callout-vertical-text.png`、`02-reader-1201-blocks.png`。
- **何が起きるか**: `::before`（番号）が 1 列目、li の最初の子が 2 列目に入り、その後ろのテキスト・`<code>`・出典リンクは匿名の grid item として
  **次の行の 22px 列**に回る。`` `crit` コマンドの入口と… `` は「crit」の後ろが 1 文字ずつ縦に、`` …が `gh` 経由で… `` は `gh` が縦に潰れる。
  HTML は正しい（`<aside class="malert" data-alert="learn"><ul><li><code>crit</code>コマンドの…`）。
  生成物で数えると crit の learn 箇条 45 個中 **11 個**（15 ページ中 **8 ページ**）、m3e は 12 個中 3 個（4 ページ中 2 ページ）が該当。
  モジュールページの最初のブロックなので、生成した設計書を開いた人がまず目にする。
- **直し方**: grid をやめて `li { position: relative; padding-left: 22px }`、`li::before { position: absolute; left: 0 }`（インラインの流れを保つ）。
  export の viewer も同じ CSS を使うなら同時に。回帰試験: reader.pw.ts と export spec に `> - \`x\` の説明 \`y\` 続き` を入れ、
  li 内テキストの行数（`getClientRects()` の高さ）が 1〜2 行であることを確認。

### F4 〔高〕非機能の予算のほぼ半分は何も測っていない — 初期 JS の +40 % にも誰も気づかない

- **どこ**: `bench/budgets/*.json` の `measure`。131 件中 **71 件**が存在しないファイルを指す（`bench/{idx,server,loop,agent,doc,anchor,dev}.bench.ts`、
  `e2e/perf/*.spec.ts`、`e2e/a11y/*.spec.ts`）。そのうち **54 件**は id がどのテスト・bench にも出てこない（`idx.rss.peak`・`srv.rss.idle*`・
  `ui.firstUseful.100k`・`ui.palette`・`ui.level`・`ui.dom.max`・`ui.section`・`ui.inputRender.1000`・`ui.card.optimistic`・`git.accept` など）。
  UI の数字は `e2e/web/*.pw.ts`（モック daemon、別 config）に直書きされているが `ci:pr`（check・test・fixtures・golden・size）に入っておらず、
  CI 自体も push で動かない。
- **何が起きるか**: 実バイナリ・実 repo での速さ・メモリの回帰を止めるものが `bun run size` の limit（150 KB）しかない。
  初期 JS は M1 の 83〜84 KB から 117.7 KB gz に増えた（target 60）が警告は出ていない。RSS は §1.4 のとおり 3 つの予算を超えている。
- **直し方**: (1) `scripts/check-budgets.ts` で `measure` のファイルが無ければ失敗させる（未実装なら `measure: null` と `unmeasured: "<理由>"` を明記）。
  (2) `ci:pr` に `e2e/web`（モック、数十秒）を足す。(3) 実バイナリの nightly perf を 1 本: この監査の `measure.mjs` を
  `e2e/perf/first-use.spec.ts` に移し（`MITORI_E2E_BINARY=compiled`、crit と react）、first useful・JS bytes・DOM・palette・level・footprint を budget id で判定。
  (4) メモリの予算は macOS では phys footprint（`proc_pid_rusage` の `ri_phys_footprint`）で測ると決める。

### F5 〔中〕最初の画面で Composer / ジョブの JS まで読む（117.7 KB gz、target の 2 倍）

- **どこ**: 地図の画面で map:painted より前に `loop-*.js`（19.3 KB gz）と `gen-*.js`（7.8 KB gz）が読まれる。`apps/web/vite.config.ts:25` で
  loop は別 chunk に切ってあるのに、地図の初回描画の前に要求されている。i18n-ja（18.3 KB gz）は Composer・Review の文言も含む全カタログ。
- **直し方**: `threads/ui.ts` 系は最初の選択・`c`・`f`・Inbox 遷移、または `map:painted` 後の `requestIdleCallback` で import。
  i18n を route 単位に分ける（composer・review・trust の文言は loop chunk と一緒に）。`bun run size` を route ごとの初期 JS で判定（地図 ≤ 80 KB を当面の limit に）。

### F6 〔中〕大きな節は 1 秒かかり、1.5 MB の JSON を非圧縮で返す

- **どこ**: `GET /ws/:ws/doc/sections/:section`。1,201 ブロック: コールド 659 ms・ウォーム 120 ms・1,497,464 B（`Accept-Encoding: gzip` でも非圧縮）、
  描画完了まで 1,016 ms（`ui.section` limit 150 ms）、daemon の RSS +540 MB。クライアントは 100 ブロックしかマウントしないのに、全ブロックの HTML を
  サーバーで作って送っている。complete effort の S8（react で 226 タスクのファイル別ノート）はこの大きさの節を作りうる。
- **直し方**: 節 API は outline + 先頭 K（例 60）ブロックの HTML を返し、残りは `?from=&to=` で仮想化の要求に合わせて取る。
  描画済み HTML を `(block の md hash, renderer 版)` で state DB にキャッシュ（再起動後のコールドも速い）。32 KB を超える JSON は gzip。
  `doc.render.2000.cold` の bench を作る（F4）。

### F7 〔中〕メモリ: 87 ファイルの repo でも peak 366 MB、react で RSS 1.1 GB

- **どこ**: §1.4。`packages/indexer/src/parse/index.ts:13-16`（worker 数）、claude 検出のタイミング。
- **何が起きるか**: footprint の idle は予算内だが、peak footprint が repo の大きさとあまり比例しない（m3e 366 MB / react 689 MB）。
  RSS 表示しか見ないユーザー（`ps`、`top`）には 0.5〜1.4 GB の常駐プロセスに見える。
- **直し方**: S1 の後に parse worker を terminate（`idx.rss.idle`）、スキャン後と大きな描画の後に `Bun.gc(true)`、claude 検出の spawn を最初の生成 / ジョブまで遅らせる。
  footprint で `idx.rss.peak` を測る bench を追加し、m3e の 366 MB の内訳（tree-sitter の wasm、ELK、shiki）を heap snapshot で切り分ける。

### F8 〔中〕自分のエージェント（⤴ / `mitori review`）経路は範囲も Undo も無い

- **どこ**: `packages/loop/src/review/engine.ts:1008-1022`（`recordTouched` は触ったファイルを round に足すだけ）、checkpoint を作るのは
  `git/accept.ts:126,149,293`（mitori のジョブの採用）だけ。
- **何が起きるか**: コンセプトの「ユーザー自身のエージェント（Claude Code / Codex）」で直す経路では、AI がユーザーの作業ツリーを直接書く。
  書き込み範囲の外を変えても mitori は気づかず、ラウンド単位で戻す手段も無い。push 経路（⚡）の「範囲内・採用は人・Undo 可」の約束が、この経路では成り立たない。
- **直し方**: pull round の dispatch 時に side repo へスナップショット checkpoint（`GIT_REFS.checkpoint`）を作る。`rounds/:n/complete` で作業ツリーと差分を取り、
  スレッドの書き込み範囲の和の外のファイルを Inbox / Review に「範囲外の変更 N」として出し、「このラウンドを元に戻す」を accept と同じ journal で提供する。

### F9 〔中〕formatter の「信頼」は依存のコード実行を覆っていない

- **どこ**: `packages/loop/src/gates/detect.ts:170-187`（`node_modules/.bin/biome` を `executesRepoCode: false`）、`:226-257`（`.venv/bin/ruff` / `black`）、
  `:93-107`（`gateTrustHash` は argv テンプレートと設定の本文だけ）。
- **何が起きるか**: `node_modules/.bin/biome` は Node のスクリプト（`#!/usr/bin/env node`、`BIOME_BINARY` を読み `execSync` も呼ぶ）、
  `.venv/bin/black` は site-packages を import する Python のスクリプト。どちらも sandbox も都度の同意も無しに走り、信頼の hash は中身を含まないので、
  信頼した後の `npm install` / 依存の差し替えでも再確認されない。
- **直し方**: 解決した実体（realpath）とそのバイト列の sha256 を trust hash に入れる。スクリプトの launcher は `executesRepoCode: true` 扱い、
  biome はプラットフォームの native binary（`@biomejs/cli-<os>-<arch>/biome`）を直接解決して hash する。ゲートの env から `BIOME_BINARY`・`NODE_OPTIONS`・`PYTHONPATH` を除く。

### F10 〔中〕ジョブの見積りは入力トークンを 6〜7 割少なく出す

- **どこ**: §1.5。Explain 1,249 → 1,958、Fix ≈2k → 3,386、patch 2,039 → 3,281、agent $0.036 → $0.048 / $0.053（±40 % の外）。
- **何が起きるか**: 見積りチップ（「≈2k in」）が毎回 1.2〜1.4k 少ない。差はほぼ lean の固定分（system prompt + JSON schema + tool 定義:
  `agent.leanOverhead` 1.0〜1.5k、tools 有効時 4.5k）。トークンに敏感なユーザーほど数字を信用しなくなる。
- **直し方**: モードごとの固定分（`bench/contract` の overhead の実測値）を `estimate.in` に足す。agent は「context × 想定呼び出し数」を cache read として価格づけ。
  ジョブの見積り誤差も gen と同じく ledger に残して κ で較正する。

### F11 〔低〕小さい repo では「一度だけ読む」がトークンでは 0.65〜0.86 回分

- m3e 0.65・crit 0.65（実測）、hono 0.86（見積り）で `gen.ratio.inputFiltered` の limit 0.6 を超える。主因は S6o（概要 8 タスク）がそれぞれ
  repo pack + system を読み直す固定分（hono では入力 394k のうち 157k）。キャッシュで費用は小さい（hono $0.86）。
- **直し方**: 40k 行未満の repo では S6o を 2〜3 呼び出しにまとめる。予算を「課金換算トークン」で定義し直すか、`eval/run.ts#tokens:inputFiltered` を実際の gen-report から計算する。

### F12 〔低〕開いただけで repo に `.mitori/` を書く

- 最初の open で `.mitori/`（react では `doc.index.json` 306 KB + md 31 個）を作る。`.mitori/.gitignore`（`*`）で git には出ないが、
  Docker の build context・rsync・git を見ないツールには入る。UI 左下の「.mitori/ · commitはopt-in」以外に告知は無い。
- **直し方**: 静的な骨組みは `~/.mitori` に置き、`mitori init` / export / 生成のときに repo へ書く。あるいは最初の open で 1 行告知する。

### F13 〔低〕state.sqlite は 0644 で作られる

- `state.sqlite`・`-wal`・`-shm` が 0644。既定の `~/.mitori` は 0700 で作られるので実害は無いが、既存の `MITORI_HOME`（0755）を指すと
  設計書の本文・スレッド・コード抜粋の入った DB が他ユーザーから読める（この監査で再現）。
- **直し方**: open 後に 0600 へ chmod、既存の home がグループ / 他者に開いていれば 0700 に直すか警告。

### F14 〔低〕CLI の入口

- `mitori --help` は「walking skeleton」の 4 行だけで、`export`・`review`・`install`・`gen` が出てこない。
- 最初の open で「integration file(s) are missing」が 5 行出る。
- `mitori export` は daemon を起動し、終わった後も idle 4 時間残る（footprint 150 MB 前後）。
- **直し方**: 実際のコマンド一覧を出す help、連携の通知は 1 行に（「連携は未インストール — `mitori install`」）、export は自分で起こした daemon を止める。

### F15 〔低〕⌘K の 1 打鍵が limit ぎりぎり

- 2 打鍵目以降が 26〜33 ms（`ui.palette` limit 33 ms）で、repo の大きさに関係なく同じ。worker への postMessage → 返信 → rAF の 2 段で 2 フレーム使っている可能性が高い。
  モックの `palette.pw.ts` は worker の matching 時間だけを 16 ms で見ている。実バイナリで key → paint を測って原因を切り分ける。

### F16 〔低〕同じ commit でも module 分割が変わる

- react（同じ commit）で、`.mitori/` の無い最初の open は 78 module、その後の open は 80 / 81（crit は 3 回とも 16、同一メンバー）。
  module ページへのスレッドや生成済み（有料）の module ページが無効になりうる。HANDOFF §0.3-6 / gen.md #8 の既知事項を実測で確認。
- **直し方**: 照合の seed（`.mitori/` の有無）で結果が変わらないようにし、「clean から 2 回開いて membersDigest が一致」の試験を足す。

---

## 3. コンセプトの約束ごとの判定

| 約束 | push 経路（⚡ patch / agent） | pull 経路（⤴ / `mitori review`） |
|---|---|---|
| 一度だけ省トークンで読む | 0 トークンの静的文書は 0.6〜3.4 s。標準生成は入力 / naive 0.12〜0.26、/ フィルタ後 0.35〜0.86（F11） | — |
| アンカーされる | 文の出典が書き込み範囲になる（`@` 不要）。対象が無ければ案内（スクショ 04） | bundle に範囲は書かれる |
| 範囲内だけ | `Edit(//abs)` 規則 + 事後検査 + lstat（書き込み）。**読み取りは範囲も伏せ字も無い（F1）** | **無い（F8）** |
| 検査される | **出荷構成では formatter だけ（F2）**。formatter の信頼は依存の中身を覆わない（F9） | 無い |
| 人がレビュー | hunk ごと、agent は 1 キー採用なし | ユーザーのエージェント次第 |
| 未コミット | ✅ | ✅（エージェント次第） |
| Undo | ✅ checkpoint | **無い（F8）** |
| 費用の見積り → 上限 → 実績 | 上限・実績 ✅、見積りの入力トークンが系統的に少ない（F10） | — |
| 読めて見た目がよい | 地図・Reader・レベル切替は速い。**生成ページの learn 箇条が崩れる（F3）** | — |

## 4. 片付け

- 監査で起動した daemon はすべて停止。誤って既定の `~/.mitori` を 1 回作ったので scratchpad（`audit-nonfunc/accidental-default-home`）へ移した（この監査より前には存在しなかった）。
- コーパスの repo には `.mitori/`（ignore 済み）以外の変更なし（`git status` 空、worktree 1・stash 0）。
