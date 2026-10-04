# 残課題パス — safety トラック（2026-10-04、`rem/safety`）

gate の sandbox と、loop と agent mode の残りを片付けた。実 LLM の消費は **$0**（録画エンジンと fixture だけ）。
契約の変更は小さく、すべて追加のみ。`packages/core/CR-LEDGER.md` §8（CR safe-1〜7）に決定を書き、
所有者がほかにいる残りは `docs/design/cr-requests/safety.md` に書いた。

## 1. 決定: gate は自分のループバックだけを使える（ADR-0013 R2）

| 環境 | 何をしたか | 確かめたこと |
|---|---|---|
| macOS（sandbox-exec） | gate の開始直前に、loopback と wildcard に bind 済みの TCP（LISTEN）と UDP のポートを集める（`netstat` ∪ `lsof`）。ループバックの bind・listen・connect を許し、その**後に**、集めたポート・特権ポート 1–1023・`ftp-proxy` 8021 への送信を拒否する。daemon のポート（`~/.mitori/daemon.json`）が一覧に無いときは、一覧を信用せずループバックも全部拒否する（fail closed） | RT-30b（`gates/runner.int.test.ts`）: gate の中で Bun のサーバー + fetch が通る。`go test` + `httptest.NewServer` も pass。同じ gate から daemon のポート・事前にあったリスナー・192.0.2.1 は `Operation not permitted`、DNS は `ENOTFOUND`。sandbox の外からは同じリスナーに届く。登録したポートが一覧に無いと gate 自身のサーバーも立たない |
| Linux（bwrap） | `--unshare-net` のまま（名前空間ごとの `lo` だけ）。ホストのために動くデーモンの unix socket を隠す（`/run/user`・D-Bus・Docker・Podman・containerd・nix daemon、検証パスで名前解決の systemd-resolved・nscd・avahi を追加）。検出は gate と同じ名前空間と mount を試す（検証パス） | 検証パスで **Linux（Ubuntu 24.04 コンテナ、`--privileged`）で実行**: RT-30L（`gates/runner.int.test.ts`）が pass。下の §7 |
| 同時に閉じた穴（macOS） | unix socket は書き込み可能な dir の中だけ（mDNSResponder 経由の DNS、Docker / nix daemon の socket を閉じた）。mach-lookup で keychain（securityd）・LaunchServices・Apple events・nsurlsessiond・pasteboard を拒否 | 手元で、DNS が引けないこと、`security find-generic-password` が keychain に届かないこと、LaunchServices の問い合わせが失敗することを確認。go / node / bun / python の localhost サーバーは影響なし |

trade-off と残り（ADR-0013 R2 に詳しく書いた）:
- **macOS 26 以降、Bun / Node が起動した `netstat` にはソケットが 1 つも見えない**（`sysctl net.inet.tcp.pcblist_n` が空。原因は未特定）。出荷版の daemon は Bun なので、実際の一覧は `lsof` で、**自分のユーザーのプロセスだけ**。root が 1024 以上で listen するサービスは見えず、届く（特権ポートと 8021 は常に拒否）。
- Seatbelt は `0.0.0.0` への bind を `localhost` と区別できない。gate が全インターフェースに listen すると、その間は LAN の端末から接続できる。
- gate の実行中に新しく listen したポートには届く。
- `(allow default)` の profile なので、名前を挙げていない mach service が代理で何かをする余地は残る（deny-default か `@anthropic-ai/sandbox-runtime` の比較は ADR の R1-O2）。

## 2. agent の残り

| 項目 | 状態 | 変更 · 回帰テスト |
|---|---|---|
| 初回ターンの入力上限に system prompt を含める（agent.md #9） | 済 | `jobs/engine.ts` `firstTurnInTokens`（system prompt + 送る JSON schema を足す）。`jobs/engine.test.ts`（deny glob 600 個の system prompt が 4k を超える） |
| `needs_more_context` のヒントを agent の bundle に（#6） | 済 | 失敗の `params.needs` → `agent/hints.ts`（path・`path:a-b`・`path#La-Lb`・シンボル名）→ 読み取り専用の REL。書き込み範囲は広げない。`agent/hints.test.ts`、INT-08 の R2 テスト（修正前は失敗することを確認） |
| `FsStat` の ctime（#3） | 済 | `FsStat.ctimeNs?`、RT-31 の指紋に入れた。`gates/deps.test.ts`（size と mtime を `utimes` で戻しても検出。ctime を外すと失敗） |
| check worktree の `maxWorktreesPerWs` | 済 | `jobs/worktrees.ts`: 新しい worktree の前に、動いていないジョブの古いものから外す。動いているもの（running / accepting など）は外さない（そのときだけ上限を超えうる）。`jobs/worktrees.test.ts` |
| ワークツリーの外を指す追跡済み symlink | 済 | worktree 作成時に skip-worktree（実体化しない。head commit は元の entry のまま）。絶対パス・root より上・`.git` の中・それらを経由するリンク。書き込み範囲が追跡済み symlink を通れば、実体化していなくても `E_SCOPE_VIOLATION`。`git/symlinks.test.ts`、`git.int.test.ts`、INT-08 の WP-08c テスト |
| F1 の残り（依存リンク・symlink 経由の秘密） | 済 | agent mode は依存リンク無しで worktree を作り、ゲートの直前にリンクし、各ターン（修復・revise）の前に外す（`git clean`、symlink だけ）。INT-08「F1 remainder」: ターン中は `node_modules`・`creds`・`up`・`chain`・`node_modules/../.env` のどれも見えず、最後のゲートの後はリンクが戻っている |
| F8 pull 経路の範囲チェックと Undo | 済（API とスレッドの通知まで） | Finish(pull) の**前**に作業ツリーを snapshot（`refs/mitori/round/<n>/base`）。ラウンドの完了時、スレッドの書き込み範囲の和の外の変更を各スレッドに 1 行で知らせる。`GET /review/rounds/:n/changes`・`POST /review/rounds/:n/undo`（通常の accept で戻す: 未コミット・divergence 検査・チェックポイントの Undo で再適用）。`side.ts` の `treeWith` が削除で失敗していた潜在バグ（`--force-remove` は work tree が要る）も直した。INT-06「F8」 |
| F9 formatter の信頼 hash | 済 | `gates/binaries.ts`: repo 内のバイナリの realpath + バイト列の sha256 を trust hash に。biome は native build を直接実行、launcher しか無ければ repo code 扱い。`.venv` の `#!` launcher（black）も同様。`gates/binaries.test.ts` |
| F10 見積りの固定分 | 済 | claude CLI 自身の固定分（answer 0.7k / patch 1.25k）と agent の往復（context × 3）を cache read として見積りに足し、その単価で計算する。台帳の実測（1,249 → 1,958、2,039 → 3,281、33.7k）に ±5〜10 % で合う。`jobs/engine.test.ts`。**ledger の profile 別較正（`UsageLedger.fixedOverhead`）は loop に配線していない**（LoopDeps に ledger が無い） |

## 3. スレッドのコード範囲（ux.md #2 / #6）

| 項目 | 状態 | 変更 · 回帰テスト |
|---|---|---|
| スレッドが選んだコードを持つ | 済（loop / core） | `Thread.context`（`CreateThreadReq.context`・`PatchThreadReq.context`、migration v3）。⤴ の pull bundle、⧉ の copy prompt（`CopyPromptReq.context`）、スレッドのすべての job が使う。INT-06「CR safe-6」、`review/engine.test.ts` |
| 自動の「対象コード」を外せる | 済（router） | `ContextAdjust.remove` の `write:<path>`: 出典のファイルを WRITE から外す（CODE は読み取りのまま）。`router/scope.test.ts`、INT-06 |
| 静的な facts 行への AI の提案が 409 になる | 済 | job のコードを採用したら、その job の静的ブロックへの保留中の提案を閉じる（行はコードから再導出される）。`ux.test.ts` / `proposal-close.test.ts` を更新し、EX-05 の Undo 経路は文章のブロックで確かめるテストを足した |
| **web 側（所有外）** | **未** | Composer が `POST /threads` / `POST /prompt` に `context` を送る、出典のチップに × を出す（`write:<path>`）、⤴ / ⧉ の「⚡ その場で実行にする」ブロックを外す。手順は `docs/design/cr-requests/safety.md` CR safe-6。**今は API / CLI からしか効かない** |

## 4. 所有者外の編集のレビュー（CR-LEDGER §7、agent.md #4、ux.md #4）

台帳 §8.1 に 1 件ずつ判断を書いた。fin-1〜5 と agent.md #4 は維持。ux.md #4 は維持したうえで、静的ブロックの提案だけ挙動を変えた（上の 3）。

## 5. 確認

- `scripts/nd bun run check`: 緑。
- loop・platform・server・core・doc・`test/int` の全部（INT-06/07/08、ux、proposal-close、RT-30〜33 を含む）: 緑（下の全体実行の結果を参照）。
- 全体の `scripts/nd bun test`（ロードアベレージ 20〜63）: 2,827 件中 **2,811 pass**、9 skip、5 todo、**2 fail はどちらも indexer の時間の予算**（crit の検索 1 ms → 2.6 ms、構造の更新経路 10 ms → 26.5 ms）。単独で再実行しても同じ負荷で落ちる。HANDOFF §0 の「負荷に弱いテスト」の 2 件と同じもので、このトラックは indexer に触れていない（`git diff main -- packages/indexer` は空）。予算は緩めていない。

## 6. 残り（続ける人へ）

1. **Linux のデスクトップ実機**: 検証パスで Ubuntu 24.04 のコンテナ（`docker run --privileged`）で RT-30L を通した（§7）。systemd-resolved・D-Bus・Docker が本当に動いているデスクトップ（Fedora / Ubuntu）で `bun test packages/loop/src/gates/runner.int.test.ts` を流し、`/run/user` などを隠して困る gate ツールが無いかを見る。再現手順: `docker run --rm --privileged --tmpfs /run/user/501:rw,uid=501,gid=1000,mode=700 -v $PWD:$PWD -w $PWD mitori-linux:arm64 bun test packages/loop/src/gates`。
2. **web**: CR safe-5（ラウンドの範囲外の変更の表示と「元に戻す」）、CR safe-6（`context` の送信、× の表示）。`docs/design/cr-requests/safety.md`。
3. **netstat が見えない原因**（検証パスで切り分け）: Bun に限らず、**Apple の署名が無い親**（Bun・nix の sh・Homebrew の python）から起動した `netstat` にはソケットが 1 つも見えない。zsh・`/usr/bin/perl`・`/usr/bin/python3` から起動すると全部見える（同じユーザー、同じ端末）。「責任プロセス」単位のプライバシー制限と思われる。回避できれば root のリスナーも拒否できる（今は lsof = 自分のユーザーだけ）。
4. **F8 の限界**: snapshot は deny glob と追跡されていない秘密のファイルを含まないので、それらへの変更は範囲チェックにも Undo にも出ない。symlink / mode 変更を含むラウンドの Undo は accept が拒否する（`not a regular file`）。ラウンドの Undo はラウンド中の作業ツリーの変更を**全部**戻す（自分のエージェントの変更と、その間に人がエディタでした変更を区別しない。チェックポイントから再適用はできる）。web で戻す前にファイルの一覧を見せること。
5. **F10 の較正**: 定数は監査の 3 回の実測から。LoopDeps に ledger の `fixedOverhead` を渡して profile 別に較正する（server の配線 = WP-INT）。
6. **macOS で setsid したプロセス**: gate の後始末（CR safe-7）はプロセスグループを殺すだけ。グループを抜けたプロセスは sandbox のまま残り、木に書ける。ターン前の歩査とターン後の範囲チェックで job を失敗にするが、ターン中の読み取りは防げない（ADR-0013 R2 の検証パス「残り」）。
7. **deny-default の読み取り**: 認証情報の拒否は列挙（`SENSITIVE_HOME_*`）。列挙外の秘密は gate が木にコピーでき、次のターンのモデルに届く。根本は deny-default の profile（ADR-0013 R1-O2）。

## 7. 敵対的検証パス（同日、`rem/safety`）

上の実装を壊しにいき、見つけた 10 件をその場で直した（1〜8 の詳細と回帰テストは ADR-0013「R2 の検証パス」の表）。

| # | 見つけたこと | 直したもの |
|---|---|---|
| 1 | Linux: `~/.claude.json`（ファイル）に `--tmpfs` → **全 gate が失敗** | ファイルは `/dev/null`、ディレクトリは tmpfs |
| 2 | Linux: 検出が gate より小さい bwrap → コンテナで全 gate が `error` | 検出は gate と同じ形（`BWRAP_PROBE_ARGS`） |
| 3 | Linux: systemd-resolved・nscd・avahi が gate の代わりに DNS を引く | その socket の dir を隠す |
| 4 | 両 OS: `~/.netrc`・`~/.npmrc`・`~/.git-credentials`・`~/.docker`・`~/.kube` などを gate が読めた（木にコピー → 次のターン） | 読み取りを拒否（`SENSITIVE_HOME_DIRS/FILES`） |
| 5 | macOS: symlink 先の秘密（`~/.aws -> ~/dotfiles/aws`）が読めた | realpath でも拒否 |
| 6 | 両 OS: gate のバックグラウンドジョブが gate の後も木に書けた | リーダーの終了後にプロセスグループを SIGKILL（CR safe-7） |
| 7 | gate が置いた symlink（`testdata/a/b/node_modules -> ~/.aws/credentials`）を REPAIR ターンが読んだ（INT-08 で再現） | 各ターンの前に作業ツリーの symlink を検査し、外を指せば job を失敗 |
| 8 | 追跡済み symlink の判定が字面（`x -> p/q/l/../../..`） | カーネルと同じく 1 成分ずつ解決 |
| 9 | job カードの ⧉（`GET /jobs/:job/prompt`）にスレッドの `context` が乗らなかった | 乗せる（INT-06） |
| 10 | worktree の上限の追い出しが古い状態で判断していた（取り出した後に gates / accept が始まったジョブも消しうる） | 追い出す直前に状態を読み直す |

ほかに壊しにいって、壊れなかったもの（macOS、`sandbox-exec` の中で）: daemon のポートへは `127.0.0.1`・`localhost`・`0.0.0.0`・`::ffff:127.0.0.1`・`127.1`・`2130706433` のどれでも届かない。LAN の IP 経由で wildcard のサービスにも届かない。事前の UDP のポート・1.1.1.1・DNS（getaddrinfo・`dscacheutil`・`dig`）・`launchctl submit`・`open`（LaunchServices）・ssh-agent の socket・keychain・`~/Library/LaunchAgents` への書き込み・拒否したファイルへのハードリンク・`cp -c`（clonefile）は全部止まる。自分のサーバー（固定ポート・ephemeral・UDP）は通る。
