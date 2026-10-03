# mitori UX/UI 仕様（ux.md）

- 版: 1.0（2026-10-03） / 状態: **正本（authoritative）** — `apps/web` の画面・操作・組版・アクセシビリティ・フロントエンド構造・予算の強制方法
- 所有: ui spec。対になる契約: `docs/design/contracts/ui.ts`（本書と同時に改訂。`tsc 6.0.3` で core/api と一緒に 0 エラー）、トークン: `docs/design/design-tokens.css`
- 入力（優先順）: `ARCHITECTURE.md`、`contracts/core.ts`・`api.ts`、`prototypes/JUDGEMENT.md`（Editorial Calm を基盤に Pro / Map を移植）、research `07`・`02`・`01 §4`、`specs/loop.md`・`generation.md`・`testing.md`
- 位置づけ: JUDGEMENT.md §5〜§10 を実装できる粒度に展開し、JUDGEMENT が決めていない画面（S0・S3・S6〜S9・trust・finish・export viewer）、状態、フロー、アプリ構造、予算の強制方法を決める。**JUDGEMENT の AC-J01〜AC-J62 はそのまま有効**で、本書は AC-U01 以降を足す（§15）。本書と JUDGEMENT が食い違う箇所は §0.2 に列挙し、本書を優先する。
- 表記: 識別子・型・キー・CSS は英語のまま。**[仮]** は推定値で、必ず「測り方」を §17 に書く。「目標 / 上限」は `bench/budgets.json` の target / limit に対応する。キーは macOS 表記（⌘ = Mod。Windows / Linux では Ctrl）。

---

## 改訂 R1（2026-10-03、レビュー反映） — 本節が本文より優先する

契約は `contracts/ui.ts`・`api.ts`・`core.ts` の R1 版。各行の ID は `docs/design/REVIEW-LOG.md`。

| 本文 | 変更（ID） |
|---|---|
| §16 R1〜R25 | 全件を台帳で精算（`contracts/CR-LEDGER.md`）。R7 は M4、R20 は P3、R25 の `last` は daemon 全体の `seq` |
| §2.2 S1 | **MVP の S1 は ELK container / dependency 図**（同じ SVG 部品、room 選択・room card・Enter→節・Z0〜Z2）+ strip・見積りカード・「0 tok で今できること」・facts カード・stage 時間。床面図は WP-18（`ui.map.floorplan`、`specs/floorplan.md`）。M1 の AC から J03・J04・J05 の Z3・J08・J09 を外す（SC-03）。S1 のデータ取得に `GET /engines` を含め、未インストール / 未ログイン / capability 喪失のカードを出す（UXP-15、AC-U-EN） |
| §2.3 route | `/w/:ws/review` は ready job → review、待機中の `mitori review` か保留 thread あり → 直前ページ `?pull=1`、それ以外 → Inbox。`PullBar` を表示（UXP-01、AC-U-P01）。permalink（`y`）の 2 行目は可搬 URL（UXP-13、AC-U-PL） |
| §2.4 認証 | session は header + `localStorage`、daemon 再起動を越える。`auth_expired` は revoke・30 日 idle・port 変更のときだけ（UXP-07・SEC-06、AC-U09） |
| §3.1 / §4.4 幅 | 幅は grid container の clientWidth（ResizeObserver）で計算し 100vw を使わない。container < rail + 672 + 332 なら rail を drawer に、< 672 + 640 なら review を右固定 overlay（`min(640px, 100% − 48px)`、⇧R と同一部品）、review 中の `b` は drawer overlay、code mode は < 1,092px で bottom sheet（UXP-03、AC-U-W01: 1024×768・1180×820・1194×834・1280×720・1280×800・1366×768・1440×900 × S1/S2 margin/S2 code/S5 review(+b)/S4、17px scrollbar 模擬込みで横 scroll 0・1 行 ≥ 34 字） |
| §3.5 toast 文言 | lint 準拠に書き換え（UXP-25）。例: 「反映しました — {n}ファイルを作業ツリーへ（未コミット）· 設計書{m}ブロック」（checkpoint は詳しいレベルだけ）、「このリポジトリの自動検査{n}件が承認待ちです（承認するまでは検査せずに提案します）」。§9.6 の語彙表に checkpoint→取り消し点、gate/ゲート/検査→自動検査、hunk→変更箇所、outdated→要付け直し、workspace→作業フォルダ を追加。ux.md の表から ja 文字列を抽出して i18n-parity 規則を掛ける CI（WP-10a） |
| §4.2.4 見積りカード | 主数値は API 換算 $、同じ行に課金状態（`Estimate.billing`）（UXP-09、AC-U-B01）。較正 n < 5 は範囲表示（UXP-30）。未較正 κ は `windowDeltaRange`（「5h枠45% → 推定+15〜40%（未較正・Proの目安）」）、未較正 + pro の既定 tile は「概要」（UXP-08、AC-G-W01）。生成は button に focus があるときの Enter だけ、主行の ⏎ 記号は削除（UXP-30）。**データ方針**: ack の無い engine では折りたためない開示行を主行の上に出し、≥ 1 s 見えた後のクリックだけを ack にする。Composer の初回 Push と Finish push にも同じ 1 行（UXP-04、AC-U-DP）。session ボタンは `/mitori:gen standard` をコピー（UXP-11） |
| §4.3.5〜4.3.6 信頼表示 | verdict `cited`（灰 ◦）を追加、verified のラベルは「出典と識別子が一致」、「確認済」は human-verified と L3 S だけ。peek footer は check ごと（UXP-06）。「確認済にする」は初めて/標準では cite peek を開くまで無効、確認者は git user、hover で「{name}が{日付}に確認」、S8 に一覧（UXP-31） |
| §4.6 Finish / Inbox | dialog 題「R{n}を送る」、⇧F はどこでも「まとめて送る」（UXP-21）。見積りは `POST /review/estimate`（CONS-08）。「人向けのメモ{n}件（送らない）」+ thread ごとの『AIに送る』（UXP-02）。既定 mode は保留 thread で選ばれた path、待機 0 の pull は「R{n}を準備する」+ `/mitori:review` のコピー（UXP-10、AC-U-F01）。Inbox filter に `uncommitted`（UXP-19）。doc_edit の 2 択は `DOC_EDIT_CHOICES`（1 = コードを設計に合わせる、2 = 設計書を直す）で全画面共通（UXP-21） |
| §4.7 Review | ✓ は全 gate が適用する木で pass のときだけ。skip/untrusted は「⚠ 検査なし（未承認{n}件）［内容を見て承認］」。部分採用は H′ で再検査（「組み合わせを検査中…」）、失敗なら主ボタンが警告色「検査に失敗した組み合わせを採用」（UXP-05、AC-U-G01/G02）。`Job.sensitive` の job は ReadyCard に採用ボタン無し・⌥⌘⏎ 無効・ファイルごとの判断（SEC-12）。ctx=review では focus に関係なく review scope が優先（`ROUTE_SCOPES.docReview`、UXP-16、AC-U-RS）。採用後は更新 block に focus、live region「採用しました。10秒以内なら⌘Zで取り消せます」（UXP-38）。採用後カードに「コミットする」「差分をコピー」（UXP-19）。merge 衝突の「やり直しを依頼」に見積り chip（UXP-36）。sandbox 無しの test gate は「自動検査を実行」ボタン（SEC-03） |
| §4.10 ⌘K | 3 つの query 形（qRaw / qKana / qRomaji）、label に romaji 規則を掛けない、`r` の前方一致で末尾未完を許容（UXP-12、AC-J46b）。score ≥ 120 の top-hit 行、prefix mode `@` `#` `>` `:`（UXP-29） |
| §4.12 trust ダイアログ | gate の文言: 「あなたの権限で実行されます。sandbox が無い環境ではネットワークとホームにアクセスできます。AI が書いたコードがここで実行されます」（旧「ネットワーク・秘密情報は渡しません」は誤り、SEC-03） |
| §4.13 export | 「コードの抜粋{n}箇所（{m}ファイル）を含みます」+「抜粋を含めない」（UXP-18）。viewer ローカルコメントと import は stretch（M6） |
| §5.2 / §6.2 Composer | draft は最初の入力か chip 変更で遅延作成、空のまま閉じたら何も作らない（UXP-22）。`COMPOSER_DENSITY`（初めては 1 行の費用だけ、chips/router/path は「詳細 ▸」）、空本文の質問は既定の問いで送る（UXP-14、AC-U-E01）。router chip はメニュー（mode と model の上書き、UXP-28）。path の初期値は直前の path → 既定（UXP-10）。mention は `@`/`＠`、直前が [A-Za-z0-9_.] 以外で発火（UXP-27）。初回 Fix の footer に未承認 gate の 1 行（UXP-05） |
| §5.5 doc 直接編集 | CM6（初回編集で lazy、失敗時のみ textarea）、cite link は原子的 widget、ID コメント非表示、claim が外れるなら「出典{n}件（…）が外れます［戻す］［外して保存］」（`DocEditRes.dropped`、UXP-20） |
| §6.1 選択 | CJK 1 文字の選択を許可（`selectionMinCharsCjk`、UXP-37）。`Alt+J`/`Alt+K` の claim cursor（UXP-17、AC-U86 の B1 を書き換え） |
| §8 キーボード | `read.chapter` の 1〜9 は TOC 順の n 番目（§0 = 1）、§10 以降は `g`+2 桁（UXP-34）。`cites.toggleAll`（`.`、bare Alt の preventDefault、⌘K 項目、UXP-26）。対象なしの e/c/f/p で 1 回だけ hint（UXP-35）。再割当て中の keyCode 229 に hint（UXP-39）。IME 規則 (3) は compositionend と同じ task の全 keydown（UXP-27） |
| §10.2-3 和欧間 | 原稿は CJK↔英数の境界に ASCII 空白 1 つ、renderer がそれを除去し UI は `text-autospace: normal`。AC-J14 は「renderer 出力に該当空白 0」。UI の i18n カタログは空白なし規則のまま（UXP-24・SC-19、方針を凍結） |
| §12.3 SSE | 1 タブ 1 本の `fetch()` stream、`?last=<seq>`、workspace 実体は (ws, rev)、global は seq で重複排除（CONS-04） |
| §13.1 予算 | M3 までの hard gate は初期 JS 150KB・CSS 25KB・Web フォント 0・Review 前に CM6 を要求しない の 4 つ。60KB と chunk ごとの値は警告、M3 で確定（SC-21） |
| §17 未決 | U23（和欧間）は方針凍結により MVP 後の評価へ。U8・U19・U24（実機）はユーザー作業表（MILESTONES §8）の日付で実施 |

---

## 0. 要約

### 0.1 1 画面で

1. **3 つの面と 1 本の文脈列**: S1 見取り図（地図が主役、0 tok で 3 秒）→ S2 設計書（明朝の見出し、37 字の本文、出典チップ）→ 右の**文脈列**が `margin`（スレッド・Composer・ジョブを段落の高さに置く）/ `code`（Split view）/ `review`（640px の Review パネル）の 3 モードを決定的に切り替える。Inbox（S4）は「やること」の一覧。
2. **ループは 1 画面で閉じる**: 文を選ぶ → `c`/`e`/`f` → Composer（意図・context chips・見積り・router）→ ⌘⏎ から 100ms で楽観的カード → 実イベントのステージ（% バーなし）→ ◆ レビュー待ち → `r` で Review（ゲート・実績・diff・設計書の提案）→ ⌘⏎ 採用（checkpoint → 作業ツリー、block が 1 回光る、10 秒の Undo）。
3. **信頼は静かに、推測は隠さない**: 確認済の ✓ は hover / ⌥ 長押し / 詳しいレベルでだけ出す。推測・古い可能性・裏付けなしは常に本文中に見える。
4. **費用は前・中・後**: 見積りチップ（≈in · ≈out · $ · 約 p25–p75 秒、色帯）、実イベントの経過、実績行（入力 / cache / 出力 / $ / モデル秒 + ゲート秒 / 見積との差 / 5h 増分）。確認ダイアログは 100k tok 超・repo 全体・昇格・従量課金のときだけ。生成は見積りカードそのものが確認（1 クリック）。
5. **キーボードで完結、IME で壊れない**: 1 つの capture ハンドラ、1 行目で `isComposing || keyCode===229`（非 editable でも絶対）、Enter 単独では送信しない（⌘/Ctrl+Enter）。scope は route で決め、ポインタ位置では決めない。
6. **和文組版は JLREQ**: 16px / 1.9 / 37em（36〜38 字）、`line-break: strict`、`text-autospace`（和欧間に空白を入れない）、太字 600、OS フォントだけ（先頭は OS 標準）。
7. **速さは「何を DOM にするか」で作る**: サーバ描画の block HTML を `{@html}` で差し込み、ルート 1 か所でイベント委譲、行単位コンポーネント禁止、節単位の `content-visibility`、閾値超えだけ仮想化、地図は SVG 文字列 1 回 + transform だけ。初期 JS ≤ 60KB gz（上限 150KB）、DOM ≤ 5k（上限 15k）。
8. **強制はコードで**: 実配信バイト検査、構造不変条件の e2e、コントラスト / 文字サイズ / 当たり判定の probe、ja/en parity、和字リテラル lint、IME guard lint。

### 0.2 JUDGEMENT.md からの差分（本書が優先）

| # | 項目 | JUDGEMENT | 本書の決定 | 理由 |
|---|---|---|---|---|
| Δ1 | 読者レベルのキー `-`/`=`/`0` の scope | `level.*` は global のまま（§6.14 の表は map のみ追加） | `level.*` を **`read` scope** に移す（`ui.ts DEFAULT_KEYMAP`） | §6.14 の「S1 では無効」を契約で表す。Inbox・設定で誤爆しない |
| Δ2 | 推測バッジ・human-verified の色 | 推測 = 黄（`--c-guess`）、人の確認 = 紫 | 同じ。gen spec §7.3 の「推測 = 灰・〜」「human-verified = 青・✓✓」は**形とラベルだけ**採用し、色は本書 §6.9 | UI の色の正本は ui spec。形 `〜` / `✓✓` は採用 |
| Δ3 | 却下の Undo | 「却下も確認なし、元に戻す ⌘Z のトースト」 | **遅延確定**（10 秒後に `POST /reject`。それまでは UI 上だけ却下） | `JOB_TRANSITIONS.rejected = []`（終端）で、API では戻せない |
| Δ4 | IME guard と非 editable | 未決（testing RQ-UI-1） | **絶対**: keyCode 229 では何も発火しない。代わりに 1 セッション 1 回のヒントトースト | 実ブラウザは非 editable で IME を無効にするので実害がなく、guard の単純さを守る（§8.6） |
| Δ5 | 本文の和文フォント（Windows） | Editorial の stack（Segoe UI → Yu Gothic UI） | 本文だけ **BIZ UDPGothic → Meiryo** を Yu Gothic UI より先に（UI は従来どおり）[仮] | Yu Gothic UI は UI 用の詰まった字形で、長文に向かない（07 §4.1）。Windows 実機で確認する（§17） |
| Δ6 | コードのコメント色 | Editorial `#8E8A82`（code-bg 上 3.2:1） | `--shiki-token-comment: #66615A`（5.30:1）/ ダーク `#A39D92` | AC-J10（不合格 0 件）を満たすため |
| Δ7 | diff の語単位ハイライト | `--add-hl #D2E6C6` / `--del-hl #F2D2C9` | `#D9EACE` / `#F6DED7`（ダーク `#223A26` / `#43231D`） | 構文色が 4.5:1 を割っていた（4.34〜4.47） |
| Δ8 | Review の独立ルート | S5 は文脈列のモード | モードのまま、permalink `/w/:ws/review/:job` を S2 + `ctx=review` として解決 | 共有と back/forward のため |
| Δ9 | 新キー | — | `review.prevJob`/`nextJob`（`[`/`]`、review scope）、`inbox.next`/`prev`/`finish`/`hideResolved`、`undo.last`（global、Undo トースト表示中だけ） | 複数のレビュー待ちを順に捌く、Inbox の id を独立させる |
| Δ10 | ブロック操作ボタン | 各 block の左ガターに縦 3 ボタン | **共有の 1 個**の浮遊ガターを hover / focus 中の block に移動して出す | 1,000 block で 6k ノードになるのを防ぐ（DOM 予算）。見た目と寸法（28×28px）は同じ |

---

## 1. 原則（拘束力のある 10 か条）

1. **設計書が主役**。chrome は設計書の格（明朝の見出し・紙の背景・墨と朱）を壊さない。グラデーション・ガラス・常時の凡例・常時の ✓ を置かない。
2. **0 tok で歩ける**。LLM を呼ぶ前に、見取り図・目次・静的な節・facts が出る。生成していない部分は空欄にせず、静的事実と「生成する ≈k tok」の placeholder を置く。
3. **すべての LLM 操作は「見積り → 1 操作 → 実イベント → 実績」**。偽の % バー、根拠のない残り時間、途中の usage を実績として出すことを禁止する。
4. **人が承認するまで書かない**。コードは worktree、設計書は提案（D12）。採用は checkpoint を作ってから。削除・却下・取り消しに確認ダイアログを出さず、Undo で戻す。
5. **コメントは失わない**。下書きは 500ms で自動保存（daemon が落ちていても localStorage に退避）。付け直せないアンカーは outdated にし、元のスナップショットを見せる。
6. **状態は形・色・ラベルの 3 つ**で示す（WCAG 1.4.1）。語彙は §6.9 の 1 表に固定する（「レビュー待ち」「採用 / 却下 / 元に戻す」）。
7. **キーボードで 2 打鍵以内**、マウス・タッチでも同じことができる。単一キーは設定 1 つで全部オフにできる（WCAG 2.1.4）。
8. **日本語ファースト**。UI 文言・設計書の原稿ともに和欧間の半角空白を入れず、`text-autospace` に任せる。EN 表示では chrome に和字を 1 文字も漏らさない。
9. **体感 100ms**。遷移・検索・ショートカット・楽観的カードは 100ms 以内。サーバでできること（Markdown・ハイライト・図の配置）はクライアントでしない。
10. **予算はコードで守る**。§13 の値を CI が実配信バイト・構造不変条件・probe で検査し、超えたら PR を落とす。

---

## 2. 情報設計（IA）とルーティング

### 2.1 画面一覧

| ID | 画面 | ルート（`ui.ts APP_ROUTES`） | 目的 | フェーズ | WP |
|---|---|---|---|---|---|
| S0 | Launcher | `/` | 最近の workspace、パス / GitHub URL を開く | P1 | 10a |
| S1 | 見取り図 | `/w/:ws` | 全体像（0 tok）、生成の見積りと進捗、部屋 → 節 | P0（0 tok）/ P1（生成） | 10a |
| S2 | 設計書 Reader | `/w/:ws/doc/*section` | 読む・出典を確かめる・コメントする | P0（静的節）/ P1 | 10a・10b |
| S3 | コード | `/w/:ws/code/*path` | ファイル全体を読み、コード範囲にコメントする | P1 | 10a |
| S4 | Inbox | `/w/:ws/inbox` | あなたの番・作業中・失敗・outdated・下書き・解決済み | P2 | 10b |
| S5 | Review | `/w/:ws/review/:job`（= S2 + 文脈列 `review`） | 提案（コード diff + 設計書の提案）を採否する | P1 | 10b |
| S6 | 用語集・索引 | `/w/:ws/glossary` | 用語（よみ・英語名）とシンボル索引 | P3（MVP は `doc/s12` へ置換リダイレクト） | 10a |
| S7 | 決定事項ログ | `/w/:ws/decisions` | 昇格した thread（`decisions/`）の一覧 | MVP は一覧のみ / P3 で全機能 | 10b |
| S8 | 生成と鮮度 | `/w/:ws/gen` | 網羅率、古い節と再生成の提案、run 履歴、見積り精度、使用量 | P2 | 10a |
| S9 | 設定 | `/settings`、`/w/:ws/settings` | engine・モデル・並列・予算・言語・ショートカット・信頼 | P1 | 10a |
| — | ⌘K パレット | overlay | 横断検索と全操作 | P0 | 10a |
| — | ヘルプ（`?`） | overlay | 実効キーマップの一覧 | P0 | 10a |
| — | テキストで見る | dialog | 見取り図の代替（表） | P1 | 10a |
| — | Finish（⇧F） | dialog | まとめて AI に送る / `mitori review` に渡す | P2 | 10b |
| — | Trust | dialog | gate・repo prompt・rules の承認 | P2 | 10b |
| — | Export viewer | 単一 HTML | 読み取り専用の設計書（オフライン） | P3（本 session の範囲） | 13 |

**ナビゲーションの入口**: ヘッダーのタブ 4 つ（見取り図 / 設計書 / Inbox / レビュー）、`g`+文字、⌘K。S0・S6〜S9 はタブに置かない（⌘K、ヘッダーの workspace 名メニュー、ステータスバーから）。

### 2.2 ルート表

共通: すべての URL は permalink。クエリの未知キーは捨て、不正値は既定値にする（`Router.parse` は例外を投げない）。`section` と `path` は rest パラメータで、各セグメントを `encodeURIComponent` する。scope は `ui.ts ROUTE_SCOPES`。

| ルート | パラメータ / クエリ / hash | 初回の取得（並列。※は既にあれば再利用） | 最初の描画 mark | 有効な scope | 読み込む chunk |
|---|---|---|---|---|---|
| `/` | — | `GET /workspaces` | `mitori:shell:painted` | global | entry |
| `/w/:ws` | `room=<nodeId>`、`z=Z0\|Z1\|Z2\|Z3`（既定 Z2）、`flow=<sectionId>`、`text=1`（テキストで見る） | `GET /ws/:ws`、`GET /ws/:ws/map`、`GET /ws/:ws/doc`※、SSE 接続。`mitori:map:painted` の後に `POST /gen/estimate` ×3（effort 3 種、生成済みなら出さない） | `mitori:map:painted` | global + map | entry, map |
| `/w/:ws/doc/*section` | `ctx=margin\|code\|review`、`pin=<path>:<a>-<b>`、`th=<threadId>`、hash `#b_xxxxxxxx` | `GET /ws/:ws/doc/sections/:section?lang=`（LRU 20）、`GET /ws/:ws/threads?limit=200`※（resolved 以外を全部）、`GET /ws/:ws/jobs?limit=200`※ | `mitori:section:rendered` | global + read（review モード中は global + review） | entry, reader（idle で loop を先読み） |
| `/w/:ws/code/*path` | hash `#L40-L78` | `GET /ws/:ws/files/content?path&start&end&html=1`（§16 R6）、`GET /ws/:ws/files/tree`（rail を開いたとき） | `mitori:section:rendered`（id = path） | global + read | entry, reader |
| `/w/:ws/inbox` | `f=all\|mine\|working\|failed\|outdated\|draft\|resolved`（既定 mine）、`sel=<itemId>` | `GET /ws/:ws/inbox?limit=200`（以後 cursor） | `mitori:section:rendered`（id = inbox） | global + inbox | entry, inbox, loop |
| `/w/:ws/review/:job` | `wide=1`、`hunk=<path>:<oldStart>` | `GET /ws/:ws/jobs/:job`（diff・提案・events）、対象 block の節 | `mitori:review:diff-mounted` | global + review | entry, reader, loop, review |
| `/w/:ws/review` | — | jobs から `ready` の最古を選び `replace` で `/review/:job` へ。0 件なら `inbox?f=mine` の空状態へ | — | — | — |
| `/w/:ws/threads/:th` | — | `GET /ws/:ws/threads/:th` → アンカーの場所（doc なら `doc/<section>?th=…#<block>`、code なら `code/<path>#L…`）へ `replace` | — | — | — |
| `/w/:ws/glossary` | `term=<gl_id>` | MVP: `doc/s12#<block>` へ `replace` | — | — | — |
| `/w/:ws/decisions` | `dc=<dc_id>` | `GET /ws/:ws/decisions` | `mitori:section:rendered` | global | entry, gen |
| `/w/:ws/gen` | `run=<gr_id>` | `GET /ws/:ws/gen/runs`、`GET /usage/summary?range=7d&ws=`、outline※ | `mitori:section:rendered` | global | entry, gen |
| `/w/:ws/settings`、`/settings` | `tab=…`（`ui.ts SettingsTab` / `WsSettingsTab`） | `GET /settings`、`GET /engines`、（ws）`GET /ws/:ws/settings`、`GET /ws/:ws/trust` | `mitori:section:rendered` | global | entry, settings |

### 2.3 ナビゲーションの規則

1. **ページの単位**: S2 の「ページ」は、`SectionNode.file` が親の file と異なる節（= `.mitori/doc/*.md` の 1 ファイル）。同じファイルの子節はそのページの中に続けて描く。§6 は索引ページ（`doc/06-modules.md`）と、モジュールごとのページ（`doc/modules/<slug>.md`）に分かれる。
2. **タブ**: 「設計書」タブは最後に開いたページ（`sessionStorage` `mitori:lastPage:<ws>`、無ければ §0）へ移る。「Inbox」タブのバッジは `InboxStore.mineCount`（あなたの番）、「レビュー」タブは `ready` の job 数（◆{n}）。0 のときバッジは出さない（タブ自体は常に出す）。
3. **リンクの横取り**: 文書内・chrome 内の `a[href^="/w/"]` と `a.mcite` のクリックは、ルート要素 1 か所の委譲で `router.go` に変える。修飾キー付き（⌘/Ctrl/Shift）と中クリックはブラウザに任せる（新しいタブ）。
4. **履歴とスクロール**: `history.state` に `{scrollY, focusBlock}` を入れ、back/forward で復元する。同じページ内の block 移動（`j`/`k`、hash）は `replaceState`。
5. **フォーカス**: ルートが変わったら `<main>` の最初の見出しへフォーカスし（`tabindex="-1"`）、`aria-live="polite"` で「設計書 §3 主要な流れ」のようにページ名を読み上げる。
6. **prefetch**: 目次・pager・本文リンクに 65ms hover したら、その節を取得して LRU に入れる。遷移 p95 ≤ 100ms（AC-J62）。
7. **permalink のコピー（`y`）**: クリップボードに 2 行を書く: `§3.2 認証フロー — login.go:40-78` と URL（`ui.ts permalinkText`）。Slack にそのまま貼れる。
8. **ワークスペースの切替**: ヘッダーの workspace 名をクリック → popover に最近の 8 件と「すべて（S0）」。⌘K の「workspace を開く」も同じ。

### 2.4 ワークスペースと接続の状態

| 状態（`WorkspaceState` / `ConnectionState`） | 見せ方 |
|---|---|
| `loading` | 外枠の skeleton（最終寸法）。1 秒を超えたら strip に「読み込み中…」 |
| `scanning` | S1 の strip に `scan.progress` を 10Hz で: `S1 解析 812 / 1,219 files`。stage は建物の外形だけを描き、部屋は skeleton |
| `ready` | 通常表示 |
| `error` | 該当画面の中央にエラーカード（`errorText(lastError)`、`requestId`、［再スキャン］= `POST /ws/:ws/scan {force:true}`） |
| 接続 `retrying` | ヘッダー直下に 32px の帯（`--c-warn-bg`）:「daemon との接続が切れました · 再接続中（3 秒後）」。読む操作は続けられる。書き込み操作のボタンは `aria-disabled` にし、Composer の下書きは localStorage に退避する |
| 接続 `auth_expired`（401） | 帯:「このタブの認証が切れました。ターミナルで `mitori` を実行すると新しいタブが開きます」［コマンドをコピー］ |
| 接続 `version_mismatch` | 帯:「画面（v{web}）と daemon（v{daemon}）の版が違います。再読み込みしてください」［再読み込み］ |
| 接続 `stopped`（`server.shutdown`） | 全画面の半透明 overlay（`inert` で背面を無効化）:「mitori は停止しました」+ 理由 +「ターミナルで `mitori` を実行してください」［コマンドをコピー］ |
| `WorkspaceKind = "shadow"` | ヘッダーの workspace 名の横に灰のバッジ「git 管理外」。tooltip「変更は ~/.mitori の shadow repo で追跡しています」 |
| `WorkspaceKind = "remote-readonly"` | 同じ位置に「GitHub · 読み取り専用」。採用ボタンの文言が「.patch を書き出す」になる（§4.7） |

---
## 3. Shell（全画面に共通）

### 3.1 グリッドとブレークポイント（JUDGEMENT §6.1 を CSS にしたもの）

| 幅 | S1 見取り図 | S2 設計書 / S5 | S3 コード | S4 Inbox | 共通 |
|---|---|---|---|---|---|
| ≥ 1281 | `grid-template-columns: var(--rail) minmax(0,1fr) var(--map-right)`（248 / 1fr / 400） | `var(--rail) minmax(var(--prose-min),1fr) var(--ctx-w)`。`--ctx-w` は §4.4 | `var(--rail) minmax(0,1fr) var(--ctx-margin)` | `var(--rail) minmax(0,1fr) var(--inbox-side)` | header 52、status 24、`scroll-padding-top: var(--scroll-pad-top)` |
| 1024–1280 | 228 / 1fr / 360 | 228 / minmax(672px,1fr) / `--ctx-w`（margin 332） | 228 / 1fr / 332 | 228 / 1fr / 400 | header のパンくずを隠す |
| 600–1023 | rail は drawer（300px、`b` / ☰）。stage は上 42%、右列の内容は bottom sheet（52px / 50vh / 88vh の 3 段） | rail は drawer。margin カードを置かず、段落の右に件数マーカー。Composer・ジョブ・peek・Review は bottom sheet | drawer + 1 列。backlink は sheet | 一覧 1 列、詳細は sheet | タッチの浮遊ツールバーは選択範囲の下 10px |
| < 600 | 地図は Z0 / Z1 だけ、ピンなし | 読む・コメント・説明（`e`）だけ。読者レベルは ⌘K から。修正（`f`）は「この端末では説明とコメントだけ使えます」 | 読むだけ | 一覧と詳細の 2 画面遷移 | 横スクロールなし（コードブロック内を除く） |

- prose 列: `max-width: var(--measure-prose)`（37em = 592px）を列の中央に置き、左右 padding ≥ 40px（既定 `--pad-prose-x` 56px）。block ガターは左 28px（`--blk-gutter`）。
- 列幅の遷移は `grid-template-columns` の 320ms（`--dur-panel`）。reduced-motion では即時。

### 3.2 起動シーケンスと head inline script（CLS 0）

1. daemon が `GET /` で返す HTML は、`<head>` に **1 つの inline script**（CSP は `script-src 'self' 'sha256-<hash>'`。hash は `scripts/gen-assets.ts` がビルド時に計算して `index.html` と daemon の CSP 定数に書く）と、`<link rel="modulepreload">`（entry と、route 別の初期 chunk 候補 map・reader）を持つ。
2. inline script（minify 後 ≤ 1.5KB [仮]）の処理（すべて try/catch。どの段で失敗しても既定値で続ける）:
   1. `document.cookie` から `mitori_ui` を取り出し `parseUiCookie`（`ui.ts`）で検証する。各フィールドは固定の正規表現 / 範囲で検査し、不正なフィールドだけ捨てる。
   2. `html.dataset.level = lv`（`newcomer|standard|expert`）、`html.lang = lg`、`th` があれば `html.dataset.theme = "light"|"dark"`（無ければ属性を付けない = OS に従う）、`cw` があれば `html.style.setProperty("--ctx-w-code", cw+"px")`、`rc=1` なら `html.dataset.rail = "collapsed"`。
   3. `lg` に応じて `<link rel="modulepreload" href="/assets/i18n-<lg>-<hash>.js">` を 1 本足す。
   4. `performance.mark("mitori:shell:painted")` は `requestAnimationFrame` の中で出す（最初の描画の直後）。
3. `<body>` には**静的な外枠 skeleton**（header 52px・rail・main・status 24px を最終寸法で）が入っている。route 別の中身（S1 の strip と stage の枠、S2 の章見出しの枠）も最終寸法で置く。
4. entry chunk が `mount(Shell, {target: skeletonRoot})` で skeleton を置き換える（寸法は同じなので移動なし）。
5. 並列に: `GET /ws/:ws`、SSE 接続、route 別の取得（§2.2）。
6. サーバ設定（`GET /settings` の `ui`）が cookie と違えばサーバを正として適用し、cookie を書き直す（別ブラウザで変えた場合だけ起きる）。

予算: CLI → 外枠描画 ≤ 0.3s / 0.5s、最初の有用な画面（S1）≤ 3s / 5s、CLS 0 / 0.01（AC-J02、AC-J48、AC-U03）。

### 3.3 ヘッダー（52px、sticky、`--hdr-bg` + `--hdr-blur`）

左から（≥ 1281）:

| # | 要素 | 仕様 |
|---|---|---|
| 1 | ブランド | `見取り図`（明朝 18px / 600 / `.06em`）+ `MITORI`（12px、`--muted`、`.14em`、uppercase）。クリックで S0。EN UI でも和文ロゴは製品名として残す（`brand.name` は parity の同値許可リスト） |
| 2 | 区切り | 1px × 18px `--rule-2`（`aria-hidden`） |
| 3 | workspace | `{名前} {HEAD7}`（名前 14px/600 `--ink`、HEAD mono 12px `--muted`）+ 種別バッジ（§2.4）。クリック → workspace popover |
| 4 | タブ | `見取り図` / `設計書` / `Inbox {n}` / `レビュー ◆{n}`（13.5px、現在タブは 600 + 下端 2px `--ink`、`aria-current="page"`）。`<nav aria-label>` の中のリンク |
| 5 | パンくず | 1024–1280 で隠す。`見取り図 › 区画 › 部屋 › 節`（地図と文書で同じ表記） |
| 6 | 検索 | 240px のボタン `⌘K 検索・コマンド`（13px、`--muted` on `--sheet`。`--faint` は使わない） |
| 7 | 読者レベル | segmented（radiogroup）`初めて｜標準｜詳しい`（12.5px、高さ 32px）。S1 でも表示し、切り替えられる（S1 では `-`/`=`/`0` はズーム） |
| 8 | ジョブチップ | `◐{実行中} 🔒{ロック待ち} ◆{レビュー待ち}`（SVG の glyph + 数、`ui.ts JobChipProps`）。全部 0 なら隠す。クリック / Enter → 440px の popover（§6.11） |
| 9 | テーマ | icon button 32×32（システム → ライト → ダークの順に巡回。`aria-label` に次の状態） |
| 10 | 言語 | `EN` / `日本語`（UI 言語を切り替える。設計書の言語は変えない） |
| 11 | ヘルプ | `?` icon button（WCAG 3.2.6: 常に同じ位置） |

- **使用量はヘッダーに出さない**（ステータスバーへ。JUDGEMENT §6.12）。
- 600–1023: 1・3・4（アイコン化）・6（アイコン）・8・11 だけ。rail の ☰ を左端に足す。

### 3.4 ステータスバー（24px、mono 12px、`--muted` on `--paper-2`、BottomStack の最下段）

`● daemon {host}:{port}` │ `index ✓ {files} files · warm {ms} ms` │ `ジョブ {n} 実行中 · {m} 待機 · C={c}`（429 back-off 中は `C={effective}/{c}`）│ `今日 {tok} tok · ${usd} API換算` │ `5h {p}% · 7d {q}%`（観測できたときだけ）│ `{engine} · {subscription|api}` │ `g …`（sequence 待ちのときだけ）│ `? ショートカット`

- 各区画はボタン: daemon → `GET /daemon` の詳細 popover（版・PID・RSS・workspace）、index → S8、ジョブ → ジョブ popover、今日 → 使用量 popover（`GET /usage/summary?range=today`: model 別・engine 別、見積り精度 ±p%）、5h → 枠の説明（resetsAt、譲り合いの規則「80% を超えたら background の生成を一時停止」）。
- **従量に回ったとき**（`window.overage.active` / `billing === "overage"`）: 5h 区画を `--c-warn` にして `従量` と明記し、`notice` トーストを 1 回出す（addendum A1）。
- `● daemon` の点: live = `--c-ok`、retrying = `--c-warn`（点滅しない）、stopped = `--c-bad`。色だけに頼らず `aria-label` に状態。

### 3.5 BottomStack とトースト（JUDGEMENT §6.8 の積み上げ規則）

1. 画面下端に固定できるのは `BottomStack` に登録した要素だけ: ステータスバー → トースト群（下から）。Inbox の batch バーは一覧の**上端に sticky**（下端には置かない）。Review パネルのフッターはパネル内部の sticky（ウィンドウ下端ではない）。
2. 各要素の `bottom` = 下にある登録要素の高さの合計 + 12px。高さは ResizeObserver で更新する。
3. `scroll-padding-bottom` = BottomStack の合計高さ（WCAG 2.4.11: フォーカスがトーストに隠れない）。
4. トーストは最大 3 件（`toastMax`）。新しいものを一番下に置き、4 件目で最古を閉じる。同じ `id` は置き換える。幅 420px（`--toast-w`）、右下（≥ 1024）/ 下中央（< 1024）。
5. トーストの寿命: info / success 5s、undo 10s（下端に残り時間の線を 10s linear）、warn 8s、error は手で閉じるまで。**pointer が乗っている間とフォーカスが中にある間は寿命のタイマーを止める**（WCAG 2.2.1）。
6. トーストの面は `--toast-bg` / `--toast-fg`（反転面）、副文字は `--toast-fg-2`。z-index は `--z-toast`（dialog より上。Undo を常に押せるように）。

トーストの文面（i18n キーは `toast.*`。値は ja）:

| id | 種類 | 文面 | 操作 |
|---|---|---|---|
| `accept.done` | undo | 反映しました — {n} files を作業ツリーへ（未 commit）· 設計書 {m} ブロック · checkpoint {ref} | ［元に戻す ⌘Z］ |
| `accept.patch` | success | `.patch` を書き出しました（読み取り専用の workspace）{path} | ［パスをコピー］ |
| `reject.pending` | undo | 却下しました — {th} | ［元に戻す ⌘Z］ |
| `undo.done` | success | 元に戻しました（checkpoint から復元 · 設計書も R{n} に戻しました） | — |
| `gen.firstBlock` | info | §0 ひとことで が届きました · 最初の文まで {s} 秒 | ［読む g d］ |
| `gen.done` | success | 生成しました — 入力 {in}（cache {c}）· 出力 {out} · {usd} · {dur} · 見積との差 {delta} | ［5 分コース →］ |
| `gen.prioritized` | info | §{id} を先に生成します（次の空き枠） | — |
| `copy.prompt` | success | プロンプトをコピーしました（≈{k} tok） | — |
| `copy.permalink` | success | リンクをコピーしました | — |
| `draft.offline` | warn | daemon に接続できないため、下書きをこのブラウザに保存しました | — |
| `trust.pending` | warn | repo の gate {n} 件が承認待ちです（未承認の gate は skip されます） | ［確認する］ |
| `notice.<key>` | SSE `notice` の level に従う | サーバの i18n キー | — |
| `hint.imeOn` | info | 日本語入力がオンのため、1 文字のショートカットは効きません。英数入力に切り替えるか ⌘K を使ってください | — |

### 3.6 レイヤーとフォーカス

- **Escape は 1 本の LayerStack**（`ui.ts LAYER_ORDER`）で処理する: menu → popover → dialog → palette → seltool → composer → ctxMode → selection → zoom の順に、開いている最上位の 1 つだけを閉じる。IME 変換中の Escape は何もしない（§8.6）。
- dialog（ヘルプ・テキストで見る・trust・Finish・確認）は `<dialog>` + `showModal()` + `aria-modal="true"`。背面は `inert`。閉じたら `returnFocus` に戻す（パレットも同じ。戻さないと直後の単一キーが見えない入力欄に吸われる — Editorial §3.5 の不具合）。
- popover（peek・用語・見積りの内訳）は focus を奪わない（`aria-describedby` で結び付ける）。キーボードでフォーカスした出典チップでは即時に開き、Escape で閉じ、Tab で中のリンクへ入れる。
- フォーカス表示: `:focus-visible { outline: var(--focus-w) solid var(--focus-ring); outline-offset: var(--focus-offset) }`。マウス操作では出さない。
- skip link: body 先頭に「本文へ移動」（`--z-skip`。フォーカスで表示）。

### 3.7 帯（banner）の規則

ヘッダー直下に最大 1 本（優先度: stopped > auth_expired > version_mismatch > retrying > billing_overage > yield_5h）。高さ 32px、`--c-warn-bg` / `--c-bad-bg` + 対応する前景、左に glyph、右に操作。複数あるときは優先度の高いものだけを出し、残りはステータスバーのアイコンで示す。

| 帯 | 条件 | 文面 | 操作 |
|---|---|---|---|
| billing_overage | `window.billing === "overage"` を観測 | サブスクの枠を超え、従量で課金されています。background の生成を止めました | ［詳細］［API key mode の設定］ |
| yield_5h | `GenRun.paused.reason === "yield_5h"` | 5h 枠が 80% を超えたため、生成を一時停止しています · {HH:MM} に自動で再開 | ［今すぐ再開］（確認つき） |

### 3.8 タブのタイトル・favicon・デスクトップ通知

- `document.title` = `{ページ名} — mitori · {workspace}`。
- タブが非表示の間に 20s（`hiddenTabBadgeMs`）以上かかった job が ready / answered / failed になったら、タイトル先頭に `(n) ✓` / `(n) ✕` を付け、favicon（inline SVG）に `--c-prop` の点を足す。タブが表示されたら消す。
- 初めて 60s 以上の job が出たとき（`UiSettings.notifyOnDone === null`）だけ、カードの中に「完了したらデスクトップ通知しますか？［通知する］［しない］」を出す（読み込み時には聞かない）。

---

## 4. 画面仕様

### 4.0 共通の状態語彙

どの画面・部品も次の状態を持ち、**空白の画面を出さない**。

| 状態 | 定義 | 見せ方（共通規則） |
|---|---|---|
| empty | 取得済みで 0 件 | 1 行の説明 + 次の行動（ボタンかキー）。イラストは出さない |
| loading | 取得中 | 最終寸法の skeleton（`--paper-2` の面、角丸は実物と同じ）。1s 未満は文言なし、1s 以上で「読み込み中…」を skeleton の中に出す。スピナーは使わない（ジョブのステージ行の回転 glyph だけ例外） |
| streaming | 内容が流れ込み中 | 確定した単位（block・回答の段落）だけを描き、最後の未確定部分は平文 + caret。高さを予約する（§4.3.9） |
| error | 取得・操作の失敗 | 主内容の失敗はその場のエラーカード（`errorText`、［再試行］、`requestId` は「詳細」に）。トーストだけで済ませない。副次的な失敗（prefetch など）は黙って捨てる |
| stale | 引用したコードが変わった（`freshness: "stale"` / verdict `stale`） | `⚠ 古い可能性` バッジ + 変わったファイル名 + ［この節だけ再生成 ≈k］ |
| outdated | アンカーが付け直せない（`anchorHealth: "outdated"`） | `▲!` + 元の位置のスナップショット（引用を灰で）+ ［新しい位置を指定］ |
| static_only / placeholder | 生成していない節 / block | 静的事実（export 一覧・LOC・依存・facts）+ 点線枠の「生成する ≈{k} tok」ボタン。空欄にしない |
| offline | 接続 retrying | §2.4 の帯。読む操作は続く。書き込みボタンは `aria-disabled`（押すと理由を tooltip） |
| readonly | viewer / remote-readonly | 操作を隠すのではなく、無効の理由を 1 行で出す（viewer では Composer 自体を出さない） |

### 4.1 S0 Launcher

- レイアウト: 中央 720px の 1 列。上から 明朝 34px「見取り図」/ 入力欄（`パス または https://github.com/owner/repo`、高さ 44px）+［開く ⏎］/ 最近の workspace（`GET /workspaces`、`last_opened` 降順）。
- カード（1 行 64px、roving tabindex、↑↓ で移動、Enter で開く）: `{名前}`（600）· 種別バッジ · `{root}`（mono 12px、中央を省略）/ 右に `生成済み 3 日前 · 標準` または `未生成`、`⚠{staleBlocks}`、`●{openThreads}`、`◐{runningJobs}`、`HEAD より {commitsBehind} commit 古い`（null なら出さない）。
- 開く: `POST /workspaces {target}` → `WorkspaceSummary` → `/w/:ws`。エラー: `E_WS_NOT_FOUND`「そのパスは見つかりません」、`E_GIT_CLONE_FAILED`「clone できませんでした。`gh auth login` 済みか確認してください」［コマンドをコピー］、`E_INVALID_INPUT`「パスか GitHub の URL を入力してください」。入力欄の下に `role="alert"` で出す。
- empty: 「まだ開いた repo はありません。ターミナルで `mitori <path>` を実行するか、上の欄にパスを入力してください」。
- `mitori`（引数なし）はカレント repo を直接開く（S0 は経由しない）。

### 4.2 S1 見取り図

#### 4.2.1 構成（≥ 1281。JUDGEMENT §5・§6.3.1）

```
┌ header 52 ─────────────────────────────────────────────────────────────────────────────┐
├ rail 248 ─────┬ strip ≤ 96 ───────────────────────────────────────────┬ right 400 ──────┤
│ 30分コース     │ スキャン完了 · 1,219 files を 0.27 秒で索引 · ここまで 0 tok │ ① 生成の見積り   │
│ 目次（状態・≈k）│ crit（明朝 34）Go · 45.7k LOC · MIT · 406875d · 10/02      │ ② 0 tok で今できること│
│ 生成メタ       ├ stage（床面図）──────────────────────────────────────┤ ③ 静的に分かったこと │
│               │ HUD:［コメント ✓］［AI 作業中 ✓］［表示 ▾］             │ ④ S0〜S4 の所要時間 │
│               │                 …部屋・扉・外部アクター・ピン…          │ ⑤ README の 1 行目  │
│               │      ［文脈 Z0｜区画 Z1｜部屋 Z2｜コード Z3］ − + ⤢       │                 │
└───────────────┴──────────────────────────────────────────────────────┴─────────────────┘
└ status 24 ─────────────────────────────────────────────────────────────────────────────┘
```

- **strip**（≤ 96px）: 1 行目 kicker（12.5px `--muted`、先頭に `--c-ok` の点）「スキャン完了 · {files} files を {s} 秒で索引 · ここまで 0 tok」。生成後は「生成済み · {M} tok · {usd} · {dur}」。2 行目 題名（明朝 34px / 600）+ メタ（言語 · LOC · ライセンス · HEAD7 · 日付、12px `--muted`）。退避中（§4.2.6）は 3 行目に「間取り図にできない構成のため依存図で表示しています」。
- **stage**（残り全部、1440×900 で高さ ≥ 700px。AC-J01）: 床面図 SVG。背景は `--paper` + 16px の点格子（`--rule`、装飾）。
- **HUD**（左上、3 つだけ）: ［コメント ✓］（ピンの表示）、［AI 作業中 ✓］（AI 枠）、［表示 ▾］（menu: 変更頻度 / 鮮度 / 依存線（すべて）/ 凡例 / テキストで見る）。チップは 28px 高・12px。
- **ズームバー**（下端中央）: segmented `文脈 Z0｜区画 Z1｜部屋 Z2｜コード Z3` + `−` `+` `⤢`（fit）。各 28×28 以上。
- **右列 400px**（スクロール。上から）:
  1. **生成の見積りカード**（§4.2.4）。生成中は進捗に置き換わる（§4.2.5）。生成後は 1 行「生成済み 0.39M tok · $1.27 · 6分12秒 · {n} files 変更で {m} 章が古い可能性［読む ⏎］」。
  2. **0 tok で今できること**（生成後は出さない）: 「見取り図を歩く（部屋をクリック）」「静的な節を読む（§4 動かしてみる · §5 コードの地図 · §8 外部インターフェース · §11 リスク）」「見積りを見る」。各行はリンク。
  3. **静的に分かったこと（0 tok）**: 2 列 × 3 枚。エントリポイント（{n}）· HTTP ルート · 環境変数（名前だけ。値は出さない）· CLI コマンド · テスト関数 · TODO/FIXME。数は `ScanSummaryView.facts`、各カードは該当節へのリンク（§8 / §4 / §11）。
  4. **S0〜S4 の所要時間**（mono 12px）: `S0 列挙 1,219 files · blob sha 13 ms` … `S4 repo pack 9.8k tok 41 ms`。
  5. **README の 1 行目**（原文のまま、明朝 italic 16px、左 2px `--rule-2`）+ 注記「原文のまま（生成すると日本語の要約に置き換わります）」。
- rail: 読書パスのカード（生成前は「生成すると 30 分コースが使えます」と淡色で）、目次（§4.3.2 と同じ行の書式）、下端に生成メタ（§4.3.2-4）。

#### 4.2.2 部屋の選択（JUDGEMENT §6.3.2）

| 入力 | 結果 | 予算 |
|---|---|---|
| 部屋に 300ms hover | L0 の 1 行要約カード（popover、`--z-popover`）。生成前は「{files} files · {LOC} · test {n} · 主なシンボル 3 個」 | 表示 140ms |
| 1 回クリック / Enter（フォーカス中） | **選択**: 関係のない部屋の床を opacity .5（ダーク .72 相当の `--plan-floor` 混色）に落とし、その部屋に出入りする依存だけを描く。右列の先頭に**部屋カード**（`RoomCardProps`）を出し、見積りカードを 1 行に畳む。URL に `?room=<id>` を `replaceState` | ≤ 100ms（AC-J07） |
| 2 回目の Enter / ダブルクリック | S2 の該当節へ（部屋の `ref.section`）。生成前の節なら S2 の placeholder | p95 ≤ 100ms |
| Escape | 選択解除。もう一度で 1 段ズームアウト | — |
| 矢印（部屋にフォーカス中） | roving tabindex で隣の部屋へ（区画内は Fiedler 順、区画をまたぐと次の区画の先頭） | — |
| 矢印（stage にフォーカス、部屋なし） | パン（1 回 48 画面 px、Shift で 192） | — |

- 部屋カードの中身: `区画 › 部屋名`（生成前は静的なパス）、L0 の 1 行要約、鮮度バッジ、スレッド数、［§6.4 を読む ⏎］、この部屋を通る流れ（`§3.1 ⑤⑥` のリンク。押すと流れを重ねる）、未生成なら［先に生成 ≈{k} tok］（`POST /gen/prioritize` か、run が無ければ scope 付き見積り）。

#### 4.2.3 床面図の描き方とズーム（JUDGEMENT §6.3.3 の数値をそのまま採用）

- 要素（建物・区画 ≤ 5・部屋 9〜24（上限 40）・扉・外部アクター・ピン・AI 作業枠・流れ）と色は JUDGEMENT §6.3.3 の表と `design-tokens.css` の `--zone-*`・`--pin-*`・`--ai-frame`・`--gen-ring`・`--dep-line`・`--flow-tag-*`。ノイズ箱は `--noise-floor` + 45° の斜線 pattern（色だけに頼らない）。
- ラベルは画面上で一定（部屋名 13px / パス 11px / 規模 11px）。表示する情報は部屋の画面上の大きさで `ui.ts ROOM_LOD`（xxs / xs / sm / md）、`lg`（≥ 330×225）で Z3 の家具（主要ファイル ≤ 5 と行数、シンボル）。名前の推定幅が部屋幅を超えたら短い名前（`sn`）。ラベルは部屋の矩形で clip（AC-J06）。
- ズーム段: `k = s / s_fit`。Z0 `k < 0.62` / Z1 `k < 0.9` / Z2 既定 / Z3 = 見えている部屋のどれかが `lg`。段の切替は opacity 200ms（`--dur-lod`）だけ、DOM は作り直さない（class の付け替え）。カメラ移動は 300ms ease-out（倍率は対数補間）、reduced-motion では即時。
- 入力: ホイール = パン、⌘/Ctrl + ホイールまたはピンチ = カーソル中心のズーム（`s' = s · exp(−deltaY · 0.0022)`、`k ∈ [0.25, 4]`）、ドラッグ = パン（pointer capture。部屋の上でも 4px 以上動いたらドラッグ扱いで選択しない）、ダブルクリック = その部屋を Z3 まで寄せる、`=`/`-`/`0` = 段の 1 つ上 / 下 / fit、HUD のボタン。どの経路でも同じ段に着く（AC-J05）。
- **性能の規則**（JUDGEMENT の 3 規則 + 本書）:
  1. SVG は `DiagramLayout` から**文字列で 1 回だけ**生成して `innerHTML` に入れる（`views/map/render.ts` の純関数）。カメラはルート `<g>` の `transform` と CSS 変数 `--inv-s` だけを書く。ラベルは `transform: scale(var(--inv-s))`（`transform-box: fill-box`）。
  2. LOD class の再計算はアニメーションの終了時と、ホイール / ピンチ中は 100ms ごとだけ。
  3. Z3 の家具は選択中の部屋と `lg` の部屋だけに遅延生成し、作ったら保持する。床面図の SVG ノードは 40 部屋で ≤ 1,500 [仮]。
  4. ピン層は別の `<g>` で、スレッドが変わったときだけ文字列で描き直す（≤ 100 ピン）。
  5. イベントは SVG ルート 1 か所の委譲（`data-node` 属性）。
- **流れ**（`Shift+1〜5` か、部屋カード / §3 の節の「地図で見る」）: §3.n の手順と同じ番号の札（`--flow-tag-bg` の角丸矩形。ピンのしずく形と区別）で矢印を重ね、ピンと AI 枠を 30% に薄める。往復の組は反対側へ膨らませ 70 単位以上離す。もう一度押すと消す。データは `SectionView.mapFlow`（§16 R4）。
- **ピン**: thread の `Anchor.diagram`（node）か、doc アンカーの block が属する部屋（`DiagramRef.section`）。しずく形に番号、色と形で状態（open `--pin-open` / AI 作業中・提案 `--pin-ai` / outdated `--pin-outdated` / 解決 `--pin-resolved`、解決は［コメント ✓］の menu で「解決済みも表示」を選んだときだけ）。クリックでそのスレッドを S2 で開く。
- **AI 作業枠**: `job.event` の phase が届いている job の write scope のファイルが属する部屋に、`--ai-frame` の点線枠（1.5px、dash 4 3）を 1.6s で脈動。reduced-motion では静的。

#### 4.2.4 生成の見積りカード（JUDGEMENT §6.11。カードそのものが確認）

1. 題「設計書を生成する」（明朝 18px）。
2. effort の 3 タイル（radiogroup、各 1/3 幅）: `概要 ≈0.12M tok · $0.4 · 約2分` / `標準 推奨 ≈0.4M · $1.3 · 約6分` / `完全 ≈1.1M · $3.6 · 約17分`。値は `POST /gen/estimate {effort}` ×3 を並列に取った `GenEstimate`（`inTokens + cacheReadTokens + cacheWriteTokens + outTokens`、`apiUsd`、`seconds.p50`）。既定は cookie `ef` → `WorkspaceOverrides.defaultEffort` → `GlobalSettings.defaultEffort`。選択中は下端 2px `--ink`。切り替えは取得済みの値で再描画（≤ 16ms、AC-J47）。
3. **主行**（ボタン込み 1 行、高さ ≥ 58px）: `標準: 約0.4M tok · API換算 $1.3 · 約6分`［生成 ⏎］（primary ボタン 104px 以上）。
4. 補足 1 行（12px、`--muted`）: `claude-cli（あなたのサブスク）· C=3 · 5h 枠 23% → 推定 34% · 80% を超えたら自動で一時停止`。`windowDeltaPct === null` なら「5h 枠: 未較正」。
5. ［内訳と経路 ▾］（初めて・標準では閉、詳しいでは開）:
   - stage 表 `stage · model | in / out | $ | 時間`（`GenEstimate.stages`）。overview 行に「* クリティカルパス（並列度を上げても短くならない）」（`criticalPathSeconds`）。
   - engine の radio: `claude-cli（C=3 · 約6分）` / `session（自分の Claude Code で mitori gen --prep · C=1 · 約17分）［--prep をコピー］` / `anthropic-api（API key · Batch −50% · $0.71）`（無効なら「未設定」+ 設定へのリンク）。値は `alternatives[]`。
   - データの扱い 1 行: `送信先: Anthropic（あなたの claude CLI 経由 · credential は読みません）· 対象 {included} files（除外 {excluded}）· 秘密情報 {k} 件を伏せ字 · 学習の扱いは plan の設定に従います［詳細］`（`dataPolicyKey` → `policy.<key>`）。
   - `見積りは index digest {8 桁} で 10 分有効`。
6. **高さの固定**: カードの「内訳 / 進捗」の領域は、2 つの状態の大きい方の高さを初回描画時に `min-height` で確保する（Editorial で CLS 0.0056 → 0.0001 [実測]）。
7. ［生成］の 1 クリック（または Enter）で:
   1. `privacy.dataPolicyAck[engine]` が無ければ、同じクリックで `PATCH /settings` に現在時刻を記録（カードの開示行を読んだことの記録）。
   2. `POST /gen/runs {estimateId, confirm: true}`。`E_PRECONDITION`（見積りの期限切れ / index が変わった）なら見積りを取り直し、主行の数値を更新して**もう一度押してもらう**（黙って実行しない）。`E_BUDGET_EXCEEDED` は「1 回の生成の上限 ${genRunMaxUsd} を超えます［上限を変更］［範囲を絞る］」。
   - 別の確認ダイアログは出さない（D3、AC-J47）。例外: `confirmReasons` に `billing_overage`（赤の注意 + チェックボックス「従量で課金されることを理解しました」を押してから有効）、`api_key_billing`（「従量課金: 今月 ${a} / 上限 ${c}」を主行の下に）、`window_risk`（§16 R11。主行のボタンを 4 択に分割: ［今すぐ生成］［リセット後（{HH:MM}）に開始］［session で実行］［範囲を絞る］）。
8. engine = `session` のとき: ボタンは［コマンドをコピー］（`mitori gen --prep --effort {e}`）になり、下に手順 3 行「1 このコマンドをターミナルで実行 → 2 表示された README を Claude Code に渡す → 3 `mitori gen --ingest <id>`」。ingest で block が届き始めたら進捗に切り替わる（`doc.block.upsert` の `gen.engine === "session"`）。

#### 4.2.5 生成の進捗（同じカードを置き換える）

- 4 列のカウンタ（mono、tabular-nums）: `入力 {in} / ≈{est}`、`出力 {out}`、`API換算 ${usd} / ≈${est}`、`経過 {m:ss} / 約{分}`。値は `gen.run` の `usage`（確定値のみ）。
- stage の行: `modules · claude-sonnet-5-5 ×3 並列 5/14` のように stage ごとに 1 行（`gen.task` を集計）。進み具合は「済 / 全」の数字だけ（細い線のメーターは「済 / 全」の比をそのまま描く。時間の推定を混ぜない）。
- tail 1 行: `Read internal/session/watch.go · §5`（最新の task の phase detail）。
- 床面図: 対象の部屋に `--gen-ring` の枠を脈動（reduced-motion では静的）、完了で ✓（高さ 60 画面 px 未満の部屋には出さない）。目次の記号が ○ → ◐ → ✓ に変わる。
- 最初の block が届いたらトースト `gen.firstBlock`（Pro）。完了で `gen.done`。
- ［一時停止］［中止］はいつでも押せる（`POST /gen/runs/:run/control`）。中止しても確定済みの block は残る。一時停止中の理由（`paused.reason`）は行で明示: `user` 一時停止中 / `yield_5h` 5h 枠 80% 超のため · {HH:MM} に再開 / `rate_limit` 送信制限のため待機中（{s} 秒）/ `billing_changed` 課金区分が変わったため停止（帯 §3.7）。
- 生成中に目次の待機中の章（○）をクリック → `POST /gen/prioritize {section}` → トースト `gen.prioritized`（≤ 100ms。AC-J48）→ その章へ移る（placeholder の中に「次に生成します」）。

#### 4.2.6 退避（品質ゲート不合格）と「テキストで見る」

- `MapView.fallback === "container"`（§16 R3）なら、stage は ELK layered の Container 図（レーン付き）を同じ SVG 部品で描く。部屋の選択・ピン・流れ・ズームの段（Z0〜Z2）は同じ操作で動く（Z3 は無い）。rail の縮図と Review の縮図は出さない。
- 「テキストで見る」（`表示 ▾`、⌘K、`?text=1`）: `<dialog aria-modal="true">` に 3 つの表。(1) 区画 → 部屋 → 主要ファイル（LOC）の木（`<table>` + `<th scope>`）、(2) 扉 `{A} → {B}（import {n} 本）`、(3) 外部アクター `{actor}: {関係ラベル}`。SVG 本体は `role="img"` + `aria-describedby="<この dialog の要約段落>"`。キーボードだけで開閉できる（AC-J16）。

#### 4.2.7 S1 の状態

| 状態 | 表示 |
|---|---|
| scanning | §2.4。stage は建物の外形 + 部屋の skeleton。右列は skeleton |
| scan failed | stage の中央にエラーカード（`scan.failed` の `error`）＋［再スキャン］ |
| 対応言語のファイルが 0 | strip「対応言語のファイルが見つかりません（generic 表示）」。床面図は directory の木で作る（server 側） |
| generating | §4.2.5 |
| generated | 見積りカードは 1 行に。部屋に hover すると生成済みの L0 要約 |
| stale | strip に「{n} files 変更で {m} 章が古い可能性［読む ⏎］」。［表示 ▾ → 鮮度］で部屋に `--c-warn` の点線枠 |
| 1280×800 | 右列 360px。見積りカードを 1 行に畳んだ状態で始める（JUDGEMENT §11-9 の測定で確定）[仮] |

### 4.3 S2 設計書 Reader

#### 4.3.1 レイアウト

```
┌ header ───────────────────────────────────────────────────────────────────────────────────┐
├ rail 248 ──────┬ prose 列（37em 中央、左ガター 28）─────────────────────────┬ 文脈列 --ctx-w ──┤
│ 縮図 200×120    │ 3（明朝 15, --faint）                                         │ margin: スレッド  │
│ 30分コース 3/7  │ 主要な流れ（明朝 34）                                           │ / Composer / ジョブ│
│ 目次            │ 約9分 · 確認済 12 · 推測 2 · 406875d · claude-sonnet-5-5       │ （段落の高さ）     │
│ 生成メタ        │ ─ この章で分かること ─ 1 … 2 … 3 …                           │ code: Split view │
│                │ 本文 …［daemon.go:178］… 推測 …                               │ review: 640px    │
│                │ ▸ なぜ … 推測   ⚠ 落とし穴 …   ▸ Deep Dive …                │                  │
│                │ まとめ / 次へ（pager）                                          │                  │
└────────────────┴────────────────────────────────────────────────────────────────┴──────────────────┘
```

#### 4.3.2 rail

1. **縮図**（200×120、`--minimap-*`）: 床面図のサムネイル（S1 の SVG 文字列を `viewBox` だけ変えて再利用）。現在のページのモジュールの部屋を `--c-prop-bg` で塗る。クリック / Enter → その部屋を選択した S1。退避中の repo では出さない。
2. **読書パスのカード**: リング（34px、`stroke-dashoffset`）+ `30分コース ▾`（menu で 5 分 / 30 分 / レビュアー / PM / SRE / repo 定義）+ `{読了} / {全体}` + `残り約 {分} 分 · 追加 0 tok` + `次: §x`（リンク）。§7.2。
3. **目次**: 各行 `{番号} {題} {スレッド数バッジ} {分 or ≈k} {状態}`（13px、行の高さ ≥ 28px）。状態の記号（SVG + `aria-label`）: ✓ 生成済 / ◐ 生成中 / ○ 待機（`≈{k}` を出す。§16 R14）/ □ 静的（0 tok）/ ⚠ 古い可能性。現在のページは左に 2px `--accent` + 600。既読は番号の前に 5px の点（`--muted`）。§6 は子（モジュール）を折りたたみで出す。
4. **生成メタ**（下端、12px、`--faint` on `--paper`）: `生成 6分12秒 · 0.39M tok · $1.27` / `網羅 393 / 1,219 files` / `.mitori/ · commit は opt-in`（`mitori init` 済みなら `commit 対象`）。

#### 4.3.3 章の頭と終わり

- 頭: 節番号（明朝 15px、`--faint`、`oldstyle-nums`）→ 題（明朝 34px / 600 / 1.35 / `.02em`、`word-break: auto-phrase; text-wrap: balance`）→ メタ行（12px `--muted`、区切りの `·` は `aria-hidden` の span）`約{n}分 · 確認済 {v} · 推測 {i} · {commit7} · {model}`（推測が 0 なら省略。stale があれば `⚠ 古い可能性 {n}` を足す）→「この章で分かること」（`kind: "learn"`。上下に 1px の罫線、番号は明朝）。
- 終わり:「まとめ」（`kind: "recap"`、`--paper-2` の面）→ pager（右寄せのカード: `次へ · 30分コース 4/7 →` / `§4 動かしてみる`。読書パス外のときは目次順の次）。

#### 4.3.4 block の描画（サーバ HTML と client の chrome）

- サーバ HTML（`HTML_CONTRACT`）の root `div.mb[data-block][data-kind][data-depth][data-fresh][data-lock]` を、client の wrapper `div.blk` が包む: `<div class="blk" data-b={id} data-depth data-kind data-ln={mdLine} tabindex="-1">{@html view.html}</div>`。wrapper は anchor テキストの外にある。
- **client が `.mb` の内側に足す要素には必ず `data-mx` を付ける**（`ANCHOR_TEXT_RULES.excludeSelectors`。付けないとアンカーの offset がずれる）。足してよいのは: 推測などの確認ボタン（`button.vsum[data-mx]`、問題のある claim を含む block だけ）と、日本語以外の block の「訳を表示」リンクだけ。
- **バッジは疑似要素で描く**（DOM ノード 0）: `.mc[data-verdict="inferred"]::after { content: var(--t-verdict-inferred) }` など。`--t-verdict-*` は i18n の起動時に `:root` に書く（UI 言語で表示。疑似要素は textContent に入らないので anchor 計算に影響しない。アクセシブルネームには含まれる）。
- **疑似要素の割り当て**（どれも DOM ノード 0）: `.blk::before` = 左 2px の状態の帯（フォーカス・スレッド付き・AI 作業中・changed）/ `.blk::after` = 採用の flash の面（flash の間だけ）/ `.mb::before` = ガターの ✓（`content: var(--glyph-check)`。client が decorate で wrapper に付ける `data-v="verified|human"` を見て、表示条件は §4.3.5）/ `.mb::after` = 詳しいレベルの Markdown 行番号（`content: "L" attr(data-ln)`。`data-ln` はサーバが `.mb` に付ける — §16 R15）。`.mb` の疑似要素は `.blk`（`position: relative`）を基準に左ガターへ置く。
- **ブロック操作は共有の浮遊ガター 1 個**（Δ10）: hover / フォーカス（`j`/`k`）中の block の左ガターへ移動して出す。縦 3 ボタン（コメント `c` / 説明 `e` / 修正 `f`）、各 28×28px、icon のみ、`aria-label`「コメント（C）」等、`title` にキー。本文に重ねない。block から pointer が出て 160ms で隠す（ガター自体に乗っていれば保持）。
- 状態ごとの見た目（wrapper の class）: hover = `color-mix(--hover 45%)` の面 / `j`/`k` フォーカス = 左 2px `--accent` / スレッド付き = 左 2px `--rule-2` / AI 作業中 = 左 2px `--c-run` が 1.6s 脈動 / 提案中 = `--sugg-bg` の面 + 左内側 2px `--c-prop`（§6.5）/ 採用直後 = 1 回だけ 1.6s の flash（`::after` の opacity、背景色そのものは動かさない）、以後 `changed`（左 2px `--c-ok` 70%）。
- kind ごとの描画規則（CSS は `styles/prose.css`）:

| kind | 描画 |
|---|---|
| heading | h2（明朝 22.5px / 600 / 1.45、番号は `--faint` の明朝）、h3（角ゴ 15px / 600） |
| prose / list | 本文（§10） |
| table | `table.ptable`、`width: calc(100% + 40px); margin: 6px -20px`、th 12px `--muted`、td 13px、数値列は `tabular-nums`。行の追加の提案は行全体を `--add-bg` |
| diagram | `figure.mdiagram[data-diagram]`。§4.3.15 |
| code | `pre.mcode.shiki`（サーバの Shiki、css-variables テーマ）。行番号はサーバが `span.ln` で出す。長いコードは `⋯ {n} 行を省略` で畳む（サーバ） |
| facts | 静的事実の表（ルート・env・CLI）。`□ 静的 · 0 tok` のタグを右上に |
| learn / recap | §4.3.3 |
| pitfall | 常に表示。`--pit-bg` の面 + 左 2px `--pit-rule`、ラベル「落とし穴」（12px `--c-bad`） |
| why | `details.why`（左 2px `--rule-2`、summary 14.5px / 600）。開閉の既定は読者レベル（§7.1）。**畳んでも summary に推測バッジを残す**（JUDGEMENT §6.4.3） |
| deepdive | `details.mdeep`（上下の罫線、L3）。summary に `Deep Dive · 約{n}分` |
| question / faq | `Q{n}`（明朝の番号）+ 本文 |
| placeholder | §4.3.10 |

#### 4.3.5 信頼の表示（JUDGEMENT §6.4.3 を 1 つの規則に）

| verdict（`VERDICT_BADGES`） | 形 | 色 | いつ見えるか |
|---|---|---|---|
| verified（コードで確認済） | ✓ | `--v-verified` | block の hover、⌥ 長押し、詳しいレベルのときだけ（左ガターの `::before`） |
| human-verified（確認済 by @name） | ✓✓ | `--v-human` | 同上。hover で「確認済 by {name}（再生成しても保持）」 |
| inferred（推測） | 〜 | `--v-inferred` | **全レベルで常に**。claim の下 38% に `--c-guess-bg` の帯 + 末尾にバッジ |
| stale（古い可能性） | ⚠ | `--v-stale` | 常に |
| unsupported（裏付けなし） | ✕ | `--v-unsupported` | 常に |

- block のバッジは claim の最悪値（unsupported > stale > inferred > verified > human-verified）と件数。章のメタ行に件数。
- **推測を確かめる**: 推測の claim をクリック（または block の `button.vsum` をフォーカスして Enter）→ popover「推測 — この主張はコードで直接確認できていません」+ 3 択:
  1. ［確認済にする］→ `POST /doc/blocks/:block/verify {verified:true}`（`human-verified` ロック、再生成しても保持）。楽観的に ✓✓ にし、失敗したら戻す。
  2. ［AI に確かめさせる ≈2k］→ intent `question` の Composer をその claim のアンカーで開き、本文に定型文「この主張がコードで正しいか、出典を示して確かめてください」を**下書きとして**入れる（送信は人）。
  3. ［専門家に聞く］→ intent `note` の Composer（宛先なし。Finish / Pull で人や agent に渡る）。
- 節の L1 合格率が 70% 未満（gen spec §7.4 `lowGrounding`）なら、章のメタ行に `根拠の弱い記述が多い` チップ（`--c-warn`）。

#### 4.3.6 出典チップと peek（JUDGEMENT §6.4.4）

- 書式（サーバが全レベル分を出し、CSS で切り替える。`.mcite` の中に `span.cs`（短）と `span.cl`（長）を持つ — §16 R15）: 初めて = 文中のチップを隠し、段落末に `出典 {n}`（クリックで一覧の popover、項目から peek）/ 標準 = `{base}:{line}` / 詳しい = `{dir/}{base}:{a}–{b}`。⌥ を押している間は全レベルで文中のチップと verified の ✓ を全部出す（`html.show-cites`）。
- 見た目: mono 11px、高さ 20px（`--cite-h`）、`--muted` on `--sheet`、1px `--rule`、角丸 4px。当たり判定は `::after { inset: calc(-1 * var(--cite-hit-ext)) -2px }` で 26px（AC-J11）。`aria-label`「出典 {path} {a}〜{b} 行」。
- peek（`CitePeekProps`）: **チップに接して**下に出す（上に余地が無ければ上）。幅 560px、本体の最大 26 行（範囲 ±3 行、`peekContextLines`）、範囲の先頭が本体の上から 40px に来るようスクロール。ヘッダー `{path} :{a}–{b} · {symbol} · 正確（symbol index）| 推定（文字列検索）· {blob7}`。本体はサーバの Shiki HTML（`GET /cite`、65ms の hover intent で先読み、LRU 100）、引用範囲は `--mark-line` の面 + 行番号列に 2px `--accent`。フッター `確認済 範囲は実在 · 識別子一致 · hash 一致`（L0 / L1 / L2 の結果。落ちた項目は `--c-warn` で「識別子が範囲に無い」等）と `o 横に固定 · ⇧O エディタで開く · Esc`。`CitePeek.stale` なら先頭に `⚠ この範囲は変更されています（{currentBlob7}）`。
- 開閉: hover 300ms ±30ms（AC-J23）で開き、pointer が peek に移っても閉じない（160ms の猶予）、Escape で閉じる。キーボードのフォーカスでは即時に開く。タッチ: タップで開いて固定、2 回目のタップで `code` モード（bottom sheet）[仮]（JUDGEMENT §11-7）。
- `o`（チップにフォーカス / hover 中、または peek の「横に固定」）→ 文脈列 `code` モード（§4.4）。`⇧O` → `UiSettings` のエディタ（§16 R21）の URL `vscode://file/{abs}:{line}` / `cursor://file/{abs}:{line}`。未設定なら設定へのリンク。

#### 4.3.7 用語・Why・落とし穴・Deep Dive

- 用語 `abbr.mterm[data-term]`: 点線の下線（4px 周期・1px、`--muted`）。下線の出し方は読者レベル（§7.1）。hover / focus 300ms で用語カード（320px）: `{語}`（16px/600）`{よみ}`（12px `--muted`）/ `{英語名} · {romaji}` / 定義（13px）/ `使用 {n} 箇所 · {出典チップ}` / ［用語集で開く］。データは、その節で使う用語の `GlossaryEntry`（`GET /doc` は件数 `glossaryCount` しか持たないため、節の取得に同梱してもらう — §16 R16）。
- Why・落とし穴・Deep Dive は §4.3.4 の表。「詳しく（n）」チップ: 初めてレベルで隠れた L3 block の数 n を、その位置に点線のチップで出す（クリックでその場だけ展開。レベルは変えない）。

#### 4.3.8 読書パス

- 進捗: 各ステップ（節）の末尾に不可視のマーカー（`div[data-mx][aria-hidden]` ではなく、wrapper の外の `span.read-mark`）を置き、IntersectionObserver で viewport の下 20% を越えたら既読にする。既読は `localStorage` `mitori:read:<ws>:<pathId>`（`{section: at}`、try/catch。失敗しても動く）。
- リング・`n/7`・残り時間（`readingSec` の合計）・pager の「次」（§4.3.3）。読書パスは既存 block の選び直しなので追加 0 tok（D-3）。

#### 4.3.9 生成の streaming を Reader で見る（CLS 0 の算法）

生成中のページを開いていると、`doc.block.upsert` と `doc.block.partial` が流れ込む。次の「予約して消費する」規則で、見えている内容を動かさない（AC-J48: CLS < 0.01、目標 0）。

1. **予約**: 生成中の節（`SectionNode.state ∈ {pending, generating, partial}`）の未生成部分を、1 つの領域 `div.mstream` にまとめる。`min-height: H_est`。
   - `H_est = clamp(outTokens × cpt / cpl × lh, 120, 2400)` px [仮]。`outTokens` は節の見積り（§16 R14 `SectionNode.est.outTokens`、無ければ 600px 固定）、`cpt` = `CHARS_PER_TOKEN["claude-v5"].markdown_ja`（1.25）/ en 2.87、`cpl` = 37（ja）/ 70（en）字、`lh` = 30.4px（16 × 1.9）。
2. **消費**: block が確定するたびに `.mstream` の中に順に追加し、未確定の最後の block は平文 + caret（`--c-run` の 6×13px、`steps(2)` で点滅。reduced-motion では静止）で `.mstream` の末尾に出す。`min-height` は H_est のまま（中身が H_est を超えるまで領域は伸びない）。
3. **超過**: 中身が H_est を超えて領域が伸びるときは、§4.3.9-5 のスクロール補正をかける。
4. **完了**: `min-height` を外すと領域が縮みうる。領域が viewport の上にあれば縮めて `scrollBy(0, −Δ)` で補正、viewport の中にあれば**領域が画面外に出るまで縮めない**（IntersectionObserver）、下にあればそのまま縮める。
5. **スクロール補正**（SSE による DOM 変更すべてに共通。Safari は `overflow-anchor` を持たないため手で行う）: 変更の直前に「viewport 上端（header 下）以降で最初に見えている block」の `top` を記録し、変更を同じフレームで適用した直後に測り直して、差 Δ があり、かつ変更点がその block より上なら `window.scrollBy(0, Δ)`。Chrome / Firefox でも同じ処理を行い（`overflow-anchor: none` を `.prose` に指定して二重補正を防ぐ）、結果を揃える。
6. 生成中の節の先頭には `◐ 生成中 · Read internal/session/watch.go`（tail）を 1 行出す。

#### 4.3.10 placeholder と静的だけの節

- placeholder block（`BlockStatus: "placeholder"`）: 点線 1px `--rule-2`、角丸 10px、padding 18/20px。左に説明「{module} はまだ生成していません。静的に分かったこと: export {n} · LOC {loc} · 依存 入{a} 出{b}」、右に［生成する ≈{k} tok］（`POST /gen/estimate {effort, scope:[section]}` を押した時点で取り、ボタンのラベルを `≈{k} tok · ${usd}` に更新して 2 回目のクリックで実行。on-demand は確認を兼ねる — gen spec §9.8）。
- `static_only` の節: 章のメタ行に `□ 静的 · 0 tok`。

#### 4.3.11 鮮度と再生成の提案（S9 の UI）

- `doc.freshness` を受けたら、該当 block の `data-fresh` を更新し（保存から ≤ 50ms、`mitori:stale:badge`）、章のメタ行に `⚠ 古い可能性 {n}`、目次の行に ⚠。
- 章の頭（メタ行の下）に 1 行の提案帯: `⚠ {files} の変更で、この節の {n} 件の記述が古い可能性があります ［この節だけ再生成 ≈{k} tok］［設計書を同期 ≈2k］［あとで］`。データは S9 の提案（§16 R12 `GET /gen/suggestions`。入るまでは outline の freshness と scope 付き見積りで代用）。［あとで］はセッション中だけ隠す。
- 実行は on-demand（ボタンを押すことが確認。100k 超ならダイアログ）。結果は**提案**（D12）として本文に出る（§6.5）。

#### 4.3.12 提案の本文表示と block の履歴

- 提案（`DocProposalView`）がある block は、本文の位置で提案モード（§6.5）。章のメタ行に `提案 {n}`。
- block の履歴（`GET /doc/blocks/:block/history`）: block のガター menu（⌘K のアクション「この block の履歴」でも）→ popover のタイムライン `R1 AI 生成（claude-sonnet-5-5）→ R2 人の編集（あなた）→ R3 AI 修正（th_17 · 採用: あなた）`。各項目の［この版を見る］で旧版を提案と同じ見た目で並べる。

#### 4.3.13 翻訳（D5）

- UI 言語と設計書の言語が違うとき（例: UI = en、doc = ja）、本文は**原文のまま**（`<article lang="ja">`）。章の頭に 1 行: `This section is in Japanese. ［Show in English ≈{k} tok］`（§16 R11 の節単位の翻訳 API。入るまでは block 単位 `POST /translate` を順に呼ぶ）。
- 訳がキャッシュ済みなら［Show in English · cached］で即時に切り替え、章ごとに `原文 / English` のトグルを出す（`GET /doc/sections/:id?lang=en`、`htmlLang` を見て `lang` 属性を付け替える）。
- 和文の本文に英語の UI 文言を混ぜない（chrome は `data-chrome`、本文は `article`）。

#### 4.3.14 やさしく（simplify）

- 初めてレベル: `BlockView.variants.easy.cached`（§16 R2）の block は、本文の直後に `--paper-2` の面で「やさしく · 初めての人向けの言い換え · 0.4k tok · キャッシュ済」を表示する。
- キャッシュが無い block は、浮遊ガターに 4 つ目のボタン［やさしく ≈0.5k］を出す（初めてレベルのときだけ）。押す → `POST /doc/blocks/:block/simplify` → 提案として届き、そのまま「やさしく版」として表示（accept すると本文になる）。

#### 4.3.15 図（`figure.mdiagram`）と外来 Mermaid

- 図の block はサーバ HTML に、図のタイトル・テキストの代替（ノード・辺の一覧、`<details>`「図をテキストで見る」）と、**図の寸法**（`data-w`・`data-h`、§16 R15）を持つ。client は `aspect-ratio: w / h` で高さを予約し、IntersectionObserver で見えたときに `diagram` chunk（≤ 5KB）を読み、`GET /diagrams/:dg` の `DiagramLayout` から S1 と同じ純関数で SVG 文字列を作って差し込む。ノードのクリックは `DiagramRef` の節・block・path へ。
- 図を含む節（`.sec.has-fig`）には `content-visibility` を付けない（Safari の SVG text 問題）。
- 外来の ```mermaid fence（repo の既存 Markdown を表示するときだけ。`pre.mmermaid`）: IntersectionObserver で見えたときに `mermaid` chunk（≤ 660KB）を読む。読み込み中は fence の原文を等幅で表示（高さは原文の行数で確保）。

#### 4.3.16 S2 の状態

| 状態 | 表示 |
|---|---|
| 節の取得中 | 章見出しの枠 + block の skeleton（BlockMeta の `readingSec` から推定した高さ: `ceil(readingSec × 8.33 / 37) × 30.4 + 14` px） |
| 節の取得失敗 | 本文の位置にエラーカード＋［再試行］。rail・文脈列はそのまま使える |
| 未生成（manifest null） | 静的な節は通常表示、AI の節は placeholder（§4.3.10）。章の頭に「この設計書はまだ生成されていません［見積りを見る］（S1 へ）」 |
| 生成中 | §4.3.9 |
| stale | §4.3.11 |
| `human-edited` の block | ガターに ✎（`--muted`）。hover「人が編集した block（再生成しても上書きせず提案になります）」 |
| `E_DOC_LOCKED` などの書き込み失敗 | 該当カードにエラー 1 行と［詳細］ |

### 4.4 文脈列（ContextColumn）— 3 モードの状態機械

右列は 1 つの要素で、モードは `margin | code | review`（`ContextColumnStore`）。S2・S3・S5 にある。S1 は固定の右列（§4.2）。

| きっかけ | 結果 | 備考 |
|---|---|---|
| S2 を開く（初めて / 標準） | `margin` | |
| S2 を開く（詳しい） | `code`（scrollspy で同期） | JUDGEMENT §11-4 の測定で既定を見直す [仮] |
| 出典チップで `o` / peek の「横に固定」 | `code`（そのチップの範囲に固定、scrollspy 停止。URL `?ctx=code&pin=…`） | |
| `code` で `o` をもう一度 / Escape | 1 つ前のモード | |
| `r`（レビュー待ちがある）/ カードの［レビュー］ | `review`（640px、rail を幅 0 に畳む） | |
| `review` で Escape / 採用 / 却下 | 1 つ前のモード（rail を戻す） | |
| 読者レベルの変更 | `review` 中は変えない。それ以外は上の既定に従う（`code` の固定中は固定を保つ） | |
| 幅 < 1024 | モードは同じだが表示は bottom sheet（§3.1） | |

**幅**（`--ctx-w`）: `margin` = 368（1024–1280: 332）/ `code` = `clamp(420px, 100vw − rail − 672px, 900px)`（計算値が 420 未満なら rail を drawer にして再計算）/ `review` = 640。`code` の幅は区切り（`role="separator"`、`aria-orientation="vertical"`、`aria-valuenow/min/max`）のドラッグか、フォーカスして ←/→ で 24px ずつ変え、cookie `cw` に保存（WCAG 2.5.7）。

#### 4.4.1 margin モード

- スレッドカード・Composer・ジョブカードを、アンカーの block の高さに置く（§6.3 の算法）。カード幅 = 列幅 − 18 − 22px。
- アンカー部分は CSS Custom Highlight（`::highlight(mitori-anchor)`、`--mark`）で塗る。**塗るのは active なカード（hover・フォーカス・Composer）のアンカーだけ**（全カードを塗ると Range の再計算が重い）。選択中の文は `::highlight(mitori-sel)`。
- アンカーの block が今のレベルで見えない（初めてで L3 が隠れた）カードは `visibility: hidden`。

#### 4.4.2 code モード（JUDGEMENT §6.2 + Pro §6.6）

- 中身（`CodePaneProps`）: sticky のファイルヘッダー（34px）`{dir}{base} [正確|推定|固定中|未 commit] … {blob7} · L{a}–{b}`、本体はサーバの Shiki HTML（`GET /files/content?…&html=1`、§16 R6。範囲 ±40 行 = `codePaneCtxLines`、マウントは ≤ 400 行）。範囲外の区間は `⋯ {n} 行を省略（{from}–{to}）`（クリックで 200 行ずつ展開、マウント上限を超える分は遠い側から外す）。
- 引用範囲は `--mark-line` + 行番号列に 2px `--accent`。文書が引用している範囲外の行（`FileContent.backlinks`）にはガターに淡い帯と `§{節}` の pill（クリックでその block へ）。
- **scrollspy**: `IntersectionObserver({root: prose 列, rootMargin: "-18% 0px -62% 0px"})` で最初に可視になった block の主出典（block 内の最初の `.mcite` の `data-cite`）を追う。同じファイル内なら class の付け替えとスクロールだけ（コード列の子ノード追加 0。AC-J22）、別ファイルなら取得して差し替え。スクロールが止まって 100ms 以内に付け替える。固定中と Composer を開いている間は止める。
- `code` モードでは margin カードを置かず、スレッドは段落の右の件数マーカー（`.blk` の外側に置く `button.mk`。`.mb` の中には入れない）、Composer とジョブカードは**対象 block の直下にインライン**で出す（1024 未満と同じ部品）。
- 採用直後（§5.2 の B12）は作業ツリーの内容（`未 commit` バッジ）を表示する。

#### 4.4.3 review モード

§4.7。

### 4.5 S3 コード

- レイアウト: rail = ファイルツリー（`GET /files/tree`、5,000 項目超で仮想化。除外ファイルは `x` の理由を灰で、`deny glob` に当たるものは錠前アイコン）/ 中央 = `CodePane` を全幅（サーバの Shiki HTML を 200 行ずつ。2,000 行超は表示中の ±1 塊だけマウントし、他は行数 × 行高の spacer）/ 右 = 「この範囲を説明している節」（`backlinks`。block の 1 行要約と ［設計書で開く］）とこのファイルのスレッド、code アンカーの Composer。
- ヘッダー: `{path}` · `{lang}` · `{totalLines} 行` · `{blob7}` · ［エディタで開く ⇧O］。
- 範囲の選択（code アンカー）: 行番号のクリック（1 行）→ Shift+クリック（範囲）、行番号のドラッグ、`⇧V` で visual mode（`j`/`k` で広げ、Escape で解除）。選択すると浮遊ツールバー（§6.1）。アンカーは `CodeAnchor {path, start, end, blob}`（`snippet` と `symbol` はサーバが刻印 — §16 R10）。
- 状態: 除外（`ExcludeReason` を `exclude.<reason>` で「生成物のため除外」等）/ 2MB 超（「大きすぎるため先頭 2MB だけ表示」）/ バイナリ（「バイナリは表示しません」）/ `E_DENY_GLOB`（「このファイルは保護対象のため表示しません（.env など）」）。

### 4.6 S4 Inbox

#### 4.6.1 レイアウト

- rail（フィルタ）: `すべて` / `あなたの番` / `作業中` / `失敗` / `outdated` / `下書き` / `解決済み`。各行に件数（mono 11px）。現在の行は `--hover` + 600 + 左 2px `--accent`。
- 中央: 見出し「Inbox」（明朝 32px）+ 説明 1 行（`あなたの番 {n} · 作業中 {m} · R{round}`）→ **上端 sticky の batch バー**（下書きが 2 件以上のときだけ）→ 一覧（`role="listbox"`、`aria-multiselectable="true"`）。
- 右（440px）: 選んだ項目の詳細（§4.6.4）。< 1024 は一覧 → 詳細の 2 画面遷移（詳細は sheet）。

#### 4.6.2 ビューと API の対応（`InboxView` → `InboxItem.tags`）

| ビュー | 含めるもの（`tags` / 状態） | ヘッダーのバッジ |
|---|---|---|
| `mine`（あなたの番） | `review` ∪ `mine` ∪ `failed` ∪ `trust` ∪ doc_edit の下書き（要選択） | **この件数**を Inbox タブに出す |
| `working`（作業中） | `working` | — |
| `failed` | `failed` | — |
| `outdated` | `outdated` | — |
| `draft` | draft thread（§16 R5 の `draft` フィルタ） | — |
| `resolved` | resolved thread（§16 R5 の `resolved` フィルタ） | — |
| `all` | 上の全部（解決済みは `h` で隠せる） | — |

`GET /ws/:ws/inbox?limit=200` を開いたときに 1 回取り、以後は SSE（`thread.upsert`・`job.upsert`・`doc.proposal.*`・`trust.request`・`gen.run`）で行を足し引きする（再取得しない）。`resync` で取り直す。

#### 4.6.3 並びと行

- 「すべて」はグループ見出し（12px、`--faint` on `--paper`、letter-spacing `--ls-caps`）で並べる: **要対応**（レビュー待ち・失敗・あなた宛て・outdated・要選択・承認待ち）→ **実行中・待機** → **下書き** → **完了** → **解決済み**。グループ内は `updatedAt` 降順。他のビューは `updatedAt` 降順だけ。
- 行（`InboxRowProps`、高さ ≥ 40px、padding 14/12/14/10）: `{状態の glyph} {題名}（14px/600 `--ink`）{意図}（12px `--muted`）` / 2 行目 `§{id} · {file:line} · {費用 or ≈k} · {時刻}`（12px `--muted`、費用は `$0.018` か `≈3.2k tok`）。詳しいレベルだけ先頭に `{th_id}`（mono 11px）。状態は glyph・色・ラベル（右端の pill）の 3 つ（§6.9、ready は「レビュー待ち」）。選択行は `--hover` + 左 2px `--accent`、`aria-selected="true"`。
- SSE で行が増えても選択中の行の id を保ち、選択行より上に行が入ったときは §4.3.9-5 と同じスクロール補正をかける。

#### 4.6.4 詳細（種類ごと）

すべての詳細に共通: 題名（明朝 20px）、アンカー（`§{id} · {file:line}`）、引用（`--mark` の左罫線 + `--paper-2`）、メッセージ（時刻順、`human` / `agent:…` / `system`）、［設計書で開く ↵］［地図で見る］（アンカーの部屋を選択した S1）。

| 種類 | 中身 |
|---|---|
| doc_edit の要選択（doc_edit の下書き） | 2 択のボタン（`1` / `2`）: **1 設計書を直す（コードが正しい）** · L1 の静的検証 → human-edited で固定 · `0 tok` / **2 コードをこの設計に合わせる** · {patch\|agent} · `≈{k} tok · ≈${usd}`（見積りは下書きの thread で `POST /jobs/estimate {kind:"fix", threads:[<下書き>]}` を取る。§16 R22）。§5.5 |
| レビュー待ち（job ready） | ReadyCard（§6.5）と同じ要約 +［レビュー R］［採用 ⌘⏎］［却下 ⌘⌫］ |
| 失敗 | 原因の連鎖（`patch → gate 失敗 ×2 → agent に昇格（--resume）→ go test 失敗`、`Job.escalatedFrom` をたどる）、stderr 末尾 3 行（mono、secret は伏せ字済み）、ここまでの費用と実行回数（`$0.043 · 3 回`）、次の手（`JobFailure.actions`: ［再試行］［範囲を絞る］［プロンプトをコピー］［別の engine で］［Opus high で提案のみ ≈${usd}］— 最後は金額を明示した 2 段目の確認を取るまで実行しない。AC-J39）、「依頼文・アンカー・context chips は失われません」 |
| ロック待ち（waiting_lock） | `{path} を {th} が編集中のため待機 — 同じファイルに触るタスクは自動で直列にします` |
| outdated | 元の位置のスナップショット（`rev_anchor_snapshots` の原文、灰）+［新しい位置を指定］（S2 / S3 で範囲を選んで `POST /threads/:th/reanchor`）+［解決にする］ |
| 回答済み（answered） | 回答（引用の `exists: false` は ⚠「この行は存在しません」）+［文書に追記］（`POST /threads/:th/promote {to:"doc"}` → 提案）+［決定事項にする］（`to:"decision"`）+［返信］ |
| 人の入力待ち（needs_input） | agent の質問 + 返信欄（Composer の返信モード。⌘⏎ で `messages` → reply 遷移） |
| 承認待ち（trust） | Trust dialog と同じ中身（§4.12）をその場に |
| 設計書の提案（proposal） | 提案の diff（`diffHtml`）+［採用］［却下］（`POST /doc/proposals/:pp/accept` / `…/reject`） |
| 生成 run（gen_run） | 進捗の要約（§4.2.5 のカウンタ）+［見取り図で見る］ |

#### 4.6.5 batch バー（上端 sticky）

`下書き {n} 件（{共通の範囲}）を 1 回の実行にまとめる ≈{k} tok · ${usd}（別々なら ≈{k2} · {p}% 節約）［まとめて送る ⇧F］`。`{共通の範囲}` は下書きの primary path の最長共通 directory（無ければ「{m} モジュール」）。数値は §5.3 の C2 と同じ batch 見積り。⇧F（`inbox.finish`）で Finish dialog（§5.3）。

#### 4.6.6 キーと空状態

- `j`/`k`（50ms 以内に選択が動き詳細が切り替わる。AC-J45）、`↵` 文書で開く、`x` 複数選択（選択中は batch バーが「選択した {n} 件を…」に変わる）、`1`/`2`（doc_edit の 2 択）、`⇧F` まとめて送る、`h` 解決済みを隠す。
- 空状態: mine「あなたの番の項目はありません」/ working「実行中のタスクはありません」/ failed「失敗したタスクはありません」/ outdated「付け直しが必要なコメントはありません」/ draft「下書きはありません（文を選んで c でコメント）」/ resolved「解決済みのスレッドはまだありません」。

### 4.7 S5 Review（文脈列の review モード、640px）

#### 4.7.1 パネルの構成（上から。JUDGEMENT §6.7）

1. **ヘッダー**（sticky、`--paper` 94% + blur 8px）: `{th} · R{n} · {mode} mode · tools {なし|Read + Edit}` / 題名（明朝 19px）/ `§{id}「{引用 40 字}」{block} · あなた「{依頼 60 字}」` / 右上に `{i}/{total}`（レビュー待ちが複数のとき、`[` `]` で前後）と［閉じる Esc］。
2. **ゲートのピル**（2 列 grid）: gate ごとに `✓ gofmt 0.02s` / `✕ go test 7.5s`（`GateResult`。`skipped` / `untrusted` は灰で「未承認のため skip」+［承認する］）。hover / focus で実行したコマンド全体（argv）。右に `書き込み範囲 {n} files ⊂ WRITE · deny glob 0`（scope 検査）。
3. **実績 1 行**: `入力 {in}（cache {c}）出力 {out} ${usd} API換算 {s}s（モデル {m}s + ゲート {g}s）見積 ≈{k} → {±}% · 5h +{pp}%`。値は `Job.usage`（final だけ）、`Job.timings`（§16 R18）、gate の `ms` の合計、`Job.estimate`、`Job.windowDeltaPct`（§16 R19。取れないときは 5h を出さない）。
4. **AI の要約**（4 項目以下、`result` の summary から）。formatter が書き換えた行があれば「空白だけの変更 {n} 行」を必ず含める（`GateResult.autofixedLines`、§16 R18）。
5. **影響を受ける部屋の縮図**（120×72、write scope のファイルの部屋を `--c-prop-bg`。退避中は出さない）。
6. **コード diff**（`DiffView`、§6.6）。
7. **設計書の提案の一覧**: `§{id} {block の先頭 24 字} · {op}` と［本文で見る］（本文の提案ブロックへスクロールして focus）。提案ごとに ✓ / ✕。
8. **フッター**（パネル内 sticky）: 左に `n / ⇧N hunk · ⌘⏎ フォーカス中を採用 · ⌘⌫ 却下 · ⌥⌘⏎ すべて採用`（12px `--muted`）と `base refs/mitori/j/{job}/base`（mono 11px）、右に［すべて却下］［すべて採用 ⌥⌘⏎］。決定の途中は中央に `決定 {d}/{total}`。

1440×900 で 1〜4 と 8 が 1 画面に入り、diff だけがスクロールする（AC-J35）。

#### 4.7.2 焦点単位の採用（JUDGEMENT §6.7、Map K7）

1. パネルを開いた直後のフォーカスは「提案全体」（`ReviewDecisions.focus = {kind:"all"}`）。このとき `⌘⏎` = 全部を採用（`POST /jobs/:job/accept {all:true}`）、`⌘⌫` = 全部を却下（遅延確定、§6.7）。
2. `n` / `⇧N` で単位（hunk → … → 提案）にフォーカスが移る（hunk ヘッダーに `--c-prop` の帯、`aria-current="true"`、`scrollIntoView({block:"nearest"})`）。以後 `⌘⏎` / `⌘⌫` はその単位だけを決め、次の未決の単位へ進む。決めた単位はヘッダーに ✓ / ✕ と「採用予定 / 却下予定」。
3. **すべての単位が決まった時点で 1 回だけ適用する**: 全部採用 → `{all:true}` / 一部 → `{hunks:[採用分], proposals:[採用分]}`（`partially_accepted`）/ 全部却下 → 遅延確定の却下。
4. `⌥⌘⏎` はいつでも全部を採用する。パネルを閉じても決定は保持する（`ReviewStore.decisions`、メモリのみ。リロードで消える）。

#### 4.7.3 広げる（⇧R）

`review.widen` でパネルを全幅の overlay（rail と prose の上、`--z-overlay`、左右 40px の余白）に広げる。このときだけ Unified / Split を切り替えられる（segmented。Split は CM6 + merge を読む）。もう一度 ⇧R か Escape で 640px に戻す。

#### 4.7.4 状態とエラー

| 状態 | 表示 |
|---|---|
| diff の取得中 | `diffStat` の行数から高さを確保した skeleton |
| 2,000 行以上 | 最初の 400 行を静的 HTML で出し、CM6 chunk の読み込み後に置き換える（その間の操作は静的 HTML 側で受ける） |
| 採用中（accepting） | 主ボタンが同じ幅のまま「採用中…」（m3e の幅固定。ラベルを grid で重ね `visibility` で切替） |
| `E_GIT_MERGE_CONFLICT` | dialog「作業ツリーの変更と衝突しました: {files}」［差分を見る］［やり直しを依頼（revise）］［.patch を書き出す］ |
| `E_GIT_DIVERGED`（undo 時） | §6.7 |
| remote-readonly | 主ボタンが［.patch を書き出す ⌘⏎］。結果はトースト `accept.patch` |
| job が他で解決済み | パネル上部に「この提案は別の画面で採用 / 却下されました」+ 閉じる |

### 4.8 S6・S7・S8

- **S6 用語集・索引**（P3）: MVP は `/w/:ws/glossary` を `doc/s12` へ `replace`。P3 の画面は 用語の表（語 · よみ · 英語名 · 定義 · 使用 n）をよみの五十音で並べ、頭文字の索引（あ か さ …）、シンボル索引（`GET /symbols`）、ファイル地図。
- **S7 決定事項ログ**: `GET /decisions` の一覧（題名・状態 · 日付 · 説明している block · 出典）。項目を開くと `decisions/<id>.md` の描画（サーバ HTML）。MVP は一覧と描画だけ、P3 で検索と supersede の系譜。
- **S8 生成と鮮度**:
  1. 網羅率カード: `網羅 {included}/{files} files · 除外 {excluded}`（理由別の内訳、`exclude.<reason>`）+ coverage の正直な表示（読んだファイル / 読まなかった理由）。
  2. 古い節の一覧: outline の `freshness: "stale"` の block を節ごとに集計し、`§{id} {題} · 古い記述 {n} · 原因 {files}`［この節だけ再生成 ≈{k}］（押した時点で scope 付き見積り、2 回目で実行）。S9 の提案（§16 R12）が入ったら理由（interface 変更 / 古い記述が 20% 超 / facts の変化）を出す。
  3. run の履歴（`GET /gen/runs`）: 日時 · effort · engine · 入力 / 出力 · $ · 時間 · 見積との差。
  4. 見積り精度（`UsageSummary.estimateAccuracyPct`、n）と、使用量（今日 / 7 日 / 30 日、model 別・engine 別の表）。

### 4.9 S9 設定

#### 4.9.1 保存の規則

- 項目ごとに自動保存（変更から 400ms の debounce [仮]、`PATCH /settings {version, patch}`。workspace は `PATCH /ws/:ws/settings`）。保存中は項目の右に `保存中…` → `保存しました`（2s）。
- `E_CONFLICT`（version 不一致）→ 取り直して自分の変更を再適用し、同じキーを他で変えていたら「別の画面で変更されました: {値}」と両方を見せて選ばせる。`E_CFG_INVALID` → 項目の下に `role="alert"` で `params` の理由。`E_CFG_GLOBAL_ONLY` → 「この項目は global 設定にしか書けません」。
- 各項目に書けるスコープのラベル（global / workspace / repo。`SETTING_SCOPES`）を小さく出す。repo の `config.json` にある無視されたキー（`ignoredRepoKeys`）は workspace 設定の先頭に notice。

#### 4.9.2 タブと項目（`SettingsTab`）

| タブ | 項目（`GlobalSettings` のキー） | UI |
|---|---|---|
| 一般 | `ui.lang`、`ui.theme`、`ui.readerLevel`、`defaultDocLang`、`ui.showUsd`、`ui.openBrowser`、`ui.notifyOnDone` | select / segmented / switch |
| エンジン | `defaultEngine`、`engines.claude-cli.{binary, inheritUserSettings, envPassthrough, warmPool, persistSessions}`、`engines.session.enabled`、`engines.anthropic-api.{enabled, keySource, envVar, useBatch, monthlyCapUsd}`、`engines.codex-cli`（MVP 後は「準備中」）| engine ごとのカードに `GET /engines` の状態（installed · version · auth · plan · capabilities · problems）と［再検出］（`POST /engines/:engine/probe`）。`inheritUserSettings` の説明「ユーザー設定（hooks 等）だけを継承します。解析対象 repo の project 設定は継承しません」。API key は**入力欄を作らない**（「環境変数 {envVar} から読みます」） |
| モデル | `models.*`（8 用途）、`reasoning.*` | 完全 ID の select（`claude-opus-5-5` / `claude-sonnet-5-5` / `claude-haiku-4-5`）。alias は選べない |
| 予算 | `limits.{confirmAboveTokens, jobMaxUsd, genRunMaxUsd, dailyMaxUsd, stopAtBudgetFraction, repairMaxAttempts, patchMaxLines, patchMaxFiles, bundleDefaultTokens, bundleMaxTokens, agentMaxInputTokens}`、`scheduler.{concurrency, yieldAtFiveHour, warmFirstFanout}` | 数値欄（単位つき）。並列は 1〜8 の slider（既定 3）。**4 以上にすると説明を出す**:「並列を上げると 5h 枠を早く使い、規約上の『通常の個人利用』から外れるおそれがあります」。`yieldAtFiveHour` は 50〜95% |
| レビュー | `review.{autoResolveOnAccept, autoAcceptDocUpdates, autoCommit, commitTrailers}` | switch。`autoAcceptDocUpdates` を on にすると「設計書の更新を確認せずに反映します（D12 の既定は常に提案）」の警告 |
| ショートカット | `ui.singleKeyShortcuts`、`ui.keymap` | §8.5 のキーマップ編集表 |
| プライバシー | `privacy.{dataPolicyAck, logContent, keepRawStreams}`、`security.{denyGlobs, secretScan}` | dataPolicyAck は engine ごとの日付と［取り消す］。deny glob は既定（`DEFAULT_DENY_GLOBS`）を錠前付きで表示し、追加だけできる。secretScan は off にすると赤の警告 |
| 連携 | Claude Code / Codex / AGENTS.md / MCP | 状態 API（§16 R17）が入るまではコマンドのコピーだけ: `mitori install claude-code`、`mitori install agents-md`、`claude mcp add mitori -- mitori mcp`（opt-in の説明「常駐で約 2k token 増えます」） |
| 情報 | 版、daemon、PRICING_VERSION、ライセンス | — |

workspace 設定（`WsSettingsTab`）: `docDir`、engine / effort の上書き、追加の exclude、読者レベル / 信頼（TrustRecord の一覧と［取り消す］）/ repo 設定（`RepoSettings` の読み取り表示）/ 書き出し（§4.13 の［HTML として書き出す］）。

### 4.10 ⌘K パレット（JUDGEMENT §6.10）

- 寸法: 幅 640px、上から 13vh、入力 54px / 17px、行 ≥ 44px、表示は 8 行 + 次の行が半分見える高さ（398px）、scrim `--scrim`（ぼかしなし）、角丸 14px。表示 170ms、非表示 100ms。
- **索引**: `GET /ws/:ws/search/palette`（`PaletteIndex`、ETag = rev、≤ 5 万件）を idle か ⌘K の初回で取り、Web Worker（`palette-worker` chunk）に `load` する。client の操作項目（`PaletteActionItem`）を足す。`index.changed` / `doc.outline` で rev が変わったら取り直す。
- **照合**（Worker、1 打鍵 ≤ 16ms @5 万件。AC-J46）:
  1. 正規化: NFKC → 小文字 → 空白除去 → カタカナをひらがなへ。ローマ字は `ROMAJI_RULES` を query と索引の両方に順に適用（`mochikoshi` / `motikosi` → `motikosi`）。
  2. 各項目について上から最初に当たった規則で点数（`PALETTE_SCORING`）: ラベルの部分一致（100 − 位置、先頭なら +40、− 0.05 × 長さ）→ かなの query を `y`（よみ）に（85）→ ローマ字の query を `r`（ローマ字）に前方 / 部分一致（82）→ 別名 `al`・英語名・`via` の用語（62）→ 補助行 `s`（50）→ 部分列（40 − 隙間 − 0.05 × 長さ）。
  3. 群の順は `PALETTE_GROUP_ORDER`（用語 → 節 → 部屋 → シンボル → スレッド → 操作）、群内は点数降順、同点はラベル昇順。各群 3 件まで（`paletteGroupMax`。群見出しの「さらに {n} 件」で展開）。
  4. 一致の理由を右に出す: 別名で当たったら「{alias} に一致」、用語経由のシンボルは「「{term}」経由」（`via` バッジ、`--c-prop` on `--c-prop-bg`）。ラベルの一致文字は `--accent` の 600。
  5. 古い query の応答は捨てる（`id` を比べる）。
- **状態**: 入力が空 = 「最近」5 件（`localStorage` `mitori:recent:<ws>`、最大 20）+ 提案 3 件（今の画面に応じた操作）/ 入力中 = 1 フレームで更新 / 結果なし =「見つかりません — 本文を全文検索（/）」→ `GET /ws/:ws/search?q=`（FTS5、150ms debounce、群「本文」）/ 索引の読み込み中 = 最終寸法の skeleton 行 3 本 + 操作の群だけは動く / エラー = 操作の群だけで動き続け、1 行「索引を読めませんでした［再試行］」。
- **キー**: `↑`/`↓`（`⌃N`/`⌃P`）、`↵` 開く、項目の上で `⌘K` → Action panel（開く / 説明して / 再生成 ≈{k} / プロンプトとしてコピー / permalink）、入力が空の `⌫` で 1 階層戻る、Escape で閉じて**元のフォーカスに戻す**。フォーカスは入力欄に置いたまま `aria-activedescendant` で項目を示す（`role="combobox"` + `listbox`）。
- IME: 変換中も `input` イベントで絞り込み（プレビュー）、変換中の Enter は実行しない（`IME_RULES.paletteRunsAfterCommit`）。
- `/`（`search.inDoc`）は crumb「本文」付きで開き、Worker の照合と並行してサーバの全文検索を出す。
- フッター（11px mono `--faint` on `--paper`）: `{件数} 件 · {ms} ms · ローカル索引 · 0 tok`。
- **操作項目**（`action.*`）: 画面移動（見取り図・設計書・Inbox・レビュー・生成と鮮度・設定・workspace を開く）、読者レベル 3 種、テーマ、UI 言語、設計書を生成する（S1 の見積りカードへ）、この節だけ再生成、レビューを終える（⇧F）、HTML として書き出す、プロンプトとしてコピー、permalink、テキストで見る（地図）、単一キーのショートカットを切り替える、ヘルプ、block の履歴、この block を直接編集（§5.5）、AI Review（`review` 意図の Composer）。

### 4.11 ヘルプ（`?`）

`<dialog>` に実効キーマップ（`KeyRegistry.effective`）を scope ごとの表で（全体 / 読む / 見取り図 / Inbox / Review / Composer / パレット）。各行 `{動作} {キー}`（再割当て済みは `変更済み` の印）。上部に絞り込みの入力欄（IME 可）、下部に［ショートカットを設定する］（S9）と「1 文字のショートカット: オン［切り替える］」。OS ごとの表記（`⌘` / `Ctrl`）は `KeyRegistry.label`。

### 4.12 Trust dialog

- きっかけ: SSE `trust.request` → Inbox の「承認待ち」+ トースト `trust.pending`（モーダルを勝手に開かない）。job カードの gate 行は「未承認のため skip」+［承認する］。
- 中身: 種類（gate / repo prompt / rules）、出所（`detected` / `repo_config`）、**実行される内容の全文**（`preview`。gate は 1 行 1 コマンドの argv、mono）、内容 hash（先頭 12 桁）、説明「承認すると、mitori は作業用 worktree の中でこれを実行します（ネットワーク・秘密情報は渡しません）。内容が変わると、もう一度確認します。」
- ボタン: ［拒否］［承認する］。**初期フォーカスは preview の領域**（どちらのボタンでもない）。決定は `POST /ws/:ws/trust/:tr {decision}`（web だけが呼べる）。

### 4.13 Export viewer（WP-13、自己完結 HTML）

- `viewer` chunk（≤ 60KB gz、同じ Reader / 地図 / パレットの部品を `AppMode = "viewer"` で）。データは `<script type="application/json" id="mitori-export">` の `ViewerPayload`（`ui.ts`）。API・SSE・Composer・ジョブ・Inbox・設定は無い（`MODE_CAPABILITIES`）。外部への要求 0（e2e でネットワークを遮断して確認）。
- ヘッダーはブランド・題名・タブ（見取り図 / 設計書）・検索・読者レベル・テーマ・言語・ヘルプだけ。上部に帯「読み取り専用の書き出し · {exportedAt} · HEAD {head7} · 秘密情報 {n} 件を伏せ字」。
- 出典の peek は書き出し時に埋め込んだ `cites`（範囲 ±3 行）から。無い範囲は「この書き出しには含まれていません」。
- 書き出しの操作（daemon 側）: ⌘K「HTML として書き出す」/ workspace 設定 → dialog（読者レベルの既定、言語、決定事項を含める）→ `GET /ws/:ws/export/html?level&lang`（ダウンロード）。結果に `redactions` を出す。

---

## 5. コアフロー（手順・遅延予算・楽観的 UI）

表の「予算」は 目標 / 上限。mark は `UI_PERF_MARKS`（`detail.trigger` = 入力の `event.timeStamp`）。

### 5.1 Flow A — `mitori` → 0 tok の見取り図 → 見積り → 生成が流れ込む

| # | ユーザー | 画面 | API / SSE | 予算 | 楽観的 UI・失敗時 |
|---|---|---|---|---|---|
| A1 | `mitori` を実行 | ブラウザが nonce URL で開き、外枠 skeleton（前回の幅・テーマ・レベル） | `GET /auth?n=…` → 302 → `GET /` | 外枠 0.3s / 0.5s（`mitori:shell:painted`） | nonce 期限切れ（60s）なら「このリンクは期限切れです。ターミナルで `mitori` を再実行してください」 |
| A2 | — | strip に `scan.progress`（S0 → S4） | SSE `scan.progress`（10Hz） | 概要 1s / 2s | — |
| A3 | — | 床面図・目次・facts・静的な節・見積りカード（skeleton） | `scan.done`、`GET /map`、`GET /doc` | **最初の有用な画面 3s / 5s**（`mitori:map:painted`、AC-J02） | 床面図が退避なら Container 図（§4.2.6） |
| A4 | — | 見積りカードに 3 effort の数値 | `POST /gen/estimate` ×3（並列） | map 描画から 300ms [仮] | 失敗したら主行に「見積りを取れませんでした［再試行］」 |
| A5 | effort を選ぶ | 主行が変わる | なし（取得済み） | 16ms（AC-J47） | — |
| A6 | ［生成 ⏎］を 1 回 | カードが進捗に置き換わる（同じ高さ） | `PATCH /settings`（初回のみ）→ `POST /gen/runs` → `gen.run` | 押下 → 進捗表示 100ms（楽観的に「開始中…」） | `E_PRECONDITION` は見積りを更新して再クリック待ち（§4.2.4-7） |
| A7 | 読み始める（`g d`） | §0 から順に block が確定して入る。未確定は平文 + caret | `doc.block.partial`（10Hz）、`doc.block.upsert` | **最初の AI block p50 20s / p95 30s**（`mitori:block:first`） | CLS < 0.01（§4.3.9）。トースト `gen.firstBlock` |
| A8 | 待機中の章をクリック | その章が次に生成される | `POST /gen/prioritize` | トースト 100ms | — |
| A9 | — | 完了: 実績と差、5 分コースの提案 | `gen.run`（done） | — | 失敗した task は節に「生成できませんでした［再試行 ≈k］」 |

### 5.2 Flow B — 選択 → 依頼 → ジョブ → Review → 採用 → 取り消し

| # | ユーザー | 画面 | API / SSE | 予算 | 楽観的 UI・失敗時 |
|---|---|---|---|---|---|
| B1 | 1 つの block の中で 2 文字以上を選ぶ | 浮遊ツールバー（選択の 46px 上） | なし | 100ms（AC-J30） | 複数 block にまたがる選択は最初の block の末尾までに切り詰め、ツールバーに「1 ブロック内に限ります」 |
| B2 | `f`（`c` / `e` も同様） | Composer が block の高さ（margin）か直下（inline）に開く。意図 = 修正 | 下書きの作成 `POST /threads {draft:true}`（idempotency-key）と、続けて `POST /jobs/estimate`（bundle ≤ 100ms） | Composer 描画 100ms（`mitori:composer:opened`） | 見積りが届くまで見積りチップは client の予測値（§6.2.6）を `≈` で出す |
| B3 | 依頼文を入力（IME 可） | 見積りチップ・router チップが更新 | 本文の変更から 300ms で再見積り。下書き保存 500ms | chips 変更は同じフレーム（AC-J32） | daemon が落ちていたら localStorage に退避（`draft.offline`） |
| B4 | context chip を外す / 足す | 見積り・router が同じフレームで変わる | 300ms 後に `POST /jobs/estimate {context:{remove, add}}` | 1 フレーム | — |
| B5 | ⌘⏎ | **ジョブカードが即時に出る**（計画ステージが淡色で並ぶ。受付 ✓） | `PATCH /threads/:th`（本文）→ `transition submit` → 見積りが古ければ取り直し → `POST /jobs {estimateId}` | **100ms / 150ms**（`mitori:card:optimistic`、AC-J33） | `requiresConfirm`（100k 超・昇格・従量）ならカードが確認の形になる（§6.8）。送信失敗は「送信できませんでした［再試行］」で本文を残す |
| B6 | 読み続ける | ステージが ✓ になり所要時間が付く。tail 1 行。経過と「通常 {p25}–{p75} 秒」 | `job.upsert`、`job.event`（10Hz） | 開始 → 最初の phase: warm 300ms / cold 3s | % バーなし（AC-J33） |
| B7 | — | ◆ レビュー待ち: ReadyCard + 本文の提案モード | `job.upsert`（ready）、`doc.proposal.upsert` | 実測（デモ: 約 7〜13 秒） | タブが非表示ならタイトルに `(1) ✓`（§3.8） |
| B8 | `r` | 文脈列が review（640px）に。ゲート・実績・要約・diff・提案 | `GET /jobs/:job` | パネル描画 100ms（`mitori:review:diff-mounted`） | 2,000 行以上は静的 400 行 → CM6 |
| B9 | `n`（任意） | hunk にフォーカス | なし | 50ms | — |
| B10 | ⌘⏎ | 採用中 → パネルが閉じ、block が新しい文に置き換わって 1 回光る。カードが 1 行に縮む | `POST /jobs/:job/accept` → `checkpoint.upsert`、`doc.block.upsert`、`thread.upsert` | 押下 → トースト 300ms [仮] | 衝突は §4.7.4。remote-readonly は .patch |
| B11 | — | トースト `accept.done`（10s の残り時間の線） | — | — | — |
| B12 | — | code モードなら右列を作業ツリーの内容（`未 commit`）に、床面図の部屋も 1 回光る | — | — | — |
| B13 | ⌘Z（10s 以内、入力欄の外）/ トーストの［元に戻す］ | 提案状態に戻る | `POST /checkpoints/:ck/undo` | 押下 → 復元 300ms [仮]（`mitori:undo:applied`） | `diverged` が空でなければ §6.7 の dialog |

意図ごとの差分:

| 意図（キー） | B5 以降 |
|---|---|
| 質問（`e`、⌘1） | answer mode。ステージ: 受付 → コンテキスト束 → 起動 → 回答（本文を流しながら描く）→ 検証（引用の実在）→ 完了。回答はカードに描き、［文書に追記］［返信］［解決］ |
| 修正（`f`、⌘2） | 上の表どおり（patch / agent） |
| 指摘（⌘3、⌘K「AI Review」） | findings mode。指摘の一覧が届き、各項目に［スレッドにする］（人が残す指摘を選ぶ） |
| メモ（`c`、⌘4） | job を作らない。⌘⏎ で thread が open になり、margin に「未解決」カード。Finish（⇧F）でまとめて渡る |
| 経路 = 自分のセッションへ | thread を open にして「⇧F で mitori review に渡します（待機中 {n}）」 |
| 経路 = プロンプトをコピー | thread を open にし、`POST /ws/:ws/prompt` の text をクリップボードへ（トースト `copy.prompt`）。engine が無くても動く |

### 5.3 Flow C — まとめて送る（batch review round）

| # | ユーザー | 画面 | API / SSE | 予算 |
|---|---|---|---|---|
| C1 | 複数の文に `c` でメモを付ける | margin に「未解決」カードが溜まる。Inbox に batch バー | `POST /threads`（各 submit） | 各 100ms |
| C2 | ⇧F（Reader / Inbox） | Finish dialog: pending の thread を module ごとに並べ、batch の見積り（`POST /jobs/estimate {kind:"fix", threads}`）と「別々なら ≈{k2} · {p}% 節約」（各 thread の単発見積りを並列に取り合計） | `GET /review`、見積り（≤ 100ms × N、並列 4） | dialog 100ms、数値 500ms [仮] |
| C3 | 経路を選ぶ: ［自分のセッションへ（mitori review · 待機中 {n}）］/［その場で実行（claude-cli）］ | 既定は待機中の `mitori review` があれば pull、無ければ push | — | — |
| C4 | ⌘⏎（dialog 内） | round R{n} が dispatched。thread カードに `R{n}` | `POST /review/finish {mode}` → `review.round`、（push）`job.upsert` ×k | 100ms（楽観的に dialog を閉じ、カードを「送信済み」に） |
| C5a | push | 各 job のカード（§6.4）。batch の thread ごとの結果は `done` → 提案 / `answer` → 回答 / `question` → 人の入力待ち / `skip` → open に戻る（「対応されず: {理由}」） | `thread.upsert`、`thread.message` | — |
| C5b | pull | 待機中の CLI に `mitori.review/1` が返る。画面は「R{n} を mitori review に渡しました · agent の返信を待っています」。agent の `mitori reply` が届くたびにカードが更新 | `thread.message`、`thread.upsert`（answered / needs_input）、touch で `doc.freshness` | — |
| C6 | — | round 完了: 触られたファイルに再アンカー。重なる他の thread に `↻ 再確認` バッジ（`Thread.stale`）。設計書の同期の提案カード「設計書を同期 ≈2k tok」 | `review.round`（complete）、`doc.proposal.upsert` | — |
| C7 | 返信して次の round へ | resolve されていない thread に `R{n} → R{n+1}` バッジ（carry-forward。`Thread.round < 現在`） | — | — |

- pending が 0 件で ⇧F: dialog「保留中のコメントはありません。承認（approved）として終えますか？［承認して終える］」→ `POST /review/finish` → 待機中の CLI に `approved: true`。
- 見積りの合計が `confirmAboveTokens` を超えると dialog の主ボタンが「≈{k} tok（${usd}）で実行」になる（2 つ目の確認ダイアログは出さない。dialog そのものが確認）。

### 5.4 Flow D — コードが変わった → stale → 提案 → 再生成

| # | 出来事 | 画面 | API / SSE | 予算 |
|---|---|---|---|---|
| D1 | エディタで保存（人 / agent / git pull） | 該当 block に ⚠、章のメタ行・目次・床面図（鮮度 on）に反映 | `index.changed` → `doc.freshness` | **保存 → バッジ 50ms / 1s**（`mitori:stale:badge`） |
| D2 | — | outdated になった thread のカードに ▲!、Inbox の outdated | `thread.upsert` | — |
| D3 | 2s の静穏後 | 章の頭に提案帯（§4.3.11） | S9 の提案（§16 R12） | — |
| D4 | ［この節だけ再生成 ≈{k}］ | ボタンが `≈{k} · ${usd}` に変わり、もう一度押すと実行 | `POST /gen/estimate {scope}` → `POST /gen/runs` | — |
| D5 | — | 結果は**提案**として本文に（lock の無い AI block は直接、`human-edited` は提案） | `doc.proposal.upsert` / `doc.block.upsert` | — |

### 5.5 Flow E — doc_edit の 2 択（設計書が間違いか、コードを合わせるか）

入口は 2 つ。

1. **Composer から**（意図 = 修正、アンカーの primary が doc のときだけ）: Composer に 2 択（§6.2-4）。「設計書を直す（コードが正しい）」を選ぶと、本文欄が **block の Markdown の編集欄**に変わる（`GET /doc/blocks/:block?md=1`、§16 R2。`<textarea>`、`field-sizing: content`、IME 可、等幅ではなく本文と同じ書体）。打ちかけの依頼文は保持され、2 択を戻すと復帰する。見積りは `0 tok`。
2. **⌘K「この block を直接編集」**: 同じ編集欄を block の直下に開く。保存（⌘⏎）の時点で 2 択を出す（`1` / `2`）。

保存の流れ:

| 選択 | API | 結果 |
|---|---|---|
| 1 設計書を直す | `POST /doc/blocks/:block/edit {baseHash, md, apply:"doc"}` | block が置き換わり ✎（human-edited）。L1 の静的検証で落ちた出典は ⚠。`E_DOC_BASE_MISMATCH`（他で更新された）→「この block は他で更新されました」+ 3-way の比較（旧 / 他 / あなた）と［あなたの版で上書き］［破棄］ |
| 2 コードをこの設計に合わせる | `POST /doc/blocks/:block/edit {…, apply:"code"}` → `DocEditRes {thread, estimate}` | doc_edit の thread とジョブカード（確認の形: 見積り + ［実行 ⌘⏎］）。実行後は Flow B の B6 以降。採用時は人が書いた文章がそのまま設計書の提案になる（loop spec §2.6.3） |
| 選ばずに閉じる | `POST /threads {intent:"doc_edit", draft:true, body: <新しい md>}`（§16 R22） | Inbox「要選択」（`needs_choice`）に残る。Inbox の詳細で `1` / `2` |

### 5.6 Flow F — 失敗 → 修復 → 昇格

1. gate 失敗: ステージ表の gate 行が ✕、続いて「修復 1/2 · --resume · 失敗の抜粋 0.6k」の行が増え、適用 → 範囲検査 → 検査をもう一度（行を追加。消さない）。
2. 2 回失敗 / patch の適用失敗: 「agent mode に昇格（理由: gate 失敗 ×2）」の行と新しいカード（`escalatedFrom` で前のカードとつなぐ）。費用の合計は両方を足して出す。
3. agent も失敗: カードと Inbox の失敗詳細（§4.6.4）。［Opus high で提案のみ ≈${usd}］は、押すと金額と「提案だけを作ります（作業ツリーには書きません）」を出す 2 段目の確認で `POST /jobs/estimate {mode:"agent", model: models.escalate}` → `POST /jobs {estimateId, confirm:true}`。
4. どの段でも依頼文・アンカー・chips は失われない（AC-J39）。

---
## 6. 部品仕様

### 6.1 浮遊ツールバー（選択）

- 表示条件: 1 つの `.mb`（S2）か CodePane（S3）の中で 2 文字以上（`selectionMinChars`）を選んだ。`selectionchange` を 1 か所で監視し、rAF にまとめる。
- 位置: 選択範囲の矩形の 46px 上（`--seltool-offset`）、上に余地が無ければ下。タッチ（`pointer: coarse`）では常に下 10px（OS のコピー用メニューと重ならないように）。`--z-seltool`。
- 中身（反転面 `--toast-bg`、高さ 38px、ボタン 30px）: `コメント C · 説明して E · 修正して F │ P │ Y │ ≈{k}`。`≈{k}` は直前の同じ block の見積りが cache にあるときだけ（無ければ出さない。選択のたびに見積りは取らない）。ボタンの `mousedown` は `preventDefault`（選択を保つ）。
- 選択は Composer を開いている間 `::highlight(mitori-sel)` で塗り続ける（DOM を割らない）。
- アンカーの作り方（doc、`ANCHOR_TEXT_RULES`）:
  1. 選択の Range を `.mb` の中に切り詰める（複数 block なら最初の block の末尾まで）。
  2. `.mb` の text node を TreeWalker でたどり、`excludeSelectors`（`.mcite`、`[data-mx]`）の中を飛ばし、コード block は行番号の gutter を除いた本文を `\n` で連結し、空白の連続（改行を含む）を 1 個の空白にして trim、NFC にした「block テキスト」と、選択の開始・終了の offset（UTF-16）を得る。
  3. `quote = {prefix: 直前 32 字, exact: 選択（≤ 2,000 字）, suffix: 直後 32 字}`、`offset`、`blockHash = BlockMeta.hash`。
  4. 選択と重なる `.mc[data-claim]` の区間を調べ、重なりが選択の 50% 以上かつ claim の 30% 以上なら `claim` を付ける（`ANCHOR_LIMITS.claimBindOverlap`）。code member はサーバが claim の最初の cite から導く。
- code アンカー（S3）: `{path, start, end, blob}`（`snippet`・`symbol` はサーバが刻印。§16 R10）。

### 6.2 Composer

置き場所: `margin` モードでは対象 block の高さの margin カード、`code` モードと 1024px 未満では対象 block の直下にインライン（< 1024 は bottom sheet）。上から次の順（AC-J31）:

1. **ヘッダー**: `○ 下書き · §{id} · {file:line}` と右端の `自動保存`（保存中は `保存中…`、オフラインは `このブラウザに保存`）。詳しいレベルだけ `· {blockId}`。**TextQuote の内部表現（prefix 32 など）は出さない**。
2. **引用**: `{前 18 字}<mark>{exact}</mark>{後 18 字}`（12.5px `--muted` on `--paper`、`--mark` の面、2 行で省略）。
3. **意図チップ**: `質問 ⌘1` / `修正 ⌘2` / `指摘 ⌘3` / `メモ ⌘4`（radiogroup、選択中は `--ink` の面）。`c` = メモ、`e` = 質問、`f` = 修正で開く（D19）。前回と同じアンカーで開き直したときは前回の意図を保つ（WCAG 3.3.7）。
4. **直す対象の 2 択**（意図 = 修正 かつ アンカーの primary が doc のときだけ）: 「コードをこの依頼に合わせる」（既定）/「設計書を直す（コードが正しい）」（`ComposerState.target`）。後者は §5.5（本文欄が Markdown の編集欄になり、見積りは `0 tok`）。
5. **本文**: `<textarea>`、`field-sizing: content`（最小 62px、最大 220px、以後スクロール。非対応のブラウザでは `input` ごとに `height = scrollHeight` を rAF で設定）、13.5px / 1.65。Enter は改行、送信は ⌘⏎ / Ctrl+Enter だけ。IME の変換中のキーはすべて無視（§8.6）。`@` を語頭で打つと mention picker（ファイル / シンボル。`GET /symbols?q=` と palette 索引）で code 範囲を足す（`ContextAdjust.add`）。下書きは 500ms の debounce で `PATCH /threads/:th {body}`（オフラインなら localStorage `mitori:draft:<ws>:<anchorKey>`）、Escape で閉じても残る（確認しない）。
6. **context chips**: 先頭に外せない固定チップ `固定: system + 規約 {k} cache`（`kind: fixed|rules`、`removable: false`、× を出さない）。各チップ `{label} {k}k ×`（11px mono の tok）。外したチップは打ち消し線で残し、`+` で戻せる。候補チップは点線の `+ 関連: {label} +{k}k`（§16 R9 `JobEstimate.candidates`）。末尾に `@ 追加`。ASK・アンカー本体・WRITE・ACCEPT・OUT は `removable: false`。
7. **フッター 1 行**: 見積りチップ（§6.8）・router チップ（§6.2.7）・実行経路の切替（⚡ その場で実行 · {engine} / ⤴ 自分のセッションへ · mitori review / ⧉ プロンプトをコピー。クリックで巡回する menu）・［送信 ⌘⏎］。

#### 6.2.6 見積りと router の client 予測（同じフレーム）

chips の変更・本文の変更のたびに、client が次を計算して即座に描く（`ComposerState.predicted`）。サーバの見積りは 300ms の debounce で取り直し、届いたら置き換える（差があれば見積りチップの枠を 0.35s だけ `--accent` で縁取る。数字のアニメーションはしない）。

- `tokensIn = Σ(included の item.tokens) + instr`。`instr = max(40, ceil(本文の文字数 × 0.8))`（本文の 50% 以上が和字のとき。`CHARS_PER_TOKEN["claude-v5"].markdown_ja` = 1.25 の逆数）、それ以外は `ceil(文字数 / 2.87)`。
- `tokensOut` = サーバ見積りの `outTokens`（chips では変わらない）。
- `usd` = `PRICING[model]` で `cached` の item を cache read、残りを input、出力を output として計算（`@mitori/core` の純データだけを使う）。
- router: 意図が質問 / 指摘なら `answer`。修正・doc_edit・メモは `lines = Σ(included の item.lines)`、`files = |{included の item.path}|`（§16 R8）で、`lines ≤ limits.patchMaxLines（120）かつ files ≤ limits.patchMaxFiles（2）` なら `patch`、それ以外は `agent`（AC-J32）。

#### 6.2.7 router チップ

`patch · {行} 行 · {n} ファイル · {model}` / `agent · {n} ファイル > 2 → Read + Edit` / `answer · {model}`。理由が `large_change` のときは `{行} 行 > 120` を添える。hover で「答えだけ: tools なし / patch: 行範囲の差し替えを mitori が適用 / agent: Read と Edit（{files}）だけ。Bash は渡しません」。

### 6.3 margin カードと配置の算法（Editorial §4.1 + JUDGEMENT X14 の上限）

入力は `MarginCardInput[]`（`ui.ts`）、出力は `MarginCardPlacement[]`。純関数 `layoutMarginCards`（30 スレッドの fixture で単体テスト）。

```
1. visible = cards.filter(c => c.visible)        // 見えないアンカー → hidden
2. sort(visible, by ideal asc, then active first, then id)
3. place(list):                                   // 押し下げ配置
     a = index of the active card (or -1)
     if a >= 0:
       y[a] = ideal[a]
       for i = a-1 .. 0:  y[i] = min(ideal[i], y[i+1] - gap - h[i])
       for i = a+1 .. n:  y[i] = max(ideal[i], y[i-1] + h[i-1] + gap)
     else:
       y[0] = max(0, ideal[0]); for i ≥ 1: y[i] = max(ideal[i], y[i-1] + h[i-1] + gap)
     // y ≥ 0 と重なりなしを上から保証
     for i = 0 .. n: y[i] = max(y[i], i == 0 ? 0 : y[i-1] + h[i-1] + gap)
     displace = max_i |y[i] - ideal[i]|
4. while (expandedCount > marginCardsMax(8) or displace ≥ marginMaxDisplacePx(480)):
     c = 次の畳む候補: active でない collapsible="resolved"（answered / resolved）の古い順 → 無ければ "open" の古い順
     if none: break
     c.collapsed = true; h[c] = marginCollapsedPx(32); place(list)
5. 出力: transform: translateY(y) を 280ms（--dur-move, --ease-out）。top は動かさない。
```

- gap = 12px、`h` は ResizeObserver の実測（初回は推定 96px）。
- 畳んだカード: 1 行 32px `✓ 回答済 · {引用の先頭 16 字}` / `● 未解決 · …`。クリックか `]`（`thread.next` で到達したとき）で展開する（展開したカードは active になる）。
- 再計算のきっかけ（すべて 1 回の rAF にまとめる）: prose の ResizeObserver、`details` の開閉（capture の `toggle`）、読者レベルの変更、block の upsert / remove、カードの中身の変化、ウィンドウの resize。
- カードの中身: ヘッダー `{who}（600）· {意図} · {時刻}` + 右端に状態 pill / 引用（2 行で省略、左 2px `--mark`）/ 本文（サーバ描画の HTML `Message.html`（§16 R23）。入るまでは `Message.body` を平文 `white-space: pre-wrap` で描き、`path:a-b` の形だけを出典リンクに変える。client は Markdown を解析しない — §12.7）/ フッター（`R{n}` · 費用 · 返信数）/ 操作（［返信］［解決］［…］）。
- 30 スレッドの節でも、アンカーから 480px 以上離れたカードは 0（AC-J25）。

### 6.4 ジョブカード（JUDGEMENT §6.6）

- **楽観的に作る**（⌘⏎ から 100ms 以内）: temp id のカードを作り、`planStages(route, gates)` の行を淡色（`planned`）で並べ、受付を ✓ にする。`route` は client 予測（§6.2.6）から作り、サーバの `job.upsert` が来たら `Job.route` で置き換える（行が変わるときは差分だけ、行の位置は動かさない）。
- **ヘッダー**: `{状態 pill} あなた → mitori AI · {修正|質問|指摘} · {patch|answer|agent} · {model}` … `{th_id} · R{n}`（th_id は詳しいレベルだけ）。
- **ステージ行**（`StageRow`、12px、行頭に 9px の丸: planned = 枠だけ / now = 回転 / done = `--c-ok` 塗り / failed = `--c-bad` の ✕ / skipped = 灰の ―）。右端に完了時刻（mono 11px、ジョブ開始からの秒）。名前と詳細欄:

| StageKey（`PHASE_TO_STAGE`） | 表示名 | 詳細欄の書式（mono 11px、1 行で省略） |
|---|---|---|
| accept | 受付 | `楽観的に作成 · {ms}ms` |
| prepare | 準備 | `snapshot → refs/mitori/j/{job}/base · dirty {n}` |
| bundle | コンテキスト束 | `MBF/1 · {tok} · {n} 範囲 · router → {mode}（{reason}）` |
| spawn | 起動 | `claude -p …（flags {n}）▸` — クリックで argv 全体を展開してコピーできる（`--setting-sources "" --strict-mcp-config --tools "" --no-session-persistence …`） |
| read | 読み取り | `Read {path}`（agent。tool event ごとに上書き） |
| think | 生成 | `ttft {s}s · {contract} を受信中` |
| verify | 検証 | `引用 {n} 件 · 実在 {m}`（answer） |
| edit | 編集 | `Edit {path}`（agent。patch mode では行を作らず apply の行に含める） |
| apply | 適用 | `patch/1 · {files} files · {hunks} hunks を worktree に適用` |
| scope | 範囲検査 | `{n} files ⊂ WRITE · deny glob 0`（違反は ✕ と `{path} は範囲外`） |
| gate | 検査（gate ごとに 1 行） | `{argv の先頭 60 字}`、結果 `pass {ms}` / `fail` / `untrusted（未承認のため skip）［承認する］` |
| repair | 修復 | `{attempt}/2 · --resume · 失敗の抜粋 {k}` |
| ready | レビュー待ち | — |
| done | 完了 | — |

- **tail 行**: 最新のイベント 1 行（`Read …`、patch/1 なら `ops[n] {path} {a}–{b} {replace|insert}`）。mono 11px、`--paper` の面、最小 2.6em。
- **回答**（answer mode）: tail の下に回答本文を流しながら描く（`job.event` の `text`、10Hz。流れている間は平文 `pre-wrap` + caret、完了して `thread.message` が届いたらサーバ描画の HTML（§16 R23）に置き換える。高さは置き換えの前後で `min-height` を保ち、縮むときは §4.3.9-4 の規則）。
- **フッター**: `{経過} 秒 · 通常 {p25}–{p75} 秒（同じ意図 × モードの過去 {n} 件）· 読み続けて大丈夫です` ［中止］。p25 / p75 は直近 20 件、20 件未満は事前値（answer 4–8s、patch 11–17s、agent 25–40s [仮]）。**% バーと根拠のない残り時間は出さない**（`role="progressbar"` を使わない。WEB-U-032）。
- **ロック待ち**: `🔒 {path} を {th} が編集中のため待機`。
- **失敗**: §4.6.4 と同じ中身をカードに畳んで（［詳細］で展開）。
- 対象 block は AI 作業中の帯（§4.3.4）。`aria-live` は状態の遷移（受付・レビュー待ち・回答・失敗・中止）だけ。

### 6.5 ReadyCard と提案の本文表示

- **ReadyCard**（margin または inline）: `◆ レビュー待ち` · `+{add} −{del} · {files} files · {hunks} hunk` · `設計書 {n} ブロック` · `✓ ゲート {pass}/{total}`（失敗があれば `✕`）· `${usd} · {s}秒` ·［レビュー R］［採用 ⌘⏎］［却下 ⌘⌫］。値は `Job.diffStat`（hunks は §16 R18）、`Job.proposals.length`、`Job.gates`、`Job.usage.apiUsd`、`Job.timings.wallMs`。
- **提案ブロック**（`ProposalBlockProps`。本文のその位置で、元の block の代わりに）: `--sugg-bg` の面 + 左内側 2px `--c-prop`、ヘッダー（12px、`--c-prop`、600）`提案 · mitori AI（{model}）· R{n} · {本文|表|図}` + 右に［✓］［✕］（各 28×28、`aria-label`「この提案を採用 / 却下」）。本文は `diffHtml`（サーバ）: 削除 `del.d`（取り消し線 1.5px、`--del-fg` on `--del-bg`）、挿入 `ins.a`（下線 1.5px・offset 3px、`--add-fg` on `--add-bg`）。表の行の追加は行全体を `--add-bg` + 先頭セルに左 2px `--c-ok`。
- 採用後: block の下に 1 行の履歴 `R1 AI 生成 → R2 AI 修正（{th} · 採用: あなた）`（12px `--muted`）。カードは 1 行 `✓ R2 で解決 · 適用済み · checkpoint {ref} · ${usd} · {s}秒［元に戻す ⌘Z］`。

### 6.6 DiffView

- **2,000 行未満**（`staticDiffMaxLines`）: client が `FileDiff[]` から**文字列で**組み立てた静的 HTML を 1 回 `{@html}` で入れる（行ごとの Svelte コンポーネントは作らない）。構造:
  ```html
  <section class="dfile" data-path="…">
    <header class="dfile-h">…{path} +{a} −{d} [✓][✕]</header>
    <div class="hunk" data-hunk="{path}:{oldStart}">
      <div class="hunk-h">@@ -{os},{ol} +{ns},{nl} @@ {symbol} [✓][✕]</div>
      <div class="dl add" data-line><span class="o"></span><span class="n">{ns+i}</span><span class="sg">+</span><code>…</code></div>
      …
  ```
  ファイルヘッダーと hunk ヘッダーはパネル内で sticky（`--z-sticky`）。行は旧 / 新の 2 列の行番号 + 記号（`+` / `−`、色だけに頼らない）+ 本文（`pre-wrap`、長い行は折り返して 1.5em 字下げ）。追加行 `--add-bg` / 本文色 `--add-code`、削除行 `--del-bg` / `--del-code`、語単位の差分 `--add-hl` / `--del-hl`。構文の色はサーバの Shiki ではなく**付けない**（diff の HTML は client が組むため。2,000 行未満でも構文色が要るなら §16 R7 の server-side diff HTML を待つ）[仮]。
- **2,000 行以上、または Split**: `cm6` + `merge` chunk（≤ 135KB gz）を読み、`@codemirror/merge` の unified / split で表示する（内部で仮想化される）。構文の色は付けない（言語パックを読まない）[仮]。hunk の採否は CM6 の外のヘッダー一覧（パネル上部の hunk ナビ）で行う。
- 委譲: パネルのルート 1 か所で click（✓ / ✕ / ヘッダー）を受ける。

### 6.7 取り消し（Undo）のモデル

| 操作 | 取り消しの仕組み | 窓 | 窓の後 |
|---|---|---|---|
| 採用 | checkpoint（`POST /checkpoints/:ck/undo`） | トースト 10s + ⌘Z（入力欄の外。`undo.last`） | block の履歴、Inbox の「解決済み」から［元に戻す］（`GET /checkpoints` に残る限り） |
| 却下 | **遅延確定**: UI だけ却下にし、10s 後（またはこの workspace を離れる / `pagehide`）に `POST /jobs/:job/reject`（`fetch(..., {keepalive:true})`） | トースト 10s + ⌘Z（タイマーを止めて元に戻す。API 呼び出しなし） | 戻せない（thread は reopen で再依頼できる） |
| 下書きの破棄 | 遅延確定（10s 後に `DELETE /threads/:th`） | トースト 10s | 戻せない |
| 設計書を直す（doc_edit apply doc） | block の履歴の 1 つ前の rev を `POST /doc/blocks/:block/edit {apply:"doc", md: 前の md}` | トースト 10s | block の履歴から |
| 読者レベル・テーマ等 | 即時に戻せる操作なので Undo を出さない | — | — |

- undo の結果 `diverged` が空でなければ dialog:「採用の後に {n} 個のファイルが変更されています: {files}」［それでも戻す（変更を失います）］［そのままにする］。前者は `{force:true}`。
- 取り消しが成功したら `undo.done`。block は提案状態に、thread は open に戻る（SSE で）。

### 6.8 見積りチップ・内訳・確認

- **見積りチップ**（`EstimateChipProps`）: `≈{in}k in · ≈{out}k out · ${usd} · 約{p25}–{p75}秒` と先頭の色帯の点（`--band-*`: 10k 未満 / 10〜50k / 50〜200k / 200k 超。`bandOf`）。mono 11px、`--paper-2` の面、角丸 5px、高さ 24px。
- **内訳の popover**（hover / focus、270px）: チップごとの tok（固定部分は `cache`）、指示（本文）、出力（思考込み）、合計の tok と $、単価の注記（`claude-sonnet-5-5: 入力 $2/M · cache read $0.2/M · 出力 $10/M`。`PRICING`）、`見積り精度 ±{p}%（n={件数}）`（`Estimate.confidencePct`、`calibrationN`）。
- **確認**（`Estimate.requiresConfirm`）: ダイアログではなく**カードの中で**確認の形に切り替える（JUDGEMENT の「100k 超の確認ダイアログは Push の依頼にだけ」を、カード内の確認として実装）:
  `この依頼は ≈{k} tok（${usd}）です · 理由: {confirmReasons}`［実行 ⌘⏎］［範囲を絞る］［プロンプトをコピー］。理由の文言: `over_token_threshold` 100k tok を超えます / `whole_repo_scope` repo 全体が対象です / `escalation` 上位モデルでの提案のみの実行です / `billing_overage` 従量で課金されます / `api_key_billing` API key で課金されます。
- 「範囲を絞る」は Composer を開き直し、候補でない chips を外せる状態にする。

### 6.9 状態の glyph と verdict（形 + 色 + ラベル）

`ui.ts STATUS_PRESENTATION`（ラベルは `status.<key>`）:

| UiStatus | glyph | 色 | ja | en |
|---|---|---|---|---|
| draft | 点線の ○ | `--muted` | 下書き | Draft |
| needs_choice | ? の丸 | `--c-warn` | 要選択 | Needs choice |
| open | ● | `--ink` | 未解決 | Open |
| queued | ○ | `--muted` | 待機 | Queued |
| waiting_lock | 錠前 | `--c-warn` | ロック待ち | Waiting for lock |
| running | ◐ | `--c-run` | 実行中 | Running |
| gating | ◐ | `--c-run` | 検査中 | Checking |
| repairing | ◐ | `--c-run` | 修復中 | Repairing |
| ready | ◆ | `--c-prop` | **レビュー待ち** | Ready for review |
| applied | ✓ の丸 | `--c-ok` | 適用済み | Applied |
| partially_applied | ◑ | `--c-ok` | 一部適用 | Partially applied |
| answered | 吹き出し | `--c-ok` | 回答済 | Answered |
| needs_input | ? の丸 | `--c-warn` | 返信待ち | Needs your reply |
| failed | ✕ の丸 | `--c-bad` | 失敗 | Failed |
| outdated | ▲ に ! | `--c-warn` | outdated | Outdated |
| stale | ↻ | `--c-warn` | 再確認 | Re-check |
| reverted | ↺ | `--muted` | 取り消し | Reverted |
| rejected | ✕ | `--muted` | 却下 | Rejected |
| cancelled | ― | `--muted` | 中止 | Cancelled |
| resolved | ✓ の丸 | `--c-ok` | 解決済み | Resolved |

- 操作の語: **採用 / 却下 / 元に戻す**（Accept / Reject / Undo）。トーストだけ「反映しました」。
- verdict（§4.3.5）: コードで確認済 ✓ / 確認済 by @name ✓✓ / 推測 〜 / 古い可能性 ⚠ / 裏付けなし ✕（gen spec §7.3 のラベル。色は本書）。
- glyph は inline SVG の sprite（`<symbol id="g-…">`、`aria-hidden="true"`）。ラベルは見える文字で併記する（pill）か、glyph だけの場所では `aria-label`。

### 6.10 出典チップ・peek・用語カード

§4.3.6・§4.3.7。

### 6.11 ジョブチップの popover

440px。`◐ 実行中` / `🔒 ロック待ち` / `◆ レビュー待ち` の群で job を並べ、各行 `{状態} {題名} · {mode} · {経過 or 費用}`。項目で Enter → そのカードへスクロール（カードが閉じた節にあればその節を開く。AC-J34）。下端に「Inbox の作業中を見る」。チップとステータスバーの件数は `JobState` の変化から SSE 1 イベント以内に一致する。

---

## 7. 読者レベル・読書パス・用語集

### 7.1 読者レベルの適用（`READER_LEVEL_RULES`、ネットワークなし、≤ 50ms）

`html[data-level]` の CSS だけで切り替える（JS は data 属性を書き、margin の再配置を 1 回走らせるだけ）。

| 規則 | newcomer（初めて） | standard（標準） | expert（詳しい） | CSS（`styles/levels.css`） |
|---|---|---|---|---|
| L3 block・Deep Dive | 隠す +「詳しく（n）」チップ | Deep Dive を閉じて表示 | 展開 | `[data-level=newcomer] .blk[data-depth=L3], [data-level=newcomer] .mdeep { display:none }`、`.more-chip` を表示。Deep Dive の開閉はサーバ HTML の `<details>` に client が `open` を付け外し（level 変更時に 1 回） |
| 出典 | 段落末の「出典 n」 | 文中 `{base}:{line}` | 文中 `{dir/}{base}:{a}–{b}` + ガターに ✓ と Markdown の行番号 | `.mcite .cs / .cl` の表示切替、`.cite-end` |
| 用語の下線 | 全部 | 節ごとの初出だけ（`data-first`） | なし（hover は有効） | `.mterm` の background-image |
| Why | 開く | 閉じる | 閉じる | `details.why` の `open` |
| 行番号 | 出さない | 出さない | 出す | `.blk::after { content: "L" attr(data-ln) }` |
| やさしく | 表示（cache 済みのもの） | 隠す | 隠す | `.easy` |
| 文脈列の既定 | margin | margin | code | §4.4 |

- **位置を保つ**: 切り替えの直前に「viewport の上端（header 下）以降で最初に見えている block」と、その `top` を記録し、切り替え後に同じ block の `top` へ `scrollBy` する。その block が隠れたら、直前の見える block を使う。ずれ ≤ 4px（AC-J20）。
- 永続化: cookie `lv` と `PATCH /settings ui.readerLevel`（debounce 1s）。S1 でも変えられる（ヘッダー）。

### 7.2 読書パス

- 既定のパス（gen spec §4.3、0 tok）: 5 分 = §0 → 1 → 2 → 3 の要約 / 30 分 = §0–5 と §6 の主要モジュール 2 つ / レビュアー = §6・9・10・11・13 / PM = §0・1・3・11・13 / SRE = §4・8・9・11。repo の `readingPaths` があれば追加。
- 選んだパスは `sessionStorage` `mitori:path:<ws>`。rail のカード、章末の pager、⌘K「次に読む」で使う。
- 完了したら「30 分コースを読み終えました · 次: レビュアー向け（§6・9…）」の 1 行（トーストではなく rail のカードに）。

### 7.3 用語集（よみ・ローマ字）

- データ: `GlossaryEntry`（term・yomi・romaji・en・definition・usedIn・symbol）。yomi と romaji は生成時に LLM が書き、サーバが Hepburn → 小文字・空白なしに正規化する（`romaji`）。palette の項目には `y` = yomi、`r` = romaji、`al` = [en, 別表記]（§16 R1）。
- ⌘K で `mochi`・`mochikoshi`・`motikosi`・`もちこし`・`carry` のどれでも「持ち越し」が先頭（AC-J46）。シンボルが用語に結び付いていれば（`via`）、`carryForwardComments` も「「持ち越し」経由」で出る。
- 初出の判定: サーバが block HTML の `abbr.mterm` に `data-first`（節ごとの最初の出現）を付ける（§16 R15）。

---
## 8. キーボード

### 8.1 処理の流れ（capture 段の 1 つのハンドラ）

すべての `keydown` / `keyup` は `keys/registry.ts` の `window.addEventListener("keydown", onKey, {capture: true})` 1 か所で受ける（component に keydown を書かない。例外は Composer の textarea と palette の input で、どちらも先頭で `isComposing(e)` を呼ぶ。lint `mitori/ime-guard`）。

```
onKey(e):
  1. if isComposing(e):                                   // §8.6
       if e.keyCode === 229 && !isEditable(e.target) && !hintShown: toast("hint.imeOn"); hintShown = true
       return                                              // 何も発火しない・preventDefault もしない
  2. layer  = layers.top()                                 // composer / palette / dialog / …
     scopes = layer ∈ {composer, palette} ? ["global", layer]
            : ctx.mode === "review" && focusInsideReviewPanel ? ["global", "review"]
            : ROUTE_SCOPES[viewKind(route)]
  3. if isEditable(e.target):
       if target ∉ composer/palette: allow only "palette.open"; else return   // 入力欄の中ではブラウザの編集キーを奪わない
       if target ∈ composer: allow only composer scope + "palette.open"
  4. chord = canonical(e)                                  // §8.2
     if pending("g") && now - pendingAt ≤ KEY_SEQUENCE_TIMEOUT_MS:
       chord = "g " + chord; clearPending()
     else if chord === "g" && !hasSingle("g", scopes):
       setPending("g"); preventDefault(); return            // status bar に「g …」
  5. def = first match in scopes (top layer → route scope → global)
     if !def: return
     if def.singleKey && settings.ui.singleKeyShortcuts === false: return
     if !when(def.when): return                             // 例: undo.last はトースト表示中だけ
     if e.repeat && !REPEATABLE.has(def.id): preventDefault(); return
  6. e.preventDefault(); handler(def.id)(e)
     performance.mark("mitori:shortcut:handled", {detail: {trigger: e.timeStamp, id: def.id}})
```

- `REPEATABLE` = `read.next`, `read.prev`, `inbox.next`, `inbox.prev`, `review.nextHunk`, `review.prevHunk`, `map.pan`, `palette.next`, `palette.prev`。
- `isEditable(t)` = `input` / `textarea` / `select` / `[contenteditable]` / CodeMirror の editor 内。
- 反応 ≤ 50ms / 100ms（AC-J62、mark で測る）。

### 8.2 binding の文法と照合（`ui.ts KeyBinding`）

- 文法: `chord | chord " " chord | "hold:" mod`、`chord := (mod "+")* key`、mod = `Mod` `Ctrl` `Alt` `Shift`。保存形は **mod をアルファベット順**（`Alt+Ctrl+Mod+Shift+<key>`）に正規化した文字列（例 `Alt+Mod+Enter`）。
- `Mod` = macOS は `metaKey`、それ以外は `ctrlKey`。`Ctrl` は常に `ctrlKey`（macOS の `⌃N` 用）。OS の判定は `navigator.userAgentData?.platform ?? navigator.platform`。
- 英字・数字は `KeyboardEvent.code` で照合する（`KeyJ` → `j`、`Digit1` / `Numpad1` → `1`）。IME の全角入力（`key: "ｊ"`）や英字以外の配列でも物理キーで効く（JUDGEMENT §6.14）。`Shift+1` は `Digit1` + `shiftKey`（US の `!`・JIS の `!` のどちらでも同じ）。
- 記号 `/ ? - = [ ] @ , .` は `KeyboardEvent.key` で照合し、`shiftKey` を無視する（JIS で `=` は Shift+`-`、`?` は Shift+`/`）。Mod / Ctrl / Alt が付いていれば一致しない。
- 名前付きキー: `Enter Escape Backspace Tab Space ArrowUp ArrowDown ArrowLeft ArrowRight Home End PageUp PageDown`（`key`）。
- 表示は `KeyRegistry.label`: macOS `⌘ ⌃ ⌥ ⇧ ⏎ ⌫ ⎋`、それ以外 `Ctrl+`・`Alt+`・`Shift+`・`Enter`。kbd は mono 11px。

### 8.3 scope の決め方（route 単位。ポインタの位置では決めない）

| 表示中 | 有効な scope | 備考 |
|---|---|---|
| S0 / S6〜S9 | global | |
| S1 | global + map | `-`/`=`/`0` は地図のズーム。読者レベルはヘッダーと ⌘K だけ（AC-J55） |
| S2 / S3 | global + read | `-`/`=`/`0` は読者レベル |
| S2 で review モード（フォーカスがパネル内） | global + review | パネル外の prose にフォーカスを戻すと read に戻る（Tab / クリック） |
| S4 | global + inbox | |
| Composer にフォーカス | global + composer | 入力欄の中なので、composer の 4 種 + ⌘K 以外は無視 |
| パレット | global + palette | |
| dialog | global（Escape だけ） | dialog 内の操作はボタンとフォームの標準キー |

### 8.4 既定のキーマップ（`ui.ts DEFAULT_KEYMAP` の全項目）

| id | キー | scope | 動作 | when |
|---|---|---|---|---|
| palette.open | ⌘K | global | パレット（項目の上でもう一度押すと Action panel） | |
| search.inDoc | `/` | global | 本文検索（crumb「本文」付きのパレット） | |
| help.shortcuts | `?` | global | ヘルプ | |
| nav.map / doc / inbox / code / review / settings | `g h` / `g d` / `g i` / `g c` / `g r` / `g s` | global | 見取り図 / 設計書 / Inbox / コード（最後に開いたファイル）/ レビュー / 設定 | |
| pane.nav | `b` | global | rail の開閉（< 1024 は drawer） | |
| pane.toc | `t` | global | 目次の先頭（現在の行）へフォーカス | |
| pane.threads | ⇧C | global | スレッドカード / ピンの表示切替 | |
| undo.last | ⌘Z | global | 直前の採用・却下・破棄を取り消す | undoAvailable |
| layer.close | Escape | global | 最上位のレイヤーを閉じる（§3.6） | |
| read.next / read.prev | `j` / `k` | read | 次 / 前の block へフォーカス（見えない block は飛ばす） | |
| read.chapter | `1`〜`9` | read | §1〜§9 のページへ | |
| thread.prev / thread.next | `[` / `]` | read | 前 / 次のスレッドカード（畳んだカードは展開） | |
| peek.pin | `o` | read | 出典を文脈列に固定 / 解除 | |
| peek.openEditor | ⇧O | read | エディタで開く | citeFocused |
| copy.permalink | `y` | read | permalink をコピー | |
| copy.prompt | `p` | read | プロンプトとしてコピー | targetOrSelection |
| cites.showAll | ⌥ 長押し | read | 押している間、全出典と ✓ を表示（150ms 後 [仮]） | |
| act.comment / act.explain / act.fix | `c` / `e` / `f` | read | 選択範囲（無ければフォーカス中の block）に Composer（メモ / 質問 / 修正） | targetOrSelection |
| select.visual | ⇧V | read | visual mode（block を選び、`j`/`k` で広げる。S3 では行範囲） | |
| review.finish | ⇧F | read | レビューを終える（Finish dialog） | |
| threads.hideResolved | `h` | read | 解決済みのカードを隠す / 出す | |
| review.open | `r` | read | レビュー待ちの最古の提案を開く（フォーカス中の block の提案があればそれ） | readyJobExists |
| level.down / up / reset | `-` / `=` / `0` | read | 読者レベルを 初めて側へ / 詳しい側へ / 標準 | |
| map.zoomIn / zoomOut / fit | `=` / `-` / `0` | map | ズーム段を 1 つ上 / 下 / fit | |
| map.pan | ↑↓←→ | map | stage にフォーカス: パン / 部屋にフォーカス: 隣の部屋へ | |
| map.flow | ⇧1〜⇧5 | map | §3.1〜§3.5 の流れを重ねる（もう一度で消す） | |
| inbox.next / prev | `j` / `k` | inbox | 選択を移す | |
| inbox.select | `x` | inbox | 複数選択の切替 | |
| inbox.choose | `1` / `2` | inbox | doc_edit の 2 択 | |
| inbox.finish | ⇧F | inbox | まとめて送る | pendingThreads |
| inbox.hideResolved | `h` | inbox | 解決済みを隠す / 出す | |
| review.nextHunk / prevHunk | `n` / ⇧N | review | 次 / 前の単位（hunk → 提案）へ | |
| review.accept | ⌘⏎ | review | フォーカス中の単位（開いた直後は全体）を採用 | |
| review.reject | ⌘⌫ | review | フォーカス中の単位を却下 | |
| review.acceptAll | ⌥⌘⏎ | review | すべて採用 | |
| review.widen | ⇧R | review | 全幅の overlay に広げる / 戻す | |
| review.prevJob / nextJob | `[` / `]` | review | 前 / 次のレビュー待ち | |
| composer.submit | ⌘⏎ | composer | 送信 | |
| composer.intent | ⌘1〜⌘4 | composer | 質問 / 修正 / 指摘 / メモ | |
| composer.mention | `@`（語頭） | composer | context を追加（`input` で検出） | |
| composer.close | Escape | composer | 閉じる（下書きは保持） | |
| palette.next / prev | ↓ / ↑（⌃N / ⌃P） | palette | 移動 | |
| palette.run | ⏎ | palette | 実行 | |
| palette.actions | ⌘K | palette | Action panel | |
| palette.back | ⌫ | palette | 1 階層戻る | inputEmpty |

- `RESERVED_KEYS`（再割当て不可、他の動作にも割り当てられない）: Escape、Tab、⇧Tab、Enter、⌘⏎、⌘K、`?`。
- 既定のキーマップは、同時に有効になる scope の組（§8.3）の中で衝突 0（snapshot テスト。AC-J55）。同じキーが別 scope にあるのは意図した重なり（`-`/`=`/`0`、`j`/`k`、`[`/`]`、⇧F、⌘⏎、⌘K）で、同時には有効にならない。
- ⌘1〜⌘4 はブラウザのタブ切替と重なる。Composer にフォーカスがあるときだけ `preventDefault` する。Safari / Firefox で奪えない環境があれば ⌥1〜⌥4 を既定に切り替える [仮]（IME 実機マトリクスと同じ回で確認）。

### 8.5 再割当て・衝突・単一キーのオフ

- 設定 → ショートカット: 表（動作 · scope · キー · ［変更］［既定に戻す］）。［変更］→ その行が「新しいキーを押してください（Esc で中止）」になり、次の keydown（IME guard を通したもの）を chord にする。`g` の後 1 秒以内のキーで sequence も登録できる。
- 検証: 予約キー → 「このキーは予約されています」/ 衝突（同時に有効な scope の別の動作）→「{動作} と重なります」［入れ替える］［やめる］/ 不正 → 「このキーは割り当てられません」。
- 保存: `PATCH /settings {patch: {ui: {keymap: {<id>: "<binding>"}}}}`（1 動作 1 binding で既定を置き換える）。複数キーの族（`read.chapter`、`composer.intent`、`map.flow`、`map.pan`、`inbox.choose`、`palette.next/prev`）は再割当ての対象外。
- 単一キーのオフ（`ui.singleKeyShortcuts = false`。WCAG 2.1.4）: `singleKey: true` の動作は 1 つも発火しない（AC-J56）。ヘルプでは取り消し線。同じ動作はボタン・⌘K・修飾キー付きの既定（⌘K、⌘⏎ など）で使える。

### 8.6 IME（日本語入力）の規則

| # | 状況 | 期待 | 試験 |
|---|---|---|---|
| I1 | Composer で変換中の Enter（`isComposing:true`） | 送信しない・改行もしない（IME が確定する） | WEB-U-001 |
| I2 | Safari 順序（`compositionend` → keydown Enter、`keyCode:229`） | 送信しない | WEB-U-002 |
| I3 | 同上で keyCode 13 の実装 | `compositionend` と同じタスクの Enter を抑止 | WEB-U-003 |
| I4 | 非変換中の ⌘⏎ | 送信 | WEB-U-004 |
| I5 | 非変換中の Enter | 改行（送信しない） | WEB-U-005 |
| I6 | 変換中の Escape | 変換だけ取り消し、Composer は閉じない | WEB-U-006 |
| I7 | 非変換中の Escape | 閉じる（下書きは保存済み。確認しない） | WEB-U-007 |
| I8 | 非 editable にフォーカス、`key:"Process"` `keyCode:229` | **何も発火しない**。初回だけヒント `hint.imeOn`（Δ4。testing WEB-U-008 の期待をこれに改める — §16 X1） | WEB-U-008 |
| I9 | editable の中で同じイベント | 何も発火しない | WEB-U-009 |
| I10 | 全角 `key:"ｊ"` `code:"KeyJ"`（keyCode ≠ 229） | `read.next`（code で照合） | WEB-U-010 |
| I11 | 変換中の記号 `/ ? - = [ ]` | 無効 | WEB-U-011 |
| I12 | パレットで変換中 | `input` で絞り込みは続け、Enter は確定後だけ実行 | E2E-10 |
| I13 | タッチ端末 | 送信は［送信］ボタンだけ（キーボードでは送信しない） | — |

- 実機マトリクス（ことえり / Google 日本語入力 / MS-IME × Chrome / Safari / Edge）は testing spec §5.3 の 6 項目 + 本書の I8・⌘1〜4 を加えた 8 項目で、P1 出口までに macOS の行を全部 pass にする。

### 8.7 sequence と長押し

- `g` の後 1,000ms 以内（`KEY_SEQUENCE_TIMEOUT_MS` [仮]）の 2 打目を見る。待機中はステータスバーに `g …`。一致しない 2 打目は捨てる（その 2 打目で別の単一キーを発火しない）。Escape で取り消す。
- ⌥ 長押し: Alt 単独の keydown（repeat でない、他の修飾なし）から 150ms で `html.show-cites` を付け、keyup・`blur`・別のキーの keydown で外す。⌥⌘⏎ などの組み合わせ中は発火しない。

---

## 9. i18n

### 9.1 カタログ

- ファイル: `apps/web/src/i18n/ja.json` / `en.json`（平坦な key → 文字列）。ビルドで `i18n-ja` / `i18n-en` chunk（各 ≤ 9KB / 8KB gz [仮]）にし、**表示中の言語だけ**を読む（head script が modulepreload）。言語の切替はもう一方を動的 import して `$state` の `lang` を変えるだけ（再読み込みしない）。
- キーの文法（`I18N_RULES.keyPattern`）: `<namespace>.<…>`、2〜5 段、小文字始まりの lower camel。namespace:

| namespace | 中身 |
|---|---|
| `brand` `app` `nav` `header` `statusbar` `banner` `toast` `hint` | shell |
| `launcher` `map` `gen` `doc` `reader` `level` `cite` `verdict` `term` `ctx` `code` | 読む面 |
| `seltool` `composer` `estimate` `router` `job` `stage` `ready` `review` `diff` `finish` `undo` | ループ |
| `inbox` `palette` `help` `shortcut` `settings` `trust` `export` | その他の画面 |
| `status` | `UiStatus` の全キー |
| `error` | `ERROR_CODES` の全キー（`error.E_xxx`） |
| `notice` | SSE `notice` の key（§16 R16 の `NOTICE_KEYS`） |
| `exclude` `policy` `idx.rule` | `ExcludeReason`、データ方針、indexer の rule id |
| `fmt` | 単位（`fmt.tok` = tok、`fmt.sec` = 秒 / s、`fmt.min` = 分 / min、`fmt.apiEquiv` = API換算 / API-equiv.） |
| `a11y` | 画面読み上げ専用の文（`sr-only`、`aria-label`） |

### 9.2 文字列の形式

- placeholder `{name}`（`I18N_RULES.placeholder`）。値は `t(key, params)` で埋める。数・token・$ は呼び出し側で `fmt*` してから渡す（カタログに書式を書かない）。
- 複数形: en だけ意味がある。キーを `.one` / `.other` の組で**両方のカタログに**置き（ja は同じ文）、`Intl.PluralRules(lang)` で選ぶ。
- 強調: `<b>…</b>`、`<kbd>…</kbd>`、`<code>…</code>` の 3 タグだけ。40 行の parser でノードにし、`innerHTML` を使わない。parity テストでタグの集合も一致を見る。
- 和欧間の空白: **ja の値に「和字 + 半角空白 + 英数字」「英数字 + 半角空白 + 和字」を書かない**（placeholder は `1` / `a` に置き換えてから検査）。`{n}件` のように詰めて書き、`text-autospace` に任せる。
- 文体: ja は常体の短文（ボタンは体言止めか動詞の終止形:「採用」「レビュー」「生成する」）、説明文は です・ます。en は sentence case。

### 9.3 書式の関数（`ui.ts NUMBER_FORMAT`、純関数、表駆動の単体テスト）

| 関数 | 規則 |
|---|---|
| `fmtTokens(n, {approx, main})` | < 1,000 はそのまま。≥ 1k は小数 1 桁の `k`（`2.5k`）、≥ 1M は小数 2 桁の `M`（`0.38M`）。見積りは `≈`、主行の推定値は `約`（en `~`） |
| `fmtUsd(n, ctx)` | job 3 桁（`$0.018`）/ day・gen 2 桁（`$1.33`）/ genMain 1 桁（`$1.3`） |
| `fmtDuration(ms, ctx)` | < 60s は小数 1 桁の `秒` / `s`。gen は `約{n}分` か `m:ss` |
| `fmtDelta(a, e)` | `（実績 3.9k · −2%）`（マイナスは U+2212） |
| LOC | 文中 `45.7k LOC`、表 `45,672`（`Intl.NumberFormat`） |
| 日時 | `Intl.DateTimeFormat(lang, {dateStyle:"medium", timeStyle:"short"})` |
| 相対時刻 | `Intl.RelativeTimeFormat(lang, {numeric:"auto"})`。**ja は数字と和字のあいだの空白（U+0020 / U+00A0 / U+202F）を除く**（`3 日前` → `3日前`、表示の間隔は `text-autospace`） |

### 9.4 UI の言語と設計書の言語

- `<html lang>` = UI 言語（`detectUiLang`: cookie → `GlobalSettings.ui.lang` → `navigator.language`（`ja*` なら ja、それ以外は en）→ ja）。
- 設計書の本文は `<article lang={BlockView.htmlLang}>`。UI を EN にしても本文の言語は変えない（D5、AC-J15）。翻訳は §4.3.13。
- コード・識別子・パスには `translate="no"`。thread の本文は、和字が 30% 以上なら `lang="ja"`、それ以外は `lang="en"` を付ける（読み上げの音声を合わせる）。
- **chrome の印**: chrome の部分木に `data-chrome` を付け、利用者の内容（設計書の本文、thread の本文、workspace 名、ファイル名）には `data-user-content` を付ける。EN 表示で `[data-chrome]` から `[data-user-content]` を除いた可視テキストに和字が 0 文字（AC-J12）。

### 9.5 試験と lint

1. `scripts/i18n-parity.ts`（L0、≤ 1.5s）: ja / en のキー集合が一致、キーごとの placeholder 集合とタグ集合が一致、`.one` / `.other` が組で両方にある、必須の族（`error.<ERROR_CODES>`、`status.<UiStatus>`、`stage.<StageKey>`、`shortcut.<ShortcutId>`、`verdict.<Verdict>`、`notice.<NOTICE_KEYS>`、`exclude.<ExcludeReason>`）が全部ある、ja の値に非 ASCII を少なくとも 1 文字含む（`sameValueAllowlist` を除く）、en の値に和字が 0、ja の値に和欧間の半角空白が 0。
2. lint `mitori/no-ja-literal`: `apps/web/src/**/*.{svelte,ts}` の文字列リテラル・テンプレート・markup のテキストに `[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}]` があれば fail（`i18n/*.json` と `**/*.test.ts` の fixture は除く）。
3. テストビルドの `t()` は欠落キーで `console.error("[i18n-missing] <key>")`（testing RQ-UI-3）。テストは文言を直書きせず catalog から引く。
4. e2e: EN で 12 状態（AC-J10 と同じ）を撮り、`[data-chrome]` の和字 0。

### 9.6 用語の対訳（UI の語彙を固定する）

| ja | en | ja | en |
|---|---|---|---|
| 見取り図 | Floor plan | 設計書 | Design doc |
| 出典 | Source | 推測 | Inferred |
| コードで確認済 | Verified in code | 古い可能性 | May be stale |
| 確認済 by @name | Confirmed by @name | 裏付けなし | Unsupported |
| 採用 / 却下 / 元に戻す | Accept / Reject / Undo | 反映しました | Applied to working tree |
| レビュー待ち | Ready for review | 適用済み | Applied |
| 見積り | Estimate | API換算 | API-equivalent |
| 5h枠 | 5h window | 生成する | Generate |
| 初めて / 標準 / 詳しい | Newcomer / Standard / Expert | 読書パス / 30分コース | Reading path / 30-minute course |
| 質問 / 修正 / 指摘 / メモ | Ask / Fix / Review / Note | まとめて送る | Send as batch |
| 自分のセッションへ | To my session | プロンプトをコピー | Copy as prompt |
| 部屋 / 区画 / 扉 | Room / Zone / Door | テキストで見る | View as text |

---

## 10. 組版（JLREQ）と書体

### 10.1 書体の使い分け（`FONT_STACKS` = `design-tokens.css`。CI で文字列を比較）

| stack | 用途 | 先頭 |
|---|---|---|
| `--font-ui` | chrome（ヘッダー・ボタン・カード・表のヘッダー） | `-apple-system, BlinkMacSystemFont, "Hiragino Sans", …, "Segoe UI", "Yu Gothic UI", Meiryo, …` |
| `--font-prose` | 設計書の本文、Composer の本文、thread の本文 | Windows で `"BIZ UDPGothic", Meiryo` を Yu Gothic UI より先に（Δ5 [仮]） |
| `--font-serif` | **章見出し・節番号・図の題・見積りカードの題・プロジェクト名・ロゴ・Inbox / Review の題名だけ** | `ui-serif, "Iowan Old Style", "Hiragino Mincho ProN", "YuMincho", "Yu Mincho", …` |
| `--font-mono` | コード、出典チップ、数値、id、kbd、ステータスバー | `ui-monospace, "SF Mono", Menlo, Consolas, "Cascadia Mono", "BIZ UDGothic", …`（リガチャ off） |

- Web フォントは 0 byte（`@font-face` を書かない。lint `mitori/no-font-face`。実配信で `font/*` の応答 0）。
- `system-ui` は使わない（Windows で細い Yu Gothic UI が当たる、07 §4.1）。

### 10.2 本文の規則（`styles/prose.css`）

```css
html { text-autospace: normal; }                     /* 継承させる（li・td にも効く。JUDGEMENT §6.13-5） */
.prose {
  font: var(--fw-regular) var(--fs-body) / var(--lh-prose) var(--font-prose);
  letter-spacing: var(--ls-prose);                   /* .012em（ja） */
  max-width: var(--measure-prose);                   /* 37em = 36〜38 字 */
  color: var(--text);
  overflow-anchor: none;                             /* §4.3.9-5 の手動補正と二重にしない */
}
.prose:lang(en), :root:lang(en) .prose:not(:lang(ja)) { line-height: var(--lh-prose-en); letter-spacing: 0; }
.prose :is(p, li, dd, td, th, blockquote, figcaption) {
  line-break: strict; overflow-wrap: anywhere; text-wrap: pretty; text-spacing-trim: trim-start;
}
.prose :is(h1, h2, h3, h4) { word-break: auto-phrase; text-wrap: balance; }
.prose :is(b, strong) { font-weight: var(--fw-strong); color: var(--ink); }
.prose :lang(ja) em, .prose:lang(ja) em { font-style: normal; font-weight: var(--fw-strong); }   /* 和文に斜体を使わない */
.prose code { font: var(--code-font-scale) / 1 var(--font-mono); font-variant-ligatures: none;
              background: var(--code-bg); padding: .08em .36em; border-radius: var(--r-chip); overflow-wrap: anywhere; }
.prose :is(table, .meter), .num { font-variant-numeric: tabular-nums; }
.sec-num, .prose h2 .hn { font-variant-numeric: oldstyle-nums; }
```

1. 本文 16px / `line-height` 1.9（ja）・1.6（en）/ 37em（1 行 36〜38 字。AC-J13）。リード（§0）は 18px / 1.85 / `--ink`。
2. 禁則は `line-break: strict`（行頭の小書きかな・長音・閉じ括弧）。本文に `word-break: keep-all` も `auto-phrase` も使わない（見出しだけ `auto-phrase`）。
3. 和欧間は `text-autospace: normal`。**原稿（生成した Markdown）にも UI 文言にも半角空白を入れない**。生成した Markdown にはコードスパンとリンクの外側で `[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}]` と `[A-Za-z0-9]` のあいだの半角空白 1 個を除く正規化を決定的にかける（doc writer の責務。AC-J14）。GitHub での見え方は JUDGEMENT §11-2 の評価で方針を確定する。
4. 太字は 600 だけ（700 は Hiragino で W6 を飛ばすことがある）。weight は 400 と 600 だけ（lint `mitori/no-fw-weight`）。
5. 見出し: 章 h1 明朝 34px / 600 / 1.35 / `.02em`、節 h2 明朝 22.5px / 600 / 1.45、h3 角ゴ 15px / 600。節番号は明朝の `oldstyle-nums`、`--faint`。
6. 段落の間隔は block の下 14px（`p { margin: 0 }`）。リストは `padding-left: 1.2em`、`::marker` は `--muted`。
7. 対応状況: `text-autospace` は Chrome 140 / Safari 18.4 / Firefox 145 以降、`text-spacing-trim` は Chrome 123 以降、`word-break: auto-phrase` は Chrome 119 以降。効かない環境では詰まって見えるだけで崩れない（原稿に空白を入れる方針には戻さない。JUDGEMENT §11-10 で確認）。

### 10.3 UI の文字の大きさ

- **画面上のテキストは 11px 以上**（SVG のラベルを含む）。**操作要素のラベルは 12px 以上**。11px を使ってよいのは mono のメタ情報（出典チップ・時刻・id・kbd・件数）とバッジの数字だけで、その組み合わせが 4.5:1 以上のとき（AC-J11、R5）。
- 既定の chrome は 13px、ボタン 13.5px、カードの本文 13px、表のヘッダー 12px。
- 数値が並ぶ所（メーター・カウンタ・表）は `tabular-nums`。

---

## 11. アクセシビリティ（WCAG 2.2 AA）

### 11.1 達成基準ごとの実装と試験

| SC | 実装 | 試験 |
|---|---|---|
| 1.1.1 非テキスト | 床面図は `role="img"` + 要約、「テキストで見る」（§4.2.6）。図の block はサーバのテキスト代替を `<details>` で持つ。glyph は `aria-hidden` + 見えるラベル | AC-J16、axe |
| 1.3.1 情報と関係 | 見出しの階層（h1 = 章、h2 = 節）、表は `<th scope>`、リストは `<ul>`、Inbox は `listbox`、パレットは `combobox` + `listbox`、読者レベルは `radiogroup`、タブは `nav` 内のリンク + `aria-current` | axe |
| 1.3.2 順序 | DOM 順 = 視覚順（margin カードは prose の後ろの DOM にあり、`aria-describedby` でアンカーと結ぶ） | 手動 |
| 1.4.1 色の使用 | 状態は形・色・ラベル（§6.9）、diff は `+`/`−` と行番号列、推測は 〜 と帯 | §6.9 の表の snapshot |
| 1.4.3 コントラスト | `design-tokens.css` の許可ペアだけを使う（§14.2）。`--faint` は `--paper` / `--sheet` の上だけ | AC-J10（12 状態 × 2 テーマで 0 件）、lint `mitori/faint-surface` |
| 1.4.4 / 1.4.10 / 1.4.12 | rem 単位、320px 幅で横スクロールなし（コード block を除く）、行間を広げても崩れない（固定 height を文字の箱に使わない） | e2e（320px、`text-spacing` bookmarklet 相当の CSS 注入） |
| 1.4.11 非テキストのコントラスト | focus ring `--accent` は面に対し ≥ 5.4:1、操作要素の境界 `--rule-2` は装飾の扱いにせず、ボタンは面の色差か文字で識別 | probe |
| 1.4.13 hover / focus の内容 | peek・用語カード・L0 カードは Escape で閉じる、カードに pointer を移せる（160ms の猶予）、勝手に消えない | AC-J23 |
| 2.1.1 / 2.1.2 キーボード | 全操作にキー（§8.4）か Tab で届くボタン。dialog は focus を閉じ込め、Escape で出られる。CodeMirror は Escape で editor から抜ける | keyboard-only の e2e（Flow A〜F） |
| 2.1.4 文字キーのショートカット | 単一キーを設定 1 つでオフ（§8.5） | AC-J56 |
| 2.2.1 タイミング | Undo のトーストは pointer / focus がある間止まり、10 秒の後も block の履歴・Inbox から取り消せる（時間制限は本質ではない） | e2e |
| 2.3.1 閃光 | 採用の flash は 1 回の opacity（3 回 / 秒未満）。脈動は 1.6s 周期 | — |
| 2.4.1 / 2.4.2 / 2.4.3 | skip link、`document.title`（§3.8）、route 変更で `<main>` の見出しへ focus | e2e |
| 2.4.7 / 2.4.11 フォーカス | `:focus-visible` の 2px ring。sticky header と BottomStack に隠れない（`scroll-padding-top/bottom`） | `ui.focusNotObscured`（testing） |
| 2.5.1 / 2.5.7 ポインタ・ドラッグ | ピンチ = ＋/− ボタン、地図のドラッグ = 矢印キー、列幅のドラッグ = separator の ←/→、範囲選択 = クリック → Shift+クリック / ⇧V | e2e |
| 2.5.2 ポインタのキャンセル | 操作は `click`（up）で発火。`mousedown` は選択保持の `preventDefault` だけ | — |
| 2.5.3 名前とラベル | アイコンだけのボタンの `aria-label` は見える tooltip / キー名と同じ語で始める（「コメント（C）」） | axe |
| 2.5.8 ターゲット | 当たり判定 ≥ 24×24（ブロック操作 28×28、出典チップ `::after` で 26px 高、パレットの行 44px） | AC-J11（4px 格子の `elementFromPoint`） |
| 3.1.1 / 3.1.2 言語 | `<html lang>` = UI、`<article lang>` = 設計書、thread 本文の `lang`（§9.4） | AC-J15 |
| 3.2.1 / 3.2.2 | focus・入力だけでは画面を移らない（パレットの Enter、Inbox の Enter で初めて移る） | — |
| 3.2.6 一貫したヘルプ | `?` を全画面のヘッダー右端の同じ位置に | — |
| 3.3.1 / 3.3.3 エラー | 設定の各項目の下に `role="alert"` で理由と直し方 | e2e |
| 3.3.7 冗長な入力 | Composer は前回の意図・context を保つ、下書きを復元 | — |
| 3.3.8 認証 | パスワード入力なし（nonce URL / cookie）。API key の入力欄も作らない | — |
| 4.1.2 名前・役割・値 | 部屋は roving tabindex の `role="button"` + `aria-label="{区画} {部屋} · {files} files · スレッド {n}"`、segmented は `role="radio"`、トグルは `aria-pressed`、展開は `aria-expanded` | axe |
| 4.1.3 状態メッセージ | §11.2 | WEB-U-031 |

### 11.2 読み上げ（live region）

- Shell に 2 つの領域: `#live-polite`（`aria-live="polite"`）と `#live-assertive`（`aria-live="assertive"`）。`announce(key, params, level)` の 1 関数だけが書く（同じ文は 1 秒以内に 2 回読まない）。
- 読み上げるのは**状態が変わったときだけ**: ジョブの受付・レビュー待ち・回答・失敗・中止、採用、取り消し、却下、読者レベル、生成の開始・最初の block・完了・一時停止、接続の切断・復帰、パレットの結果件数（打鍵が 300ms 止まったときだけ）。トークンの流入・`doc.block.partial`・tail 行は読まない。assertive は接続の切断と、利用者の操作を止めるエラーだけ。
- 推測などのバッジの読み上げ: 疑似要素の `content` に加え、claim span に `aria-describedby="sr-verdict-inferred"`（Shell の sr-only の定義文「推測: コードで直接確認できていない記述」）を client が付ける（属性だけ。ノードは増やさない）。
- 出典チップ: `aria-label="出典 {path} {a}〜{b} 行"`、peek は `role="dialog"` ではなく `role="tooltip"` 相当の popover（focus を奪わない）。

### 11.3 動きと配色の設定

- `prefers-reduced-motion: reduce`: すべての duration を 0.001ms（`design-tokens.css` §5）。脈動は静止した帯 / 枠、採用の flash は静的な左の帯、ズームとカメラは即時、View Transitions を使わない。
- `prefers-contrast: more`: `--faint` → `--muted`、`--rule` → `--rule-2`。
- `forced-colors: active`: focus ring を `Highlight`、状態の glyph は `currentColor`、diff は記号と行番号列で識別できる。

---
## 12. Svelte 5 アプリ構造（`apps/web`）

### 12.1 ディレクトリ

```
apps/web/
├─ index.html                 # head inline script（CSP hash）+ 静的な外枠 skeleton + modulepreload
├─ vite.config.ts             # manualChunks（§12.6）、svelte({ compilerOptions: { runes: true } })
└─ src/
   ├─ main.ts                 # stores を 1 回だけ作り setContext、Shell を mount、SSE 接続
   ├─ viewer-main.ts          # export viewer の entry（API / SSE の代わりに ViewerPayload を読む）
   ├─ app/                    # Shell, Header, JobChip, StatusBar, BottomStack, Banner, LayerOutlet, Announcer, SkipLink
   ├─ router/router.ts        # History router（純関数 parse / href + RouteState の $state）
   ├─ stores/*.svelte.ts      # session, workspace, doc, map, review, gen, inbox, palette, ctx, layers, bottom, prefs
   ├─ sse/sse.ts, reducers.ts # EventSource + entityRev による重複排除 + type → store の表
   ├─ api/mutate.ts           # 楽観的 mutation の helper（@mitori/client を包む）
   ├─ keys/registry.ts, ime.ts, bindings.ts
   ├─ i18n/ja.json, en.json, i18n.ts, rich.ts（<b><kbd><code> の parser）
   ├─ lib/fmt.ts, storage.ts（try/catch の wrapper）, perf.ts（mark）, announce.ts, clipboard.ts, dom.ts, icons.svg
   ├─ views/launcher/  views/map/（FloorPlan.svelte, render.ts, camera.ts, Hud, ZoomBar, RoomCard, GenEstimateCard, GenProgress, FactsCards, TextViewDialog）
   ├─ views/reader/（ReaderPage, BlockHost, delegate.ts, decorate.ts, Rail, Toc, Minimap, ReadingPathCard, CitePeek, TermCard, ClaimPopover, StreamingRegion, levels.ts, scrollAnchor.ts）
   ├─ views/ctx/（ContextColumn, Margin, marginLayout.ts, CodePane, scrollspy.ts）
   ├─ views/code/（CodeView, FileTree）
   ├─ loop/（SelectionToolbar, Composer, ContextChips, EstimateChip, RouterChip, ThreadCard, JobCard, ReadyCard, ProposalBlock, FinishDialog, stages.ts, predict.ts, anchorCapture.ts）
   ├─ review/（ReviewPanel, diffHtml.ts, DiffCm6.svelte（lazy）, decisions.ts）
   ├─ inbox/（Inbox, InboxRow, details/*）
   ├─ palette/（Palette, worker.ts, normalize.ts, score.ts, actions.ts）
   ├─ gen/（GenPage = S8, DecisionsPage = S7）
   ├─ settings/（SettingsPage, WsSettingsPage, KeymapEditor, fields/*）
   ├─ trust/TrustDialog.svelte   help/HelpOverlay.svelte
   └─ styles/tokens.css（= docs/design/design-tokens.css）, base.css, prose.css, levels.css
```

### 12.2 store と runes の規則

1. store は `*.svelte.ts` の class。`main.ts` で 1 回だけ作り、`setContext(STORES, stores)`（`ui.ts AppStores`）。component は `getContext` で受け取るか、葉の component は props だけを受ける。
2. サーバの DTO（`DocOutline`、`SectionView`、`MapView`、`JobDetail`）は **`$state.raw`**（深い proxy を作らない。変えるときは丸ごと置き換える）。1,000 block の配列を深い `$state` にしない。
3. id で引く集合（threads・jobs・節の LRU）は `svelte/reactivity` の `SvelteMap`。1 件の upsert は 1 キーだけを更新する（その block / カードだけが描き直される）。
4. block の更新は `view.blocks.with(i, newBlock)` の新しい配列で `SectionView` を置き換える。keyed `{#each blocks as b (b.id)}` なので、変わらない block の `{@html}` は再実行されない。
5. 派生値は `$derived`（`mineCount`、ジョブチップの数、読書パスの進捗）。store の中に `$effect` を書かない（DOM との橋渡し — `html.dataset.level`、cookie、CSS Highlight — は Shell の component の `$effect` に置く）。
6. component は fetch しない。取得と mutation は store の method か `api/mutate.ts` を通す。描画の helper（`render.ts`、`diffHtml.ts`、`marginLayout.ts`、`stages.ts`、`predict.ts`）は純関数で、単体テストする。
7. 例外は `<svelte:boundary>` で領域ごとに受け、その領域にエラーカード（§4.0）を出す。画面全体を白くしない。

### 12.3 SSE（1 タブ 1 本）

- `new EventSource("/api/v1/events?ws=<ws>")`（cookie で認証）。workspace を切り替えたら閉じて開き直す。
- 再接続: 通常の切断はブラウザ自身の再接続に任せる（`Last-Event-ID` が送られ、サーバが ring buffer から replay する。間隔はサーバの `retry:` 行 1,000ms）。`readyState === CLOSED`（HTTP エラーで自動再接続が止まった、401 など）のときだけ client が 0.5s × 2ⁿ（上限 10s、±20% jitter）で作り直す。このとき `Last-Event-ID` はブラウザが送らないので、`?last=<rev>`（§16 R25）を付ける。R25 が入るまでは作り直しの後に必ず resync する。
- **重複排除**: entity ごとに `entityRev[key]`（`thread:th_…`、`job:j_…`、`block:b_…`、`proposal:pp_…`、`checkpoint:ck_…`、`run:gr_…`、`task:gt_…`、`round:<n>`、`ws:<ws>`）に、その値を作った最大の rev（SSE の envelope `rev`、mutation 応答の `x-mitori-rev`）を持つ。`rev ≤ entityRev[key]` の upsert は捨てる（WEB-U-026）。
- 未知の `type` は捨てる（前方互換）。`resync` はマウント中の取得をすべてやり直す（workspace・outline・表示中の節・threads・jobs・inbox・map）。
- reducer の表（`sse/reducers.ts`）:

| type | store の処理 |
|---|---|
| `hello` | 再接続で `resumedFrom === null` なら resync と同じ |
| `resync` | 全取得 |
| `server.shutdown` | `connection = stopped`、overlay |
| `notice` | トースト（`notice.<key>`） |
| `engines.updated` / `scheduler.updated` / `usage.updated` / `workspace.updated` / `settings.updated` | session / workspace / prefs |
| `trust.request` | inbox に追加 + トースト `trust.pending` |
| `scan.progress` / `scan.done` / `scan.failed` | workspace.scan |
| `index.changed` | S3 で表示中のファイルが含まれていれば「このファイルは変更されました［再読み込み］」 |
| `map.updated` | map を取り直す（250ms throttle） |
| `doc.outline` | `outlineRev` が新しければ outline を取り直す |
| `doc.block.upsert` | doc.upsertBlock（§4.3.9-5 のスクロール補正）。採用待ちの block なら flash |
| `doc.block.partial` | doc.streaming の partial |
| `doc.block.removed` | doc.removeBlock（補正つき） |
| `doc.freshness` | block の `data-fresh`、章・目次・床面図の鮮度（`mitori:stale:badge`） |
| `doc.claims` | 該当 `.mc` の `data-verdict` を属性だけ書き換える（ノードを作り直さない） |
| `doc.proposal.upsert` / `removed` | doc.proposals |
| `doc.saved` | S8 だけが使う（「.mitori/ に保存しました」） |
| `gen.run` / `gen.task` | gen |
| `thread.upsert` / `thread.removed` / `thread.message` | review.threads |
| `review.round` | review.round |
| `job.upsert` / `job.event` | review.jobs / events（ring 200） |
| `checkpoint.upsert` | review の Undo 状態 |

### 12.4 API と楽観的 mutation

```ts
// api/mutate.ts（形だけ）
mutate({
  optimistic: () => undoFn,            // 即座に UI を変え、元に戻す関数を返す
  call: (key) => api.call(route, { …, idempotencyKey: key }),
  commit: (res, rev) => store.apply(res, rev),   // entityRev を更新
  rollback: (err) => { undoFn(); toast.error(errorText(err), { retry }) },
})
```

- 作成（threads・jobs・gen runs・finish）は `idempotency-key` = temp key（`crypto.randomUUID()`）。再送は同じ key（10 分は同じ結果）。
- 楽観的に作る物: スレッドカード（temp `tmp_…`）、ジョブカード、採用中の状態、verify の ✓✓、読者レベル、設定の値。作らない物: 採用の結果（作業ツリーの変化）、生成の block。
- 書き込みはすべて daemon の API 経由（ファイル・DB に直接書かない）。CLI 専用ルート（`gen/prep` など）は web から呼ばない（`ROUTE_META.clients`）。

### 12.5 ルーティング

- 自前の History router（≈1KB）。`popstate`、リンクの委譲（§2.3-3）、`history.state` によるスクロール復元。
- 地図 ↔ 設計書の遷移だけ same-document View Transitions（`document.startViewTransition`、対応ブラウザかつ reduced-motion でないとき）。他は即時に切り替える。
- route ごとの component は動的 import（chunk は §12.6）。読み込み中は外枠の skeleton を保つ。

### 12.6 遅延 chunk と先読み

| chunk | 読み込むとき | 先読み |
|---|---|---|
| `entry` | 常に | HTML の modulepreload |
| `map` | S1 | S1 の HTML で modulepreload |
| `reader` | S2・S3・S5 | S2 の HTML で modulepreload。S1 では目次 / 部屋カードに 65ms hover |
| `i18n-ja` / `i18n-en` | 表示中の言語 | head script が modulepreload |
| `loop` | 選択・`c`/`e`/`f`・Inbox | 最初の描画の後 `requestIdleCallback`（timeout 2s） |
| `review` | `r`、レビュー待ちの job を初めて受け取ったとき | — |
| `inbox` | `g i`、Inbox タブに 65ms hover | — |
| `palette` + `palette-worker` | ⌘K / `/` | loop の後の idle |
| `gen` | S7・S8 | — |
| `settings` | S9 | — |
| `diagram` | `figure.mdiagram` が viewport に入ったとき | — |
| `cm6` + `merge` | diff ≥ 2,000 行、または Split | **先読みしない**（AC-U59） |
| `shiki` | 使わない（予約。サーバが描く） | — |
| `mermaid` | 外来の mermaid fence が viewport に入ったとき | — |
| `viewer` | export の HTML だけ | — |

`vite.config.ts` の `build.rollupOptions.output.manualChunks` で、ファイルのパスから上の名前（`ui.ts CHUNK_NAMES`）に固定する（testing RQ-UI-2。名前は manifest で検査）。

### 12.7 BlockHost（サーバ HTML + 委譲。行単位コンポーネント禁止）

- 描画: `{#each view.blocks as b (b.id)}<div class="blk" data-b={b.id} data-depth={b.depth} data-kind={b.kind} data-ln={b.mdLine} tabindex="-1">{@html b.html}</div>{/each}`。block の mount / html の変更ごとに `decorate(el)` を 1 回だけ実行する（`{@attach}`）: 推測などの claim に `aria-describedby` を付け、必要な block にだけ `button.vsum[data-mx]` を足す。
- 委譲（reader のルートに **≤ 8 個**）: `pointerover`、`pointerout`、`focusin`、`focusout`、`click`、`toggle`（capture）。document に `selectionchange` 1 個。合計 ≤ 10（WEB-U-021）。`closest()` で振り分ける: `a.mcite` → peek、`abbr.mterm` → 用語カード、`.mc[data-verdict]` → claim の popover、`figure.mdiagram [data-node]` → 図のジャンプ、`a[href^="/w/"]` → router、`.blk` の hover → 共有ガターを移動。
- **作らないもの**: 行ごとの Svelte component（コード・diff・CodePane は HTML 文字列）、block ごとのガター、block ごとの listener。Inbox の行と margin のカードは component でよい（行数ではなく件数で、上限がある）。
- **HTML の扱い**: サーバの block HTML（markdown-it `html:false` で描画、同じ origin、CSP）だけを `{@html}` に入れる。利用者が書いた文字列（thread の本文の平文表示、workspace 名、パス）は必ず text node として入れる。i18n の強調は `rich.ts` の parser でノードにする。client で Markdown を解析しない（thread の本文はサーバ描画の HTML — §16 R23）。

### 12.8 仮想化と `content-visibility`

| 面 | 規則 |
|---|---|
| S2 のページ | 子節の `.sec` に `content-visibility: auto; contain-intrinsic-size: auto 900px`。paint の範囲を広げるため `margin: 0 -64px; padding: 0 64px`（ガターの ✓・図の負 margin・件数マーカーが切れないように。Editorial §2.4）。図を含む `.sec.has-fig` には付けない（Safari の SVG text） |
| 1 ページの block が 300 超（`virtualizeBlocks` [仮]） | 50 block（`blockWindow`）の窓で描き、viewport ± 1 窓だけをマウント。外した block は実測の高さ（`Map<BlockId, px>`）か推定（§4.3.16 の式）の spacer。Ctrl+F が効かない旨を `/` の案内に出す |
| CodePane / S3 | 200 行の塊（`div.cchunk`、`content-visibility: auto`）。2,000 行超（`virtualizeCodeLines`）は viewport ± 1 塊だけマウントし、他は `行数 × 18.6px`（11.5px × 1.62）の spacer。マウントする行は常に ≤ 400 |
| diff | 2,000 行未満は静的 HTML、以上は CM6（内部で仮想化） |
| ファイルツリー | 5,000 項目超で 28px 固定行の仮想化 |
| Inbox | 500 行超で窓（行 ≥ 40px の実測）[仮] |
| パレット | 表示する項目は各群 3 件 + 展開分だけ。200 件を超えて展開したら仮想化 |
| 床面図 | 仮想化しない。LOD と家具の遅延生成（§4.2.3） |

### 12.9 コードの色

- サーバの Shiki を **css-variables テーマ**（`createCssVariablesTheme({ name: "mitori", variablePrefix: "--shiki-" })`）で描かせる。token は `<span style="color:var(--shiki-token-keyword)">` になり、ライト / ダークの切替でコードを描き直さない（色は `design-tokens.css` の `--shiki-*`）。doc renderer への依頼（§16 X3）。
- client は最初の描画でハイライトしない。CM6 の diff は構文の色を付けない [仮]。

### 12.10 Worker

- `palette-worker`（module worker、同じ origin。CSP の `default-src 'self'` で許可される）: `PaletteWorkerMsg` / `PaletteWorkerReply`（`ui.ts`）。索引は正規化済みの配列（label・yomi・romaji・alias を前処理）として保持し、1 query ≤ 16ms（5 万件、worker 内で計測）。
- 他の重い処理（diff の写像・token の推定・ハイライト）はサーバが行う。

### 12.11 ブラウザ内の保存（すべて `lib/storage.ts` の try/catch 経由。lint `mitori/storage-wrapper`）

| キー | 場所 | 中身 | 寿命 |
|---|---|---|---|
| `mitori_ui` | cookie | `UiCookie` | 1 年 |
| `mitori:draft:<ws>:<anchorKey>` | localStorage | オフライン時の下書き `{intent, body, anchor, at}` | 同期できたら消す |
| `mitori:read:<ws>:<pathId>` | localStorage | 読書パスの既読 | — |
| `mitori:recent:<ws>` | localStorage | パレットの最近 20 件 | — |
| `mitori:lastPage:<ws>` | sessionStorage | 最後に開いたページ | タブ |
| `mitori:path:<ws>` | sessionStorage | 選んだ読書パス | タブ |
| `mitori:hint:imeOn` | sessionStorage | IME ヒントを出したか | タブ |

- IndexedDB は使わない。複数タブは許す（書き込みは daemon の単一 writer）。同じ下書きを 2 つのタブで書いて `E_CONFLICT` になったら、新しい本文を取り直して「別のタブで編集されました」と出す。

### 12.12 performance mark（全ビルド。`ui.ts UI_PERF_MARKS`）

| mark | 出す場所 | detail.trigger |
|---|---|---|
| `mitori:shell:painted` | head script（rAF） | — |
| `mitori:map:painted` | FloorPlan の初回描画の rAF | — |
| `mitori:toc:painted` / `mitori:facts:painted` | Rail / FactsCards | — |
| `mitori:block:first` | 最初の AI block が DOM に入った rAF | — |
| `mitori:section:rendered` | ページの block が DOM に入った rAF（S3・S4・S7〜S9 も id 付きで） | クリック / キー |
| `mitori:level:applied` | data-level 変更後の rAF | キー / クリック |
| `mitori:palette:results` | 結果を描いた rAF | keydown |
| `mitori:shortcut:handled` | registry | keydown |
| `mitori:composer:opened` | Composer の初回描画 | キー / クリック |
| `mitori:card:optimistic` | 楽観的カードの描画 | ⌘⏎ |
| `mitori:job:ready` | ReadyCard の描画 | — |
| `mitori:review:diff-mounted` | diff の描画 | `r` / クリック |
| `mitori:undo:applied` | 取り消し後の block 描画 | ⌘Z / クリック |
| `mitori:stale:badge` | `data-fresh` 変更の rAF | — |
| `mitori:ctx:mode` | 文脈列のモード変更後 | キー / クリック |
| `mitori:room:card` | 部屋カードの描画 | クリック / Enter |
| `mitori:estimate:updated` | 見積りチップの更新 | 入力 |

---

## 13. 予算とその強制

### 13.1 予算表（`bench/budgets.json` に登録。`UI_THRESHOLDS`・`BUNDLE_BUDGETS` と同値であることを CORE-U-009 が検査）

| id | 指標 | 目標 / 上限 | 測り方 | CI |
|---|---|---|---|---|
| `asset.js.initial.gz` | 初期 JS（route ごとの最大） | 60KB / 150KB | `bench/assets.ts`: `mitori:map:painted` / `mitori:section:rendered` より前に読まれた JS の**実配信バイト**（br と gz を別々に） | > 60KB 警告、> 150KB fail |
| `asset.css.gz` | CSS | 15KB / 25KB | 同上 | > 25KB fail |
| `asset.chunk.<name>` | 遅延 chunk | `BUNDLE_BUDGETS.chunksKb` / +15% | Vite manifest の chunk 名 + 実配信 | +15% 超で fail |
| `asset.font` | Web フォント | 0 / 0 | `font/*` の応答・`.woff*` の要求 | 1 つでも fail |
| `asset.viewer.js` | export viewer | 60KB / 70KB | export HTML の inline JS を gzip | fail |
| `ui.dom.typical` / `ui.dom.max` | DOM ノード | 5k / 15k | testing §6.4（12 状態 + 最大状態） | > 15k fail、> 5k 警告 |
| `ui.codeLines.mounted` | マウント中のコード行 | — / 400 | `.cm-line` + `pre.mcode .line` + CodePane の `[data-line]` | fail |
| `ui.floorplan.nodes` | 床面図の SVG ノード（40 部屋） | — / 1,500 [仮] | `svg.plan *` の数 | fail |
| `ui.listeners.reader` | reader ルートの listener | — / 10 | CDP `DOMDebugger.getEventListeners` | fail |
| `ui.inp` | INP | p75 100ms / p98 200ms | testing §6.6 | head vs base 20% |
| `ui.section` | 節の遷移 | p95 100ms / 150ms | mark | 同上 |
| `ui.palette` | ⌘K 1 打鍵（5 万件） | 16ms / 33ms | mark | 同上 |
| `ui.level` | 読者レベル | 50ms / 100ms | mark、fetch 0 | 同上 |
| `ui.card.optimistic` | 楽観的カード | 100ms / 150ms | mark | 同上 |
| `ui.shortcut` | ショートカットの反応 | 50ms / 100ms | mark | 同上 |
| `ui.cls.boot` / `ui.cls.gen` | CLS（起動 / 生成中） | 0 / 0.01 | `PerformanceObserver("layout-shift")` | > 0.01 fail |
| `ui.heap.10k` | JS heap（10k ファイル） | 100MB / 150MB | CDP | fail |
| `ui.a11y.contrast` | AA コントラスト不合格 | 0 / 0 | `judge-probe.mjs` の算法（祖先の背景をアルファ合成） | fail |
| `ui.a11y.textSize` | 11px 未満の文字 / 12px 未満の操作ラベル | 0 / 0 | probe | fail |
| `ui.a11y.target` | 24×24 未満の当たり判定 | 0 / 0 | probe（4px 格子の `elementFromPoint`） | fail |
| `ui.a11y.axe` | axe serious / critical | 0 / 0 | testing §5.4 | fail |

### 13.2 lint（`scripts/lint-web.ts`。`check` に含め、≤ 1.5s）

| 規則 | 内容 |
|---|---|
| `mitori/ime-guard` | `apps/web/src` の `keydown` / `keyup` の listener（`addEventListener`・`onkeydown=`）は、関数の最初の文が `if (isComposing(e)) return` であるか、`keys/registry.ts` を通す。自己テスト WEB-U-012 |
| `mitori/no-ja-literal` | §9.5-2 |
| `mitori/no-ja-space` | `i18n/ja.json` の値の和欧間の半角空白（placeholder を置換して検査） |
| `mitori/no-raw-color` | component の CSS に hex / rgb / hsl を書かない（`var(--…)` だけ。tokens.css を除く） |
| `mitori/no-raw-z` | `z-index` は `var(--z-*)` か 0〜5 |
| `mitori/no-fw-weight` | `font-weight` は 400 / 600 / `var(--fw-*)` |
| `mitori/no-font-face` | `@font-face` 禁止 |
| `mitori/faint-surface` | `color: var(--faint)` を持つ規則は、背景が `--paper` / `--sheet` の container の中だけ（component 単位の静的検査 + probe） |
| `mitori/storage-wrapper` | `localStorage` / `sessionStorage` / `document.cookie` の直接使用は `lib/storage.ts` と head script だけ |
| `mitori/no-direct-fetch` | `fetch(` は `@mitori/client` と `api/` だけ（viewer を除く） |
| `mitori/no-line-components` | `views/code/`・`views/ctx/`・`review/` で、`{#each}` の中に大文字始まりのタグ（component）を置かない |
| `mitori/no-progressbar` | `role="progressbar"` と `<progress>` を使わない（WEB-U-032） |

### 13.3 構造不変条件（e2e、絶対値）

testing spec §6.4 の表に、本書の `ui.floorplan.nodes`・`ui.listeners.reader`、共有ガターが 1 個であること（AC-U32）、CM6 が Review を開くまで要求されないこと（AC-U59）、カメラ操作で床面図の子ノードが増えないこと（AC-J05）を加える。

---

## 14. デザイントークン

### 14.1 ファイルと規則

`docs/design/design-tokens.css`（WP-10a で `apps/web/src/styles/tokens.css` にそのまま置く）。規則 R1〜R7 はファイル冒頭のコメント。要点:

1. 色は 3 ブロック（ライト / OS のダーク / 明示のダーク）に同じキー集合で定義し、ダークの 2 ブロックは値も同じ（AC-U90）。`data-theme` は利用者が明示したときだけ付く（OS の切替がそのまま効く）。
2. 色は 6 桁 hex。合成が要るもの（`--sugg-bg`、`--pit-bg`、`--mark-line`、`--add-code` など）は**事前に混色した hex** にし、CI がアルファ合成なしでコントラストを計算できるようにする（Editorial の `color-mix` を置き換えた）。
3. 文字の大きさ（`--fs-*`）・行間・字間・weight・間隔（4px 格子）・角丸・寸法（`--hdr` 52、`--status` 24、`--rail` 248/228、`--ctx-*`、`--map-right` 400/360 …）・動き（`--dur-*`、`--ease-*`）・z-index の梯子（`--z-*`）を持つ。component はこれ以外の値を使わない（§13.2 の lint）。

### 14.2 許可する文字と面の組（計算値。WCAG 2.x の相対輝度の式。CI は `scripts/tokens-contrast.ts` が CSS から計算し直す）

| 文字 \ 面（ライト） | paper | paper-2 | sheet | code-bg | mark | zone-1〜5 | add-bg / del-bg |
|---|---:|---:|---:|---:|---:|---:|---:|
| `--ink` | 16.35 | 15.38 | 17.21 | 14.85 | 14.52 | ≥ 11.77 | — |
| `--text` | 13.22 | 12.44 | 13.92 | 12.01 | 11.74 | — | 12.26 / 12.17 |
| `--muted` | 6.21 | 5.84 | 6.54 | 5.64 | 5.52 | 5.53〜5.66 | 5.76 / 5.72 |
| `--faint` | **4.66** | ✕ 4.38 | **4.90** | ✕ 4.23 | ✕ 4.14 | ✕ | ✕ |

| 文字 \ 面（ダーク） | paper | paper-2 | sheet | code-bg | mark | zone-1〜5 | add-bg / del-bg |
|---|---:|---:|---:|---:|---:|---:|---:|
| `--ink` | 15.48 | 14.79 | 14.35 | 13.23 | 10.56 | ≥ 10.61 | — |
| `--text` | 12.21 | 11.66 | 11.32 | 10.44 | 8.33 | — | 10.12 / 10.85 |
| `--muted` | 7.76 | 7.42 | 7.20 | 6.64 | 5.29 | 6.74〜6.96 | 6.43 / 6.90 |
| `--faint` | **5.35** | 5.11 | **4.96** | 4.58 | ✕ 3.65 | — | ✕ 4.44 / 4.76 |

`--faint` は**両テーマとも `--paper` と `--sheet` の上だけ**（ダークの paper-2 / code-bg は通るが、規則を 1 つにするため使わない）。

状態色（前景 on 自分の面）: ライト ok 5.48 / guess 4.96 / run 5.90 / prop 6.52 / bad 6.23 / warn 5.11、ダーク 7.93 / 8.75 / 7.64 / 7.40 / 7.13 / 7.90。`--c-prop` on `--sugg-bg` 6.90 / 7.98、`--c-bad` on `--pit-bg` 6.54 / 7.75、`--add-fg` on `--add-bg` 6.43 / 9.14、`--del-fg` on `--del-bg` 7.11 / 8.31、diff 本文 `--add-code` / `--del-code` 9.92 / 10.51（ダーク 9.76 / 9.85）、`--toast-fg` on `--toast-bg` 14.80 / 14.34、`--toast-fg-2` 7.86 / 5.82、`--accent` on paper / sheet / hover 6.03 / 6.34 / 5.48（ダーク 6.61 / 6.13 / 5.72）。構文色（`--shiki-token-*`）は code-bg・add-bg・del-bg・add-hl・del-hl・mark-line のどれの上でも ≥ 5.30（ライト）/ ≥ 5.71（ダーク）。

**Editorial の CSS から直す組**（prototype のまま移植すると AC-J10 に落ちるもの）: hunk ヘッダー `--faint` on `--paper-2` → `--muted`（mono 11px）/ diff の行番号 `--faint` on `--add-bg`・`--del-bg` → `--muted` / 目次・カードの区切り `·`（`--rule-2`）→ `aria-hidden` の span にして検査の対象から外す / 構文のコメント `#8E8A82` → `--shiki-token-comment` / `--faint` を `--paper-2`・`--hover`・`--code-bg`・`--mark`・zone の上に置いていた箇所 → `--muted`。最終的な判定は probe（AC-J10）が行う。

### 14.3 部品と token の対応（抜粋。全体は component の CSS が正）

| 部品 | 面 | 文字 | 線・帯 |
|---|---|---|---|
| ヘッダー | `--hdr-bg` + blur | `--ink`（現在タブ）/ `--muted` | 下 1px `--rule` |
| rail | `--paper` | 目次 `--muted`、現在 `--ink` / 600 | 現在の行の左 2px `--accent` |
| prose | `--paper` | `--text`、見出し `--ink` | — |
| カード（margin・見積り・部屋） | `--sheet` | `--text` / `--muted` | 1px `--rule`、`--shadow-soft`（active は `--shadow-pop`） |
| popover・パレット | `--sheet` | — | 1px `--rule`、`--shadow-pop` |
| 出典チップ | `--sheet` | `--muted`（mono 11px） | 1px `--rule` |
| 推測の claim | 下 38% に `--c-guess-bg` | — | — |
| 提案 block | `--sugg-bg` | ヘッダー `--c-prop` | 左内側 2px `--c-prop` |
| 落とし穴 | `--pit-bg` | ラベル `--c-bad` | 左 2px `--pit-rule` |
| ステータスバー | `--paper-2` | `--muted`（mono 12px） | 上 1px `--rule` |
| トースト・浮遊ツールバー・batch バー | `--toast-bg` | `--toast-fg` / `--toast-fg-2` | — |
| 床面図 | 床 `--plan-floor` / `--zone-*`、ノイズ箱 `--noise-floor` + 斜線 | `--plan-ink` / `--muted` | 壁 `--plan-wall` |

### 14.4 動き（`--dur-*`。reduced-motion で 0.001ms）

| 対象 | 値 |
|---|---|
| hover の色・背景 | 120〜150ms |
| popover | 遅延 300ms、表示 140ms、閉じる前の猶予 160ms |
| margin カードの位置合わせ | `transform: translateY` 280ms `--ease-out`（`top` は動かさない） |
| カードの出現 | opacity 220ms（transform は位置合わせ専用） |
| 文脈列の幅 | `grid-template-columns` 320ms |
| 地図のカメラ / LOD | 300ms ease-out / opacity 200ms |
| AI 作業中の帯・部屋の枠 | opacity 1.6s の脈動 |
| 採用の flash | 1 回、1.6s（`::after` の opacity） |
| Undo トースト | 表示 180ms、残り時間の線は 10s linear（偽の進捗ではなく残り時間そのもの） |

---

## 15. 受け入れ基準

### 15.1 JUDGEMENT.md の基準

**AC-J01〜AC-J62 はそのまま有効**（S1・組版・a11y・i18n・Reader・文脈列・依頼・ジョブ・Review・Inbox・パレット・生成・キーボード・性能）。本書で数値や手順を足したもの: AC-J20（§7.1 の位置保持の算法）、AC-J25（§6.3 の算法）、AC-J33（§6.4 の楽観的カード）、AC-J38（§3.5）、AC-J48（§4.3.9）、AC-J55（§8.4、`level.*` は read scope — Δ1）。

### 15.2 本書で足す基準（AC-U）

**Shell・起動・接続**
- **AC-U01**: `mitori_ui` が無い / 壊れている（不正な JSON、範囲外の数、未知のキー、256 バイト超など 10 通り）とき、head script は例外を出さず既定値で描画する。CSP 違反の報告が console に 0 件。
- **AC-U02**: cookie が `lv=e, th=d, lg=en` のとき、`mitori:shell:painted` の時点でダーク・`lang="en"`・`data-level="expert"` で描かれ、以後の読み込みでこの 3 つの属性が変わらない（MutationObserver で 0 回）。
- **AC-U03**: 起動から `mitori:map:painted` までの CLS ≤ 0.001（crit fixture、1440×900 と 1280×800）。
- **AC-U04**: どの状態でも `scroll-padding-bottom` = BottomStack の合計の高さ ±1px で、Tab で移ったフォーカス先が header と BottomStack に隠れない（`ui.focusNotObscured`）。
- **AC-U05**: Escape 1 回で閉じるレイヤーは 1 つだけで、順序は `LAYER_ORDER`（menu + popover + Composer + code モードを重ねた状態から 4 回で全部閉じる）。
- **AC-U06**: daemon を止めると 2 秒以内に retrying の帯が出る。その間に Composer へ打った下書きは localStorage に残り、再起動後に同じ本文でサーバの下書きになる。再接続後に `resync` の再取得が終わる。
- **AC-U07**: `server.shutdown` で停止の overlay が出て、背面に Tab で到達できない（`inert`）。
- **AC-U08**: 401 で auth_expired の帯が出て、再試行の要求は 10 秒に 1 回以下。

**ルーティング**
- **AC-U10**: `APP_ROUTES` のすべてで `parse(href(s))` が `s` と等しい（和文のファイル名と `/` を含む節 id を入れた 1,000 件の property test）。
- **AC-U11**: 5 回の遷移の back / forward で、スクロール位置（±4px）とフォーカス中の block が戻る。
- **AC-U12**: `/w/:ws/review` は、レビュー待ちが 0 件なら Inbox（`mine`）の空状態に、3 件なら最も古いものに `replace` で移る。
- **AC-U13**: `/w/:ws/threads/:th` はアンカーの場所へ `replace` し、カードにフォーカスが当たる（300ms 以内 [仮]）。

**S0・S1**
- **AC-U15**: Launcher は workspace を最後に開いた順に並べ、存在しないパスでは入力欄の下に `E_WS_NOT_FOUND` の文言を `role="alert"` で出す。
- **AC-U20**: 3 effort の見積りは `mitori:map:painted` の後に並列で取得され、effort の切替でネットワーク要求が 0。［生成］1 回で出る要求は `PATCH /settings`（初回だけ）と `POST /gen/runs` だけで、dialog は出ない（`billing_overage`・`api_key_billing`・`window_risk` の fixture を除く）。
- **AC-U21**: 見積りの期限切れ（`E_PRECONDITION`）では run を始めず、主行を新しい数値にして 2 回目のクリックを待つ。
- **AC-U22**: engine = session のとき、ボタンでクリップボードに `mitori gen --prep --effort <effort>` が入る。
- **AC-U23**: 生成の進捗のカウンタは確定値だけを使い、減らない。`role="progressbar"` も時間に基づく % も無い。

**S2・文脈列・S3**
- **AC-U30**: client が `.mb` の中に足した要素はすべて `data-mx` を持つ（fixture の全 block で DOM 監査）。50 個の無作為な選択から作った `DocAnchor.quote` / `offset` が、サーバの `DocStore.blockText` に基づく golden と一致する。
- **AC-U31**: verified / inferred / stale のバッジは DOM ノードを増やさない（疑似要素）。`button.vsum` の数 = verified 以外の claim を持つ block の数。
- **AC-U32**: 浮遊ガターは block の数によらず DOM に 1 個。ボタンは 28×28px。`j` で block にフォーカスするとガターが出て、Tab でボタンに届く。
- **AC-U33**: 生成の録画（cassette）を、生成中の節の途中を見ながら再生しても、Chromium と WebKit の両方で CLS < 0.01、4px を超えて動いた見える block が 0。
- **AC-U34**: 推測の claim から「確認済にする」を選ぶと、100ms 以内に ✓✓ になり、`POST /verify` が失敗したら戻る。
- **AC-U35**: 翻訳の帯は UI 言語 ≠ 設計書の言語のときだけ出る。訳した節は再読み込みなしで原文 / English を切り替え、`<article lang>` が `htmlLang` に従う。
- **AC-U36**: placeholder の［生成する］は 1 回目で scope 付き見積りを取ってラベルを `≈{k} · ${usd}` に変え、2 回目で実行する。100k 以下では dialog を出さない。
- **AC-U37**: 引用されたファイルを保存すると、block の ⚠ が p50 50ms / 最大 1s で出て、章のメタ行と目次にも出る。
- **AC-U40**: 文脈列の区切りは ←/→ で 24px ずつ、clamp の範囲で変わり、値は cookie に残り、再読み込みで CLS なしに戻る。
- **AC-U41**: 20k 行の fixture を code モードと S3 でスクロールし続けても、マウント中のコード行は常に 400 以下。
- **AC-U45**: S3 で、クリック → Shift+クリック、ドラッグ、⇧V + `j`/`k` のどれで選んでも同じ `CodeAnchor` になる。deny glob のファイルは保護の文言を出し、内容を返す応答が 0。

**S4・S5・ループ**
- **AC-U50**: §4.6.2 の対応どおりに絞り込まれ（全タグを持つ fixture）、Inbox タブのバッジ = `mine` の件数が SSE 1 イベント以内に一致する。
- **AC-U51**: Inbox の doc_edit で `1` は `apply:"doc"` を送って下書きを消し、`2` は `apply:"code"` を送ってジョブカードを確認の形で出す。
- **AC-U52**: 選択中の行より上に SSE で行が入っても、選択行の画面上の位置が ±4px 以内に保たれる。
- **AC-U55**: 焦点単位の採用で、全単位が決まるまで accept の要求は 0、決まった時点で 1 回だけ。一部採用の要求の `hunks` / `proposals` は決定と一致する。
- **AC-U56**: ⌘⌫ の 10 秒以内に ⌘Z で `/reject` の要求は 0。取り消さなければ 10±0.5 秒で 1 回。窓の間にタブを閉じたら keepalive で送られる。
- **AC-U57**: `diverged` のある取り消しで dialog が出て、「それでも戻す」は `{force:true}` を送る。
- **AC-U58**: remote-readonly の workspace で、採用ボタンが「.patch を書き出す」になり、結果のトーストにパスが出る。
- **AC-U59**: 2,000 行未満の diff では `cm6` の要求が 0。2,000 行以上では Review を開いた後にだけ `cm6` と `merge` を要求する。
- **AC-U60**: Composer に TextQuote の内部表現が出ない。詳しいレベルでだけ block id が出る。
- **AC-U61**: client の予測は、較正前の fixture 20 件でサーバ見積りの token の ±10% 以内 [仮]、router の予測はサーバの `route.mode` と 100% 一致する。
- **AC-U62**: ジョブカードの計画行は `RouteDecision` と gate から作られ、% を一度も表示しない。
- **AC-U63**: 回答の streaming は平文で描かれ、完了でサーバの HTML に置き換わるとき、カードの列で CLS 0。
- **AC-U64**: 経路 = 自分のセッションへ では thread が open になり job の要求が 0。経路 = プロンプトをコピー ではクリップボードの文が `POST /prompt` の text と一致する。
- **AC-U65**: 確認の形は `requiresConfirm = true` の見積りのときだけ出て（99k / 101k・昇格・従量の fixture）、modal dialog にはならない。
- **AC-U68**: Finish dialog の節約 = 単発の合計 − batch。push で `review.round` が届く。待機中の `mitori review` がある pull ではその CLI が返り（CLI との結合試験）、画面は待機の表示になる。pending 0 件の Finish は approved で終わる。

**パレット・キーボード・i18n**
- **AC-U70**: JUDGEMENT AC-J46 の例に加え、`ninshou` / `にんしょう` → 認証（WEB-U-024）。古い query id の結果を描かない。
- **AC-U71**: `/` の本文検索で、ローカルの群は即時に、サーバの全文検索の群は 150ms の debounce の後に出る。
- **AC-U75**: keydown の listener は window の capture 1 個 + Composer / パレットの入力欄だけ（lint と実行時の数え上げ）。
- **AC-U76**: §8.6 の I1〜I13 が Chromium（CDP の IME）と WebKit（Safari 順序）で通る。
- **AC-U77**: 再割当てで、予約キーは拒否、衝突は入れ替えを提案、保存は `PATCH /settings`、複数キーの族は再割当ての対象外。
- **AC-U80**: `scripts/i18n-parity.ts` が通る（§9.5-1 の全項目）。
- **AC-U81**: 実行中に ja → en を切り替えると、再読み込みなしで chrome の文言だけが変わり（CLS ≤ 0.01）、設計書の本文は変わらない。

**a11y・トークン・性能・export**
- **AC-U85**: 12 状態 × 2 テーマで axe の serious / critical 0。
- **AC-U86**: Flow A〜F をポインタのイベントなしにキーボードだけで最後まで通せる（e2e）。
- **AC-U87**: 30 秒の回答の streaming の間、live region の読み上げは 3 回以下（受付・回答・完了）。
- **AC-U88**: reduced-motion では、無限に続く animation が 0（`document.getAnimations()`）、transition は 1ms 以下。
- **AC-U90**: tokens の 3 ブロックのキー集合が同じで、ダークの 2 ブロックの値が byte 単位で同じ。
- **AC-U91**: CSS から計算し直した §14.2 の表が ±0.01 で一致し、許可した組はすべて 4.5 以上。
- **AC-U92**: component の CSS に生の色・z-index・weight が無い（lint）。
- **AC-U93**: `ui.ts FONT_STACKS` と tokens の `--font-*` が文字列として一致する。
- **AC-U95**: route ごとの初期 JS が 60KB gz を超えたら警告、150KB で fail。各 chunk は `BUNDLE_BUDGETS` の +15% 以内。
- **AC-U96**: reader ルートの listener ≤ 10、window の listener ≤ 6（keydown・keyup・resize・popstate・pagehide・blur）[仮]。
- **AC-U98**: 40 部屋の床面図で SVG ノード ≤ 1,500 [仮]。カメラとズームの操作で子ノードの追加 0。
- **AC-U99**: export viewer はネットワークを遮断して開け、要求 0、パレット・読者レベル・peek（静的版）・地図が動き、JS ≤ 60KB gz、帯に伏せ字の件数が出る。

---

## 16. 契約への変更要望

`core.ts` / `api.ts` は本書の所有ではないので、ここに列挙して architect に依頼する（優先度 P0 = WP-10a の最初の PR まで、P1 = WP-10b まで、P2 = それ以降）。R1〜R5・R18 は JUDGEMENT §9 の要望を引き継いだもの。

| # | 対象 | 変更 | 理由 | 優先 |
|---|---|---|---|---|
| R1 | api `PaletteItem` | `al?: string[]`（ローマ字の異表記・英語名）、`via?: string`（用語 id） | §7.3、AC-J46 | P0 |
| R2 | api `BlockView` | `mdLine: number`、`variants?: {easy?: {tokens: number; cached: boolean}}`。`GET /doc/blocks/:block?md=1` で `md: string` を返す | 詳しいレベルの行番号、やさしく、doc_edit の編集欄（§5.5） | P0 / P1 |
| R3 | api `MapView`、core `DiagramKind` / `DiagramLayout` / `DiagramAnchor` | `modules[].topFiles?`、`fallback?: "container"`、`quality`。`DiagramKind` に `"floorplan"`、`DiagramLayout.doors?` / `groups[].polygon?`、`DiagramAnchor.pos?` | 床面図（JUDGEMENT §6.3） | P0 |
| R4 | api `SectionView` | `mapFlow?: {from, to, step}[]` | 流れの重ね表示 | P1 |
| R5 | api `InboxFilter` / `InboxItem` | `InboxFilter` に `"draft" \| "resolved"`。`InboxItem` に `intent?`、`anchor?: {section?, path?, line?}`、`cost?: {usd, tokens, estimated}`、`thread?`、`job?`、`displayState?` | Inbox の行の書式（§4.6.3）を 1 回の取得で描く | P1 |
| R6 | api `FileContent` | `GET /files/content` に `html=1` で `html?: string`（Shiki css-variables、行ごとに `span[data-line]`） | code モード・S3 をサーバ描画にする（client でハイライトしない） | P0 |
| R7 | api（新規） | `GET /ws/:ws/jobs/:job/diff?html=1` で hunk ごとのサーバ描画 HTML（構文色つき） | 2,000 行未満の diff にも構文色を付ける | P2 |
| R8 | core `EstimateItem` | `path?: RepoPath`、`lines?: number` | Composer の router 予測を同じフレームで（§6.2.6、AC-J32） | P0 |
| R9 | api `JobEstimate` | `candidates?: EstimateItem[]`（候補チップ）、`seconds` の履歴 `history?: {p25: number; p75: number; n: number}` | 候補チップ、「約 p25–p75 秒」「通常 p25–p75 秒」 | P1 |
| R10 | api `CreateThreadReq` / `PatchThreadReq` | anchor をサーバが刻印する項目抜きで受ける `AnchorInput`（code: `snippet`・`symbol` を省略可、doc: `claim` を省略可）。サーバは常に計算し直す | client は xxh3 を持たない。信用しない値を送らせない | P0 |
| R11 | api（新規）+ core `ConfirmReason` / `GenRunReq` | `POST /ws/:ws/doc/sections/:section/translate {lang, confirm?}` → `BlockOpRes`。gen spec C10（`window_risk`、`GenRunReq.notBefore`） | 節単位の翻訳（D5）、5h 枠の「リセット後に開始」 | P1 |
| R12 | api（新規） | `GET /ws/:ws/gen/suggestions` → `{section, reason, files, estimate: GenEstimate}[]` と SSE `gen.suggestions` | S9 の提案を UI に出す（§4.3.11、S8） | P1 |
| R13 | api SSE `doc.block.partial` | `kind?`、`aspect?`（gen spec C12） | streaming の高さ予約 | P1 |
| R14 | core `SectionNode` | `est?: {inTokens: number; outTokens: number}`（未生成の節） | 目次の `≈{k}`、placeholder のラベル、H_est（§4.3.9） | P0 |
| R15 | api `HTML_CONTRACT` | (a) cite の href を History ルート `/w/<ws>/code/<path>#L<a>-L<b>` に（現行 `#/code/…`）、cite の中に `span.cs`（短）と `span.cl`（長）、(b) `figure.mdiagram` に `data-w` / `data-h`、(c) `abbr.mterm` に初出の `data-first`、(d) block root に `data-ln`（md 行） | 読者レベルの CSS 切替、CLS 0、中クリックで新しいタブ | P0 |
| R16 | core（新規）+ api `SectionView` | `NOTICE_KEYS`（SSE `notice` の key の列挙。i18n parity 用）。節取得時に、その節で使う用語の `GlossaryEntry` を `SectionView.terms?` で同梱 | parity、用語カード | P0 |
| R17 | api（新規） | `GET /integrations` → claude-code plugin / skill / hook / AGENTS.md ブロック / MCP 登録の状態（sha256 の鮮度） | 設定の連携タブ | P2 |
| R18 | core `Job` / `GateResult` | `Job.timings?: {modelMs, wallMs}`、`diffStat.hunks`、`GateResult.autofixedLines?` | ReadyCard・Review の実績行・要約（JUDGEMENT §9） | P1 |
| R19 | core `Job` | `windowDeltaPct?: number`（job の前後の 5h 利用率の差、観測できたとき） | Review の「5h +pp%」 | P1 |
| R20 | api `DocEditReq` | `fromRev?: number`（block の履歴の版を「旧」として doc_edit の thread を作る） | 外部のエディタで直した設計書に「コードを合わせる」（P3） | P2 |
| R21 | core `UiSettings` | `editor: "vscode" \| "cursor" \| "none"`（⇧O の URL 形式） | エディタで開く | P1 |
| R22 | loop（cross-spec） | (a) intent `doc_edit` の draft thread（本文 = 新しい md）を UI の下書きとして受け付け、Finish の対象にしない。(b) `POST /jobs/estimate` が draft の thread を受け付ける（Composer を開いた時点の先読み見積りと、doc_edit の 2 択の費用表示。doc_edit の draft では本文を `targetDocMd` とみなす） | §5.2 B2、§5.5、AC-J40 | P1 |
| R23 | core `Message` / api `ThreadDetail` | `html?: string`（サーバ描画。markdown-it `html:false`） | client で Markdown を解析しない（§12.7） | P1 |
| R24 | api `FinishReq` / `FinishRes` / `ReviewStatus` | loop spec の要求（`estimateId`・`confirm`、`jobs[]`、`batchEstimate`）を UI も前提にする | Finish dialog（§5.3） | P1 |
| R25 | api `GET /events` | query に `last?: number`（client が作り直した EventSource で replay の起点を渡す。`Last-Event-ID` と同じ意味） | 手動の再接続でも欠落なく replay する（§12.3） | P1 |

他 spec への依頼（変更は各 spec の所有者）:

| # | 宛先 | 依頼 |
|---|---|---|
| X1 | testing spec | WEB-U-008 の期待を「発火しない + 初回だけ `hint.imeOn`」に改める（RQ-UI-1 の回答）。`PERF_MARKS` に `mitori:ctx:mode`・`mitori:room:card`・`mitori:estimate:updated` を足す。chunk 名は `ui.ts CHUNK_NAMES`（必須 6 個を含む上位集合。RQ-UI-2 の回答）。RQ-UI-3 は採用 |
| X2 | gen spec | §7.3 の verdict の**色**は本書 §6.9 を正とする（形とラベルは gen spec のまま）。`lowGrounding` のチップは本書 §4.3.5 |
| X3 | doc renderer（gen spec Part A） | Shiki を css-variables テーマで描く（§12.9）。`HTML_CONTRACT` の R15。ViewerPayload（`ui.ts`）を HtmlExporter の出力にする |
| X4 | loop spec | R22。Finish の push で、batch の thread ごとの結果（done / answer / question / skip）を `thread.message` で順に流す（§5.3 C5a） |

---

## 17. 未決事項（[仮] の値と測り方）

| # | 項目 | 現在の値 | 測り方 / 決め方 | 期限 |
|---|---|---|---|---|
| U1 | streaming の高さ予約 H_est の式と上下限 | `clamp(out × cpt / cpl × lh, 120, 2400)` | 5 repo の cassette を生成中の節の途中で見ながら再生し、CLS と `.mstream` の過不足（実高 / H_est）の分布を記録。過不足の中央値が ±30% を超えたら係数を合わせる | M2 |
| U2 | ⌥ 長押しの遅延 | 150ms | IME マトリクスの回で、⌥ を修飾として使う操作（⌥⌘⏎）で誤表示が出ないか | P1 |
| U3 | `g` sequence の待ち時間 | 1,000ms | dogfooding の 1 週間で、取りこぼしと誤発火の件数（registry のデバッグログ） | P1 |
| U4 | 再見積りの debounce | 300ms | 1 依頼あたりの `/jobs/estimate` の回数と、送信時に見積りが古かった割合 | P1 |
| U5 | 1 ページの block 窓 | 300 超で 50 | gen:doc-1000 で DOM・節遷移・`j` の反応を測り、DOM 5k を守れる最大値に | M1 |
| U6 | margin カードの上限 | 8 枚 / 480px | JUDGEMENT §11-5（30 スレッドの fixture で畳んだカードを探す時間） | P2 |
| U7 | 床面図の SVG ノードと品質ゲート | 1,500 / JUDGEMENT §6.3.4 の 4 指標 | JUDGEMENT §11-1・§11-11（8 repo） | M1 |
| U8 | Windows の本文書体（BIZ UDPGothic 優先） | Δ5 | Windows 11 の実機で §3 と §6 を撮影し、Yu Gothic UI 版と並べて 5 人に読みやすさを 5 段階で評価。BIZ UDPGothic が 4 人以上で上なら確定 | P3（Windows 対応） |
| U9 | 明朝見出しの Windows 表示 | Yu Mincho | JUDGEMENT §11-3 | P3 |
| U10 | 詳しいレベルの文脈列の既定 = code | code | JUDGEMENT §11-4（20% 以上速くなければ margin に戻す） | P3 |
| U11 | ⌘1〜⌘4 をブラウザから奪えるか | ⌘1〜4 | Chrome / Safari / Firefox / Edge で Composer にフォーカスして押し、タブが切り替わらないか。奪えない環境があれば ⌥1〜4 を既定に | P1 |
| U12 | 採用 → トースト / 取り消し → 復元 | 300ms / 300ms | `mitori:undo:applied` と accept の応答時間（fixture の Go repo、2 files） | P1 |
| U13 | Inbox の窓化 | 500 行超 | 500 / 1,000 / 2,000 件の fixture で DOM と `j` の反応 | P2 |
| U14 | i18n chunk の大きさ | ja 9KB / en 8KB | WP-10b 完了時の実配信 | P2 |
| U15 | entry chunk 30KB の実現性 | 30KB | WP-10a の最初の PR で実配信を測る。35KB を超えたら loop 用の SSE reducer と ToastSpec の文面を loop chunk に移す | M1 |
| U16 | head inline script | ≤ 1.5KB | minify 後のバイト数（CSP hash の計算と同じ工程で記録） | M1 |
| U17 | ジョブの所要時間の事前値 | answer 4–8s / patch 11–17s / agent 25–40s | 意図 × モードの実績が 20 件たまるまでの初期値。eval fixture の 20 回で p25–p75 を取り直す | P1 |
| U18 | client 予測の精度 | ±10% | AC-U61 の fixture 20 件 | P1 |
| U19 | CM6 の diff に構文色が無いこと | 色なし | 専門家 5 人に 2,000 行超の diff を review してもらい、構文色の要望が 3 人以上なら R7 を P1 に上げる | P2 |
| U20 | タブレットの peek | タップで固定、2 回目で code モード | JUDGEMENT §11-7 | P3 |
| U21 | 1280×800 の S1 右列 | 360px、見積りカードを畳んで開始 | JUDGEMENT §11-9 | M1 |
| U22 | `text-autospace` の対応ブラウザ | Chrome のみ確認済み | JUDGEMENT §11-10（Safari 26 / Firefox 145 で AC-J13） | P1 |
| U23 | 原稿に和欧間の空白を入れない方針と GitHub での読みやすさ | 入れない | JUDGEMENT §11-2 | P1 |
| U24 | IME の実機マトリクス | 未実施 | JUDGEMENT §11-6 + 本書 §8.6 の I8・U11 | P1 出口 |
| U25 | `⇧1〜⇧5` の JIS 配列 | `Digit1〜5 + shiftKey` | JUDGEMENT §11-12 | P1 |
| U26 | 5h 枠の推定の表示 | 未較正なら「未較正」 | JUDGEMENT §11-8、gen spec §9.4 の κ が 3 サンプルたまるまで | P1 |
| U27 | 設定の自動保存の debounce | 400ms | 連続入力（数値の欄）で PATCH の回数と `E_CONFLICT` の件数 | P1 |
| U28 | `cites.showAll` と OS のショートカット | — | macOS の「⌥ を押しながらクリック」等と干渉しないか（dogfooding） | P1 |
