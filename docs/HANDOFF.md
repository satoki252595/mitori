# mitori 引き継ぎ資料（2026-10-04 仕上げパス統合後）

> **現在の状態は §0**。§0b はその前の更新（グループ B の取り込みと実機デモ）、§2〜§4 は最初の停止時点の記録（歴史）。

---

## 0. 現在の状態（仕上げパス 4 トラックを main に統合、2026-10-04）

ユーザーの「残っていること」（コード指定なしの Fix・Review ヘッダー・Composer の引用・提案 accept/reject・`mitori install`・
実エンジン未検証の項目）と「次の 3 手」（`@` なしの Fix の案内・実エンジンでの標準生成の再実行・エージェントモードと HTML エクスポート）を
4 トラック（`fin/export`・`fin/gen`・`fin/agent`・`fin/ux`）で並行して実施し、それぞれ「実装 → 敵対的検証」を通したうえで
**この順に `--no-ff` で main へ統合した**（統合者は push しない。push はリードが行う）。

| 統合 | 衝突・統合時の修正 |
|---|---|
| `fin/export` → `fin/gen` → `fin/agent` | 衝突なし。各マージ後に `bun install --frozen-lockfile`・`bun run check` 緑。`prompts.lock.json` は gen だけが変更（AC-40 で一致を確認） |
| `fin/ux` | `docs/design/briefs/INDEX.md`（生成物）だけ衝突 → `bun run contract:index` で再生成。export と ux が**同じ不具合**（`bun test` 下の gen-assets が NODE_ENV=test を継いで別ハッシュの開発版 bundle を作り ENOENT / viewer 予算超過）を別々に直していたので、`genAssets` 側の 1 か所（viewer も含む）に寄せた |

**統合後の main で再確認したもの**（Apple M5 Max、ロードアベレージ ≈ 11 の中で）:

| 確認 | 結果 |
|---|---|
| `scripts/nd bun run check` | 緑（tsc・biome・境界・CR 台帳・budgets・契約索引・svelte-check） |
| `scripts/nd bun test`（全体） | **2,716 pass / 0 fail**（9 skip = コーパス・replay・実エンジンの opt-in、5 todo）、278 files、240 s |
| `scripts/nd bun run build:bin` | `dist/mitori-darwin-arm64` 70.7 MB、`--version` 起動 中央値 36 ms（target 20 / limit 50 — 警告のみ）、web 資産 ok |
| `test/int/shots/live.ts --engine fake`（本物の UI を Chrome で、説明 → 修正 → 検査 → 採用 → Undo） | 通過。検査は **gofmt（autofix）・go test・go vet の 3 つ**（WP-08c の検出が入った）、採用 185 ms、Undo 106 ms、コンソールエラー 0・4xx/5xx 0 |
| export e2e（`MITORI_E2E_CHANNEL=chrome bun run e2e --grep @export`） | **29 / 29**（開発版）、**29 / 29**（`MITORI_E2E_BINARY=compiled`、統合後のバイナリ） |

この統合パスでの LLM 消費は **$0**。トラック側の実エンジン消費（API 換算、Max サブスク枠）: gen **$3.43**（上限 $4.00）、agent **$0.20**（run 1〜4）、
ux・export **$0**。**現在この環境の `claude` CLI はログアウト状態**（`claude auth status` → `loggedIn: false`）で、実エンジンが要る残り（下の 1）は
ユーザーの再ログイン待ち。

### 0.1 ユーザーの依頼ごとの状態

| 依頼 | 状態 | 何がどう変わったか（根拠） |
|---|---|---|
| コード指定なしの Fix（412・ヒント無し） | **済** | 文の出典が自動で「対象コード」になる（router と同じ範囲）。出典が無ければ候補（表の行のコード参照 → 名前一致 → 全文検索 → 同じ節の近い出典）を 1 クリック / ⌥1–4 で選ぶ。何も無ければその場で `@` の指し方を案内。対象の無い Fix は見積りを要求しない（412 もコンソールエラーも出ない）。route 5 ms（go-small）〜 2–41 ms（crit）、`f` → 候補描画 34–86 ms。`docs/progress/ux.md` §1、`ux/ux-01,02,06,09.png` |
| Review ヘッダーが混む | **済** | ◆ はレビュータブだけ、レビュー中はドロワーボタンなし、block id は「詳しい」だけ、ゲート警告はピルの行に。`ux/ux-04-review.png`（+ dark） |
| Composer の引用に隣のセルが混ざる | **済** | 表のセルは選んだ文字列そのもの、段落は自分の段落の中だけ（UX-QUOTE-01） |
| 提案の accept / reject（501） | **済** | 本文中の提案差分（和文は文字・英数字は語単位）、SSE で即表示、単独の採用 / 却下、レビュー中ジョブの提案は Review でコードと一緒に。人の編集 route（`POST /doc/blocks/:block/edit`）も配線 = 共同編集の入口。`ux.md` §2 |
| `mitori install` | **済** | `/integrations` 一式、AGENTS.md ブロック 74 tok（上限 80）、SKILL.md ≤ 1,487 B（上限 1,500）、`claude plugin validate` 警告なし。`ux.md` §3 |
| 実エンジンでの標準生成の再実行 | **済（crit は一部未達）** | m3e-canvas: 再試行 **25 %**・1 回目 valid 91.5 %・L1 **93.0 %**・$0.69・最初の AI ブロック 3.2 s・見積誤差 −3 %（$）。crit: $1.65・再試行 33 %・L1 88.2 %（最終コードで記録を再生すると 16 % / 90.6 %、実エンジンでの再計測は未）。初見者理解テスト（m3e、10 問）: README 20 % → **mitori 50 %**（+30 pt）。29 + 25 claim を出典と突き合わせ、支持されないもの 0。`docs/progress/gen-quality.md`、生成物 `docs/progress/dogfood2/` |
| エージェントモード（WP-08c） | **済（実エンジン 1 項目のみ未）** | 複数ファイルの修正を side repo のワークツリーで（Read/Edit/Glob/Grep のみ、書き込み範囲のファイルごとに `Edit(//abs)`）、事後検査、検査ゲート（Go / JS・TS / Python / Rust の typecheck・test・lint を検出）、修復ターン ≤ 2（continuation → resume → cold）、昇格（patch → agent は上限内のみ自動、Opus は確認必須）、external patch。録画エンジンで INT-08 全経路（22 tests）。**本物の claude**: agent Fix（3 ファイル）入力 context 7.7k・**$0.048–0.053・17–21 s**、Request changes 3.9 s / $0.010、採用 154 ms、**並列 2 ジョブ**（別ファイルは完全に重なる、同じ行は `waiting_lock` → 2 本目採用で 409）。`docs/progress/agent-mode.md` |
| 修復ターン（実エンジン） | **未完** | run 4 で本物の claude への REPAIR continuation が走ったが、入力上限（4k）で止まった → 修正済み（回帰テストあり）。修正後の実エンジン再実行は CLI ログアウトで未実施 |
| HTML エクスポート（WP-13） | **済（アプリ内ダイアログのみ未）** | `mitori export --html [-o file\|dir] [--no-code]` と `GET /ws/:ws/export/html`。1 ファイル・ネットワーク不要・読み取り専用で Reader と同じ体験（目次・読者レベル・出典 peek・確かさバッジ・用語・図・⌘K・ダーク・EN）。viewer JS **58.75 KB gz**（予算 60）、crit 1.58 MB（`--no-code` 0.92 MB）を **0.41–0.65 s**、LCP 92–104 ms、秘密は伏せ字（fixture で 6 件・原文 0）、CSP で外部読み込み 0。Chrome + WebKit で確認。`docs/progress/export/README.md` |
| Linux | **未** | bwrap・watcher とも未実行 |

### 0.2 コンセプトに対してどうなったか

- **一度だけ省トークンで読む → 読める設計書**: 0 トークンの静的文書（crit 1.05 s）+ 標準生成（m3e $0.69 / crit $1.65、L0 100 %）。初見者は README より +30 pt 理解でき、専門家が出典を開いて確かめても支持されない claim 0。
- **文書の一点にコメント → AI がそこに対応するコードを直す / 答える**: 文の出典がそのまま書き込み範囲になり（`@` 不要）、patch（1 ファイル $0.014）でも agent（複数ファイル $0.05）でも、採用は人が hunk ごとに・未コミットで・Undo 可。設計書側の変更は提案として本文に出て、人が採用 / 却下する。
- **初見者と専門家が同じ文書で**: 読者レベル（初めて / 標準 / 詳しい）、出典 peek、確かさバッジ。export でも同じ。
- **非機能**: 見積 → 上限 → 実績を全ジョブで表示、修復は会話の継続（増分のみ）、UI の楽観カード 26–44 ms。
- **ローカルファースト / 自分のエージェント**: ⤴ 自分のセッション（pull bundle）・`mitori install`（Claude Code / AGENTS.md）・MCP `submit_patch`。

### 0.3 残り（優先順）

1. **（要ログイン・実費小）** `claude` に再ログインしてから: 修復ターンの実エンジン確認
   `MITORI_LIVE=1 MITORI_MAX_USD=0.2 scripts/nd bun test test/int/int08.live.test.ts -t "3\."`（$0.01–0.03）。crit の S5 だけ再計測
   （`bench/measure/gen-real.ts --scope`、14 module ≈ $1.0）で再試行 < 30 %・L1 ≥ 90 % を実測で確かめる。候補を選んだ Fix の実エンジン 1 回。
2. **CLI がゲートの sandbox を検出しない**（`cr-requests/agent.md` #1）: `apps/cli` が `gateSandbox: "none"` 固定なので、出荷版では go vet / go test などが
   毎回「自動検査を実行」のクリック待ち。platform に `detectGateSandbox()`（macOS: sandbox-exec、Linux: bwrap）を足して CLI で渡す。**体験への影響が最大**。
3. **判断が要る**: sandbox はループバックも遮断する（ADR-0013、`agent.md` #8）。`httptest` などのテストは base/head とも失敗 → ⚠ のまま。
   現状維持 / ループバック許可 / プロキシ port を拒否してループバック許可、のどれか。
4. **アプリ内の書き出しダイアログ**（⌘K「HTML として書き出す」→ 読者レベル・言語・決定事項・抜粋の有無）。route と数字（`ExportRes.codeExcerpts`・redactions）は揃っている（`cr-requests/WP-13.md` §8）。
5. Fix の対象コード: 出典のチップを外せない（`ux.md` #2、router・`jobs/plan.ts`・`bundle/plan.ts`）。スレッドがコード範囲を持たないので ⤴ / ⧉ に選んだ候補が渡らない（`ux.md` #6、`CreateThreadReq.context`）— 今は出典の無い文の ⤴ / ⧉ を止めて ⚡ へ誘導している。
6. 生成の質: 横断的な「変更の手引き」節が無い（理解テストの 0 点問）、flow の seed が本筋を外す（crit で「コメント → review ファイル」が出ない、`gen.md` #4）、
   4,800 行級コンポーネントの中身、再 open で module 分割が変わる（#8）、「5 分で試す」が Node ≥ 22.12 を落とす、complete effort 未実行、理解テストを spec 規模（12 問 × 4 条件）に。
7. agent 周り: 初回ターンの入力上限が system prompt を含まない（`agent.md` #9）、`--restricted` の Read がワークツリー外を指す追跡済み symlink を辿るか未確認、
   `needs_more_context` のヒントが agent の束に入らない（#6）、`FsStat` に ctime が無い（#3）、Linux/bwrap、codex の agent mode、docpatch/1、GitHub PR、`maxWorktreesPerWs`。
8. UI の小物: 同じ未承認ゲートが Review 外で 3 回言われる、静的 facts 行への AI 提案はコード採用後に 409、アプリ本体の cite peek に行番号が無い、
   TermCard がローマ字と英語が同じとき 2 回出す、WebKit で和欧間の隙間が出ない（`text-autospace` 未対応）。
9. 予算の余裕: export viewer は 58.75 / 60 KB gz。`packages/core/src/domain.ts` の module 直下の Set/Map/RegExp に `/* @__PURE__ */`（試算 −0.65 KB）。
10. 負荷に弱いテスト（単独では通る）: INT-06 の go vet（空の GOCACHE・5 s 枠）、SKEL-AT-02（ELK 中央値 ≤ 120 ms）、IDX-AT-15（parse timeout）。
11. 所有者のレビュー待ち: WP-08b のファイルへの agent の変更（`agent.md` #4: `git/side.ts`・`jobs/runner.ts`）、ux の他所有者ファイルへの追加（`ux.md` #4）、WP-13 #7。
    非契約 export（`Installer.states()`・`resolveCodeTargets`、`ux.md` #1 / #5）。
12. 未着手: WP-17（Cloudflare 共有、**デプロイ前にユーザー承認必須**）、WP-18（床面図）、Windows、Firefox / 実機 Safari の確認。

---

## 0b. 前回の更新（2026-10-04 再開後 — グループ B の取り込みと実機デモ。歴史）

引き継ぎ資料の §5.3 に沿って再開した。**グループ B の 8 ブランチのうち 8 本すべてが main に取り込み済み**（push 済み）。

| 取り込み | 備考 |
|---|---|
| dogfood / perf / 06b / 11 | 06b と dogfood で gen プロンプト版が衝突 → 統合結果に合わせて `prompts.lock.json` を再生成。planner テストのしきい値を固定（再試行込みの見積が 12.1 万 tok になったため） |
| structure | **バグ修正**: 入れ子の親モジュール（`packages/excalidraw` など）が再スキャンで ID/スラッグを失っていた（照合索引が「ファイル→1 コミュニティ」だった）。crit の最大モジュールは 35.7k → 9.0k 行、leaf 14 個。crit のモジュラリティ下限は暫定 0.35（仕様の 0.45 は [仮]、実測 0.356） |
| 08b | lint 修正のみ。**ただし `createLoop` ファクトリ本体は未実装**（部品は揃っている） |
| visual / 10b | 見た目はプロトタイプに大きく近づいた（生成カード・ヒーロー・Reader の表・ミニマップ。`docs/progress/m1/*.png`） |

main の状態: `check` 緑・テスト 2,440 pass / 0 fail。crit のコールドオープンは約 0.8 s（ロードアベレージが高いと 8 s 近く出るが退行ではない）。

**完了（main に取り込み済み）**:
- `createLoop` の組み立て + サーバー配線 + INT-06/07（`docs/progress/loop-wiring.md`）。
- **実機デモ**（本物の UI・daemon・`claude`）で 説明 → 修正 → gofmt ゲート → 採用 → Undo を通した（`docs/progress/live.md`、スクショ `docs/progress/live/`）。Explain 4.7 s / $0.009、Fix 7.9 s / $0.014、UI の楽観カード 26〜44 ms。実機で見つけた結合バグ（SSE の同一 rev 取りこぼし、空の ASK 送信、他）は修正済み。再実行: `scripts/nd bun test/int/shots/live.ts --engine fake|real`。

**その時点の「次にやること」**（1〜3 は §0 で済。4 は小規模版のみ — §0.3-6）:
1. Fix が `@` 指定なしだと何も書かずに 412 になる件の UX（ヒント表示 or 自動でコード候補を選ぶ）。
2. 本物のエンジンでの標準生成の再実行（dogfood のプロンプト修正後の品質確認。API 換算 $1〜3）。
3. WP-08c（agent mode・test gate・修復ターン）、WP-13（HTML export）、`mitori install` 配線、doc proposal の accept/reject ルート。
4. 初見者理解テスト（`docs/design/specs/testing.md`）。

以下の §2.2「退避ブランチ」表は停止時点の記録であり、現在は全て main にある。

---

## 1. プロダクト概要（1 分で）

**mitori（見取り図）** — リポジトリを一度だけ省トークンで読み、人が読める「設計書」を生成する。設計書の任意の箇所にコメントすると、**ユーザー自身の AI エージェント**（Claude Code / Codex）が最小コンテキストでコードと設計書を同時に直し、差分と費用を返す。ローカルファースト、日本語ファースト、Bun 単一バイナリ。

- 参考: lnkiai/m3e-canvas（設計→AI 向けプロンプト）、tomasz-tomczyk/crit（レビュー→エージェントへフィードバック）
- 差別化: 設計書アンカー型の閉ループ / 全 claim に出典と検証バッジ / 初心者〜専門家を 1 文書で / 費用の事前見積→上限→実績 / 日本語組版
- リポジトリ: `github.com/satoki252595/mitori`（private）

## 2. 停止時点の状態（歴史 — 現在は §0）

### 2.1 main（安定・push 済み）

| 項目 | 状態 |
|---|---|
| 最新 | `docs: handoff` コミット（この文書）。直前 `7b4bcba feat(core): CR batch 2` |
| ゲート | `scripts/nd bun run check` 緑 / `scripts/nd bun test` 2,144 pass・0 fail（約 2 分） |
| 完了マイルストーン | M0（土台・契約凍結）、M0.5（walking skeleton）、M1（0 トークンの見取り図）、M2 の大半（生成パイプライン・セッションエンジン）。詳細 `docs/progress/M1.md` |
| 動くもの | `mitori <path>` → daemon 起動 → S0〜S4 解析 → 静的設計書（間取り図・目次・facts 表・§4/§5/§6/§8/§11）をブラウザ表示（**0 トークン、crit 1,219 files で 1.05 s**）。⌘K、ライト/ダーク、ファイル保存→鮮度バッジ、生成の見積→実行→ブロック streaming（録画エンジンで検証済み）、`.mitori/` への書き出し（GitHub で出典リンクが効く）、`mitori gen --prep/--ingest` |
| 動かないもの（main では） | レビュー→AI 修正ループ（`createLoop` 未マージ）、Pull CLI（`mitori review` 等）、差分更新 S9、HTML export。初回起動で claude CLI が「見つかりません」になる（修正は track/dogfood にある） |

### 2.2 グループ B の退避ブランチ（未マージ・未検証）

各トラックは「実装 → 敵対的検証」の **実装段階の途中**で停止。検証エージェントは未実行。`wip(...)` コミットは停止時点の未コミット作業をそのまま保存したもの。

| ブランチ | 内容 | `bun run check` | 次の作業 |
|---|---|---|---|
| `track/dogfood` | **実エンジン生成の修正一式**: 初回 claude 検出（TOFU pinning）、**プロンプトが 2 回送られトークン 2 倍になるバグ修正**、プロセス残留修正、プロンプト @2〜@4、L1 検証改善、見積に再試行分を加算、`bench/measure/gen-real.ts` | ✅ | **最優先でマージ**（検証 → main）。gen-measure レポートは未作成（数値は §3.2） |
| `track/11` | WP-11 CLI 一式（review/bundle/reply/touch/open/check/digest/gen/install/mcp/config/export/usage/stop/doctor）、Pull hook、installer、MCP tools/list golden、進捗レポート | ✅ | 検証 → マージ。daemon 側の配線待ち項目はブランチ内レポート参照 |
| `track/06b` | WP-06b: S9 差分更新、on-demand、翻訳、M4 prompt 5 本、crit 40 commit replay テスト | ✅ | 検証 → マージ |
| `track/perf` | 増分 S2 facts、wasm モジュール共有、watcher の stat 判定・ディレクトリ削除、永続化の非同期化（+ wip: GitReader local） | ✅ | 検証 → マージ。gostd の時間/RSS 予算は再計測が必要 |
| `track/10b` | WP-10b レビュー UI（選択ツールバー・Composer・ジョブ/ready カード・Review パネル・Inbox）+ wip（遅延ロード化、e2e/loop） | ✅ | 検証（Playwright でスクショ確認）→ マージ |
| `track/visual` | 見た目の磨き込み（地図ラベル切れ、ヒーロー、生成カード状態、Reader の重複見出し・表、i18n）— **全部 wip**（53 files） | ✅ | 検証（スクショ比較）→ マージ |
| `track/08b` | WP-08b git 安全（side repo・snapshot・scope・accept/undo・gc）+ wip（gates・jobs・createLoop 相当） | ❌（tsc 未使用変数 1、biome 25） | 修正して検証 → マージ。**これがマージされるとレビュー→修正ループが動く** |
| `track/structure` | S3 のディレクトリ整合 leaf、パス名、module/repo skeleton、moduleContext、要約 + wip（cluster 調整・テスト） | ❌（biome 4） | 修正して検証 → マージ。巨大モジュール問題（crit で 35.7k 行が 1 module）の解消確認 |

推奨マージ順（依存と衝突の少なさ）: `dogfood` → `perf` → `structure` → `06b` → `08b` → `11` → `visual` → `10b`。マージ後に `packages/server/src/compose.ts` へ `createLoop`（08b）と 06b の入口を配線する（WP-INT の仕事。`docs/design/briefs/WP-INT.md`）。

## 3. 実測値（停止時点。最新の生成・agent・export の数字は §0.1）

### 3.1 解析・UI（M1、Apple M5 Max、他エージェント稼働中）

| 指標 | 予算 target / limit | 実測 |
|---|---|---|
| 起動 → 最初の有用な画面（crit） | 3 s / 5 s | **1.05 s**（m3e 0.56 s） |
| S0〜S4 + 静的文書（crit） | 1.0 / 2.0 s | 0.80 s |
| 保存 → 鮮度バッジ | 50 ms / 1 s | go-small 30 ms、crit 80〜140 ms |
| 初期 JS（gz） | 60 KB 警告 / 150 KB | 83〜84 KB |
| バイナリ | 85 / 95 MB | 68.8 MB、`--version` 26.6 ms |
| gostd cold / peak RSS | 1.5 s / 1 GB（limit） | 2.0 s / 1.05 GB（**超過**、track/perf で対処中） |

### 3.2 実エンジンでの標準生成（track/dogfood、lean `claude -p`、Max サブスク、並列 3）

| repo | 所要 | 最初の AI ブロック | API 換算 | 入力（うち cache read） | 出力 | citation L0 / L1 |
|---|---|---|---|---|---|---|
| crit（65k 行） | 145 s | 2.7 s | **$1.32** | 828k（65%） | 37k | 100% / 84.8% |
| m3e-canvas | 94 s | 4.3 s | **$0.52** | — | — | — |

- 初回 run は「プロンプト 2 重送信」バグで CLI 実費 $3.88（台帳 $1.88）・子プロセス 33 本残留 → 修正済み（track/dogfood）。
- 課題: 行の再試行率 63%（費用の主因）、見積誤差 +84%（再試行分を見積に加算する修正は入った）、L1 が limit 85% をわずかに下回る。
- 生成された実物の設計書: `docs/progress/dogfood/{crit,m3e-canvas}/doc/*.md`（品質確認用）。

## 4. 既知の課題（停止時点の記録。1〜3 と 7 の WP-08c / WP-13 は解消済み。現在の残りは §0.3）

1. **レビュー→修正ループが main で動かない**（08b + 10b + 11 のマージと配線が必要）。MVP の「魔法の瞬間」はここ。
2. **モジュール分割が粗い**（crit で 1 module 35.7k 行、名前が `internal + cmd · CritJSON`）→ track/structure。
3. **間取り図の見た目**（ラベル切れ・空箱・常時出る「間取り図にできない構成」バナー）、ヒーロー/生成カード/Reader の表 → track/visual。
4. 生成の再試行率 63% と見積誤差（§3.2）。
5. gostd 規模の解析時間・メモリ超過、crit の鮮度バッジ 80〜140 ms。
6. Linux 未計測（watcher 方式 O3 含む）、Windows 未対応。
7. 未着手: WP-08c（agent mode・test gate・修復）、WP-13（HTML export）、WP-17（Cloudflare 共有、**デプロイ前にユーザー承認必須**）、WP-18（床面図）、公開ベンチ・初見者理解テスト。

## 5. 再開手順

### 5.1 環境

```bash
cd ~/work/20261002_aiAgentTool
scripts/nd bun install --frozen-lockfile   # nd = キャッシュ済み nix devShell で実行（nix develop は使わない）
scripts/nd bun run check                   # typecheck + biome + 境界 + CR 台帳 + budgets + svelte-check
scripts/nd bun test                        # 全テスト（約 4 分、2,716 件）
scripts/nd bun run build:bin               # dist/mitori-darwin-arm64
./dist/mitori-darwin-arm64 <repo-path>     # ブラウザで見取り図が開く
```

- コーパス（ベンチ用 clone）はセッション一時領域にあった。再取得: `scripts/nd bun scripts/fetch-corpus.ts`（`bench/corpus.lock.json` の pin で shallow clone）。
- 実エンジン生成の計測: `.claude/skills/mitori-measure/`（`MITORI_LIVE=1` と `--max-usd` が無いと 1 円も使わない設計）。

### 5.2 ブランチの取り込み（コストを抑えたやり方）

1 ブランチずつ、手元で:

```bash
git checkout -b integrate/dogfood main
git merge --no-ff track/dogfood
scripts/nd bun run check && scripts/nd bun test
```

失敗したら原因をそのブランチで直してから main へ。08b / structure は lint エラーがあるので `scripts/nd bunx biome check --write <path>` と未使用変数の修正から。

### 5.3 推奨する次の一手（停止時点のもの。すべて済み — 現在の次の一手は §0.3）

1. **（ほぼ無料）** `track/dogfood`・`track/perf`・`track/06b`・`track/11` は check 緑。テストを通してマージ。
2. **（小）** `track/08b`・`track/structure` の lint 修正 → テスト → マージ → `compose.ts` に `createLoop` 配線 → INT-06（デモ台本: Explain → Fix → 採用 → Undo → `mitori review`）を録画エンジンで通す。
3. **（中）** `track/10b`・`track/visual` をスクショで確認してマージ。
4. **（中〜大、LLM 費用あり）** 実エンジンでデモ台本を 1 回（go-small、API 換算 $0.5 以下）。初見者理解テスト（`docs/design/specs/testing.md`）。

### 5.4 コストについて（今回の反省と次回の運用）

- 今回は ultracode（多数エージェントの並列ワークフロー）で進めた。サブエージェントの消費トークンはおおよそ: リサーチ 3.2M、設計 10.3M、M0 2.1M、グループ A 14.5M、グループ B（停止まで）数 M〜10M 規模。**設計フェーズの仕様が 2MB と過大**で、各エージェントの読み込みコストを押し上げた。
- 次回の目安:
  - 並列は 3〜4 本まで、検証は「失敗した受け入れ試験がある WP だけ」に絞る。
  - 定型作業は sonnet、opus は設計判断・セキュリティ・統合だけ。
  - 各エージェントは `docs/design/briefs/WP-xx.md`（≤ 12k token）だけを読み、spec 本文の全文読みを禁止する。
  - 実エンジン生成は 1 repo あたり API 換算 $0.5〜1.5（サブスク枠から消費。継続的な課金増は無し）。
- 継続費用: **0 円**（Cloudflare 未デプロイ、GitHub Actions は push トリガー無し・未実行）。

## 6. ドキュメント地図

| 何を知りたいか | どこ |
|---|---|
| 調査の結論（競合・数値・方針） | `docs/research/00-synthesis.md`（Critic addendum を含む） |
| アーキテクチャ・判断 | `docs/design/ARCHITECTURE.md`、`docs/design/adr/0001〜0014` |
| 作業分割・受け入れ試験・所有ディレクトリ | `docs/design/MILESTONES.md`、各 WP の要約 `docs/design/briefs/WP-xx.md` |
| 仕様の優先順位 | 契約（`packages/*/src/contract.ts`、`packages/core/src/{domain,api}.ts`）> `docs/design/REVIEW-LOG.md` > ARCHITECTURE/ADR > `docs/design/specs/*.md`（各 spec 冒頭「改訂 R1」が本文に優先） |
| 契約変更の台帳 | `packages/core/CR-LEDGER.md`、未処理の要望 `docs/design/cr-requests/` |
| UI の正解（目標の見た目） | `docs/design/prototypes/editorial/`（index.html + shots）、統合仕様 `docs/design/prototypes/JUDGEMENT.md` §6 |
| 進捗・実測 | `docs/progress/M1.md`、`docs/progress/m1/*.png`、`docs/progress/dogfood/`、ループ配線 `loop-wiring.md`、実機デモ `live.md`、生成品質 `gen-quality.md`（生成物 `dogfood2/`）、agent mode `agent-mode.md`、レビュー UX `ux.md`（`ux/*.png`）、HTML export `export/README.md` |
| 開発コマンド・規約 | `CLAUDE.md`、`.claude/skills/{mitori-check,mitori-bench,mitori-measure,mitori-release-build,mitori-export}` |

## 7. 守るべき約束（設計で決めた安全側の既定）

- エージェント起動は lean flags 必須（`--setting-sources ""`/`--strict-mcp-config`、stdin でプロンプト、`--system-prompt-file`、`--no-session-persistence`、完全なモデル ID）。**対象 repo の project 設定・hook を読ませないのはセキュリティ境界**（invariants I1〜I14、`packages/agent`）。
- サブスクで `claude -p` を使う扱いは 2026 年に 3 回変わっている（ADR-0005）。並列は既定 3、無人ループなし。
- ユーザー repo の refs/objects/worktree には書かない（side repo、ADR-0012）。accept は未コミットで作業ツリーへ + checkpoint で Undo。
- `fixtures/repos/{injection,secrets}` には**意図的な偽の秘密情報**がある（スキャナ試験用）。
- Cloudflare リソースは `mitori-` 接頭辞。**デプロイ・Paid 化は事前承認**。
