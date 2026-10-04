# 生成品質（実エンジン）— 2026-10-04

mitori 自身の lean エンジン（claude-cli、`--setting-sources ""`・stdin・`--system-prompt-file`・no session、Max
サブスク、並列 3）で、dogfood のプロンプト修正後の main を m3e-canvas と crit に対して標準生成し、生成物を初見者と
専門家の目で読んで直した記録。費用はすべて API 換算（サブスク枠の消費。現金の課金なし）。

- 生成物: `docs/progress/dogfood2/{m3e-canvas,crit}/doc/`（m3e は修正後。§3 は修正後の flows 単独再生成）
- 計測レポート: `docs/progress/dogfood2/*/gen-report*.json`（`bench/measure/gen-real.ts` の出力そのまま）
- 初見者理解テスト: `docs/progress/dogfood2/m3e-canvas/comprehension.{md,json}`
- 他パッケージへの依頼: `docs/design/cr-requests/gen.md`

## 1. 結果（before / after）

### m3e-canvas（Next.js + React、108 files・23.6k 行、モジュール 5）

| 指標 | 前回 dogfood（@2） | before（今朝の main） | after（このブランチ） | 目標 |
|---|---|---|---|---|
| API 換算 | $0.52 | $0.649 | **$0.690**（+ §3 再生成 $0.067） | — |
| 所要（並列 3） | 94 s | 78.8 s | 85.9 s | — |
| 最初の AI ブロック | 4.3 s | 4.3 s | **3.2 s** | — |
| task / 呼び出し | 7 / 12 | 12 / 16 | 13 / 15 | — |
| 再試行率（task 単位） | 71.4 % | 45.5 % | **25.0 %** | < 30 % ✅ |
| 1 回目で valid な行 | 83.5 % | 79.6 % | **91.5 %** | ≥ 90 % ✅ |
| citation L0 | 100 % | 100 % | 100 % | ≥ 99 % ✅ |
| citation L1 | 65.5 % | 84.3 % | **93.0 %**（§3 再生成 100 %） | ≥ 90 % ✅ |
| 識別子なし（vacuous） | 37 % | 39 % | 27.7 % | — |
| 見積誤差 $（実績−見積）/見積 | +14 % | −12.6 % | −14.0 %（較正後の見積で −10.4 %） | ±30 % ✅ |
| 見積誤差 入力 / 出力 token | — | −10 % / −29 % | −16 % / −30 %（較正後 −16 % / −23 %） | ±30 % ✅ |
| 見積誤差 所要時間 | — | 198 s → 79 s | 198 s → 86 s（較正後、同じ C = 3 で 101 s → **−15 %**。§7） | ±30 % ✅ |
| §3 主要な流れ | なし | **なし（未生成）** | 3 本（編集とトークン、プロンプト生成、部品描画） | — |

### crit（Go + JS、1,219 files・65k 行、leaf 14 + 親 2）

| 指標 | 前回 dogfood（@2、19 task） | after（24 task: M4 の 5 節を含む） | 目標 |
|---|---|---|---|
| API 換算 | $1.32 | $1.652 | — |
| 所要（並列 3） | 145 s | 約 155 s 実働（計 865 s。うち 12 分は計測ハーネスの上限設定による予算停止、修正済み） | — |
| 最初の AI ブロック | 2.7 s | 2.8 s | — |
| 再試行率 | 63.2 % | **33.3 %**（同じ出力を最終コードで再生: **16 %**） | < 30 % 実測 ❌ / 再生 ✅ |
| 1 回目で valid な行 | 80 % | 84.6 %（再生: 3 / 261 行だけ不合格） | ≥ 90 % 実測 ❌ / 再生 ✅ |
| citation L0 | 100 % | 100 % | ✅ |
| citation L1 | 84.8 % | **88.2 %**（再生: **90.6 %**） | ≥ 90 % 実測 ❌ / 再生 ✅ |
| 見積誤差 $ | +8.5 % | **−0.9 %**（$1.668 → $1.652） | ✅ |
| 見積誤差 入力 / 出力 token | +92 % / −22 %（素の task 見積） | −5.6 % / −20.6 % | ✅ |

この branch の実エンジン消費は合計 **$3.43**（m3e 2 回 $1.34、§3 再生成 2 回 $0.17、理解テスト $0.26、crit $1.65）。上限 $4.00 内。

### 記録した実出力の再生（`bench/measure/gen-replay.ts`、無料）

crit の実測のあとに入れた修正（範囲の切り詰め、questions の section、exported: 0、Go のパッケージ名）は実エンジンで再計測する
予算が残らなかったため、`gen-real.ts --record` で記録した**同じ 1 回目の返答**を、最終コードの validator と Verifier に通し直した
（入力は記録したプロンプトそのもの。プロンプト側の変更は反映されない）。再生の忠実度は m3e after で確認: 実測 25 % / 93.0 % に対し再生 25 % / 92.7 %。

| 記録 | 実測 再試行 / L1 | 最終コードで再生 再試行 / L1 |
|---|---|---|
| crit 前回 dogfood（プロンプト @2） | 63 % / 84.8 % | 21 % / 87.8 % |
| m3e before（今朝の main） | 45.5 % / 84.3 % | 36 % / 94.2 %（TESTS 由来の V17 は入力側の修正なので再生では消えない） |
| m3e after | 25 % / 93.0 % | 25 % / 92.7 % |
| crit after | 33 % / 88.2 % | **16 % / 90.6 %** |

### 初見者理解テスト（m3e-canvas、10 問、`eval/comprehension/run.ts`）

出題者（Sonnet、Read/Grep/Glob だけの読み取り専用 agent、`.git`・`.mitori` を除いたコピー）が 10 問と模範解答・根拠行を作り、
回答者（Haiku、ツールなし）が条件ごとに 1 回答え、採点者（Sonnet）が条件を伏せたまま採点した。

| 条件 | 得点 | newcomer (4) | intermediate (4) | expert (2) | README では答えられない問 (8) | 幻覚 | 不明 |
|---|---|---|---|---|---|---|---|
| none（リポジトリ名だけ） | 0 % | 0 % | 0 % | 0 % | 0 % | 0 % | 10 |
| README（README.md、8.1k tok） | 20 % | 25 % | 25 % | 0 % | 6 % | 10 % | 7 |
| **mitori**（生成文書、9.5k tok） | **50 %** | 63 % | 38 % | 50 % | 44 % | 10 % | 0 |

- README 比 **+30 pt**（spec Q1 の +15 pt を上回る。ただし 10 問・1 回なので信頼区間は広い）。費用 $0.264（出題 $0.155 は再利用可能: `--quiz`）。
- 落とした問: 「新しい部品（Kind）を足すとき触るファイル」（0 点。文書は tokens.ts の 3 箇所しか書いていない）、「API キーを守る制約」
  （`isSecureUrl` の https / ローカル条件が文書にない）、「Node のバージョン条件」。幻覚 1 件は「全プロバイダを同じ方法で呼ぶ」（Claude
  だけ別エンドポイント）。→ 横断的な「変更の手引き」と `lib/ai.ts` の詳細が弱い（§4 残課題）。

## 2. 読んで見つけたこと（修正したもの）

### 初見者の目

1. **§3 主要な流れが空**（m3e）。Next.js アプリには route / CLI / main の entry fact が無く、flow seed が 0 → gen.flows を計画すらしない。
   → `genFlowSeeds`（`packages/gen/src/prompts/seeds.ts`）: index に seed が無ければファイルグラフから導出。最初はいちばん重い辺を辿る
   だけで「言語切り替え」「テーマ」になったので、ルートモジュールの最も外向きのファイルから**重要モジュールごとの中核ファイル**へ
   辿るよう変更 → 「編集とトークン計算」「プロンプト生成」「パーツの描画」。根本は indexer（CR #4）。
2. **5 分で試す方法が無い**（§4 は静的な表だけ）。→ gen.overview@3: s1 の「利用者」を「5 分で試すには…」の 1 項目で締める
   （FACTS に script fact `S` 行を追加し引用可能に）。m3e: `npm install` → `npm run dev` → localhost:3000 → 部品をドラッグ → プロンプトをコピー、
   crit: `brew install crit` → `crit` → 行にコメント → `crit install claude-code`。本来は §4 の aspect（CR #5）。
3. **未解決の問いがプロンプトの内部の話**（「FACTS は 6 個と数えるが REPOSITORY CONTEXT には 2 個」「本体が未提示」）。本文にも
   「示された範囲では確認できない」が漏れていた。→ gen.system@5: question は保守者が答えられる問いに限る、データや提示範囲に言及しない、
   言葉でぼかさない（推測は mitori が印を付ける）。after の §13 は「GitHub Pages 以外の配信を想定するか」「相互 import は意図か」など実際の問いになった。
4. **同じ事実が 4 回出る**（`LoadingAnimator.update` の 0.1 秒上限がモジュール 2 箇所・§9・§11 に）。→ gen.quality@2 / gen.risks@2:
   モジュールページの claim 文を写さず横断的な性質を書く。after の §11 は「言語を足すとき prompt.ts と i18n.ts を両方直す」
   「`getShapes` はキャッシュそのものを返すので複製してから加工」と、変更する人に効く内容になった。
5. **図のキャプションに生の `[[1]]`**（§3 の全シーケンス図）。→ 図のキャプションは marker と claim を持たない（W10、gen.flows@3）。描画側は CR #2。

### 専門家の目（29 claim を出典と突き合わせ）

m3e 22 件・crit 7 件を、引用行（±1 行）を開いて確認した。

| 判定 | 件数 | 例 |
|---|---|---|
| 支持される（S） | 23 | `effectivePrompt` の分岐（prompt.ts:1864）、`shareable` が http(s) 以外の `src` と履歴を落とす（share.ts:12-21）、`Spring.step` の 12 分割（shapes.ts:190-197）、crit `Session` の `mu`/`writeMu`（session.go:487-497）、`ChangeBaseBranch` がロック外の VCS 処理後にコメントを取り直す（2456-2468）、`clicmd.Exit` の終了コード（clicmd.go:26-37）、preview の baseDir 外 403 |
| 一部（P） | 4 | `KIND_SPEC` が「既定寸法・可否フラグを持つ」を宣言 1 行で引用 / dt 上限の理由（タブ停止）は行に無い推論 / s1「描いた内容はブラウザの外へ送られない」は SECURITY.md 3-4 行どおりだが続く行の AI ヘルパー例外を省いた / crit `CRIT_DEBUG` は正しいが「panic に変わる」という肝を落とした |
| 推測（正しい） | 2 | tokens.ts が i18n と color を import する（引用なしの推測、実際に正しい） |
| 支持されない（U） | 0 | — |

- **L1 の偽陰性**が失敗の大半だった。m3e の 13 件中 9 件はメソッドを自分の本体の中で引用したもの（`LoadingAnimator.update` を update 内の行で）、
  crit の 32 件中 6 件は Go のパッケージ修飾名（`clicmd.Exit` を internal/clicmd/clicmd.go で）。→ 引用範囲を囲むシンボルの修飾名、ファイルの
  ディレクトリ名、ファイル名の stem を L1 の文脈に含めた（gen spec §7.1 の拡張、`packages/gen/src/verify/l1.ts`）。残りは本当に引用が足りない文
  （1 文に 6 個の識別子で引用 2 つ、など）で、推測扱いのままが正しい。
- 専門家向けの深さ: crit の `internal/session` ページは不変条件・並行性・落とし穴まで具体的（RWMutex と書き込み用ロック、墓標の移し替え）。
  m3e の `app` ページは 4,800 行の `Editor` の中身をほとんど語れていない（入力が署名中心のため）。

### 日本語

- 全角句読点の後の半角空白（「持つ。 文書の…」）→ W12 で除去。用語集の読みは全件ひらがなで正しい（いんすぺくた、きょうゆうりんく 等）。
- 「このモジュールは」で始まる段落が続く機械的な調子 → gen.system@5 に「同僚に説明するシニアの書き方、書き出しを変える」。after では改善したが、
  「〜である。」の連続はまだ残る。
- crit の §1 で README.md が 4 種類あり、引用ラベルがどれも `README.md:n` で区別できない（CR #7）。

## 3. 再試行と見積を下げた修正

| 原因（実データ） | 対処 |
|---|---|
| claim の kind に `inferred`・aspect 名（`interface`）を書く | W09: 種類に正規化（`packages/gen/src/line/claims.ts`） |
| marker だけあって claim が無い / claim はあるが marker が無い | W10: 前者は推測 claim に、後者は文・項目が同数なら 1 つずつ配置 |
| TESTS に引用できる行が無い（`moduleContext().tests` がファイル単位） | test fact から 1 ケース 1 行 `T path:line name` を組み立て（m3e 再試行 5 件中 2 件） |
| 提示範囲を少し越えた引用、他の引用がある claim の未提示引用 | W04: 提示部分が半分以上なら切り詰め、W11: 他に有効な引用があれば落とす（L1 が引き続き検査） |
| `s10/decision` のような section | W03: task の section に正規化 |
| keep した既存ブロックが「必須 aspect 欠落」と数えられる | keep も aspect（と flow）を満たす。flow の EXISTING に `section=` を出す（§3 単独再生成で全 flow が重複した） |
| 再試行で足した steps が最後の flow に入る | flow ブロックは「その aspect を欠く最初の flow」へ。MISSING に flow 名と section を出す（m3e §3 が failed になった） |
| gen.questions が出典の section を保つと V05 で全体やり直し | 統合リストはどの section でも可（prompt と validator の食い違い） |
| export の無いモジュール（CSS）に interface を要求 | MODULE が `exported: 0` なら interface は必須でない |
| 出力 token の見積が 30–43 % 高い | quality 1200・decisions 1600・flows 2400・用語 28/語に較正 |
| 所要時間の見積が実測の 2.3 倍 | ttft を Sonnet 1 s・Opus 2 s、速度を実測 135 / 140 tok/s、起動 1 s に（`GEN_ESTIMATE_PARAMS`） |

- 版: gen.system@5、gen.module@5、gen.overview@3、gen.flows@3、gen.quality@2、gen.risks@2、gen.deepdive@2（`prompts.lock.json` / `render.lock.json` 再生成）。
- 再試行 1 回あたりは $0.010–0.017・2–5 s（会話の継続なので安い）。再試行率が効くのは費用より壁時計と、失敗 task の救済。

## 4. complete effort（standard と同じだった）

standard と complete の違いが eager の数（≤ 40 / 全 leaf）だけで、40 leaf 未満の repo では見積も中身も同一だった。spec §3.2 どおり実装:

- `gen.quality` を complete では overview モデル（Opus medium）で（`modes.complete`）。
- **S8 ファイル別ノート**: leaf ごとに `gen.deepdive` mode `files`（≤ 20k token の FILES ごとに分割、mode `files#k`）。6k token 以下のファイルは
  全文に行番号、超えるものは doc スケルトン。ノートは aspect `files`（「ファイル別の詳細」）でモジュールページに入り、その task 自身の
  EXISTING（このチャンクのファイルのノートだけ）で再生成される。モジュールページの再生成はノートを見ない・消さない。
- 見積（free、`bench/measure/gen-inspect.ts`、C = 3、retryRate 0.3 — §7）: m3e standard $0.71 / complete **$1.65**（S8 12 task）、crit standard $1.50 / complete **$4.86**（S8 42 task）。
  complete は実エンジンでは未実行（上限内に収まらないため）。

## 5. 残っている問題（正直に）

1. **crit は実測では目標に届いていない**: 再試行 33 %・L1 88.2 %・1 回目 valid 84.6 %。最後の修正（範囲の切り詰め、questions の section、
   exported: 0、Go のパッケージ名）は、記録した同じ出力の再生では 16 % / 90.6 % になるが、**実エンジンでの再計測はしていない**
   （残り予算 $0.57 では crit 1 回 ≈ $1.6 が走らない）。プロンプトが変わると出力も変わるので、次の実測で確かめる必要がある。
2. ~~所要時間の見積はまだ +55 %~~ → 検証で訂正（§7）: 133 s は製品既定（対話枠を 1 つ予約 = 背景 2 並列）での見積で、計測は 3 並列だった。同じ 3 並列なら m3e 101 s / crit 170 s に対し実測 86 s / 約 155 s（−15 % / −9 %）。
3. **flows の選び方**: crit の 3 本は「コマンドの振り分け」「プレビュー配信」「story API」で、肝心の「ブラウザでコメント → review ファイル →
   エージェントが読む」が入らない。seed の順位（index の route 優先）に引きずられる。m3e の導出 seed も Editor の先頭 80 行しか本体が見えず、手順が浅い。
4. **横断的な「変更の手引き」が無い**: 理解テストの 0 点問（新しい Kind を足す手順）はまさにこれ。モジュール単位の構成では書けない。
   新しい節（または s5/s11 の aspect）が要る — doc 契約の変更なので未着手。
5. **4,800 行級の巨大コンポーネント**（m3e `Editor`）の中身は、署名中心の入力では語れない。hot body の選び方を変えるか、complete の
   ファイル別ノートに任せることになる。
6. §2 の図のラベルが生成名と一致しない、図が全辺を描く、同名ファイルの引用ラベル — いずれも doc 側（CR #1, #6, #7）。
7. 理解テストは 10 問・各条件 1 回・回答者 Haiku。差は大きいが統計的には弱い。spec の 12 問 × 4 条件（素朴要約 C2 を含む）・人の確認はまだ。
8. 計測ハーネスの予算停止（product は上限の 80 % で dispatch を止めて run を pause する）で crit の計測が 12 分止まった。
   `gen-real.ts` は product の上限に余裕を持たせ、pause を検知したら止めて報告するよう直した。
9. 全テスト（2,555 件）を並列で回すと SKEL-AT-02（埋め込み ELK の 120 ms 予算）と IDX-AT-15（parse timeout）が負荷で落ちることがある。
   どちらも単独では通り、gen の変更とは無関係。

## 6. 再現

```bash
# 無料: seed・complete のチャンク・3 段の見積
scripts/nd bun bench/measure/gen-inspect.ts --repo <clone>
# 実エンジン（サブスク枠、上限つき）
MITORI_LIVE=1 scripts/nd bun bench/measure/gen-real.ts --repo <clone> --home <dir> --run --max-usd 1.0 --out <dir> [--record <dir>]
# §3 だけ作り直す
scripts/nd bun bench/measure/gen-reset.ts <clone> <home>
MITORI_LIVE=1 scripts/nd bun bench/measure/gen-real.ts --repo <clone> --home <home> --scope s3 --run --max-usd 0.2 --out <dir>
# 記録した実出力を今の validator / Verifier に通す（無料。gen-real.ts に --record を付けた run の記録が要る）
scripts/nd bun bench/measure/gen-replay.ts --rec <record dir> --repo <clone> [--verbose]
# 初見者理解テスト（出題を再利用すると $0.11）
MITORI_LIVE=1 scripts/nd bun eval/comprehension/run.ts --repo <clone> --max-usd 0.6 [--quiz <report.json>] --out <dir>
```

## 7. 検証（敵対的検証、2026-10-04 同日）

実装者の受け入れ項目をすべて自分で再実行し、差分を読み、生成物の claim を出典と突き合わせた。

### 再実行と費用の照合

- `scripts/nd bun run check` 緑。`packages/gen`・`eval`・`bench` のテストは全通過。全体は検証の修正後 2,547 pass / 0 fail（修正前の
  1 回目は IDX-AT の crit 構造更新の性能予算が負荷で 1 件落ちた。単独では 18 / 18 通り、gen と無関係）。
- 実エンジン費用（scratch の各 `report.json` と台帳から）: m3e before $0.649 + after $0.690 + §3 単独再生成 $0.106 + $0.067
  + 理解テスト $0.155（出題のみ。初回は回答・採点の呼び出しが $0 で失敗）+ $0.109 + crit $1.652 = **$3.429**。報告どおりで、
  上限 $4.00 内。
- **検証での実エンジン消費は $0**。この環境では `claude auth status` が未ログインを返し、`gen-real.ts` の事前確認が実行を拒否する
  （ログインは行わない）。そのため crit の最終修正後の実測はできていない。記録した 1 回目の返答を最終コードで再生した結果は再現した
  （25 返答中 4 件が再試行 = 16 %、L1 90.6 %）。
- 補足: m3e after の本番 run では gen.flows が failed（再試行後も steps を欠いた）。§1 の表の §3 と `dogfood2/m3e-canvas/doc/03-key-flows.md`
  は、そのあとの単独再生成 2 回目（$0.067）の結果である。

### 所要時間の見積（訂正）と retryRate の較正

§5-2 の「+55 %」は比べ方の誤りだった。`gen-inspect.ts` は製品既定の設定（対話枠を 1 つ予約するので背景は 2 並列）で見積もり、
計測の `gen-real.ts` は 3 並列・予約 0 で走らせていた。`gen-inspect.ts` を `gen-real.ts` と同じ scheduler にし（`--concurrency`、
既定 3）、初回 open の新しいコピー（CR #8）で見積もり直した。あわせて `GEN_ESTIMATE_PARAMS.retryRate` を 0.6 → **0.3** にした
（このブランチの実測は 25 % / 33 %。0.6 は @2〜@3 の 63〜71 % 時代の値）。retryRate は見積だけに効き、1 回の呼び出しの予算や
出力上限には効かない。

| 3 並列の見積 | 見積 $ / 入力 / 出力 / 秒 | 実測 | 誤差（実測 − 見積）/ 見積 |
|---|---|---|---|
| m3e、retryRate 0.6 | $0.77 / 410k / 28.5k / 110 s | $0.690 / 345k / 24.2k / 86 s | −10 % / −16 % / −15 % / −22 % |
| m3e、**0.3** | $0.71 / 329k / 26.3k / 101 s | 同上 | **−3 % / +5 % / −8 % / −15 %** |
| crit、retryRate 0.6 | $1.62 / 925k / 57.0k / 約 181 s | $1.652 / 877k / 51.9k / 約 155 s | +2 % / −5 % / −9 % / −14 % |
| crit、**0.3** | $1.50 / 743k / 52.6k / 170 s | 同上 | **+10 % / +18 % / −1 % / −9 %** |

（出力は thinking を含む。crit の実測秒は予算停止の 12 分を除いた実働。complete の見積は m3e $1.65、crit $4.86 になった。）

### 差分のレビューで直したもの

- **flow の任意 aspect が前の flow へ移される**（`packages/gen/src/line/validator.ts`）。section なしの flow ブロックは「その aspect を
  欠く最初の flow」へ回す規則が、任意の aspect（`sequence`・`edge_cases`）にも効いていた。ある flow が 2 枚目の図や 2 つ目の
  例外ブロックを書くと、図を持たない前の flow の下に入り、別の flow の図がその flow の見出しの下に出る。振り替えは必須 aspect
  （summary・steps）だけにした。回帰テスト付き（修正を戻すと落ちることを確認）。
- `gen-inspect.ts` の scheduler（上記）。

### 自分で突き合わせた claim（25 件）

| 判定 | 件数 | 例 |
|---|---|---|
| 支持される | 21 | crit §3.1 の手順 1〜4（main.go:21-32、clicmd.go:26-37）、§3.2 の 5 手順（preview_handlers.go:12-57）、session の `GetComments` の focus 絞り込み（1870-1890）、差分取得失敗は警告だけ（1072-1079）、`ChangeBaseBranch` のコメント取り直し・墓標の移し替え・`rewriteReviewJSONRenames`（2458-2493）、`Lazy`/`loadOnce`（231-233）、m3e の `buildPrompt`・`effectivePrompt`（prompt.ts:1745、1864）、`setGroups` → `constrainModalRails`（Editor.tsx:461-463）、`paletteOf`（tokens.ts:538-547）、`M3Static`（M3Node.tsx:1939-1976）、`Frame` の w/h 省略は phone 寸法（tokens.ts:2122-2124、2147）、`Group` の `free`/`pos`（2317-2327）、リンク URL のテスト（button.test.ts:80-86） |
| 一部 | 4 | m3e s1「5 分で試す」: `npm install`・`npm run dev`・localhost:3000 は CONTRIBUTING.md:17-19 どおりだが、「左のパレットからドラッグ」はその行に無く、Node 22.12 以上の条件（25 行）を落とした / §3 の導入と 3.1 の要約: Editor.tsx の引用行は状態の宣言だけで「トークン・プロンプト・描画へ渡す」部分は推論 / §3.3「パーツの描画」は `M3Static`（決定的な静止描画。Editor.tsx:3058・3090 などの一部だけ）を描画の流れとして説明しているが、キャンバス本体は `M3Node`（3574・3720・3877）で描く — 引用は正しいが初見者を誤導する / s1「描いた内容はブラウザの外へ送られない」（実装者の判定と同じ） |
| 支持されない | 0 | — |

### 受け入れ判定の訂正と、追加で見つけた残課題

- 「再試行率 < 30 %」「L1 ≥ 90 %」は **m3e では実測で達成、crit は記録の再生でのみ達成**（実測は 33.3 % / 88.2 %）。次に実エンジンが
  使えるときに crit の S5 だけを `--scope` で測れば確認できる（14 module で約 $1.0）。
- 見積誤差 ±30 % は、上の訂正後は $・token・所要時間とも m3e・crit で達成。
- **§3 は seed で決まる**。m3e の 3 本はどれも手順 2 つ・登場者 2 つの図で、「部品を置く → プロンプトをコピー」という利用者の本筋に
  なっていない（導出 seed は Editor から各モジュールへの 1 hop で、BODIES には 4,800 行の `Editor` の先頭 80 行しか入らない）。
  crit は §3.2・§3.3 に図がなく、本筋（ブラウザでコメント → `session.AddComment` → review ファイル）が無い。原因は index の route seed
  の重複除去（`/api/health` だけが残る）で、CR #4 (c) に具体を追記した。
- **再 open で module 分割が変わる**（CR #8）。同じ commit でも初回 open と 2 回目以降で module の所属ファイルが変わり、before / after の
  比較と見積（complete の S8 task 数 42 / 43）が揺れる。計測は `.mitori/` の無い新しいコピーで行うこと。
