# 残課題パス — safety トラック（2026-10-04、`rem/safety`）

gate の sandbox と、loop と agent mode の残りを片付けた。実 LLM の消費は **$0**（録画エンジンと fixture だけ）。
契約の変更は小さく、すべて追加のみ。`packages/core/CR-LEDGER.md` §8（CR safe-1〜6）に決定を書き、
所有者がほかにいる残りは `docs/design/cr-requests/safety.md` に書いた。

## 1. 決定: gate は自分のループバックだけを使える（ADR-0013 R2）

| 環境 | 何をしたか | 確かめたこと |
|---|---|---|
| macOS（sandbox-exec） | gate の開始直前に、loopback と wildcard に bind 済みの TCP（LISTEN）と UDP のポートを集める（`netstat` ∪ `lsof`）。ループバックの bind・listen・connect を許し、その**後に**、集めたポート・特権ポート 1–1023・`ftp-proxy` 8021 への送信を拒否する。daemon のポート（`~/.mitori/daemon.json`）が一覧に無いときは、一覧を信用せずループバックも全部拒否する（fail closed） | RT-30b（`gates/runner.int.test.ts`）: gate の中で Bun のサーバー + fetch が通る。`go test` + `httptest.NewServer` も pass。同じ gate から daemon のポート・事前にあったリスナー・192.0.2.1 は `Operation not permitted`、DNS は `ENOTFOUND`。sandbox の外からは同じリスナーに届く。登録したポートが一覧に無いと gate 自身のサーバーも立たない |
| Linux（bwrap） | `--unshare-net` のまま（名前空間ごとの `lo` だけ）。ホストのために動くデーモンの unix socket を隠す（`/run/user`・D-Bus・Docker・Podman・containerd・nix daemon）。検出が `--unshare-net` も確かめる | **実機では未実行**。argv の形だけを `gates/sandbox.test.ts` で確かめた |
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
- 全体の `scripts/nd bun test`: 結果は commit メッセージと最終報告に書く（負荷で時間の予算のテストが落ちることがある。HANDOFF §0 の 11 件と同じ種類）。

## 6. 残り（続ける人へ）

1. **Linux で bwrap を実行する**: `gates/runner.int.test.ts` の RT-30 / RT-30b は darwin だけ。Linux 版（`--unshare-net` でのループバック、隠した socket の dir、`/var/run/docker.sock` への `/dev/null` の bind）を実機で確かめる。`/run/user` を隠すと困るツールが無いかも見る。
2. **web**: CR safe-5（ラウンドの範囲外の変更の表示と「元に戻す」）、CR safe-6（`context` の送信、× の表示）。`docs/design/cr-requests/safety.md`。
3. **netstat が見えない原因**: Bun / Node の子の `netstat` に macOS がソケットを見せない理由が分かれば、root のリスナーも拒否できる（今は lsof = 自分のユーザーだけ）。
4. **F8 の限界**: snapshot は deny glob と追跡されていない秘密のファイルを含まないので、それらへの変更は範囲チェックにも Undo にも出ない。symlink / mode 変更を含むラウンドの Undo は accept が拒否する（`not a regular file`）。
5. **F10 の較正**: 定数は監査の 3 回の実測から。LoopDeps に ledger の `fixedOverhead` を渡して profile 別に較正する（server の配線 = WP-INT）。
