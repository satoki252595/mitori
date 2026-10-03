# 設計レビュー — スコープと納期リスク（scope & delivery risk）

- 作成: 2026-10-03 / 立場: 敵対的な設計 critic（レンズ: スコープ・納期・並列化・試験可能性・実装が止まる箇所）
- 対象: `ARCHITECTURE.md`、`adr/0001〜0011`、`specs/{indexer,generation,loop,ux,testing}.md`、`contracts/*.ts` と `contracts/testing.md`、`MILESTONES.md`、`prototypes/JUDGEMENT.md`。入力として `research/00-synthesis.md`（Critic addendum を含む）と 05 §3・§6 を読んだ
- リードの決定（D1〜D19、今回の build scope）は再審議しない。本書は「その範囲の中で何を先に出し、何を後ろへ送り、何を書き足せば止まらずに着地するか」だけを扱う
- 表記: **[検証済]** = 本レビューでこの Mac（Bun 1.4.2 / Node 22.23.3 / Claude Code 2.1.288）で確かめた。記録は `scratchpad/design-tmp/scope/`。重大度は critical / high / medium / low

---

## 0. 結論（TL;DR）

1. **設計の中身は精密で、多くは正しい**。問題は精密さそのものではなく、(a) 凍結するはずの契約に約 67 件の未適用変更要求（core / api）が積まれていること、(b) 0 token の P0 出口（M1）が、実際には生成パイプライン（M2）と、誰も担当していない床面図に依存していること、(c) 単一バイナリの結合が最後のグループに置かれ、walking skeleton が無いこと、の 3 点で、このままだと **M1 が閉じない**。
2. **最初に着地させるべき「魔法の MVP」は synthesis §8.1 のデモ台本そのもの**（`mitori` → 3 秒で地図と静的な表 → 見積り → 日本語の設計書が出典付きで流れ込む → 文を選んで `f` → patch + 設計書の提案 + gofmt ✓ + $ → ⌘Enter → Undo → `.mitori/` を GitHub で読める）。これに要らないものは M3 の後へ送る。リードの build scope に含まれる P2 項目（agent mode・repair・batch round・Inbox・S9・doc_edit・install・prep/ingest・mcp・export）は **M4 以降の第 2 波**として保持し、削らない。
3. **後ろへ送る（今回の範囲から外す）候補**は、リードの範囲外か design 段階で足されたもの: 床面図（区画・扉・Z0〜Z3・ピン・流れの重ね描き）、やさしく、読書パスのカード・S6/S7/S8 画面、キー再割当てエディタ、ローマ字・かなのパレット正規化、anthropic-api の Batch・count_tokens、Node 22 アダプタの二重グリーン、Windows・linux-arm64・macOS-x64 のバイナリ、`install codex`、GitHub PR 作成（fork + push）、warm pool、理解度クイズ・L3 judge・A/B eval。
4. **書き足すべきもの**: server / platform spec（存在しない）、CR の台帳と P0 分の適用、WP ごとの実装ブリーフ（実装者 1 人あたり 17〜19 万 token の spec を読ませない）、作業量と timebox。
5. **検証で分かったこと**: ELK は `elk-api.js` + 埋め込んだ `elk-worker.min.js` なら `--compile` 後も動く（elkjs の既定 entry と `elk.bundled.js` は Bun で失敗）。Shiki は compile 後も動くが convenience bundle は +9.3MB。TypeScript 7 は svelte-check と同居できない（peer が `^5 || ^6`）。契約の tsc は 0 エラー。

---

## 1. 検証ログ（本レビューで実行したもの）

| # | 何を | 結果 | 帰結 |
|---|---|---|---|
| V1 | `bunx tsc@6.0.3 -p docs/design/contracts/tsconfig.json --noEmit` | 0 エラー（0.68 s） | 契約は型として整合。ただし core / api は commit `d4255df` から未変更（`git log -- contracts/core.ts contracts/api.ts`）。`DiagramKind` に `"floorplan"` 無し、`PauseReason` に `"budget"` 無し → 各 spec の CR は未適用（SC-01） |
| V2 | ELK 3 方式を `bun run`（`elk-a/b/c.ts`） | A: `elk-api.js` + `workerFactory: u => new Worker(u)` + `elk-worker.min.js` を `with {type:"file"}` → **成功 108 ms（50 ノード）**。B: `elk.bundled.js`、C: `elkjs`（既定 entry）→ **どちらも失敗** `TypeError: undefined is not a constructor (evaluating 'new _Worker(url)')` | 05 §6 の結論を再確認。ELK は専用 Worker が要る（SC-04、SC-17d） |
| V3 | A を `bun build --compile`、node_modules の無い dir で実行 | **成功 95 ms**。worker path は `/$bunfs/root/elk-worker.min-4d2t87j4.js` | compile 上の阻害要因ではない。ただし誰もまだ通していない（WP-11 が Group B）→ walking skeleton で固定する |
| V4 | Shiki（`shiki/core` + `createOnigurumaEngine(import("shiki/wasm"))` + 4 言語 + css-variables テーマ）を compile | 成功（64 ms）、バイナリ 63.4MB。convenience（`createHighlighter` 名前指定）も成功だが **72.7MB（+9.3MB）** | fine-grained を必須にし、言語表を固定する（SC-25） |
| V5 | `npm view typescript@latest` / `svelte-check@latest` / `bun-plugin-svelte` | TS 7.0.2 の `exports["."]` は `./lib/version.cjs` だけ。svelte-check 4.7.6 の peer は `typescript: ^5.0.0 \|\| ^6.0.0`。bun-plugin-svelte は 0.0.6 | TS 7 を workspace の `typescript` にすると `check:web` が壊れる（SC-08）。component の unit 試験基盤は未成熟（SC-18） |
| V6 | `claude --help`（2.1.288） | `--setting-sources` `--restricted` `--strict-mcp-config` `--disable-slash-commands` `--no-session-persistence` `--permission-prompts` `--system-prompt-snapshot` `--session-id` `--include-partial-messages` あり。`--system-prompt-file` は help に無い。`--no-session-persistence` の説明は「cannot be resumed」 | loop spec I1〜I14 は妥当。ARCHITECTURE / ADR-0006 の「`--resume` で修復」は既定と矛盾（loop §6.6 の parking で解決済みだが上位文書が古い、SC-17b） |
| V7 | `node:sqlite`（Node 22.23.3）と `bun:sqlite` の FTS5 trigram | 両方動く。Node は `ExperimentalWarning` を出す。Bun は SQLite 3.54.0 | Node 撤退先は技術的には可能。ただし今回の納品物ではない（SC-13） |
| V8 | `bun test --help` | `--parallel` `--changed` `--timings` `--randomize` `--rerun-each` あり | testing spec の開発ループは Bun 1.4.2 で成立 |
| V9 | GitHub Actions の料金（Web 検索） | self-hosted の $0.002/分 課金は 2025-12 に**無期限延期**（撤回ではない）。hosted は 2026-01 に最大 39% 値下げ | self-hosted 依存は今は無料だが監視が要る（SC-10） |
| V10 | spec の分量（文字数から token を推定: 和字 0.8 tok/字、他 3 字/tok） | ux 63k、loop 61k、testing 53k、gen 52k、indexer 51k、JUDGEMENT 27k、core.ts 34k、loop.ts 40k、api.ts 22k、ARCHITECTURE 17k | WP-10a の実装者は約 18.6 万 token、WP-08 は約 17.3 万 token を読む必要がある（SC-12） |

---

## 2. 指摘一覧（重い順）

| ID | 重大度 | 一言 |
|---|---|---|
| SC-01 | critical | 約 67 件の core / api 変更要求が未適用のまま「契約凍結」→ 並列開始直後に契約が動く |
| SC-02 | critical | M1（P0 出口）が O1/O2 の計測を通じて生成パイプライン（M2）に依存している |
| SC-03 | critical | 床面図が担当なし・仕様不足のまま M1 の主画面になっている |
| SC-04 | high | walking skeleton が無く、単一バイナリの結合が Group B（WP-11）。M1 が WP-11 を要るのに WP-11 は WP-06/07/08 待ち |
| SC-05 | high | server / platform spec が存在しない（所有者として参照だけされている） |
| SC-06 | high | ストリーム S1 が architect + core + platform + server + 全結合を抱える単一の律速 |
| SC-07 | high | WP-08 が大きすぎ、P1 と P2 の中身が混ざっている |
| SC-08 | high | TypeScript 7 を使う方針が svelte-check と両立しない [検証済] |
| SC-09 | high | gen の cassette が indexer の出力バイトで key 化され、並行開発中に毎回 miss する。再録画は maintainer 機だけ |
| SC-10 | high | CI 計画が自分の数字で無料枠を超える（spending limit $0 → CI 停止） |
| SC-11 | high | マイルストーンの出口条件（2 回連続 dry + 全 SLO の target）が収束しない |
| SC-12 | high | 実装者 1 人に 17〜19 万 token の spec を読ませる構成 |
| SC-13 | high | リードの範囲外（P3 または design で追加）の機能が WP に入っている |
| SC-14 | high | 出口判定の閾値が n=30・n=1 の確率的な値（patch 通過率など） |
| SC-15 | medium | 自前 Leiden + γ 探索 + 階層 + マシン間の浮動小数決定性が M1 の経路にある |
| SC-16 | medium | 共有ファイル（budgets.json・i18n・lockfile・fixtures）が並列 8 本の衝突点になり、所有規則が往復を生む |
| SC-17 | medium | ADR / ARCHITECTURE と spec の食い違い 5 件（claim marker、`--resume`、warm pool 数、compute Worker、watcher debounce） |
| SC-18 | medium | Svelte component の unit 試験基盤（bun-plugin-svelte 0.0.6 + happy-dom）が未検証 |
| SC-19 | medium | 人が要る判定（5 人の読みやすさ評価、IME 実機、人手監査、runner 登録）が出口に組み込まれている |
| SC-20 | medium | 実装 agent 8 本・cassette 録画・P0 計測・eval が同じサブスクの 5h 枠を取り合う |
| SC-21 | medium | 遅延 chunk ごとの +15% hard fail を初日から適用 |
| SC-22 | medium | standard の生成 prompt が M2 には広すぎる（節合成 8 種） |
| SC-23 | medium | WP-00 に直列作業が詰め込まれている |
| SC-24 | medium | MILESTONES に作業量・timebox・cut line が無い |
| SC-25 | low | バイナリ予算 85MB の余裕は Shiki の作り方次第 [検証済] |
| SC-26 | low | facts 検出器 約 45 種の全数を M1 に入れている |

---

## 3. 指摘の詳細

### SC-01（critical）約 67 件の core / api 変更要求が未適用のまま契約を凍結する

- **場所**: MILESTONES §0-1（WP-00 で凍結、以後 architect レビュー）、WP-00 の成果物。変更要求の出所: ux §16 R1〜R25（25 件）、gen §17.1 C1〜C12（12）+ §17.2 L1〜L10（loop.ts へ 10）+ §17.4 ADR 改訂 2、indexer 付録 B CR-1〜CR-13（13）、loop §14.3（11）+ §14.4（cross-spec 6 宛先）、testing §11.1 / contracts/testing.md §4 CR-1〜CR-6（6）+ RQ 14 件、JUDGEMENT §9。
- **事実**: core.ts・api.ts は `d4255df` 以後まったく変わっていない（V1）。gen.ts・indexer.ts・loop.ts・ui.ts は合計 +6.6k 行の追加で、core に無い型をローカル定義や fallback（例: indexer の `EXCLUDE_REASON_FALLBACK`、`special → "vendored"`）で避けている。
- **失敗シナリオ**: WP-00 が「現在の契約」を `packages/core` に移して凍結 → Group A の 10 WP が同時に着手 → 初週に各 WP が「P0」優先の CR（R1・R2・R3・R6・R8・R10・R14〜R16、C2、CR-1・CR-5・CR-6・CR-8、testing CR-1・CR-4 など）を architect に出す → architect は S1 ストリーム（WP-01・WP-09 も担当）なので直列に詰まる。あるいは各 WP がローカル型で回避し続け、M1 の結合で `ScanSummaryView.stages` と `stageMs` の二重定義（indexer CR-13 と testing CR-5 が同じものを別名で要求）のような食い違いが表面化する。
- **修正**:
  1. WP-00 に **「CR 精算」を最初の作業として追加**する。`docs/design/contracts/CR-LEDGER.md` に全件を 1 行ずつ（id・出所・P0/P1/P2・採否・適用 commit）で並べ、**P0 分は凍結前に適用**、P1 以降は「採用・形を確定・適用は Mx」と書く。重複は統合する（例: indexer CR-13 と testing CR-5 → `ScanSummaryView.stageMs` 1 つ。indexer CR-6 の `SecretScanner` と loop §12.2 の `createSecretScanner` → core に 1 つ）。
  2. 本書の SC-03 で床面図を後ろへ送るなら、R3（floorplan 型）・R4（`mapFlow`）は不採用（後日）と明記して台帳から外す。
  3. 凍結後の契約変更は **週 1 回のバッチ窓**（例: 毎週月曜、architect が 1 PR にまとめる）に限る。個別の CR は台帳に積むだけにして、WP 側は `// CR-xx pending` を付けたローカル型で進める。
  4. WP-00 の受け入れ試験「契約ファイルと `packages/core` の型が一致（代入互換テスト）」は **M0 の時点で 1 回だけ**にする。以後 `docs/design/contracts/` は凍結スナップショットなので、このテストを残すと CR を入れるたびに凍結物を書き換えるか試験を壊すかの二択になる。

### SC-02（critical）M1 の出口が生成パイプラインに依存している

- **場所**: MILESTONES §3 M1「計測完了: O1（D14）、O2（Pass 1 実測・5h 枠）…と、その結果による budgets.json の確定」、ARCHITECTURE §13 O1・O2（期限 P0）、gen spec §16 M-1〜M-10、testing §7.6 M-01・M-02。
- **事実**: gen §16 M-2 は「crit・m3e で standard を claude-cli C=3 で実行」、M-1 は「10 module ずつ NDJSON と `--json-schema` を比較」、M-9 は「M-2 の 200 block を人手確認」。これを製品コードでやるには、WP-05（claude-cli engine・normalizer・scheduler）、WP-06（planner・prompt 群・行検証器・Verifier）、WP-04（doc writer）、WP-02/03（skeleton・repo pack）がほぼ完成している必要がある。これらは M2 の中身。
- **失敗シナリオ**: 0 token の見取り図が出来ても M1 を閉じられず、最初の結合マイルストーンが実質 M2 にずれる。その間 budgets.json の生成 SLO は「P0 実測後に確定」のまま宙に浮き、M2 の出口判定（「見積り誤差 ±25%」など）の基準値が無い。
- **修正**: O1・O2（M-1〜M-10）を **M2 の出口**へ移す。M1 は O3（Linux watcher）・O4（Leiden）・O8（ID コメント配置）だけにする。どうしても M1 で数字が要るなら、研究段階と同じ使い捨ての harness（`bench/measure/pass1-proto.ts`。indexer の出力を読み、`claude -p` を直接 lean flag で叩く）で測り、製品コードに依存させない。M2 の出口に「budgets.json の `gen.std.*` を実測値で確定する PR」を入れる。

### SC-03（critical）床面図が担当なし・仕様不足のまま M1 の主画面になっている

- **場所**: JUDGEMENT §6.3.1〜6.3.4・§10 AC-J01〜J09・§11-1/9/11、ux §4.2.1〜4.2.7・§16 R3/R4・§17 U7、MILESTONES WP-04（`DiagramLayouter` は ELK だけ）・WP-10a（client 描画だけ）。
- **事実**:
  - サーバ側の床面図レイアウト（squarified treemap 2 段 + Fiedler ベクトル順 + 扉 + 品質ゲート 4 指標 + 前回並びの保持）を**どの WP も成果物に持っていない**。所有パッケージも決まっていない（doc か indexer か）。
  - **区画（zone）5 種**（入口 / 常駐プロセス / 中核 / 基盤・外部連携 / UI）への module の割り当て規則が、どの spec にも無い（`grep zone` は indexer・gen・api・core で 0 件）。
  - **外部アクター**は「`MapView` の facts（HTTP client、exec、書き込み先、README）から作る」とあるが、indexer §5.2 の検出器に HTTP client・exec・書き込み先は無い。
  - `MapView`（api.ts）に zones・doors・`fallback`・`quality` が無い（R3 は未適用）。`overlays.churn` は git log（gen C5 の `GitReader.log`、未適用）が要り、`--depth 1` の GitHub clone では原理的に取れない。
  - さらに ELK の Container 図を「退避先」として**別に**用意する設計なので、M1 で地図の描き方が 2 系統になる。
- **失敗シナリオ**: WP-10a は `FloorPlan.svelte` をモックの `DiagramLayout(kind: floorplan)` で作るが、それを出す server 側の実装が無い。M1 の AC-J01〜J04（stage 700px、3 秒、決定的レイアウト 30 ms、8 repo の退避レポート）を誰も満たせない。誰かが終盤に区画の分類を即興で作り、m3e のような層型 repo で品質ゲートに落ちて結局 ELK 図になる。
- **修正**:
  1. **MVP の S1 は ELK の Container / dependency 図**にする（ux §4.2.6 で既に「同じ SVG 部品・部屋の選択・ピン・ズーム Z0〜Z2 が同じ操作で動く」と仕様化済みの退避経路を主経路に昇格する）。S1 の画面構成（strip・右列の見積りカード・「0 tok で今できること」・静的に分かったこと・S0〜S4 の所要時間）はそのまま残す。これで M1 の魔法（3 秒で地図）は保たれる。
  2. 床面図は **新しい WP-18（M4 以降、feature flag `ui.map.floorplan`）**に切り出し、着手前に「区画の分類規則（facts と path 規則から決定的に）」「外部アクターの検出器」「所有パッケージ（`@mitori/doc` の `layout/floorplan.ts` を推奨）」「`MapView` の型」を spec に書く。
  3. M1 の受け入れから外すもの: AC-J03（床面図の決定性）、AC-J04（品質ゲートと退避レポート）、AC-J05 の Z3、AC-J08 の扉、AC-J09（流れの重ね描き。§3 の生成が要るので元々 M2 以降）、`ui.floorplan.nodes`。残すもの: AC-J01（stage が見える、LLM 呼び出し 0）、AC-J02（3 秒）、AC-J06（ラベル 11px 以上・clip）、AC-J07（部屋カード 100 ms・Enter で節）。
  4. `overlays.churn` は remote-readonly（shallow）で常に空になることを api.ts のコメントに書く。

### SC-04（high）walking skeleton が無く、単一バイナリの結合が最後になっている

- **場所**: MILESTONES WP-00（`--compile` は `--version` の hello だけ）、WP-11（Group B。「5 ターゲットの `--compile` と埋め込みアセット」）、§3 M1「11（`mitori` open のみ）」、ARCHITECTURE §2.4（compute Worker に ELK・Shiki・diff）。
- **事実**: M1 は WP-11 の一部（daemon の起動・registry・nonce・ブラウザを開く）を要るが、WP-11 の依存は WP-09・WP-07・WP-06・WP-08 で Group B に置かれている（表の上で矛盾）。05 §3 は wts・Worker・UI 埋め込みを**別々に**確かめただけで、本設計の組み合わせ（parse Worker + ELK Worker + Shiki + markdown-it + migration + Svelte の dist の事前圧縮表）を 1 本のバイナリで通したことは無い。本レビューで ELK と Shiki は compile 後も動くことを確かめた（V2〜V4）が、ELK は**専用の Worker**（`elk-worker.min.js` を file として埋め込み、`elk-api.js` の `workerFactory` で起動）でないと動かず、`elkjs` の既定 entry と `elk.bundled.js` は Bun で失敗する。
- **失敗シナリオ**: Worker の entrypoint 指定漏れ、`$bunfs` のパス、gen-assets の表の生成順、バイナリ 85MB 超過、Linux での挙動差が M3 前後に一度に出る。その時点では 8 本の WP がそれぞれの前提で作っており、直すと広範囲に波及する。
- **修正**:
  1. **WP-11a「walking skeleton」を Group A の先頭（WP-00 直後、1 週以内）に新設**する。内容: `bun build --compile`（darwin-arm64 と linux-x64 の 2 つだけ）で、Svelte の dist（br/gz 事前圧縮）、6 grammar の wasm、parse Worker、ELK Worker（`elk-worker.min.js` を `with {type:"file"}`）、Shiki（fine-grained）、migration runner を埋め込み、`mitori <path> --no-open` → daemon 起動 → S0 の列挙だけ → `GET /api/v1/ws/:ws/doc`（静的な目次）→ 外枠が描ける、まで。CI で node_modules の無いディレクトリから起動し、バイナリサイズと起動時間を asset gate に入れる。
  2. 以後の WP はこの skeleton に機能を足していく（「結合は M1 で一度に」ではなく「毎日 skeleton に結合」）。WP-11 の残り（review・reply・install・mcp・export・usage・doctor）は Group B のまま。
  3. ARCHITECTURE §2.4 の compute Worker を「ELK 専用 Worker（elk-api の workerFactory）+ compute Worker（Shiki・大きな diff）」の 2 本に書き直す。

### SC-05（high）server / platform spec が存在しない

- **場所**: ARCHITECTURE §3.2（platform・server・client・cli の spec 所有者が「server spec」）、MILESTONES WP-01（`docs/specs/platform-watch.md` に記録）、testing SRV-I-006・SRV-I-008（「status は server spec」「server spec が採否を決める」）、testing M-04（「platform spec に記録」）、loop §14.4（server 宛の依頼: `job.accepted`・`round.completed`・`checkpoint.undone` の配線、accept lock と write queue の順序）、gen §17.2 L1（delta の throttle は SSE 配信側だけ）。`find docs -iname '*server*' -o -iname '*platform*'` は 0 件。
- **失敗シナリオ**: WP-09 の実装者は、daemon の寿命・版不一致・registry・認証・SSE の rev と replay・write queue の API・WorkspaceManager の状態・domain event の発行と購読・migration の順序・idempotency・エラーの HTTP 写像を、ARCHITECTURE と api.ts と 4 本の spec の「依頼」表から自分で組み立てることになる。結合バグ（例: accept の書き込みと再アンカーの write queue 上の順序、`index.delta` を anchor → doc → loop → gen に渡す順序と transaction 境界）が M1〜M4 のたびに単一の結合担当に溜まる。
- **修正**: Group A の開始前に **`specs/server.md`（目安 30KB 以内）**を書く。最低限: (1) daemon の寿命・lock・registry・版不一致の 3 分岐、(2) 認証と `ROUTE_META.clients` の判定表、(3) SSE hub（envelope・rev・ring・replay・resync・throttle）、(4) write queue の API と「中で待ってよいもの / いけないもの」、(5) WorkspaceManager の状態遷移、(6) **domain event のカタログ**（publisher・subscriber・payload・同期 / 非同期・write queue 内か外か）: `index.delta` → `anchor.reanchor` → doc / loop / gen、`job.accepted` → `gen.syncBlocks`、`round.completed`、`checkpoint.undone`、`gen.block.applied`、(7) migration runner の順序、(8) エラー → HTTP（415・421・403 等）、(9) watcher の要求仕様（indexer §10.1 を参照）と O3 の記録先。platform の port（`SqlDb`・`Spawner`・`WorkerPool`・`GitReader`・`FsReader`）もここに置く。

### SC-06（high）ストリーム S1 が単一の律速になっている

- **場所**: MILESTONES §1 の割り当て表（S1: WP-00 → WP-01 → WP-09、所有 `/`・core・platform・server・client・scripts）、§0-1（core の変更は architect レビュー）、§0-3（結合は WP-09 の composition root で M1〜M5 ごと）。WP-03 は「S2 の 2 人目、または WP-02 の後」と曖昧。
- **失敗シナリオ**: S1 は直列の WP-00 を終えた後、全員が使う platform の実装（WP-01）と、全員の結合点（WP-09）と、全 CR のレビュー（SC-01）を同時に抱える。M1 の結合は S1 の WP-09 完了待ちになり、その WP-09 は WP-01 完了待ち。WP-03 が WP-02 の後に回ると、M1 の経路は WP-00 → WP-02 → WP-03（Leiden）→ M1 にもなる。
- **修正**: (1) WP-01 を独立ストリーム（sonnet）にし WP-00a の直後から並行させる。(2) 「結合担当（integrator）」を S1 から分け、`packages/server/src/compose.ts` と結合試験（INT-xx）を M1 から専任で持たせる。(3) architect の CR レビューは SC-01 の週次バッチに限定し、48 時間以内に採否を返す SLA を MILESTONES に書く。(4) WP-03 は「WP-02 と同時に別担当で着手」と確定する（ParseResponse は indexer spec に byte 仕様と fixture があるので代用できる）。

### SC-07（high）WP-08 が大きすぎ、P1 と P2 が混ざっている

- **場所**: MILESTONES WP-08（Group B、依存 WP-07・05・01・02・04）。成果物に BundleBuilder・router・GitSafety 一式・**4 生態系の gates（format・typecheck・test:related）**・JobRunner（answer / patch / agent）・repair ≤ 2 回・昇格・Opus 提案・revise・retry・cancel・external patch・prompt 群。synthesis §8.2 では P1 は「fmt gate」、typecheck・関連 test・repair・agent mode は P2。M3（P1 出口）は WP-08 全体を含み、M4 も「WP-08（agent mode・repair・昇格）」と書いて重複している。
- **失敗シナリオ**: S6 ストリームは WP-07（anchor + review engine）→ WP-08 の直列で、全マイルストーン中で最長の鎖になる。M3 のデモ（patch Fix + gofmt）を出すのに、agent mode の permission rule、typecheck の検出、pytest の関連テスト選択、昇格の状態遷移まで作り終える必要が出る。
- **修正**: 3 つに分ける。
  - **WP-08a（Group A、純関数）**: BundleBuilder（MBF/1、tier、drop 順、`OMITTED:`）、router、loop の prompt 群、出力契約の検証器（patch/1・answer/1・findings/1 の parser）。golden と token 数だけで閉じる。WP-07 と並行できる。
  - **WP-08b（M3）**: GitSafety（snapshot・worktree・refs・applyEdits・scope 検査・merge-tree 事前検査・accept・undo・exportPatch・shadow・gc）、JobRunner の answer と patch、**format gate だけ**（gofmt・biome/prettier・ruff/black・cargo fmt）、Copy as prompt。
  - **WP-08c（M4）**: agent mode（`--restricted` + `Edit(//abs)`）、typecheck・test の gates、repair（parking / resume / cold）、昇格、revise・retry、external patch（MCP `mitori_submit_patch`）、GitHub PR。

### SC-08（high）TypeScript 7 と svelte-check が同居できない [検証済]

- **場所**: ARCHITECTURE §3.5（「mitori 自身の型検査には TS 7 の `tsc` を使ってよい」）、testing §1.1 L0（`tsc -b`（TS 7））と §1.3 `check:web` = `svelte-check`、ADR-0003。
- **事実**（V5）: `typescript@latest` は 7.0.2 で、`exports["."]` は `./lib/version.cjs` だけ（JS の API は `typescript/unstable/*`）。svelte-check 4.7.6 の peerDependencies は `typescript: "^5.0.0 || ^6.0.0"`。
- **失敗シナリオ**: WP-00 が root の devDependency を `typescript@7` にすると、svelte-check が peer を満たさず、`import ts from "typescript"` で API が無く落ちる。WP-10a は `.svelte` の型検査ができないまま進むか、各自が別の TS を入れて lockfile が割れる。
- **修正**: workspace の `typescript` は **6.0.3 に固定**する（`tsc -b` も svelte-check もこれで動く）。TS 7 の速さが欲しい場合だけ、alias（例 `typescript7@npm:typescript@7.0.2`）を入れてその bin を明示的に呼び、`.svelte` を含まない packages の `tsc -b` に限って使う。WP-00 の CI に `svelte-check --version` と空の `.svelte` 1 枚の型検査を入れる。ARCHITECTURE §3.5 の文言をこの形に直す（補遺 A7 の「解析用途は TS 6 alias」と向きが逆になるので注意）。

### SC-09（high）gen の cassette が indexer の出力バイトで key 化される

- **場所**: testing §3.3（key = engine・model・effort・tools・schema・resume + **正規化した system と prompt の全文**）、§3.4（CI は replay 強制、miss は失敗、`MITORI_CASSETTE_STRICT=1` で未使用 cassette も失敗）、§3.5（録画は `MITORI_LIVE=1` とサブスク認証の maintainer 機だけ、全体の再録画 ≤ $3）、gen spec §0-3（system prompt に repo pack）、indexer §7（skeleton・repo pack のバイト規則、`EXTRACTOR_CODE_VERSION`）。
- **失敗シナリオ**: indexer（WP-02/03）と gen（WP-06）を並行開発すると、skeleton や repo pack の 1 バイトの変化（IDX-D14 の行プレフィックス調整、CR の反映、`q8` の更新）で gen の int / e2e の exact cassette（INT-02・INT-06・E2E のデモ台本）が全部 miss する。CI では録画できないので gen と web の PR が赤のまま止まり、サブスクを持つ maintainer が手で再録画するまで待つ。これが開発期間中に何度も起きる。
- **修正**:
  1. gen・loop の unit / int は **scenario cassette（名前で選ぶ）を既定**にし、`promptHash` の不一致は警告にとどめる（§3.4 の (1) の経路を主にする）。行検証・刻印・SSE の順序の試験は prompt の中身に依存しないので、これで十分。
  2. exact key の cassette は「prompt drift」suite に限定し、nightly の self-hosted job でだけ回す。
  3. **indexer の出力形式の凍結日**（例: WP-02 の 2 週目末に `PACK_FORMAT`・skeleton の golden を固定）を MILESTONES に書き、以後の変更は `cassette:rerecord` の ticket と版の更新を必須にする。

### SC-10（high）CI 計画が無料枠を超え、spending limit $0 で止まる

- **場所**: testing §1.7（費用 0 円の構成）、§10 AC-14。
- **事実**: 同節の見積りでも nightly ≤ 40 分 × 30 日 = 1,200 分 + PR 30 分 × 50 本 = 1,500 分で、計 2,700 分 > Free の 2,000 分（Pro 3,000 分にも近い）。さらに (a) 各 job の `nix develop`（go・rust・python・playwright のブラウザ・CJK フォントの取得）の時間が入っていない、(b) 8 ストリームが並行すると PR は月 50 本では収まらない（1 ストリーム 1 日 1 本でも月 150〜170 本 → PR だけで 4,500 分超）。
- **失敗シナリオ**: 月の半ばで Actions が止まる（spending limit $0）。CI なしで merge するか、全員が待つかになる。上限を上げると月 1,000 円超になりうるので承認待ちで止まる。
- **修正**: (1) PR の pipeline を **ubuntu 1 job・10 分以内**にする（check + unit + golden + int の変更範囲分 + asset bytes）。(2) e2e-pr は `apps/web/**` 変更時だけ chromium で。(3) `perf-rel`（12 分）は nightly に移す。(4) nightly と bench・e2e 全体は **self-hosted（maintainer の Mac）**で回す（2025-12 に self-hosted の $0.002/分 課金は延期されたので今は無料。ただし撤回ではないので `scripts/ci-usage.ts` で監視する）。(5) CI 用の細い devShell（`devShells.ci`: bun・node・git・go のみ）を flake に足し、nix store を cache する（magic-nix-cache 等の無料のもの）。(6) `ci-usage.ts` の警告を 80% ではなく 60% にする。

### SC-11（high）出口条件が収束しない

- **場所**: testing §9.4（2 回連続の dry round、8 次元すべてで S0〜S2 の新規確定 0、budgets.json の関係する全 ID が **target 以内**、e2e は chromium と webkit、1 マイルストーン 6 round まで）、§9.3（S2 に「SLO の target 未達（limit 内）」を含む）、§9.2（round ≤ $8、マイルストーンあたり ≤ $40）。
- **失敗シナリオ**: target は意図的に攻めた値（S0–S1 cold 0.3 s、上限 0.5 s など、[仮] も多い）。どれか 1 つでも target を外すと S2 → その round は dry でない → 次の round。8 次元のどこかで毎回 S2 が出るので、6 round（$48 相当の枠）を使い切ってリードの判断待ちになる。5 マイルストーンで最大 $240 相当。Linux nix 上の webkit e2e の不安定さも出口を揺らす。
- **修正**: 出口 = (1) budgets.json の **limit** が全部 green、(2) S0・S1 の未解決 0、(3) dry round は **1 回**（S0・S1 の新規確定 0）、(4) 延期した S2 ≤ 5 件で担当と期限つき。target は傾向として記録するだけ。webkit は M3 と release だけ。adversarial round はマイルストーンあたり 2 回まで（≤ $16）。

### SC-12（high）実装者 1 人あたり 17〜19 万 token の spec

- **場所**: MILESTONES §0-6（WP を opus / sonnet の agent に割り当てる）、各 spec の分量（V10）。
- **事実**: WP-10a は ARCHITECTURE 17k + ux 63k + JUDGEMENT 27k + ui.ts 23k + api.ts 22k + core.ts 34k ≈ **18.6 万 token**。WP-08 は ARCHITECTURE + loop 61k + loop.ts 40k + core + api ≈ **17.3 万 token**。WP-06 は gen 52k + gen.ts 25k + indexer.ts 20k + core + api + ARCHITECTURE ≈ 17 万 token。
- **失敗シナリオ**: agent は context の大半を spec に使い、実装・試験の余地が少ない。読み飛ばすと byte 単位の規則（ID コメントの置き方、MBF/1 の行、NDJSON の key 順）を外して golden が落ちる。毎セッション読み直すので枠も消費する。
- **修正**: `docs/design/briefs/WP-xx.md`（各 ≤ 12k token）を作る。中身: 成果物の一覧、読むべき節の番号（それ以外は読まなくてよいと明記）、golden と truth の一覧、その WP に効く CR、明示的な範囲外。ux.md と loop.md は WP 単位のファイルに分け、contracts は package ごとに「公開名の索引」を付ける。

### SC-13（high）リードの範囲外の機能が WP に入っている

リードの build scope は「P0 + P1 の全部、P2 の指定項目、P3 の HTML export」。次は synthesis では P3 以降か、design 段階で足されたもの。MILESTONES に「今回の範囲外」表を作り、明記して外す（または M5 以降の任意枠に置く）。

| 項目 | 現在の置き場所 | 根拠 | 処置 |
|---|---|---|---|
| 床面図（区画・扉・Z3 の家具・ピン・流れの重ね描き） | JUDGEMENT §6.3、ux §4.2、WP-10a | design で追加（研究は IR → ELK） | SC-03 のとおり WP-18 へ |
| やさしく（simplify） | WP-06b、gen §12、ux §4.3.14 | synthesis §8.2 で P3 | 後へ。翻訳（D5）は残す |
| 読書パスのカード・進捗リング、S6 用語集画面、S7 決定事項ログ、S8 生成と鮮度 | ux §2.1、§4.3.8、§4.8 | synthesis P3（読書パス・用語集のよみ・決定事項ログ・生成と鮮度の管理画面） | MVP は目次と §12 の静的表だけ。S7 は一覧だけ（既に MVP 扱い） |
| キー再割当てエディタと衝突検出 | ux §8.5、S9、WEB-U-020 | design で追加 | MVP は「単一キーを全部オフ」の 1 設定だけ（WCAG 2.1.4 に必要） |
| ローマ字・かなの正規化（`mochikoshi` → 持ち越し） | AC-J46、WEB-U-024 | design で追加 | MVP は label・path・alias の前方 / 部分一致。正規化表は後へ |
| anthropic-api の Batch・`count_tokens` | WP-05、gen §8.3、§17.2 L5/L6 | synthesis P3（Pass 2 + Batch）。D3 は opt-in engine の存在だけを決めている | MVP の anthropic-api は Messages の streaming・cache breakpoint・structured outputs まで。Batch と count_tokens は後へ。実 API の契約テストは有料なので承認と上限が要る |
| Node 22 アダプタの二重グリーン | WP-01 受け入れ、INT-14 | 撤退先であって今回の納品物ではない | port の境界は守り、Node アダプタの実装と試験は後へ（`node:sqlite` は Node 22 で ExperimentalWarning、V7） |
| Windows x64・linux-arm64・macOS x64 のバイナリ | WP-11 | Windows は synthesis P3、IME 実機も無い | darwin-arm64 + linux-x64 の 2 つだけ |
| `mitori install codex`（skill） | loop §11.2 | Codex は MVP 後 | 後へ |
| GitHub PR 作成（fork + push） | loop §7.13 | リードは「patch / PR を返す」 | MVP は `.patch` の書き出しだけ。PR は WP-08c |
| warm pool | loop §6.6.1、ARCHITECTURE §2.6 | 最適化。デモの「7〜10 秒」は cold（API 6.8 s + 起動 1.8〜2.8 s）でも収まる | M4 へ。parking（修復に必須）は残す |
| 理解度クイズ・L3 judge・packet あり / なし A/B・judge 較正 | testing §7.2〜7.4 の full tier | synthesis P3（公開ベンチ） | MVP の eval は cite L0/L1 + patch fixture + tokens |

### SC-14（high）出口の閾値が小さな標本の確率的な値

- **場所**: MILESTONES M3（patch gate 通過率 ≥ 70%、$/成功 ≤ $0.05）、testing §7.4（standard は 30 task × n=1、`hiddenPass ≥ 70%`）、M2（citation L1 ≥ 90%）。
- **失敗シナリオ**: 真の通過率が 75% でも、n=30 では観測値の標準偏差が約 7.9 pt あり、70% を下回る（30 件中 20 件以下）確率は約 20%（二項分布で計算）。同じコードで出口を通ったり落ちたりし、再実行のたびに枠を使う。
- **修正**: 判定規則を「n=30 で Wilson 下限 ≥ 閾値 − 10 pt」か「2 回の実行の合算」にし、必要な最小標本数を書く。L1 は claim 数（数千）が十分なので点推定のままでよいが、repo 単位ではなく全体で判定すると書く。

### SC-15（medium）自前 Leiden と付帯物が M1 の経路にある

- **場所**: indexer IDX-D9・§6.2（自前 Leiden 約 400 行、γ の二分探索 8 回、hysteresis）、§6.3（γ' = 2γ で最大 4 回の再分割、親の階層を別の Leiden で）、§6.2 末尾（マシン間の浮動小数決定性、IDX-AT-30）、MILESTONES §4（「2 日で判断がつかなければ Louvain + 連結性修復で暫定」— IDX-D9 で既に自前実装に決めているので食い違う）。
- **事実**: module ID の安定性を守っているのは §6.6 の LOC 加重 Jaccard の照合と seed（`reps`）で、Leiden の warm start は揺れを減らす補助にすぎない。M1 の受け入れ（m3e で modularity ≥ 0.2 かつ directory 分割より高い）は、研究の Louvain（0.262）で既に満たせる水準。
- **修正**: M1 は「決定的な順序の Louvain の local move + BFS による非連結 community の分割 + §6.3 の分割・併合 + §6.6 の照合」で出す。Leiden の refinement は M2 の改善として、modularity のベンチ（`ngraph.leiden` 比 −0.01 以内）で効果が出たら入れる。IDX-AT-30（macOS と Linux で同じ membership）は P3 まで「同一 OS で決定的」に緩める（別マシンへの持ち運びは `reps` の seed で守れる）。

### SC-16（medium）共有ファイルの衝突と所有規則の往復

- **場所**: MILESTONES §0-4（所有ディレクトリの外は書かない）、`bench/budgets.json`（1 ファイル。全 spec が id を登録）、`apps/web/src/i18n/{ja,en}.json`（WP-10a・10b と全パッケージのエラーコード）、root の `package.json` / `bun.lock`、`fixtures/`（WP-00 と WP-12 と各 WP の試験）。
- **失敗シナリオ**: 8 本の branch が毎日同じファイルで衝突する。所有規則により、新しい budget id・i18n key・依存を足すたびに所有者への issue が要り、往復で止まる。
- **修正**: (1) budgets を `bench/budgets/<pkg>.json` に分け、id は `<pkg>.` 接頭辞で名前空間を切り、script で 1 つにまとめて lint する。(2) i18n は機能ごとの namespace ファイル（`i18n/ja/<ns>.json`）にし、build でまとめる（parity は namespace ごと）。(3) WP-00 が既知の外部依存（web-tree-sitter と 6 grammar、elkjs、shiki、markdown-it、svelte、vite、@sveltejs/vite-plugin-svelte、codemirror と merge、@modelcontextprotocol/server、playwright、biome、xxhash の wasm 実装、picomatch 等）を版固定で先に入れ、lockfile の変動を減らす。(4) fixtures は WP ごとの追加専用ディレクトリ（`fixtures/<pkg>/…`）を認める。

### SC-17（medium）上位文書と spec の食い違い

実装者が ARCHITECTURE / ADR を正本として読むと、次の 5 点で誤る。WP-00 の CR 精算と同時に直す。

| # | 上位文書 | spec | 正 |
|---|---|---|---|
| a | ADR-0011: 「claim の text が md の部分文字列であること」 | gen §0-2・§6.6: 文中マーカー `[[n]]`（§17.4 A1 で改訂依頼） | gen spec。ADR-0011 を改訂 |
| b | ARCHITECTURE §4.3 の図と ADR-0006: gate 失敗は `--resume` で修復 | loop I4（既定 `--no-session-persistence`。help は「cannot be resumed」、V6）と §6.6.3（continuation = parking が既定、resume は `persistSessions` のときだけ） | loop spec |
| c | ARCHITECTURE §2.6: warm pool は profile ごとに最大 2 本 | loop §6.6.1: profile ごと既定 1、全体 3 | loop spec（SC-13 で M4 へ） |
| d | ARCHITECTURE §2.4: compute Worker が ELK・Shiki・diff | ELK は専用 Worker が必須（V2・V3） | 2 本に分ける |
| e | ARCHITECTURE §4.4: watcher は 30 ms debounce | indexer CR-10: leading 5 ms + max-wait 30 ms | indexer spec |

### SC-18（medium）Svelte component の unit 試験基盤が未検証

- **場所**: testing §4.6 の見出し（bun test + happy-dom + `bun-plugin-svelte`、[仮]）、§11.3 OT-6、WEB-U-001〜034。`bun-plugin-svelte` は 0.0.6（V5）。
- **失敗シナリオ**: WP-10a の最初の PR で mount できないと分かり、試験の書き直しと道具の入れ替えが UI 開発の途中に入る。
- **修正**: 今決める。(1) ロジック（`keys/registry.ts`、`ime.ts`、`sse/reducers.ts`、`marginLayout.ts`、`render.ts`、`fmt.ts`、`predict.ts`）は純 TS で `bun test`。ux §12.2-6 が既に純関数にすると書いているので、IME・keymap・SSE 重複排除の WEB-U はここで書ける。(2) component の振る舞い（Composer の送信・Esc、楽観的カード、StreamingBlock の高さ予約）は Playwright の e2e か Vitest browser mode で書く。happy-dom と bun-plugin-svelte は入れない。

### SC-19（medium）人が要る判定が出口に組み込まれている

- **場所**: JUDGEMENT §11-2（日本語話者 5 人の読みやすさ評価で、Markdown の和欧間空白の方針を切り替えうる。ux U23 の期限 P1）、§11-4（専門家 5 人）、ux U8・U19、U24（IME 実機マトリクスが P1 出口）、testing §7.2（人手監査 50 claim を M2・M3・release で）、O9 / §1.7（self-hosted runner の登録とサブスク認証）、WP-04（GitHub 上の表示のスクリーンショット）。
- **失敗シナリオ**: agent だけの build session では 5 人を集められず、期限の来た判定が出口を止める。P1 の途中で空白の方針が変わると、doc writer の golden と AC-J14 と生成済み文書が全部変わる。
- **修正**: MVP の既定を今固定する（原稿に和欧間の空白を入れない、renderer は `text-autospace`）。5 人評価は MVP の後の調査に移し、結果で変えるときは prompt と writer の版を上げる手順にする。MILESTONES に「ユーザー作業」表（runner 登録 = 1 週目、IME 実機 = M3 前、人手監査 = M2・M3 の各 1 回 30 分）を日付つきで置く。

### SC-20（medium）サブスクの 5h 枠を実装 agent と計測が取り合う

- **場所**: MILESTONES §0-6（opus / sonnet の実装 agent 8 本）、gen §16 M-2・M-8（「他のセッションを止めた時間帯」）、testing §7.1（LLM を使う試験の月合計 $80 相当、5h 枠 0.8 で譲る）、§3.5（録画）。
- **失敗シナリオ**: 実装 agent が枠を 80% 超に押し上げ、mitori 自身の yield 規則で eval・生成の試験が止まる。M-8（5h 枠 / $ の係数 κ）は他のセッションが動いている限り測れない。agent 側も 429 で止まる。
- **修正**: MILESTONES に **計測の時間帯**（実装 agent を止める枠。例: M2 出口の前に 2 回、各 3 時間）を書く。録画と eval は週あたりの上限（API 換算）を置く。eval を API key で回す案は月の上限 ≤ ¥900 の承認を取ってから。

### SC-21（medium）遅延 chunk ごとの hard fail を初日から

- **場所**: ux §13.1 `asset.chunk.<name>`（+15% で fail）、`BUNDLE_BUDGETS.chunksKb`（entry 30・map 9・reader 12 …）、JUDGEMENT §6.16（[仮]）。
- **失敗シナリオ**: 機能の追加で chunk が 10% 程度ずつ育つのは普通。関係のない PR が chunk の境界の移動で落ち、agent が配信バイトの微調整に時間を使う。
- **修正**: M3 までの hard gate は「初期 JS の合計 150KB（60KB で警告）」「CSS 25KB」「Web フォント 0」「CM6 が Review を開くまで読まれない」だけ。chunk ごとの値は警告として記録し、M3 で確定する。

### SC-22（medium）M2 の生成 prompt が広すぎる

- **場所**: gen §3.2（standard の task 集合: early overview・S5 × K・labels・S6・overview final・flows・**datamodel・quality・decisions・risks・glossary・questions**）、§5.6 の 18 本の prompt、§4.2 の aspect。
- **失敗シナリオ**: 各 prompt に aspect の許容集合・検証規則・cassette・golden・eval の観点が要る。M2 でそれを全部揃えると、デモの核（§0〜§3 と §6 が出典付きで流れ込む）の品質調整に回す時間が減る。
- **修正**: M2 の prompt は overview（early / final）・module・parent・labels・flows・glossary の 7 種。datamodel・quality・decisions・risks・questions は M2 では静的 block と placeholder（「生成する ≈k tok」、synthesis §4.1 の「空欄にしない」は守れる）のままにし、M4 で入れる。planner は effort の表を data で持っているので後から足せる。

### SC-23（medium）WP-00 に直列作業が詰め込まれている

- **場所**: MILESTONES WP-00（契約の移動 + 純関数 + check-boundaries + budgets.json の全行 + 一致テスト + fixture repo 7 種 + CI + compile hello + CLAUDE.md）。testing §2.3 は fixture ごとに人が書く truth（edge-inventory は全ファイル網羅）を要求する。
- **修正**: WP-00a（目安 3 日）= workspace の骨格、契約の移動、CR 精算（SC-01）、check-boundaries、CI の check job、compile hello、CLAUDE.md の規約。WP-00b = fixture と truth、budgets の分割ファイル（SC-16）、corpus 取得 script を WP-12 に移して Group A で並行。

### SC-24（medium）作業量・timebox・cut line が無い

- **場所**: MILESTONES 全体（期間・規模の記述が無い。timebox は Leiden の「2 日」だけ）。
- **失敗シナリオ**: 遅れを検知できず、どこで何を切るかを遅れてから議論することになる。
- **修正**: WP ごとに S / M / L（と担当モデル）、マイルストーンごとに timebox と「超えたら切るもの」を書く。例: 「M1 が timebox を 30% 超えたら ⌘K を目次検索だけにし、facts 検出器を tier 1 に絞る」「M3 が超えたら AI Review（findings）を M4 へ」。

### SC-25（low）バイナリ予算の余裕は Shiki の作り方次第 [検証済]

- **場所**: ARCHITECTURE §10.2（85MB / 95MB）、ux §12.9（サーバ Shiki）、ADR-0001。
- **事実**（V4）: Bun runtime 62.2MB（05 §3）に対し、Shiki fine-grained（4 言語 + onig wasm）は +1.1MB、convenience bundle は +9.3MB。ほかに grammar 5.1MB、web dist（raw + br + gz。Mermaid の遅延 chunk 660KB gz を含めて 3〜4MB 程度 [推定]）。
- **修正**: Shiki は fine-grained の import に限り、言語表を MVP 言語 + 主要な設定ファイル形式（json・yaml・toml・md・sh・sql）に固定する。それ以外の言語の cite peek は無着色にする。WP-11a の walking skeleton でバイナリサイズの gate を最初から回す。

### SC-26（low）facts 検出器の全数を M1 に入れている

- **場所**: indexer §5.2（約 45 種）、WP-03。
- **修正**: tier 1（M1）= corpus と fixture で件数を実測済みのもの（`entry.*`、`route.nethttp`・`route.hono`・`route.express`・`route.fastapi`・`route.flask`、`cli.registry`・`cli.cobra`・`cli.click`・`cli.clap`・`cli.commander`、`env.*`、`script.*`、`dep.*`、`doc.existing`、`todo.comment`、`test.*`、`schema.sql`）。tier 2（M4）= gin・echo・chi・fastify・next・django・axum・actix・urfave・yargs・typer・argparse・prisma・drizzle・sqlalchemy・gorm。どちらも truth を伴うときだけ入れる。

---

## 4. 推奨する並べ方（リードの範囲の中で）

### 4.1 マイルストーンの組み直し

| M | 名前 | 中身 | 出口（limit 基準、SC-11） |
|---|---|---|---|
| M0 | 契約凍結 | WP-00a（CR 精算込み）、`specs/server.md`、WP ブリーフ | tsc 0 エラー、boundaries の意図的違反が CI で落ちる、TS 6 固定で svelte-check が動く |
| **M0.5** | walking skeleton | WP-11a | darwin-arm64 / linux-x64 のバイナリが node_modules 無しで起動し、`mitori <path> --no-open` → 静的な目次の外枠まで。サイズ・起動の gate |
| M1 | 0 token の見取り図 | WP-01、02、03（Louvain 版）、04（静的部分）、09、10a（ELK の地図・Reader・基本の ⌘K）、12（ハーネス） | 5 repo で最初の有用な画面 ≤ 5 s（limit）、初期 JS ≤ 150KB（60KB 警告）、O3・O4・O8 の記録。**O1/O2 は含めない** |
| M2 | 設計書が流れ込む | WP-05（claude-cli、parking、scheduler、ledger。warm pool 無し）、06（7 prompt）、10a（見積りカード・進捗） | 5 repo の standard 生成、citation L0 ≥ 97%・L1 ≥ 85%（limit）、**O1/O2/M-1〜M-10 の実測と budgets 確定**、`.mitori/` を GitHub で読める |
| **M3 = MVP** | Read → Ask → Fix | WP-07、08a、08b（answer・patch・fmt gate・accept・Undo・Copy as prompt）、10b の一部（Composer・ジョブカード・Review・Undo）、11（`mitori review`） | synthesis §8.1 のデモ台本が 5 repo で通る、コメント消失 0、patch の判定は SC-14 の規則、IME e2e |
| M4 | 第 2 波（リードの P2 項目） | WP-08c、07（batch round・carry-forward）、06b（S9 の提案、翻訳）、10b（Inbox・doc_edit の 2 択・Finish・trust）、11（install claude-code・prep/ingest・mcp）、gen の残り 5 prompt、facts tier 2 | MILESTONES の M4 の数値（limit 基準） |
| M5 | export | WP-13 | オフラインで動く |
| M6 以降（任意） | 床面図（WP-18）、やさしく、読書パス UI、S6/S8、キー再割当て、ローマ字検索、warm pool、Node 撤退先、Windows、Codex、GitHub PR、Cloudflare 共有（WP-17） | — | — |

### 4.2 並列化の規則（追加）

1. **毎日 skeleton に結合する**: 各 WP は M0.5 のバイナリに自分の機能を差し込む PR を出し、結合担当が `compose.ts` を持つ（SC-04・SC-06）。
2. **形式の凍結日を置く**: indexer の skeleton・repo pack（WP-02 の 2 週目末）、doc の Markdown 書式（O8 の確定時）、MBF/1（WP-08a 完了時）。以後の変更は版の更新 + cassette / golden の再生成 ticket（SC-09）。
3. **CR は週 1 回のバッチ**（SC-01）、architect は 48 時間で採否。
4. **共有ファイルは分割**（SC-16）。
5. **計測の時間帯**を予約し、その間は実装 agent を止める（SC-20）。

### 4.3 ユーザー作業（人が要るもの。日付を MILESTONES に書く）

| 作業 | いつまでに | 止まるもの |
|---|---|---|
| self-hosted runner（maintainer の Mac）の登録とサブスク認証 | M0.5 | 契約テスト・nightly・bench の絶対値 |
| GitHub の plan（Free / Pro）の確認 | M0 | CI の分数の上限（SC-10） |
| CI の spending limit を $0 のまま運用することの確認 | M0 | — |
| IME 実機マトリクス（ことえり / Google 日本語入力） | M3 の前 | M3 の出口 |
| 人手監査 50 claim（各 30 分） | M2・M3 | citation の judge 採用 |
| anthropic-api の契約テスト用 API key と月の上限（使う場合） | M2 | anthropic-api engine の検証 |

---

## 付録. 参照

- 実験スクリプト: `scratchpad/design-tmp/scope/elk-{a,b,c}.ts`、`scratchpad/design-tmp/scope/shiki/{a,b}.ts`（compile 後の実行は `scratchpad/design-tmp/scope/iso/`）
- GitHub Actions の料金の現状（V9）:
  - [Pricing changes for GitHub Actions · GitHub](https://resources.github.com/actions/2026-pricing-changes-for-github-actions/)
  - [GitHub bends to criticism and delays paid self-hosting of runners - Techzine Global](https://www.techzine.eu/news/devops/137396/github-to-charge-for-self-hosted-runners-from-march-2026/)
  - [GitHub Postpones Self-Hosted Action Runner Fees Following Community Revolt - WinBuzzer](https://winbuzzer.com/2025/12/18/github-postpones-self-hosted-action-runner-fees-following-community-revolt-xcxwbn/)
