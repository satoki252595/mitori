# ux — 仕上げパス（track ux、branch `fin/ux`、2026-10-04）

コンセプト（設計書の文にコメントすると、AI がその場所に対応するコードを直す／答える。初見者にも専門家にも同じ文書。
速さ・トークン・UI/UX に執着）を受け入れ基準にして、Live run（`docs/progress/live.md`）の「残り」を片付けた。
**LLM の実費はゼロ**（このトラックは実エンジン禁止。UI は INT-06 と同じスクリプト版 claude、バイナリは送信なしの操作だけ）。

| # | 項目 | 結果 | 証拠 |
|---|---|---|---|
| 1 | コード指定なしの Fix（`@` 無しで 412、ヒント無し） | **直した**: 文の出典 = 自動の「対象コード」、出典が無ければ候補を 1 クリック / ⌥1–4 で選ぶ、何も無ければその場で指し方を案内。対象が無い Fix は見積りを**要求しない**（412 もコンソールエラーも出ない） | `ux-01`〜`ux-02`、`ux-06`、`ux-09`、UX-FIX-01〜08、UX-FIX-10〜15、UX-INT-01、UX-UI |
| 2 | Review ヘッダーが混む | **直した**: ◆ は レビュー タブだけ、レビュー中（≥ 1024 px）はドロワーボタンを出さない、block id は「詳しい」だけ、ゲート警告はピルの行に畳む | `ux-04`（プロトタイプ 03e と同じ並び） |
| 3 | Composer の引用に隣のセルの出典が混ざる | **直した**: 表のセルは選んだ文字列そのもの、段落は自分の段落の中だけ。ヘッダーの file:line も選んだ行から | `ux-01`（引用 = `TSUNDOKU_API_TOKEN`）、UX-QUOTE-01 |
| 4 | 提案の accept / reject（501） | **配線した**: 単語 / 和文字単位の提案差分（本文中と Review）、新しい提案は SSE で即表示、単独の採用 / 却下、レビュー中ジョブの提案は Review で決める、人の固定（human-edited）は採用後も保たれる、追加（INSERT）提案も本文に出る。**人の編集 route（`POST /doc/blocks/:block/edit`）も 501 だった**ので配線（共同編集の入口） | `ux-03`、`ux-07`〜`ux-12`、UX-PROP-01〜05、UX-INT-02/03 |
| 5 | `mitori install` と `/integrations`（WP-11 のスタブ） | **配線した**: global installer、`GET /integrations`（ファイルごとの sha256 鮮度）、`POST /integrations/:target/install`、`POST /ws/:ws/init {agentsBlock}`。AGENTS.md ブロック **74 tok**（上限 80、マーカー込み）、SKILL.md **1,480 / 1,487 / 1,305 B**（上限 1,500）、`claude plugin validate` は marketplace・plugin とも**警告なしで通過** | UX-INST（6 本）、`ux-bin.json` |
| 6 | 見た目の確認 | Chrome（Playwright `channel: "chrome"`、1440×900）で全シナリオ、**ページエラー 0・4xx/5xx 0**。コンパイル済みバイナリでも送信なしの範囲を確認 | `docs/progress/ux/*.png`、`ux-run.json`、`ux-bin.json` |

## 1. コード指定なしの Fix（CR ux-F1）

`POST /ws/:ws/jobs/targets {anchor, text?, limit?}` → `{cited, candidates}`。決定的・0 tok（`packages/loop/src/review/targets.ts`
の純関数 + `wiring/loop-routes.ts`）。Composer（修正 × 「コードをこの依頼に合わせる」× 設計書のアンカー）が開いた時点で 1 回、
出典が無い間は本文の入力から 400 ms 後にもう一度聞く。

- **(a) 出典あり** — アンカーの claim（選択が claim に重なればその claim、無ければブロックの全 claim）の cite。router が
  書き込み範囲にするものと**同じ範囲**（`anchorRanges` を共有）なので、見積りと表示が食い違わない。チップ「対象コード
  `fetch.go:46-61 Client.Fetch`」。× は付けない（下の「残り」1）。
- **(b) 出典なし → 候補**（ユーザーが選ぶまで書き込み範囲にしない＝黙って推測して書かない）: ① 選んだ表の行・箇条の
  **その行のコード参照**（静的 facts の `internal/config/config.go:36` → 囲む関数 `Load` 19–38）、② 選択と依頼文の
  **名前**に完全一致するシンボル、③ 全文検索（fact / symbol）。証拠の強い順、同じ層では別ファイル優先、テストは後ろ
  （依頼が「テスト」の話なら別）。選ぶと `ContextAdjust.add` になり、router は既存の規則どおりそれを書き込み範囲にする。
- **(c) 何も無い** — 「直すコードがまだ決まっていません…本文に @ を打って関数名やファイル名を選ぶと…」＋［@ でコードを指す］、
  「答えだけなら質問（⌘1）。自分のセッションへ送れば、あなたのエージェントがコードを探します」。送信は ⚡ その場で実行
  のときだけ止める（⤴ 自分のセッション / ⧉ コピーはエージェントが自分で探せるので止めない）。
- 送信前に**書き込みファイル数**（「書き込み1ファイル」、hover で全パス）を出す。

実測（他エージェント稼働中の Apple M-series）:

| 計測 | 値 |
|---|---|
| route（go-small、コンパイル済みバイナリ） | 5 ms |
| route（crit 1,219 files、in-process、行の参照 / 名前 / 日本語のみ） | 2〜41 ms |
| UI: `f` → 候補が描かれるまで | 34〜86 ms |
| 選んだ後の見積り（go-small） | 1.9k in · patch · 書き込み `config.go` だけ |

crit での質（`agent_cmd を repo 設定でも上書きできるように` → 先頭 `config.go:45 Config.AgentCmd`、`parseDaemonFlags のエラーを…`
→ 先頭 `daemon_cli.go:88-184 parseDaemonFlags`、静的表の行 → 先頭はどれもその行の定義）。最初の版は小文字の英単語
（`repo`・`agent`・`auth`・`crit`）が何十ものフィールドに当たって正解を 4 位に落としたので、**名前らしい語だけ**を引くようにした
（snake / camel / Dotted / ALL_CAPS / Capitalized / バッククォート）。和文だけの依頼（「レビューの保存処理を速くして」）は
候補なし → (c) の案内になる（日本語→コードの対応は持っていない。生成済み文書なら (a) の出典が効く）。

## 2. 提案（doc proposals）と人の編集

- 差分: 提案の HTML（表・コード・リンクの形のまま）の**文字ノードだけ**を差分し、削除 `<del class="d">` → 追加 `<ins class="a">`。
  和文は文字単位、英数字は語単位（和文に続く英単語も 1 語。初版は「Fetchは失敗した…」全体が 1 語になっていた）、空白だけ
  を挟む変更は 1 句にまとめる。大きすぎる中間部は 1 つの置換（O(n·m) の上限）。
- 経路: ジョブの doc_updates / 再生成 / `mitori reply --doc-update` / 回答の「文書に追記」→ すべて `doc.proposal.upsert`（SSE）で
  本文中に提案として出る（**それまでどこからも発行されておらず、再読み込みまで見えなかった**）。追加（INSERT）は対象ブロックの直後
  に出る（**以前は表示されず、追記した回答は消えたように見えた**）。
- 採用: レビュー中（ready / partially_accepted）のジョブの提案は 412 で Review へ誘導（コードと一緒に 1 回の採用・1 回の Undo）。
  それ以外は単独で採用 / 却下。ブロックが動いていれば 3-way、重なれば 409 → 提案自体に「本文が変わりました…却下するか直接直して」。
- 人の編集 `POST /doc/blocks/:block/edit`（`apply: doc | code`）: 出典リンクを消す編集は**保存前に** `dropped` で知らせる（UXP-20）。
  範囲だけ変えたリンクは「外れた」扱いにしない（store は新しい claim として刻印し直す）。`apply: code` で出典の無いブロックは
  412 + 「Fix がコードを提案します」のヒント。
- 人が書いた文に AI の提案を採用しても `human-edited` の固定は残る（UX-INT-02、ロックは採用で外れない）。

## 3. `mitori install`

| 対象 | 書くもの | 確認 |
|---|---|---|
| `claude-code`（user） | `~/.mitori/integrations/claude-code/`（marketplace・plugin・review / gen skill・gen-writer agent・touch hook、`--mcp` で `.mcp.json`） | 6 ファイル current、記録 `integrations.json` 0600、次に実行するコマンドを表示、`claude plugin validate` 通過 |
| `claude-code`（project） | `.claude/skills/mitori-review/SKILL.md` | current |
| `agents-md` | `AGENTS.md` の管理ブロック（マーカーの間だけ、利用者の文章はそのまま）、`CLAUDE.md` があればそこにも | 74 tok。手で直すと `modified` → 再 install は残す → `--force` は TTY で確認（agent からは exit 2） |

テンプレートの文面は契約（`INTEGRATION_TEMPLATES`）なので CR ux-F2 で記録した。id は `@1` のまま（install route は今回まで 501 で、配布済みのブロックは無い）。

## 4. 実機で見つけて直したバグ（全部に回帰テスト）

| # | 症状 | 原因 | テスト |
|---|---|---|---|
| UX-B1 | Review を開くたびに `effect_update_depth_exceeded` が 2 回（ページエラー） | ReviewPanel の effect が trust トーストを無条件に dismiss — dismiss はトースト一覧を読んで書き直すので、effect が自分の書き込みに依存した | UX-UI（ページエラー 0 を検査） |
| UX-B2 | 人が未生成の節に書くと、次の静的更新で「この節はまだ生成されていません」に戻す提案が出る（本文中に AI の提案と並ぶ） | 人が書いても `kind: placeholder` のままで、節に中身が無いと判定された | DOC-U-007b（修正なしで失敗を確認） |
| UX-B3 | 「設計書を直す」が 501 | `POST /doc/blocks/:block/edit` 未配線 | UX-INT-01 (a)、UX-INT-03 |
| UX-B4 | AI の設計書の変更が再読み込みまで見えない | `doc.proposal.upsert` の発行者がいなかった | UX-INT-02（SSE） |
| UX-B5 | 「文書に追記」した回答が消える | INSERT 提案を本文に出す層が無かった | UX-UI D |
| UX-B6 | 提案差分が文全体の置換になる | 英単語の正規表現が和文字も食べた | UX-PROP-03 |
| UX-B7 | 背の高い Composer が画面外で開き、送信ボタンが見えない | 伸びたときだけスクロールしていた | UX-UI A（`ux-01`） |
| UX-B8 | 実 repo で候補がノイズだらけ | 普通の英単語もシンボル検索した | UX-FIX-07/08 |

## 5. 他の所有者のファイルに入れた変更（小さく、追加のみ。`docs/design/cr-requests/ux.md` #4）

`packages/core/src/api.ts`（CR ux-F1 の型と route）、`packages/server/src/contract.ts`（ROUTE_OWNERS 1 行）、
`packages/loop/src/contract.ts`（テンプレート文面、CR ux-F2）、`packages/server/src/compose.ts`（installer と integration handlers、
init の agentsBlock）、`packages/server/src/wiring/workspace.ts`（提案の発行）、`apps/web/src/stores/doc.svelte.ts`（`pendingInserts()`）、
`apps/web/src/shell/Header.svelte`（ヘッダー整理）、`packages/doc/src/store/store.ts`（UX-B2）、`packages/core/CR-LEDGER.md`（§6）。

## 6. 動かないもの・残り（正直に）

1. **出典の「対象コード」は外せない**（× なし）。router が出典を必ず書き込み範囲にする（loop spec §3.2）ので、外すには別の文を
   選び直す。ブロック全体を選ぶと全 claim の出典が入る。CR #2（router が `context.remove` を受けるように）。
2. **実エンジンでは試していない**（このトラックは実費禁止）。候補を選んだ Fix が本物の claude で通るか、候補の質が生成済みの
   設計書でどうかは未確認。fake では Fix → ready → Review → 採用 → 提案の採用まで通る。
3. 本文中の提案は `renderMessage` で描くので、静的表の `config.go:25` チップが提案の中ではフルパスのコード表示になる（見た目の差）。
4. 静的 facts の行への AI の提案は、コードを採用すると行がコードから作り直されて重なり（409）になる。今は提案に「本文が変わりました」
   と出して却下を促すだけ（正しい内容はコードから自動で入る）。静的ブロックには doc_updates を出させない方が筋かもしれない（loop 側）。
5. 未生成の節に人が書いた文は prose になったが、Reader は節を「この設計書はまだ生成されていません / 生成する」の枠で囲んだまま（WP-10a の節表示）。
6. ready カード・trust トースト・「内容を見て承認」で同じ未承認ゲートが 3 回言われる（Review パネルの中だけは 1 回にした）。
7. 和文だけの依頼から候補は出ない（(c) の案内になる）。Linux・Windows・Codex は未確認。

## 7. 再現

```bash
scripts/nd bun run check
scripts/nd bun test packages/loop/src/review packages/loop/src/install packages/server/src/wiring apps/web/src/composer \
  apps/web/src/threads packages/doc/src/store/store.test.ts test/int/ux.test.ts test/int/ux-install.test.ts test/int/ux-ui.test.ts
scripts/nd bun scripts/gen-assets.ts && scripts/nd bun test/int/shots/ux.ts --out docs/progress/ux     # Chrome、fake engine、≈ 20 s
scripts/nd bun run build:bin && scripts/nd bun test/int/shots/ux-bin.ts --out docs/progress/ux         # コンパイル済み、送信なし
```

全体: `scripts/nd bun test` 2,558 pass / 0 fail（225 s、UI テスト 2 本込み）、`bun run check` 緑。

スクリーンショット（`docs/progress/ux/`）: 01 候補（⌥1）・02 選んだ後の見積り・03 本文中の提案差分と ready カード・04 Review
（整理後のヘッダー）・05 採用・06 対象なしの案内・07 設計書を直す・08 直した文（出典付き）・09 出典 = 対象コード・10 単独の提案・
11 採用後・12 追記（INSERT）提案。
