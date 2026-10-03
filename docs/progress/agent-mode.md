# agent mode・検査ゲート・修復ターン・昇格・external patch（WP-08c、branch `fin/agent`、2026-10-04）

設計書のコメントから「複数ファイルにまたがる修正」を AI に頼めるようにした。AI はユーザーの作業ツリーではなく
**side repo のワークツリー**で、Read / Edit / Glob / Grep だけ（Bash なし）、書き込み範囲のファイル 1 つごとに
`Edit(//絶対パス)` を 1 つ許可されて動く。終わるたびに head commit と事後検査（差分 ⊆ 書き込み範囲・deny・mode・secret）、
続いて gofmt / go vet / go test などの検査、失敗すれば修復ターン（≤ 2）。人が hunk ごとに見て採用すると**未コミット**で
作業ツリーに入り、Undo で元に戻る。ここまでを録画エンジンで全経路、**本物の claude で 1 回**（API 換算 $0.18）確かめた。

## 入ったもの

| どこ | なに |
|---|---|
| `packages/loop/src/agent/run.ts` | agent mode（spec §8.3）: snapshot → ワークツリー（依存 symlink）→ realpath を cwd と system prompt に → 実行（`--restricted --tools Read,Edit,Glob,Grep --permission-mode dontAsk --allowedTools Read Glob Grep Edit(//wt/…)`、引数は bridge が組む）→ 拒否された tool 呼び出しは thread に 1 行 → head commit → 事後検査 → ゲート（format はワークツリー内で autofix、続いて checks）→ 修復 → ready。Request changes（revise）と同意後の修復も同じワークツリーで |
| `packages/loop/src/agent/escalate.ts` | 昇格（§3.5）: patch の `needs_more_context`・当たらない edit・2 回直らない検査 ⇒ **R2**（agent への自動引き継ぎ。見積りが確認不要・`jobMaxUsd` 以内・「使用額 + 見積り ≤ 最初の見積り × 3」のときだけ）。agent の失敗 ⇒ **R1**（Opus）は `escalate` の提案だけで、作成には確認が要る。scope 違反・deny・secret・依存改変は昇格しない |
| `packages/loop/src/repair/turn.ts` | 修復の 3 経路（§6.6.3）: parked プロセスへの continuation → `--resume`（persistSessions のときだけ）→ cold（元の bundle + REPAIR を 1 メッセージ 2 ブロック）。**終了済みのプロセスは即座に飛ばす**（loop-wiring の soft spot: ターンのタイムアウトを待たない）。何もしないで失敗した経路だけ次へ（課金済みのターンは繰り返さない）。予算は「ジョブの残り」 |
| `packages/loop/src/repair/ranges.ts` | REPAIR の CODE 範囲: head の hunk + 失敗行（書き込み範囲内）±3、抜粋は gate の ≤ 1k token |
| `packages/loop/src/gates/checks.ts` | typecheck / test / lint の検出: Go（go vet・go test、パッケージは gate cwd 相対）、JS/TS（package script を lockfile の PM で、無ければ tsc、vitest / jest / bun test は関連テストだけ）、Python（ruff check・mypy / pyright・pytest）、Rust（cargo check --offline）。どれも `executesRepoCode: true`、npx 等は使わない。**lockfile の blob を trust hash に**（依存が変われば再 trust） |
| `packages/loop/src/gates/job.ts` | patch mode の checks は遅延作成のワークツリーで（format は従来どおり一時コピー）。実行前に検査対象の木へ同期、実行後に**元へ戻す**（テストが書いたファイルを head に入れない）。失敗した check は base でも走らせ、**変更前から失敗していたものは修復しない**（`error`、抜粋は増えた行だけ） |
| `packages/loop/src/gates/trust.ts` | trust は**変更ごとのゲート集合を 1 回で**（gofmt + go vet + go test を 1 ダイアログ、argv を全部表示）。単独で trust 済みのゲートはそのまま、単独の deny は優先 |
| `packages/loop/src/gates/deps.ts`・`runner.ts`・`sandbox.ts` | sandbox 無しで repo のコードを実行するゲートの前後に依存ツリー（ワークツリーの `node_modules` 等の symlink 先）を fingerprint、変わればジョブを失敗／破棄（RT-31）。sandbox では mitori 専用の `GOCACHE` を書けるように（ユーザーのキャッシュは汚染させない）。関連テストが無い test gate は全体を走らせず `skipped` |
| `packages/loop/src/external/patch.ts` | external patch（§5.6、MCP `mitori_submit_patch` / `POST /patches`）: side repo の snapshot に適用、書き込み範囲は thread 由来（広げられない）、`first_line` は常に照合、`base` が分からなければ `E_PATCH_RANGE`（RT-22）。ゲートは切り離して実行（MCP は ≤ 25 s ポーリング）→ ready |
| `packages/loop/src/jobs/pipeline.ts` | patch mode の修復ループ（当たらない edit に 1 回、失敗した検査に ≤ 2 回、同意後の修復）、revise も 3 経路、`readJobFile` で REPAIR の CODE は **job head** から |
| `packages/loop/src/jobs/{runner,assemble,store,plan}.ts` | 配線（`cr-requests/agent.md` #4）。plan: `agentPathsOk` を実際に判定、escalate モデルの agent job は確認必須、agent の書き込み範囲でゲートを再検出 |

## INT-08（録画エンジン、`scripts/nd bun test test/int/int08.test.ts`、22 tests ≈ 30 s）

本物の daemon・claude-cli エンジン・normalizer・scheduler・台帳。claude だけ台本（agent の turn は Edit ツールのように
ワークツリーを書き換える）。git・gofmt・go vet・go test は本物。

- **agent Fix（3 ファイル、`@` 2 つ）**: R6 で agent。argv に `--restricted`・`dontAsk`・`Read,Edit,Glob,Grep`・`Edit(//wt/<path>)` × 書き込み範囲、Bash 無し、cwd = ワークツリー、system prompt に `Working directory: <wt>`、edit phase は tool 呼び出しから。trust は 1 セット（プレビュー 3 行）。同意 → go vet 失敗（`assignment mismatch`）→ **同じプロセスへの continuation** で REPAIR（`GATE typecheck:go-vet fail attempt=1/2` + 抜粋）→ gofmt がワークツリー内で整形 → 再同意 → 全 pass。agent job は「全部採用」不可（412）、hunk 指定で採用 → 3 ファイルが**未コミット**、ユーザー repo の refs・objects・index・config・worktree・stash は不変、`go vet ./...` 通過、Undo で元のバイト列
- **終了済みプロセスの修復**: 最初の結果の直後にプロセスが死ぬ → 修復は待たずに cold（0.65 s。continuation の first-line timeout は 10 s）、cold の入力は元 bundle と REPAIR の 2 ブロック
- **patch の修復**: `first_line` 不一致 → REPAIR（`PATCH fail`）→ 当たった edit が go vet で失敗 → 同意後 REPAIR、CODE は head の行番号と `base=`。3 ターンとも同じプロセス。edit の無い REPAIR 応答は patch/1 として不正 → 同じプロセスに 1 回だけ再要求 → `E_AGENT_PROTOCOL`
- **並列**: 別ファイルの 2 ジョブは待ち合わせなし・両方採用。同じ行の 2 ジョブは 2 つ目が `waiting_lock`、両方 ready、先に採用した後の 2 つ目は `409 E_GIT_MERGE_CONFLICT` で ready のまま
- **昇格**: patch が `needs_more_context` → 上限内なので agent job（`escalatedFrom`、thread は failed を経由しない）→ budget 停止 → `escalate` を提案、自動の 3 段目なし。Opus は確認なしの作成が 412、retry も 412、confirm 付きで実行
- **external patch**: 適用 → ready（ユーザーのファイルは不変）／未知の `base` → `E_PATCH_RANGE`・thread は open に戻る／範囲外のパス → `E_SCOPE_VIOLATION`
- **red-team**: RT-01/07/19（README と `.vscode/tasks.json` を直接書く、`src/evil.ts` は拒否）→ 事後検査で失敗、昇格なし、ツリー不変、ワークツリー削除。RT-31（sandbox 無し・同意後に依存を書き換えるテスト）→ ジョブ破棄、thread は open。**sandbox-exec**（macOS）: 検査は無人で走り修復も自動、RT-30（`~/.aws/credentials` を読むテスト）は読めない、RT-31 の書き込みは拒否されて依存は不変

単体: `gates/checks.test.ts`（検出・PM・lockfile 再 trust・関連テスト・集合 trust）、`gates/deps.test.ts`、`repair/turn.test.ts`
（経路の順序、死んだプロセスの即スキップ、課金済みターンを繰り返さない、resume の条件）、`agent/escalate.test.ts`、`agent/run.test.ts`。

## 本物の claude（`MITORI_LIVE=1 MITORI_MAX_USD=1.5 scripts/nd bun test test/int/int08.live.test.ts`）

claude 2.1.288、Max サブスク（`auth: subscription`、`billing: subscription-window`）、mitori の lean argv、go-small の git コピー、
`gateSandbox: sandbox-exec`。実行 3 回、**API 換算の合計 $0.182**（上限 $1.50 の 12 %）。数値は `docs/progress/agent-mode/measurements.run{1,2,3}.json`。

| 項目 | 予算 | 実測 |
|---|---|---|
| agent Fix（3 ファイル + 関連テスト）の入力 | ≤ 30k（spec §8.3 は context の大きさ） | context（in + cache write）**7.7k**。累積は cache read 込みで 33.7k / 53.2k（8 tool 呼び出し） |
| 〃 出力 | ≤ 2.5k | 2,377 / 2,468（ほぼ上限。書き込み範囲に入った `memory_test.go` に 22 行のテストを自分から足した） |
| 〃 費用 | $0.04〜0.06 | **$0.048 / $0.053** |
| 〃 時間（ゲート除く） | ≤ 30 s | 21.3 s / 17.4 s（モデル時間 = 壁時計時間） |
| ゲート（sandbox） | — | gofmt 17〜20 ms、go vet 3.9 s・go test 1.3 s（mitori の GOCACHE が冷えている初回）、2 回目 146 ms / 249 ms。3 つとも `sandboxed: true`・pass |
| Request changes（agent の continuation） | +≈ 2〜8 s / 回 | **3.9 s・$0.010**、Edit 1 回、ゲート再実行も pass |
| 採用（hunk 指定、4 ファイル） | `git.accept` 300 / 800 ms | 154〜155 ms。未コミットの ` M` 4 つ、ユーザーツリーで `go vet ./...`・`go test ./...` 通過、Undo で完全に元通り |
| patch 2 本を並列（別ファイル） | — | 2 本とも 4.3〜4.8 s・$0.010〜0.011、**実行区間が全区間重なった**（並列 3 の scheduler） |
| 同じ行に patch 2 本 | — | 2 本目は `waiting_lock` → 1 本目の ready で開始、両方 ready（2 本目は温まったキャッシュで $0.0057）。1 本目を採用後の 2 本目の採用は `409 E_GIT_MERGE_CONFLICT`、2 本目は ready のまま |

**run 1 で見つけたバグ（修正済み・回帰テスト `agent/run.test.ts`）**: agent の入力メーター上限を `limits.agentMaxInputTokens`（30k）
そのものにしていた。メーターは各 API 呼び出しの入力（cache read 込み）を累積で数えるので、Read 3 回 + Grep 2 回の時点
（累積 32.5k）で `E_BUDGET_EXCEEDED`、最初の edit の前に止まり $0.038 が無駄になった。上限を「context × 1 ターンの呼び出し数（10）」
にし、費用の歯止めは USD 予算（≥ $0.30、80 % で停止）に任せた（`cr-requests/agent.md` #2 でメーター側の重み付けを要望）。

## 検証パス（敵対的レビュー、2026-10-04）

実装を読み直し、範囲の外へ書かせる経路を探した。見つけたものは直して回帰テストを足した（`scripts/nd bun test test/int/int08.test.ts` は 22 tests）。

| 見つけたこと | 直し方 | 試験 |
|---|---|---|
| ワークツリーで動く mitori の git は `<wt>/.git` から repo を探していた。検査（repo のコード）や agent がこのファイルを書き換えると、mitori 自身の git がそこを辿る（sandbox の外で、ユーザーの権限で） | `inWorktree` は GIT_DIR / GIT_WORK_TREE を side.git の admin dir に固定（admin の `gitdir` と `<wt>/.git` の双方向を照合）。違えば `E_SCOPE_VIOLATION`。sandbox の中では `<wt>/.git` を書き込み禁止（Seatbelt / bwrap） | INT-08「.git pointer」: ジョブ失敗・昇格なし・ユーザー repo 不変。`gates.test.ts` の profile 検査 |
| Edit / Write はシンボリックリンクを辿る。書き込み範囲のパスがリンク（コミット済みのリンク dir、依存リンク、検査が残したリンク）を通ると、ワークツリーの外に書ける | agent の各ターンの前に、範囲の全パスの各段を lstat。リンクなら engine を起動せず `E_SCOPE_VIOLATION`。検査後に元へ戻せないワークツリーもジョブ失敗（同意後なら ready を破棄） | INT-08「symlinked directory」: spawn 0 回、リンク先は空 |
| AI の diff が `go.mod`・`package.json`・lockfile・`conftest.py` などを変えても、検査は人が以前信頼した設定のまま走った | 変えられた trust 入力ごとに、その検査の trust hash を木ごとに作り直す（`gates/trust.ts treeSpecs`）。ダイアログ 1 行目に変わったファイル名 | `trust.test.ts`、INT-08「go.mod re-trust」 |
| （実エンジン run 4）REPAIR の continuation は会話全体を読み直す（4.6k）が、patch の入力上限 4k で止められた | 修復・修正・再要求ターンの上限 = 計画の余裕 + ジョブがこれまでに読んだ／書いた量 + メッセージ。USD が歯止め | `turn.test.ts`「live run 4」 |
| （実エンジン run 4）sandbox の go test が base と head で同じように panic しても、goroutine 番号や秒数の違いで「変更による失敗」と判定され、修復ターンを 1 回使った | 失敗行の比較で数値とアドレスを無視 | `trust.test.ts`「base comparison」 |
| external patch の `..`・絶対パス・`.git/config`・`.mitori/`・`.env` | もともと拒否されていた（範囲は thread から決まる）。回帰テストだけ追加 | INT-08 external patch |

**実エンジン run 4**（$0.018、`measurements.run4.json`）: patch mode、sandbox。モデルは `%d` を自分で `%s` に直したので go vet は通過、
go test は sandbox がループバックの listen を拒否して（`httptest`）失敗 → **実エンジンへの REPAIR continuation が実際に走った**
（cache read 3.3k + 新規 1.3k）が、上記の入力上限で止まった。両方とも修正済み。修正後の再実行（hidden test を使う live test 3）は、
`claude` CLI がログアウト状態になったため実行できなかった（`E_AGENT_AUTH`、課金なし）。再実行:
`MITORI_LIVE=1 MITORI_MAX_USD=0.2 scripts/nd bun test test/int/int08.live.test.ts -t "3\."`。

## 動かないもの・未確認（正直に）

- **CLI が sandbox を検出しない**（`apps/cli` は `gateSandbox: "none"` 固定、`cr-requests/agent.md` #1）。そのため実際のアプリでは
  go vet / go test / tsc / bun test などはすべて「自動検査を実行」のクリック待ち（ADR-0013 どおりの安全側）で、修復もクリック後。
  上の実測と INT-08 の sandbox 部分は daemon に `sandbox-exec` を渡して測った。配線は platform + CLI の 2 か所（この track の外）。
- **sandbox はループバックも遮断する**（ADR-0013 の「network 拒否」どおり）。`httptest` などローカルにサーバーを立てるテストは
  base でも head でも失敗し、`error`（変更前から失敗）として扱われて検査は ⚠ のまま（#8、判断が要る）。
- 実エンジンで**修復ターンが成功まで走ったところはまだ見ていない**（run 4 で continuation は走ったが入力上限で停止 → 修正済み、
  再実行は CLI のログアウトで未実施）。修復の各経路は録画エンジンで確認済み。
- Linux（bwrap）は未確認。sandbox の無い環境では RT-31 は検出（ジョブ破棄）できても防げない（依存は書き換わる）。in-place 書き込みで
  size と mtime を戻されると検出もできない（`FsStat` に ctime が無い、#3）。
- `needs_more_context` のヒントは agent の bundle に入らない（agent が自分で Read する、#6）。
- 書き込み範囲に関連テストが自動で入るため、agent が頼まれていないテストを書くことがある（live run 2・3。採用は hunk ごとなので外せる）。
- `docpatch/1`（送信したメモ）・GitHub PR・codex の agent mode は未対応のまま。ready の patch job が遅延作成するワークツリーの上限
  （`maxWorktreesPerWs`）は未実施（accept / reject / GC で消える）。
- trust は「ゲート集合」を 1 回で尋ねるようにしたが、ダイアログはプレビュー文字列（1 行 1 ゲート）をそのまま出すだけ（#5）。

## コンセプトの守り方（チェックリスト）

| 約束 | どこで守るか | 試験 |
|---|---|---|
| ユーザーのツリーに触れるのは人の採用だけ | agent はワークツリー（`~/.mitori/wt/<ws>/<job>`）、patch / external は in-memory head | INT-08 の全シナリオで採用前のツリー・refs・objects・index 不変 |
| 書けるのはアンカーから決まった範囲だけ | `Edit(//abs)` 規則 + 事後検査（差分 ⊆ 範囲、deny、mode、secret）。範囲を広げるのは人の `@` だけ | RT-01/07/19、external の範囲外、CT 相当の argv 検査 |
| 検査で AI のコードを勝手に実行しない | trust（集合）→ sandbox が無ければ同意 → 依存 fingerprint | RT-30/31、`pending_consent` |
| 無人ループなし | 修復 ≤ 2、R2 は上限内のみ、Opus は確認必須、retry も確認必須 | 昇格シナリオ、`escalate.test.ts` |
| 採用は未コミット・Undo 可 | 既存の accept / checkpoint（08b） | agent 採用 → ` M` → Undo でバイト一致 |
| 速さ・トークン | 修復は continuation（増分のみ）、check はワークツリーを使い回し、base 比較は失敗時だけ | live: revise 3.9 s / $0.010、ゲート 2 回目 0.4 s |
