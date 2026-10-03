# UX レビュー（ペルソナ視点の敵対的批評）— ux-personas

- 版: 1.0（2026-10-03） / 役割: 敵対的設計批評（レンズ = 4 ペルソナで全コアフローを歩く）
- 対象（全部読んだ）: `ARCHITECTURE.md`、`adr/0001〜0011`、`specs/{ux,loop,generation,indexer,testing}.md`（ux は全文、他は UX に関わる節）、`contracts/{ui,api,core}.ts`（UX に関わる型と定数）、`MILESTONES.md`、`prototypes/JUDGEMENT.md`、研究 `00-synthesis.md`（Critic addendum 含む）、`07-ux-principles.md`
- ペルソナ（synthesis §1.2）: **P1** 新規参画エンジニア（初日）/ **P2** うるさいテックリード / **P3** 非エンジニアの PM / **P4** token を節約したい Claude Code の常用者
- 決定 D1〜D19 は前提として扱い、蒸し返さない。修正案はすべて決定の範囲内で書いた
- 表記: **[検証済]** = この審査で実際に計算・実行して確かめた（付録 A）。**[仮]** = 推定値で、測り方を併記
- 提案した UI 文言（「」や `` ` `` で囲んだ画面の文）は ux §9.2 の規則（和字と英数字のあいだに半角空白を入れない、キーは `<kbd>`）に合わせて書いた。この文書の地の文は規則の対象外
- 書き込み先はこのファイルだけ。検証用のスクリプトは `scratchpad/design-tmp/ux-personas/` に置いた

---

## 0. 結論（TL;DR）

1. **Pull（P4 の本線）が入口で迷子になる**。`mitori review` が出す URL `/w/<ws>/review` は ux §2.2 の規則で「レビュー待ちの job が 0 件なら Inbox `mine` の空状態」に飛ぶ。Pull では job が無いので、待機中の Claude Code がいることも、次に何をすればよいかも画面に出ない（UXP-01）。
2. **`c`（コメント）が、まとめて送るとコード変更の依頼になる**。`c` は intent `note`、note は Finish で CHANGE として batch され、Pull の SKILL.md は「change / note: edit the code」と指示している。PM の「この説明わかりにくい」がユーザーの作業ツリーのコード編集になる（UXP-02）。
3. **1024〜1311px の幅で Reader と Review がはみ出す** [検証済]。margin モードは 1,232px、review モードは 1,312px を要求する。1280×800 で Review の右端（［すべて採用］）が 32px、iPad 横（1180px）で 132px 切れる（UXP-03）。
4. **信頼表示が実態より強い**: 識別子を 1 つも含まない主張にも「コードで確認済」が付く（L1 の vacuous 合格。UXP-06）、部分採用ではゲートを通っていない組み合わせを ✓ のまま適用し、未承認で skip したゲートも「✓ ゲート 0/3」になる（UXP-05）、データ方針の同意は「閉じた ▾ の中の 1 行」で記録される（UXP-04）。
5. **費用と枠の表示が初回に一番弱い**: 「API換算 $1.3」は請求額に見え（UXP-09）、5h 枠は最初の 3 回の生成が「未較正」で、Pro の利用者が自分の作業枠を生成で使い切ることを止められない（UXP-08）。
6. **daemon が再起動すると全タブ・ブックマーク・agent が中継した URL が 401 / 接続拒否になる**（cookie が起動ごとに変わる token の HMAC。UXP-07）。
7. **⌘K のローマ字正規化が英語の識別子検索を壊す** [検証済]。`pool`→`pol`、`loop`→`lop`、`route`→`rote` に書き換わり、`WorkerPool` などが部分一致しない（UXP-12）。
8. 日本語の細部: ux §3.5 のトースト文面そのものが自分の lint（`mitori/no-ja-space`）に 10 文面・23 箇所以上で違反し [検証済]、ja の UI に `files` `checkpoint` `gate` `skip` `outdated` が混ざる（UXP-25）。GitHub 上の `.mitori/` は Chrome 154 でも `text-autospace` の初期値が `no-autospace` で、和欧間が詰まって見える [検証済]（UXP-24）。

重大度の内訳: **high 11 / medium 22 / low 6**（critical なし）。

| ID | 重大度 | 主なペルソナ | 題 |
|---|---|---|---|
| UXP-01 | high | P4 | Pull の着地点が空の Inbox。待機中のセッションが画面のどこにも出ない |
| UXP-02 | high | P3・P1・P4 | `c` のメモが Finish / Pull でコード変更の依頼として agent に渡る |
| UXP-03 | high | 全員 | 1024〜1311px で margin / review / code モードが横にはみ出す |
| UXP-04 | high | P3・P1 | データ方針の同意を、閉じた開示の中の 1 行で記録する。Push の初回には開示が無い |
| UXP-05 | high | P2・P3 | 部分採用はゲート未検査の組み合わせを ✓ のまま適用する。skip したゲートも ✓ |
| UXP-06 | high | P2 | 識別子 0 個の主張にも「コードで確認済」が付く（L1 の vacuous 合格） |
| UXP-07 | high | P4・P1 | daemon の再起動で全タブ・ブックマーク・Pull の URL が無効になる |
| UXP-08 | high | P4・P3 | 初回の生成は 5h 枠が「未較正」のままで、作業枠を使い切るのを止められない |
| UXP-09 | high | P3・P1 | 「API換算 $」が請求額に見え、従量に切り替わっても見た目が同じ |
| UXP-10 | high | P4 | Finish の既定が push に切り替わり、Pull を選んだ thread も claude-cli で走る |
| UXP-12 | high | P4・P2 | ⌘K のローマ字正規化で英語の識別子が部分一致しない |
| UXP-11 | medium | P4 | session 生成の見積りが過小。`/mitori:gen` が無い。AGENTS ブロックと prep README が矛盾 |
| UXP-13 | medium | P1・P3 | permalink は 127.0.0.1 と端末固有の ws で、「Slack にそのまま貼れる」が成り立たない |
| UXP-14 | medium | P1・P3 | Explain が 2 打鍵で終わらない。Composer の計器が初見者にも全部出る |
| UXP-15 | medium | P1 | `claude` が無い・未ログイン・capability 喪失の画面が無い |
| UXP-16 | medium | P2・P4 | review モードの scope がフォーカス位置で変わる（`[` `]` の意味、⌘⏎ の無反応） |
| UXP-17 | medium | a11y・P4 | キーボードだけでは文（claim）単位のアンカーを作れず、AC-U86 が満たせない |
| UXP-18 | medium | P3 | export を受け取った PM はコメントできない。export のコード抜粋に警告が無い |
| UXP-19 | medium | P3・P1 | 採用の後に「次にすること」（commit・PR）が無い |
| UXP-20 | medium | P2・P3 | 設計書の直接編集が textarea で ADR-0003（CM6）と食い違い、出典を壊すと claim が黙って消える |
| UXP-21 | medium | 全員 | doc_edit の 2 択の文言・順序・キー、⇧F の名前が画面ごとに違う |
| UXP-22 | medium | P1 | `c` `e` `f` を押しただけで空の下書きがサーバに作られ、Inbox と batch バーに溜まる |
| UXP-23 | medium | P1 | ホームなどプロジェクト外で `mitori` を実行すると全走査し、macOS のプライバシー確認が連発する |
| UXP-24 | medium | P1・P3 | GitHub 上の `.mitori/` は和欧間が詰まる（`text-autospace` 初期値 = `no-autospace`） |
| UXP-25 | medium | P3・全員 | トースト文面が自分の lint に違反し、ja に内部語が混ざる |
| UXP-26 | medium | a11y | ⌥ 長押しが Windows / Linux の Firefox でメニューバーにフォーカスを奪う |
| UXP-27 | medium | IME | `@` が和文の直後・全角 `＠` で発火しない。Safari の compositionend 直後の Escape |
| UXP-28 | medium | P2・P4 | router と model をその依頼だけ変える UI が無い（API には override がある） |
| UXP-29 | medium | P4 | ⌘K の群の固定順で、記号名を打っても用語・節が先に来る |
| UXP-30 | medium | P2・P4 | 生成カードの主行に誤差幅が無い。［生成 ⏎］の ⏎ が誤解を招く |
| UXP-31 | medium | P2 | 推測の「確認済にする」が誰でも 1 クリックで、根拠も記録されない |
| UXP-32 | medium | P4 | PostToolUse の `mitori touch` が未登録の repo で何をするか未定義 |
| UXP-33 | medium | P4 | Pull の bundle 既定 4,000 token × thread 数が対話セッションの context に積まれる |
| UXP-34 | low | P3 | `1`〜`9` で §0 と §10〜§13 に行けない |
| UXP-35 | low | P1 | 対象の無い `c` `e` `f` `p` が無反応 |
| UXP-36 | low | P2 | 衝突ダイアログの「やり直しを依頼」に見積りが無い |
| UXP-37 | low | P1 | 1 字の用語（鍵・型・表）を選択できない（`selectionMinChars: 2`） |
| UXP-38 | low | a11y | 採用後のフォーカスの戻り先と、取り消しの案内の読み上げが無い |
| UXP-39 | low | IME | キーの再割当てで IME がオンだと無反応 |

---

## 1. ペルソナごとの歩き方（どこで詰まるか）

### P1 新規参画エンジニア（初日）

1. `git clone` → `mitori`。`claude` が入っていない・ログインしていない → 生成カードには状態の表示が無く、［生成］で 424 になる（UXP-15）。誤ってホームで実行するとホーム全体を走査する（UXP-23）。
2. 0 tok の見取り図は良い。ただ「0 tok」「C=3」「5h 枠」は初日に意味が通じない（UXP-25）。主行の「API換算 $1.3」を請求と読み、押すのをためらう（UXP-09）。
3. 生成を待つ間に読む。チームが `.mitori/` を commit していれば GitHub でも読めるが、和欧間が詰まる（UXP-24）。
4. 分からない文を選んで `e`。Composer に固定チップ・候補チップ・router・経路・見積りが全部並び、質問を打たないと送れない（UXP-14）。何も選ばずに `e` を押すと何も起きない（UXP-35）。`e` → Esc を繰り返すと空の下書きが Inbox に溜まる（UXP-22）。
5. 同僚に「ここ」を見せたくて `y` → Slack に貼った URL は同僚の環境で開けない（UXP-13）。
6. 1280×800 のノート PC では、Review を開くと右端が切れる（UXP-03）。

### P2 うるさいテックリード

1. 詳しいレベルで code モード。✓ が付いた主張を出典で突き合わせる。識別子の無い文に「コードで確認済」「識別子一致」と出ているのを 1 つ見つけた時点で、✓ 全体を信用しなくなる（UXP-06）。
2. `f` で修正 → Review。シグネチャ変更の hunk だけ採用し、呼び出し側の hunk を却下 → ビルドが通らない組み合わせが ✓ ゲートのまま適用される（UXP-05）。
3. diff を見ながら `[` `]` で前後のレビュー待ちへ → ［本文で見る］で prose にフォーカスが移った後は、同じ `[` `]` が「前後のスレッド」になり、⌘⏎ は無反応（UXP-16）。
4. この依頼だけ agent mode や Opus で走らせたい → UI が無い（UXP-28）。衝突時の「やり直しを依頼」は費用を出さない（UXP-36）。
5. 設計書の 1 段落を直接直す → textarea に相対パスの出典リンクが生で出て、消すと claim が黙って消える（UXP-20）。

### P3 非エンジニアの PM

1. 多くの場合、PM は export の HTML を受け取る。読めるがコメントできない（UXP-18）。
2. 自分の端末で動かした場合: 主行の「$1.3」を請求と読む（UXP-09）。データ方針の行は閉じた ▾ の中にあり、読まないまま「読んだ」と記録される（UXP-04）。
3. 文に `c` で「来週の仕様変更で変わる予定」とメモ → ⇧F（「レビューを終える」と「まとめて送る」の 2 つの名前。UXP-21）→ agent がコードを書き換える（UXP-02）。
4. `f` で依頼 → Review の diff は判断できない。採用すると作業ツリーに未 commit で残り、トーストには `checkpoint refs/mitori/ck/…` とだけ出る。次に何をすればよいかが無い（UXP-19、UXP-25）。

### P4 token を節約したい Claude Code の常用者

1. `mitori install claude-code` → `/mitori:review`。開いたタブは空の Inbox（UXP-01）。既にタブを開いていれば、daemon の再起動で認証が切れている（UXP-07）。
2. Composer の経路を毎回「自分のセッションへ」に切り替える必要がある（既定値が無い）。⇧F の時点で Claude Code が待機していなければ既定が push になり、そのまま ⌘⏎ で claude-cli が走る（UXP-10）。
3. `mitori bundle` は thread ごとに既定 4,000 token。10 thread で 40k が対話の context に入る（UXP-33）。
4. 大きな生成は session（D3 で第一級）。UI はターミナルのコマンドをコピーさせるだけで skill が無く、見積りはサブエージェントの固定費を数えていない。AGENTS ブロックの「`.mitori/` を直接編集しない」と prep README の「`.mitori/tmp/prep/…/out/` に書け」が矛盾する（UXP-11）。
5. 初回の生成で 5h 枠がどれだけ減るかが分からない（UXP-08）。⌘K で `pool` `loop` を打っても目的の symbol が上に来ない（UXP-12、UXP-29）。

---

## 2. 指摘（high）

### UXP-01 [high] Pull の着地点が空の Inbox。待機中のセッションが画面のどこにも出ない

- **場所**: `specs/loop.md` §10.1 手順 2（stderr に `http://127.0.0.1:<port>/w/<ws>/review`、初回は nonce URL でブラウザを開く）、`specs/ux.md` §2.2 ルート表の `/w/:ws/review`（「jobs から ready の最古を選び… 0 件なら `inbox?f=mine` の空状態へ」）、§4.6.2（`mine` に pending の thread は入らない）、`contracts/api.ts` `ReviewStatus.waitingClients` と `SSE_EVENT_META`（待機者の増減を知らせるイベントが無い）。
- **失敗シナリオ**: P4 が Claude Code で `/mitori:review` を実行する。agent は `mitori review`（background）を起動し、ブラウザが `/w/<ws>/review` を開く。Pull は job を作らないので ready は 0 件 → Inbox `mine` の空状態「あなたの番の項目はありません」に着地する。待機中の Claude Code がいることも、「文を選んで `c` → ⇧F で渡す」という次の行動も画面に出ない。`waitingClients` は Finish dialog を開いたときにしか取得されない（§5.3 C2・C3）。`/mitori:review` を実行するたびに新しいタブが開く（nonce URL は 1 回限り）。
- **修正**:
  1. ux §2.2 の `/w/:ws/review` の解決規則を 3 段にする: (a) ready の job があれば最古の `/review/:job`、(b) `ReviewStatus.waitingClients > 0` か `pending.length > 0` なら、最後に開いたページ（`mitori:lastPage:<ws>`、無ければ §0）を `?pull=1` 付きで開く、(c) それ以外は Inbox `mine`。
  2. **Pull バー**（新部品 `PullBar`、prose 列の上端に sticky、1 行）:「Claude Code（{agentLabel}）がR{n}を待っています — 文を選んで<kbd>c</kbd>でコメント → <kbd>⇧F</kbd>で渡す · 保留{k}件［渡す ⇧F］」。ヘッダーのジョブチップに `⤴{waiting}` を足す（`JobChipProps.waiting`）。
  3. api に SSE `review.waiting {round, clients, agents: string[]}`（replay: true、scope: workspace）を足す。long-poll は 25 秒ごとに張り直されるので、待機者は `x-mitori-agent` + CLI の pid（新 header `x-mitori-waiter`）で数え、最後の poll から 35 秒の猶予を置いて減らす（数が明滅しない）。
  4. loop §10.1 手順 2: その workspace に SSE で接続中のタブがあれば新しいタブを開かず、そのタブに `review.waiting` を送る（Pull バーが出る。`notifyOnDone` が許可されていればデスクトップ通知「Claude Codeがレビューを待っています」）。タブが無いときだけ nonce URL を開く。stderr に出す URL は UXP-07 の修正後の永続 cookie で開けるものにする。
- **受け入れ基準（追加）**: AC-U-P01「ready 0 件・待機者 1 の状態で `mitori review` を実行すると、1 秒以内に既存タブで Pull バーが出る。新しいタブは開かない。25 秒の再 poll を 3 回挟んでも待機数の表示が変わらない」。

### UXP-02 [high] `c` のメモが Finish / Pull でコード変更の依頼として agent に渡る

- **場所**: `specs/loop.md` §2.1 の意図表（`note`: 「batch job に含める（agent は修正か回答を選ぶ）」、既定 mode「change と同じ」）、§2.4.3-2（`C` = change / doc_edit / **note**）、§3.4（`CHANGE = {change, doc_edit, note}`、R7 = `codeAnchored = false` は `E_PRECONDITION`）、§11.1 SKILL.md 手順 4（「change / note: edit the code, then `mitori reply <id> --done`」）、`specs/ux.md` §6.2-3（`c` = メモ）、§5.3 C1（「複数の文に `c` でメモを付ける」が batch の典型操作）。
- **失敗シナリオ**:
  - P3 が §0 の段落に `c`「この説明わかりにくい」、§6 の段落に `c`「来週の仕様変更で変わる予定」と書いて ⇧F。Pull では agent が SKILL の指示どおり**ユーザーの作業ツリーのコードを直接編集**する（Pull には worktree の隔離が無い）。Push では module 単位の patch / agent job になり、doc 由来の導出 path を write scope にしてコードを書き換えようとする。
  - 出典の無い段落（§0 の要約など）への note は `codeAnchored = false` → R7 で `E_PRECONDITION`。batch の分割次第で Finish 全体が見積り段階で断られる。
  - 設計書の誤字の指摘はコードでは直せない（`.mitori/**` は deny）。agent は `docUpdate` を返すか、無関係のコードを触るかのどちらかになる。
- **修正**（D19 の `c` = コメントは変えない。dispatch の意味だけを直す）:
  1. loop §2.1: `note` の Finish での扱いを「**既定は送らない**（人向けのメモ）。Finish dialog で thread ごとに『AIに送る』を選んだものだけ送る」に変える。ux §5.3 C2 の dialog に「人向けのメモ{n}件（送らない）」の群を作り、行ごとのトグル（既定 off）を置く。
  2. 送ると決めた note の router: primary が doc（`DocAnchor` が主）なら **`docpatch/1`（設計書の提案だけ、write scope = ∅、patch/agent にしない）**、code が主なら `answer/1`（指摘への応答）。コードを変えるのは intent が `change` / `doc_edit` のときだけ。§3.4 の `CHANGE` から `note` を外し、R0 の後に「R0b: intents = {note} → doc-primary は docpatch、code-primary は answer」を足す。
  3. SKILL.md（claude-code・codex の両方）の手順 4 を分ける: 「change: edit the code, then … --done」/「note: do not edit code. Reply `--answer` (1–2 lines), or `--question` if it needs the human」。skill 本体 ≤ 1.5KB の golden を更新する。
  4. `mitori.review/1` の stdout の見出し行に intent が既に出ている（`## <thread-id> <intent> …`）ので、note には末尾に ` (memo: do not edit code)` を付ける（+≈6 token/thread。≤ 50 token/thread の予算内）。
- **受け入れ基準（追加）**: AC-L-NOTE「doc-anchored の note 3 件と code-anchored の note 2 件だけの Finish で、push ではコードの書き込みが 0・提案は doc だけ、pull では SKILL を使った実 Claude Code の E2E で作業ツリーの変更が 0」。

### UXP-03 [high] 1024〜1311px で margin / review / code モードが横にはみ出す [検証済]

- **場所**: `specs/ux.md` §3.1（1024–1280 の S2 = `228 / minmax(672px,1fr) / --ctx-w`、margin 332）、§4.4 の幅（review = 640、code = `clamp(420px, 100vw − rail − 672px, 900px)`、review では rail を 0 に畳む）、`design-tokens.css` 120–128 行と 220–224 行、`prototypes/JUDGEMENT.md` §6.1・AC-J35（1440×900 でしか確かめていない）。§3.1 の「横スクロールなし」と矛盾する。
- **実測**（Chrome 154、`scratchpad/design-tmp/ux-personas/probe.cjs`、tokens と同じ grid を組んで `scrollWidth − clientWidth` を測った）:

| viewport 幅 | margin | review | code（rail を drawer に畳んだ後） |
|---:|---:|---:|---:|
| 1024 | **208px** | **288px** | **68px** |
| 1100 | 132px | 212px | 0 |
| 1180（iPad Air 横） | 52px | 132px | 0 |
| 1194（iPad Pro 11 横） | 38px | 118px | 0 |
| 1232 | 0 | 80px | 0 |
| 1280（13" ノート、1920×1080 の 150%） | 0 | **32px** | 0 |
| 1312 以上 | 0 | 0 | 0 |

  - 必要幅: margin = 228 + 672 + 332 = 1,232px、review = 0 + 672 + 640 = 1,312px。Windows の通常のスクロールバー（17px）は `100vw` に含まれるので、code の clamp はさらに 17px 過大になる。
  - review 中に `b`（rail の開閉）を押すと 248 + 672 + 640 = 1,560px で、1440 でも 120px はみ出す（§4.4 に規則が無い）。
- **失敗シナリオ**: 1280×800 で P2 が `r` → Review の右端 32px（フッターの［すべて採用 ⌥⌘⏎］の一部）が切れ、横スクロールが出る。iPad 横で P1 が設計書を開くと本文の右側の margin カードが 52px 切れる。
- **修正**:
  1. 幅の計算は `100vw` ではなく grid コンテナの `clientWidth`（ResizeObserver）で行う（`ContextColumnStore` に `containerPx` を持たせる）。
  2. margin モード: コンテナ幅 < rail + prose-min + ctx-margin（1024–1280 では 1,232px）のとき、rail を自動で drawer にする（code モードの既存規則と同じ。`data-rail="auto"`、`b` で drawer を開く）。これで 1024px でも 0 + 672 + 332 = 1,004px に収まり、Windows のスクロールバー 17px を引いた 1,007px にも入る（prose の padding ≥ 40px と 37em の行長は変えない）。
  3. review モード: コンテナ幅 < prose-min + 640 のときは、列ではなく**右寄せの overlay**（`position: fixed; right: 0; width: min(640px, 100% − 48px)`、背面の prose は `inert` にせずスクロール可、Escape で閉じる）にする。⇧R の全幅 overlay と同じ部品を使う。
  4. review 中の `b` は rail を drawer（overlay）で開く。
  5. code モードの clamp で rail を畳んでも 420 に満たない（コンテナ < 1,092px）ときは code モードを bottom sheet にする（< 1024 と同じ部品）。
- **受け入れ基準（追加）**: AC-U-W01「viewport {1024×768, 1180×820, 1194×834, 1280×720, 1280×800, 1366×768, 1440×900} × {S1, S2 margin, S2 code, S5 review（`b` を押した状態を含む）, S4} の全組で `document.documentElement.scrollWidth − clientWidth = 0`、本文の 1 行が 34 字以上。Windows のスクロールバー幅を `::-webkit-scrollbar { width: 17px }` で模擬した回も含める」。

### UXP-04 [high] データ方針の同意を、閉じた開示の中の 1 行で記録する。Push の初回には開示が無い

- **場所**: `specs/ux.md` §4.2.4-5（データの扱いの 1 行は［内訳と経路 ▾］の中。**初めて・標準では閉**）と §4.2.4-7.1（［生成］を押すと「カードの開示行を読んだことの記録」として `privacy.dataPolicyAck` に時刻を書く）、`ARCHITECTURE.md` §7.6（「初回の生成前に、送信先と plan ごとのデータ方針を 1 行で示し」）、synthesis Critic addendum C2（consumer plan は学習許可時に保持 5 年。NDA コードでは購入判断に直結）。
- **失敗シナリオ**:
  - P3 が標準レベルのまま［生成］を押す。データ方針の行は閉じた ▾ の中で、一度も描画されていないのに「読んだ」と記録され、以後は二度と出ない。
  - チームが `.mitori/` を commit していた P1 は、生成をせずにいきなり `e`（Explain）を使う。Composer の経路にはデータ方針の開示が一切無い（§6.2）ので、コードの抜粋が送信される前に何も知らされない。
- **修正**:
  1. `privacy.dataPolicyAck[engine]` が無いあいだ、生成カードは主行の**上**に、畳めない 1 行の「送信の確認」を出す: `送信先: Anthropic（あなたのclaude CLI経由・認証情報は読みません）· プラン: {plan}（{consumer: 学習は設定に従い、保持は30日／学習を許可していれば5年 | commercial: 学習に使われません}）· 対象{n}ファイル · 伏せ字{k}件［詳細］`（`{plan}` は `EngineStatus.plan`）。plan が consumer のときは［API key モードについて］のリンクを足す。
  2. ack を記録するのは、その行が viewport に 1 秒以上見えた後だけ（IntersectionObserver）。`PATCH /settings` に `ackShownAt` を送り、gen spec / core の `privacy.dataPolicyAck` を `{at, shownAt, plan}` にする。
  3. 同じ「送信の確認」行を、engine ごとの最初の Push（Composer のフッター）と、`mitori gen --prep` 以外のすべての送信経路（Finish の push）に出す。session（自分の agent）は送信先がユーザーの agent なので出さない。
- **受け入れ基準（追加）**: AC-U-DP「ack が無い状態では、全読者レベルで送信の確認の行が展開されて見え、見えないまま［生成］を押した場合は ack が記録されない。最初の Explain でも同じ行が Composer に出る」。

### UXP-05 [high] 部分採用はゲート未検査の組み合わせを ✓ のまま適用する。skip したゲートも ✓

- **場所**: `specs/loop.md` §7.8 手順 2（hunk 指定なら選んだ hunk だけを base に当てた H′ を作り、そのまま merge-tree → 書き込み。**gates を H′ で走らせない**）、`specs/ux.md` §6.5 ReadyCard（`✓ ゲート {pass}/{total}`、失敗があるときだけ ✕）、§4.7.1-2（skipped / untrusted は灰）、§4.7.2（焦点単位の採用で一部採用を推奨する操作体系）、§4.12（trust は Inbox とトーストで知らせ、モーダルは出さない）。
- **失敗シナリオ**:
  - A（P2）: Go の修正で hunk 1 が関数のシグネチャを変え、hunk 2 が呼び出し側を直す。hunk 2 を却下して採用 → 作業ツリーはビルドが通らないが、パネルは ✓ gofmt / ✓ go vet / ✓ go test のまま。`partially_accepted` の後にユーザーが初めて壊れていることに気づく。
  - B（P1・P3）: その repo で最初の Fix。gate は trust 前なので `untrusted` で skip → ReadyCard は「✓ ゲート 0/3」と ✓ を付けて出す。検査されていない patch が「検査済み」に見える。
- **修正**:
  1. ゲートの要約を 4 値にする（`ui.ts` に `GateVerdict = "passed" | "failed" | "unverified" | "partial_unverified"`）。✓ を付けるのは「適用する木そのもの」で全 gate が pass したときだけ。skip / untrusted が 1 つでもあれば `⚠ 検査なし（未承認{n}件）［内容を見て承認］`（`--c-warn`）。
  2. loop §7.8 に手順 2b を足す: H′ ≠ head なら、job の worktree を H′ に切り替えて**同じ gates を再実行**してから 3 へ進む（0 token。所要は前回の gate 時間 ≈ 数秒）。Review パネルは決定が全部そろった時点で「組み合わせを検査中…」のステージ行を出し、失敗なら主ボタンを「検査に失敗した組み合わせを採用」（副ボタン・`--c-warn`）に変える。`job_gates` に `attempt: "partial"` で記録する。
  3. repo で最初の Fix のときは、Composer のフッターに trust の要約を 1 行出す: 「このリポジトリの自動検査3件（gofmt -l / go vet … / go test …）は未承認です［内容を見て承認］— 承認しないと検査せずに提案します」。押すと Trust dialog（§4.12。初期フォーカスは preview のまま）。
- **受け入れ基準（追加）**: AC-U-G01「hunk 2 を却下するとコンパイルが通らない fixture で、一部採用の前に gate が H′ で再実行され、失敗が表示される」。AC-U-G02「untrusted の gate だけの job の ReadyCard に ✓ glyph が出ない」。

### UXP-06 [high] 識別子 0 個の主張にも「コードで確認済」が付く（L1 の vacuous 合格）

- **場所**: `specs/generation.md` §7.1 L1（「span が 0 個なら `l1 = true`（metric 上は vacuous として別集計）」）、§7.2 #7（それ以外 → `verified`）、§7.3（verified のラベル = 「コードで確認済 / Verified in code」）、`specs/ux.md` §4.3.5（verified の ✓）、§4.3.6（peek のフッター「確認済 範囲は実在 · 識別子一致 · hash 一致」）。
- **失敗シナリオ**: 「このキューはスレッドセーフである（[pool.go:10-40](…)）」のように backtick の識別子を含まない主張は、範囲が実在するだけで verified になり、peek には「識別子一致」と出る。照合する識別子が 1 つも無かったのに、照合に成功したように見える。P2 はこれを 1 件見つけた時点で、すべての ✓ を信用しなくなる。設計書の文の多くは識別子を含まない説明文なので、この扱いが ✓ の大半を占めうる。
- **修正**:
  1. core の `Claim.checks.l1` を `boolean` から `"pass" | "fail" | "vacuous"` にする（gen §7.1）。
  2. verdict に `cited`（出典あり · 内容は未照合 / Cited, not checked）を足す。`computeVerdict` の #7 の前に「`l1 = "vacuous"` かつ `l3 ≠ "S"` → `cited`」。表示は verified と同じく既定では隠し（hover・⌥・詳しいで出す）、形は灰の `◦`。
  3. peek のフッターは項目ごとに結果を出す: `範囲は実在 ✓ · 識別子: 照合する語なし · ハッシュ一致 ✓`。
  4. verified のラベルを「出典と識別子が一致 / Identifiers match the source」に変え、「確認済」という語は human-verified（✓✓）と L3 の S だけに使う。`VERDICT_BADGES` と i18n の `verdict.*` を合わせて直す。
  5. gen §7.4 に `gen.cite.l1.vacuousShare`（vacuous の割合）を足して記録する。高ければ prompt で「主張には識別子を backtick で含める」を強める。
- **受け入れ基準（追加）**: AC-G-VAC「backtick の無い claim を含む fixture で、その claim の verdict が `cited` になり、peek に『識別子一致』が出ない」。

### UXP-07 [high] daemon の再起動で全タブ・ブックマーク・Pull の URL が無効になる

- **場所**: `contracts/api.ts` の cookie 定義（`mitori_s` の値 = `HMAC(token, nonce)`）と `DaemonRegistry.token`（「Rotated on every daemon start」）、`ARCHITECTURE.md` §2.3（全 workspace が idle で 30 分後に自動終了）・§2.2（版が違えば idle の daemon を再起動）、`specs/ux.md` §2.4（`auth_expired` の帯は「ターミナルで `mitori` を実行」としか言えない）、`specs/loop.md` §10.1 手順 2（2 回目以降は nonce の無い URL を stderr に出すだけ）。
- **失敗シナリオ**:
  - a: Chrome の Memory Saver が背面の mitori タブを破棄 → SSE が切れて idle → 30 分後に daemon が終了 → タブに戻ると Chrome の「127.0.0.1 で接続が拒否されました」。mitori の帯すら出ない。
  - b: バイナリを更新した後の最初の CLI 呼び出しで idle の daemon が再起動 → 開いている全タブが 401 → `auth_expired` の帯。
  - c: Pull で agent が数分後に中継した `http://127.0.0.1:<port>/w/<ws>/review` は nonce を含まないので、cookie が古いと 401。ユーザーはターミナルに戻って `mitori` を打ち、さらにもう 1 つタブが増える。
- **修正**:
  1. **ブラウザ用の署名鍵を CLI の bearer token と分ける**: `~/.mitori/session.key`（0600、256 bit）。daemon の再起動では変えず、`mitori doctor --rotate-session` と 30 日ごとの更新だけで変える。cookie = `HMAC(sessionKey, sessionId)`、session の一覧は state.sqlite に持つ（失効できる）。CLI / MCP / hook の bearer は今どおり起動ごとに再生成する。ADR-0009 に追記する。
  2. port は記憶した値を厳密に優先し、使えないときだけ変える。変わったら CLI が新しい URL を表示する（cookie は port に依存しないので有効なまま）。
  3. 自動終了までの idle を 30 分 → 4 時間にする（idle RSS ≤ 30MB の予算内。破棄されたタブを戻したときに daemon が生きている確率を上げる）。
  4. 版の違いによる再起動の後、SSE の `hello` で `server.version` を送り、タブは再読み込みの帯（`version_mismatch`）だけを出す（認証は切れない）。
- **受け入れ基準（追加）**: AC-U09「daemon を `mitori stop` → 起動し直しても、開いていたタブは 5 秒以内に `live` に戻り、401 にならない」。

### UXP-08 [high] 初回の生成は 5h 枠が「未較正」のままで、作業枠を使い切るのを止められない

- **場所**: `specs/generation.md` §9.4（κ は n < 3 の間 `null` → UI は「5h枠: 未較正」、`window_risk` は κ がある場合だけ判定）、§9.6（100k LOC 標準 = API 換算 $2.92・C=3 で 4.8 分）、`ARCHITECTURE.md` §2.6（80% を超えたら background だけ止める）、`specs/ux.md` §4.2.4-4、synthesis Critic addendum C3（「Pro の利用者では標準の生成 1 回で枠を使い切るおそれ」）・C8（ユーザーの対話セッションとの取り合い）。
- **失敗シナリオ**: Pro の P4 が 5h 枠 45% の時点で、100k LOC の repo の標準生成を押す。κ が未較正なので `window_risk` は出ず、補足行は「5h 枠: 未較正」だけ。生成が枠を 80% まで押し上げてから background が止まる。午後の本来のコーディング作業で 429 に当たる。較正には同じ規模の生成が 3 回要るので、新しい利用者は最初の 3 回とも守られない。
- **修正**:
  1. plan ごとの事前分布 `WINDOW_PRIORS`（`EngineStatus.plan` = `pro` / `max5` / `max20` ごとに κ の [下限, 上限] [仮]。O2 / C3 の計測で埋める）を core の純データとして持ち、κ が未較正のあいだは上限を使って `window_risk` を判定する。表示は「5h枠45% → 推定+15〜40%（未較正・Proの目安）」。
  2. 未較正かつ plan が `pro` のときは、effort の既定を「概要」にし、主行の下に「初回は枠の消費が分からないため、まず概要（約$0.4）で試せます」を出す（押せば標準にも切り替えられる）。
  3. scheduler の譲り合いに、絶対値（80%）に加えて**この run が使った増分の上限**を足す: `u_now − u_runStart > 0.30` [仮] で background を一時停止し、帯で「この生成で5h枠を30%使いました。続けますか？［続ける］［リセット後に再開］」。
  4. 生成完了のトースト `gen.done` に「5h枠+{x}%（この生成）」を出す（ユーザーにとっての較正の 1 標本になる）。
- **受け入れ基準（追加）**: AC-G-W01「κ = null・plan = pro・utilization 0.6 の fixture で、標準の見積りに `window_risk` が付き、主行のボタンが 4 択になる」。

### UXP-09 [high] 「API換算 $」が請求額に見え、従量に切り替わっても見た目が同じ

- **場所**: `specs/ux.md` §4.2.4-3（主行 `標準: 約0.4M tok · API換算 $1.3 · 約6分`）・-4（補足行に「claude-cli（あなたのサブスク）」）、§3.4（ステータスバー `今日 {tok} tok · ${usd} API換算`）、§6.8（見積りチップ）、§9.6（`API換算 = API-equivalent`）、`research/07` §6.4 の anti-pattern「トークンを $ だけで出す（サブスク利用者には無意味）」、synthesis Critic addendum A1（主単位を API 換算 $ にする判断）。
- **失敗シナリオ**: P3 は「$1.3」を mitori か Anthropic からの請求額と読み、押すのをやめるか、経理に確認しに行く。逆に、課金区分が従量（overage）に変わっても主行の書式は同じなので、本当に課金される場面との区別が数字からは付かない（帯と確認理由は出るが、主行の数字の意味は変わらない）。
- **修正**（主単位を API 換算 $ にする決定は変えない。数字が「請求されるか」を同じ行に書く）:
  - `EngineStatus.billing` / `SubscriptionWindow.billing` から主行の書式を選ぶ:
    - `subscription-window`: `標準: 約0.4M tok · 約6分 · サブスクの枠内（追加料金なし）· API換算 約$1.3`
    - `overage` / `metered-api`: `標準: 約0.4M tok · 約6分 · 約$1.3が課金されます`（`--c-warn`、既存の確認理由と組み合わせる）
    - `unknown`: `標準: 約0.4M tok · 約6分 · 課金の扱いは未確認 · API換算 約$1.3`
  - ステータスバーは `今日182k tok · API換算$0.54（請求なし）`（従量なら `請求$0.54`）。
  - i18n キー `estimate.billing.{subscription,metered,overage,unknown}` を足し、parity に含める。
- **受け入れ基準（追加）**: AC-U-B01「billing の 4 値の fixture で、主行とステータスバーの文言が上のとおりになる」。

### UXP-10 [high] Finish の既定が push に切り替わり、Pull を選んだ thread も claude-cli で走る

- **場所**: `specs/ux.md` §5.3 C3（「既定は待機中の `mitori review` があれば pull、無ければ push」）、§5.2 の「経路 = 自分のセッションへ」（thread を open にするだけ）、`contracts/ui.ts` `ComposerState.path`（既定値の規定が無い）、`contracts/core.ts` の `GlobalSettings`（経路の既定値を持つキーが無い）。
- **失敗シナリオ**: P4 は Composer で毎回「⤴ 自分のセッションへ」に切り替えて 6 件のコメントを書く（既定値が無いので毎回の操作になる）。⇧F を押した時点で Claude Code はまだ `/mitori:review` を実行していない → dialog の既定が push になり、いつもの ⌘⏎ で claude-cli の batch job が走る。token を自分のセッションで使いたかった判断が、1 打鍵で黙って覆る。
- **修正**:
  1. `UiSettings.defaultExecPath: "push" | "pull" | "copy"`（global と workspace override、既定 `push`）を足し、Composer は「前回この workspace で選んだ経路」→ `defaultExecPath` の順で初期値を決める。
  2. Finish dialog の既定経路は「pending の thread が選んでいた経路」で決める。全部 pull なら待機者の有無にかかわらず pull。混在していれば dialog を経路ごとの 2 群に分ける。**待機者の有無で黙って push にしない**。
  3. pull で待機者が 0 のとき、主ボタンは「R{n}を準備する」にし、下に「Claude Codeで<code>/mitori:review</code>を実行すると渡ります［コマンドをコピー］」を出す（round は `dispatched` で残り、次の `mitori review` が拾う。loop §2.5 の既存の動作）。
- **受け入れ基準（追加）**: AC-U-F01「全 thread の経路が pull・待機者 0 で ⇧F → ⌘⏎ したとき、job の要求が 0 で round が dispatched になる」。

### UXP-12 [high] ⌘K のローマ字正規化で英語の識別子が部分一致しない [検証済]

- **場所**: `contracts/ui.ts` の `ROMAJI_RULES`（「Romaji normalization applied to BOTH query and index」、`ou→o`、`oo→o`、`-→""` などを含む）、`PALETTE_SCORING`、`specs/ux.md` §4.10「照合」1〜2（正規化の後にラベルの部分一致を最初に評価する）、AC-J46・AC-U70（日本語の用語しか試さない）。
- **実測**（`scratchpad/design-tmp/ux-personas/romaji.mjs`。規則を仕様どおりに順に適用）:
  - query だけを正規化してラベルと比べる場合: `pool`→`pol`、`loop`→`lop`、`root`→`rot`、`count`→`cont`、`route`→`rote`、`chunk`→`tyunk`、`shad`→`syad`、`jou`→`zyo`。どれも `WorkerPool` `loop` `rootDir` `count` `route` `chunkSize` `shadow.git` `journal` に部分一致しない。`pool` は部分一致で `PolicyLoader`（`pol…`）に負ける。
  - ラベルも正規化する場合: 打っている途中で結果が消える（`sh` で `shadow.git`、`ch` で `chunkSize`、`j` で `journal` が外れ、次の文字で戻る）。`ou→o` と `-→""` で長さが変わるので、`marks`（UTF-16 の位置）が元のラベルに対応しなくなる。
- **失敗シナリオ**: P4 / P2 が ⌘K で `pool` と打つと、`WorkerPool` が上位 3 件に入らない。⌘K は symbol へ移動する主な手段なので、英語の識別子で毎回外れる。
- **修正**:
  1. query を 3 形で持つ: `qRaw` = NFKC + 小文字 + 空白除去（ラベル・別名・補助行・部分列の照合と `marks` に使う）、`qKana` = カタカナ → ひらがな（よみ `y` に使う）、`qRomaji` = `ROMAJI_RULES(qRaw)`（`/^[a-z'-]+$/` のときだけ、ローマ字欄 `r` にだけ使う）。**ラベルには ROMAJI_RULES を適用しない**。`ROMAJI_RULES` の JSDoc を「query（ローマ字欄との照合用）と `r` 欄にだけ適用」に直す。
  2. 打ちかけの末尾（`s` `sh` `c` `ch` `t` `ts` `j` `f` `n`）は、正規化しない末尾でも `r` の前方一致を試す（`mochi` の途中の `moch` でも「持ち越し」が残る）。
- **受け入れ基準（追加）**: AC-J46b「`pool` → `WorkerPool`、`loop`、`route`、`chunk` → `chunkSize`、`carry-forward` → `carryForwardComments` がそれぞれ symbol 群の先頭に来て、`marks` が元のラベルの文字を指す。`chunkSize` の全ての前方部分（`c` `ch` `chu` …）で `chunkSize` が上位 3 件から外れない」。

---

## 3. 指摘（medium）

### UXP-11 [medium] session 生成の見積りが過小。`/mitori:gen` が無い。AGENTS ブロックと prep README が矛盾

- **場所**: `specs/generation.md` §8.4.2（README「If you can start subagents, give each task to a fresh subagent with only these two files」）、§9.3（session = 「claude-cli と同じ式で計算し参考値と表示」）、§9.5（session C=1）・§9.6（100k LOC 標準の session C=1 = 16.9 分、1M LOC 完全 = 426 分）、`specs/loop.md` §11.1（plugin の skill は review だけ）・§11.3（AGENTS ブロック「Never edit `{docDir}/` directly」）、`specs/ux.md` §4.2.4-8（session はターミナルのコマンドをコピーして 3 手順を手で行う）。
- **失敗シナリオ**:
  - P4 は「自分のセッションで回せば安い」と考えて session を選ぶ。README に従って task ごとにサブエージェントを立てると、サブエージェントごとに Claude Code 自身の system prompt と tool 定義（≈ 10k token 級 [仮]）、`system.md`（gen.system + repo pack ≈ 11.5k）の再読込、Read の行番号の前置（≈ +10% [仮]）が加わる。100k LOC 標準の 37 task で、claude-cli の式より 0.4〜0.8M token 多くなりうる [仮]。UI の「参考値」はこれを含まない。
  - AGENTS ブロックを入れた repo では、agent が「`.mitori/` を直接編集しない」と「`.mitori/tmp/prep/<id>/out/` に書け」の矛盾に当たり、書き込みを拒むかユーザーに確認を求める。
  - UI の手順は「ターミナルでコマンドを実行 → 表示された README を Claude Code に渡す → ingest」で、Claude Code の中で完結しない。
- **修正**:
  1. session の見積り式を別に持つ: `U_t,session = (P + I_t)·(1 + r_read) + ε_sub`（`ε_sub` = サブエージェント 1 本の固定費、`r_read` = Read の前置の比率）。P0 の計測（O2）に「実 Claude Code で 5 task を session で回し、`/cost` の差分を取る」を足して `ε_sub` と `r_read` を決める。表示は「あなたのセッションで消費 · 推定{k}（サブエージェント込み・未較正）」。
  2. README に「同じ module の小さな task は 1 つのサブエージェントに 3 件までまとめる」を足す（固定費を割る）。
  3. plugin に `skills/gen/SKILL.md`（`/mitori:gen [overview|standard|complete]`、`disable-model-invocation: true`、≤ 1.5KB）を足す。中身: `mitori gen --prep --effort $1` → README に従う → サブエージェント → `mitori check` → `mitori gen --ingest` → `NEXT:` があれば繰り返す。UI の session ボタンは主に「`/mitori:gen standard` をコピー」、副に生のコマンドをコピーにする。
  4. AGENTS ブロックを「Never edit `{docDir}/` directly, except `{docDir}/tmp/prep/*/out/` when following a mitori prep README.」にする（≈ +14 token、上限 80 の範囲内か golden で確認）。
- **受け入れ基準（追加）**: AC-G-S01「session の見積りの golden が `ε_sub` を含む」。AC-L-S02「AGENTS ブロックを入れた fixture repo で、実 Claude Code が prep の out/ に書くことを拒まない」。

### UXP-13 [medium] permalink は 127.0.0.1 と端末固有の ws で、「Slack にそのまま貼れる」が成り立たない

- **場所**: `specs/ux.md` §2.3-7（`y` → 2 行目に URL。「Slack にそのまま貼れる」）、`contracts/ui.ts` `permalinkText`、`contracts/core.ts` `WorkspaceKey`（`base32(sha256(realpath(root)))` = 端末とパスに固有）と `DocId`（「repo を移しても変わらない」）、`research/07` §6.3-9。
- **失敗シナリオ**: P1 が `y` で §3.2 のリンクを Slack に貼る。同僚がクリックすると同僚の 127.0.0.1 に行き、mitori が動いていないか、別のパスに clone しているので ws が違って開けない。自分でも port が変わると開けない。
- **修正**: `permalinkText` の 2 行目を持ち運べる参照にする。(a) `.mitori/` が commit 済みで `origin` が GitHub なら `https://github.com/<o>/<r>/blob/<HEAD>/.mitori/doc/<file>.md#L<mdLine>`（+ 出典があればコードの blob URL）、(b) そうでなければ `mitori open <docId>#b_xxxxxxxx`。daemon に `/d/:docId/b/:block` のルートを足し、`DocId` からその端末の workspace を引いて `/w/:ws/doc/…#b_…` に redirect する。ローカルの URL は ⌘K の「ローカルURLをコピー」だけにする。
- **受け入れ基準（追加）**: AC-U-PL「`y` の 2 行目が 127.0.0.1 を含まない。別のパスに clone した同じ repo で `mitori open <docId>#b_…` が同じ block を開く」。

### UXP-14 [medium] Explain が 2 打鍵で終わらない。Composer の計器が初見者にも全部出る

- **場所**: `specs/ux.md` §1-7（「キーボードで 2 打鍵以内」）、§6.2（Composer の 7 部品を読者レベルによらず全部出す）、§5.2 B2・B5（本文を入力してから ⌘⏎）、`research/07` §0-5（「どれも選択範囲から 1 キー」）、`prototypes/JUDGEMENT.md` §3.2-2（Pro の計器を P1 / P3 に見せない理由）。
- **失敗シナリオ**: P1 が分からない文を選んで `e`。Composer に固定チップ「system + 規約 0.7k cache」、候補チップ「+ 関連: … +1.4k」、router「answer · claude-sonnet-5-5」、経路の切替、見積り「≈2.4k in · ≈0.4k out · $0.012 · 約4–8秒」が並び、本文が空だと送れない。「説明して」の 1 キーが、計器の読み取りと作文の作業になる。
- **修正**:
  1. intent = 質問で本文が空のとき、送信を有効にし、i18n の定型文 `composer.defaultAsk.question`（「この部分を{読者レベル}向けに、出典つきで説明して」）を ASK として送る。本文欄の placeholder は「空のまま<kbd>⌘⏎</kbd>で説明します」。
  2. Composer の密度を読者レベルで変える（`READER_LEVEL_RULES` に `composerDensity` を足す）: 初めて = ヘッダー・引用・意図・本文・1 行「約5秒 · サブスクの枠内」・［送信］。context chips・router・経路は「詳細 ▸」に畳む。標準 = + 見積りチップ。詳しい = 全部（今の仕様）。
- **受け入れ基準（追加）**: AC-U-E01「初めてレベルで `e` → ⌘⏎ の 2 打鍵で answer job が始まる。Composer の操作要素は 6 個以下」。

### UXP-15 [medium] `claude` が無い・未ログイン・capability 喪失の画面が無い

- **場所**: `specs/ux.md` §4.2.4-7（扱うエラーは `E_PRECONDITION` と `E_BUDGET_EXCEEDED` だけ）、§6.2（Composer）、`contracts/api.ts` `EngineStatus.{installed, auth, problems}`、`contracts/core.ts` `E_AGENT_NOT_INSTALLED` / `E_AGENT_AUTH_SOURCE`（http 424）、ADR-0005（`--bare` が既定になったら Pull / Copy に落とす）。
- **失敗シナリオ**: 初日の P1 の端末に `claude` が無い。見積りカードは普通に出て、［生成］を押すと 424 になる（どこにどう出るかの規定が無い）。Composer で `e` を押しても同じ。
- **修正**: S1 の取得に `GET /engines` を加え（§2.2 の表）、生成カードと Composer の経路が engine の状態で変わるようにする:
  - `installed = false`: 「Claude Codeが見つかりません」［インストール方法］［自分のagentで生成（session）］［プロンプトをコピー］。Composer の経路の既定は「プロンプトをコピー」。
  - auth が未ログイン: 「Claude Codeにログインしていません」［ログイン用のコマンドをコピー］［再検出］。
  - `problems` に `E_AGENT_CAPABILITY`: 「この版のclaudeではmitoriから直接実行できません — 自分のセッションかコピーで続けます」。
- **受け入れ基準（追加）**: AC-U-EN「3 状態の engine fixture で、生成カードと Composer に上の文言と代わりの経路が出て、［生成］を押しても 424 にならない」。

### UXP-16 [medium] review モードの scope がフォーカス位置で変わる

- **場所**: `specs/ux.md` §8.1 手順 2（`ctx.mode === "review" && focusInsideReviewPanel` のときだけ review scope）、§8.3（パネル外の prose にフォーカスを戻すと read）、§8.4（`[` / `]` は read = 前後のスレッド、review = 前後のレビュー待ち）、§4.7.1-7（［本文で見る］は本文の提案ブロックへフォーカスを移す）、`prototypes/JUDGEMENT.md` X6（「ポインタの位置で意味が変わるのはモードの取り違え」として捨てた）。
- **失敗シナリオ**: P2 が Review で ［本文で見る］ を押す → フォーカスが prose に移る → `n` と ⌘⏎ が効かなくなり（read scope に ⌘⏎ は無い）、`[` は「前のスレッドカード」に意味が変わる。画面上は review モードのままなので、無反応と意味の変化の理由が見えない。
- **修正**: `ctx.mode === "review"` のあいだは、フォーカスの位置によらず scope を `global + review + read`（review を優先）にする。read と衝突するキー（`[` `]` `r`）は review の意味だけを有効にし、read 側は止める。ステータスバーに `Review · ⌘⏎採用 · n次へ` を出す。§8.3 の表と `ROUTE_SCOPES` の説明を直す。
- **受け入れ基準（追加）**: AC-U-RS「［本文で見る］の後でも ⌘⏎ がフォーカス中の単位を採用し、`[` `]` が前後のレビュー待ちに移る」。

### UXP-17 [medium] キーボードだけでは文（claim）単位のアンカーを作れず、AC-U86 が満たせない

- **場所**: `specs/ux.md` §5.2 B1（「1 つの block の中で 2 文字以上を選ぶ」）、§6.1、§8.4（`⇧V` は block 単位の visual mode）、AC-U86（Flow A〜F をキーボードだけで通す）、WCAG 2.1.1。
- **失敗シナリオ**: 読み取り専用の本文でキーボードだけで文字範囲を選ぶには caret browsing（Chrome の F7）が要る。キーボードだけの利用者（と P4）は `j` / `k` + `c` で block 全体にしかアンカーを付けられず、主張単位の指摘ができない。AC-U86 は B1 を通せない。
- **修正**: フォーカス中の block の中で claim を移る `Alt+J` / `Alt+K`（`read.claimNext` / `read.claimPrev`、`.mc[data-claim]` を順に `::highlight(mitori-sel)` で塗る。DOM を割らない）を足し、`c` `e` `f` はその claim をアンカーにする（`DocAnchor.claim` + quote = claim の本文）。`⇧V` を claim カーソルの上で押すと文単位で広げる。ヘルプと keymap snapshot に足す。AC-U86 の B1 をこの操作で書き直す。

### UXP-18 [medium] export を受け取った PM はコメントできない。export のコード抜粋に警告が無い

- **場所**: `contracts/ui.ts` `MODE_CAPABILITIES.viewer`（`compose: false`）、`ViewerPayload.cites`（出典ごとに ±3 行のコード）、`specs/ux.md` §4.13、`ARCHITECTURE.md` §7.4（export では secret scan だけ）、ADR-0008。
- **失敗シナリオ**: P3 は daemon を動かさない。受け取った HTML で読んで「ここは違う」と思っても、書き込む場所が無い（Slack に文面を書き写すしかなく、アンカーが失われる）。P3 がその HTML を社外に転送すると、出典の peek に埋め込まれたコードの抜粋（全出典 × ±3 行）も一緒に出ていくが、書き出し時にそれを知らせるのは secret の件数だけ。
- **修正**:
  1. viewer にローカルのコメントを足す（`MODE_CAPABILITIES.viewer.compose = "local"`）: 選択 → `c` → localStorage（キー = export の `docId` + `exportedAt`）。「コメントを書き出す」で `mitori-comments-<docId>.json`（`format: "mitori.comments/1"`、`DocAnchor`（block id + TextQuote）・本文・任意の名前）を保存するか、テキストとしてコピーする。
  2. CLI に `mitori import-comments <file>` を足す: draft thread として取り込み、block id と TextQuote で付け直す（付けられないものは outdated）。
  3. 書き出し dialog（§4.13）に「コードの抜粋{n}箇所（{m}ファイル）を含みます」と、選択肢「抜粋を含めない（出典はパスと行番号だけ）」を足す。
- **受け入れ基準（追加）**: AC-U99b「viewer でコメントを 2 件書いて書き出し、`mitori import-comments` で同じ block に draft thread が 2 件できる」。

### UXP-19 [medium] 採用の後に「次にすること」（commit・PR）が無い

- **場所**: `specs/ux.md` §5.2 B10〜B13、§3.5 `accept.done`（`checkpoint {ref}` を出す）、§6.5（採用後のカード `✓ R2 で解決 · 適用済み · checkpoint {ref}`）、`specs/loop.md` §7.8-11（commit は `review.autoCommit` の opt-in だけ）。
- **失敗シナリオ**: P3 が採用すると、変更は作業ツリーに未 commit で残り、トーストには `refs/mitori/ck/…` が出る。P3 には commit も PR も、誰に確認してもらうかも分からない。数日後に別の作業と混ざる。
- **修正**: 採用後の 1 行カードに［コミットする］（メッセージ案 = thread の題 + AI の要約。`autoCommit` と同じ trailer で、この時だけ明示的に commit。user の hook が走る旨を 1 行で）、［差分をコピー］、［PR を作る（gh）］を置く。初めてレベルでは `checkpoint` の表記を「あとで取り消せます（履歴から）」にする。Inbox に「適用済み・未コミット」のフィルタを足す。

### UXP-20 [medium] 設計書の直接編集が textarea で ADR-0003 と食い違い、出典を壊すと claim が黙って消える

- **場所**: `specs/ux.md` §5.5-1（「`<textarea>`、等幅ではなく本文と同じ書体」）、ADR-0003 Decision 4 番目の項目（「直接編集は block 単位の CM6 Markdown ソース編集」）、D15、`specs/generation.md` §10.3（link の数が合わないとき「対応の無い sidecar claim は削除」）、§7.5。
- **失敗シナリオ**: P2 が段落を直すと、textarea に `（[login.go:40-78](../../internal/auth/login.go#L40-L78)）` が生で出る。P3 は意味が分からず括弧ごと消す。保存すると claim が黙って削除され、その文は推測になる（history には残るが、画面では何も言われない）。
- **修正**: ADR-0003 どおり CM6 にする（`cm6` chunk は編集を始めたときに遅延読み込み。読み込みに失敗したら textarea に落とす）。出典リンクは `Decoration.replace` で 1 つの部品 `⟦login.go:40-78⟧` として描き、まとめてしか消せないようにする。ID コメントは見せない。保存の前に、外れる claim があれば 1 行で「出典2件（login.go:40-78、…）が外れます［戻す］［外して保存］」を出す。

### UXP-21 [medium] doc_edit の 2 択の文言・順序・キー、⇧F の名前が画面ごとに違う

- **場所**: `specs/ux.md` §6.2-4（「コードをこの依頼に合わせる」（既定・先）/「設計書を直す（コードが正しい）」）、§4.6.4（**1** 設計書を直す / **2** コードをこの設計に合わせる）、§5.5、§8.4（`review.finish` = 「レビューを終える」、`inbox.finish` = 「まとめて送る」）、§4.10（操作項目「レビューを終える（⇧F）」）。
- **失敗シナリオ**: Composer で「先頭 = コード」と覚えた利用者が、Inbox で `1` を押すと「設計書を直す」になる。⇧F は Reader では「レビューを終える」、Inbox では「まとめて送る」と呼ばれ、同じ操作だと分からない。
- **修正**: 2 択は 1 つの部品 `DocEditChoice` にし、どこでも順序を「<kbd>1</kbd>コードを設計に合わせる（既定）」「<kbd>2</kbd>設計書を直す（コードが正しい）」、文言を i18n の同じキーにする。Inbox の `1` / `2` もこの順。⇧F の名前は全画面で「まとめて送る」にし、dialog の題を「R{n}を送る」にする。

### UXP-22 [medium] `c` `e` `f` を押しただけで空の下書きがサーバに作られ、Inbox と batch バーに溜まる

- **場所**: `specs/ux.md` §5.2 B2（開いた時点で `POST /threads {draft:true}`）、§6.2-5（Escape で閉じても残る）、§4.6.5（batch バーは下書き 2 件以上で出る）、§6.7（下書きの破棄は遅延確定）。
- **失敗シナリオ**: P1 が試しに `e` → Esc を 4 回繰り返すと、本文が空の下書きが 4 件残り、Inbox の「下書き」と「下書き 4 件を 1 回の実行にまとめる ≈… tok」のバーに出る。
- **修正**: 下書きは最初の入力か chips の変更の時点で作る（それまでは client の temp key だけ）。本文が空・chips が既定のまま閉じたら、何も残さない（Undo も出さない）。batch バーと Finish は本文が空の下書きを数えない。

### UXP-23 [medium] ホームなどプロジェクト外で `mitori` を実行すると全走査し、macOS のプライバシー確認が連発する

- **場所**: `ARCHITECTURE.md` §2.2（引数なし = カレントを開く）・§4.6（git 管理外は shadow repo）、`specs/indexer.md` §2.1(b)（`git ls-files --others` で全列挙。規模ガードは列挙の後の 200,000 entry / 5GB）。
- **失敗シナリオ**: P1 が新しいターミナル（cwd = `~`）で `mitori` を打つ。ホーム全体を shadow repo として列挙し、`~/Desktop` `~/Documents` `~/Downloads` に触れた時点で macOS のプライバシー確認（「ターミナルが書類フォルダ内のファイルへのアクセスを求めています」）が次々に出る。列挙が終わるまで数十秒待った後、規模ガードで `E_PRECONDITION` になる。
- **修正**: shadow を作る前に検査する: root が `$HOME`・`/`・`/Users`・`~/Desktop`・`~/Documents`・`~/Downloads`・`~/Library` 配下のいずれか、または深さ 1 にプロジェクトの印（`package.json` `go.mod` `pyproject.toml` `Cargo.toml` `*.sln` `Makefile` `src/` `README*`）が無いときは `E_WS_NOT_PROJECT`（「プロジェクトのディレクトリで実行してください（<code>mitori &lt;path&gt;</code>でも開けます）」）で止め、Launcher を開く。`--force` で続行できる。列挙は 2 秒または 200,000 entry で打ち切る。

### UXP-24 [medium] GitHub 上の `.mitori/` は和欧間が詰まる [検証済]

- **場所**: `prototypes/JUDGEMENT.md` §11-2（未決。「GitHub は text-autospace を指定しないので詰まって見える」）、`specs/ux.md` §10.2-3（原稿に半角空白を入れない）、AC-J14、ADR-0004 Consequences（「GitHub 上で設計書が出典リンクごと読める（無料の共有手段）」）、synthesis §8.1-5（デモ台本）。
- **実測**: スタイルを指定しない `<p>` の computed `text-autospace` は Chrome 154.0.8037.95 で `no-autospace`（`probe.cjs`）。初期値が既に間隔なしなので、GitHub・VS Code のプレビュー・ターミナル・Pull の agent が読む `.mitori/*.md` は「設計書をGitHubで読む」のように詰まる。
- **失敗シナリオ**: デモ台本 5（同僚が GitHub で開く）が、日本語の読み手にとって最も読みにくい見え方になる。
- **修正**（P1 の聞き取り調査を待たずに、両方を満たす形に決める）: 原稿（`.mitori/*.md`）には和字と英数字の境界に半角空白を 1 個入れる（GitHub と各種エディタで読みやすい通常の書き方）。mitori の doc renderer は block HTML を作るときに、コードスパン・リンクの外側でその空白をちょうど 1 個だけ取り除き、UI は `text-autospace: normal` で 1/8em を入れる（markdown-it の core rule。決定的）。anchor の正規化（`ANCHOR_TEXT_RULES`、`DocStore.blockText`）も同じ除去をかけ、TextQuote の offset を合わせる。AC-J14 を「renderer の出力に該当の空白が 0」に、§10.2-3 と gen spec の正規化を「原稿は空白あり」に直す。UI の i18n catalog の規則（空白なし）は変えない。

### UXP-25 [medium] トースト文面が自分の lint に違反し、ja に内部語が混ざる [検証済]

- **場所**: `specs/ux.md` §3.5 のトースト表、§9.2（「ja の値に和字 + 半角空白 + 英数字を書かない」）、§13.2 `mitori/no-ja-space`、§6.9（ja の `outdated` のラベルが「outdated」）、§4.6.4・§6.5（「ゲート」と「検査」が同じ概念に混在）。
- **実測**（`toast-lint.mjs`。placeholder を `1` に置き換えて §9.2 の規則を当てた）: 13 文面のうち 10 文面・23 箇所以上が違反する。例: `反映しました — {n} files を作業ツリーへ（未 commit）· 設計書 {m} ブロック · checkpoint {ref}`（`s を`・`未 c`・`書 1`・`1 ブ`）、`repo の gate {n} 件が承認待ちです（未承認の gate は skip されます）`。
- **失敗シナリオ**: 実装者がこの表をそのまま catalog に写すと CI が落ち、lint を弱める誘因になる。空白だけ消すと「{n}filesを作業ツリーへ」のような文になる。P3 には `files` `checkpoint` `gate` `skip` `cache` `outdated` `hunk` が分からない。
- **修正**: 例文を和語で書き直す: `反映しました — {n}ファイルを作業ツリーへ（未コミット）· 設計書{m}ブロック`（checkpoint は詳しいレベルだけ）、`このリポジトリの自動検査{n}件が承認待ちです（承認するまでは検査せずに提案します）`。語彙表（§9.6）に chrome の言い換えを足す: checkpoint → 取り消し点、gate / ゲート / 検査 → **自動検査**に統一、hunk → 変更箇所、outdated → 要付け直し、workspace → 作業フォルダ、cache → キャッシュ（詳しいレベルだけ表示）。spec の表から ja の文面を抜き出して `i18n-parity.ts` と同じ規則で検査する CI を足す（spec と catalog がずれない）。

### UXP-26 [medium] ⌥ 長押しが Windows / Linux の Firefox でメニューバーにフォーカスを奪う

- **場所**: `contracts/ui.ts` `cites.showAll`（`hold:Alt`）、`specs/ux.md` §8.7。
- **失敗シナリオ**: Windows / Linux の Firefox は、Alt を単独で押して離すとメニューバーを出し、キーボードのフォーカスをそこへ移す。⌥ 長押しで出典を出した直後に `j` を押すと、メニューの操作になる。押し続けること自体が難しい利用者（固定キー機能を使う人）には、長押しの代わりが無い。
- **修正**: 単独の Alt の keydown と keyup の両方で `preventDefault` し（長押しが発火した場合）、Firefox / Chrome / Edge × Windows / Linux でメニューが出ないことを IME マトリクスの回に確かめる。抑止できない環境では非 mac の既定を `.`（トグル）にする。⌘K に「出典をすべて表示（切替）」を足す（長押しの代わり。WCAG 2.1.1）。

### UXP-27 [medium] `@` が和文の直後・全角 `＠` で発火しない。Safari の compositionend 直後の Escape

- **場所**: `specs/ux.md` §6.2-5（「`@` を語頭で打つと mention picker」）、`contracts/ui.ts` `isComposing` の規則 (3)（compositionend と同じ task の **Enter** だけを抑止）、§8.6 I6。
- **失敗シナリオ**: 和文には語の区切りの空白が無いので、「この関数@」の `@` は語頭と判定されない。IME がオンのまま打つと `＠`（全角）になり、`@` と一致しない。Safari で変換を Escape で取り消したとき、compositionend の直後に keyCode 27 の Escape が届く実装があると、規則 (3) は Enter しか見ないので Composer が閉じる。
- **修正**: mention の起点を「`@` または `＠`（NFKC）で、直前が文頭・空白・`[A-Za-z0-9_.]` 以外の文字」にする（「この関数@」は発火、`user@example.com` は発火しない）。`input` と `compositionend` の両方で検出する。規則 (3) を「compositionend と同じ task のすべての keydown（Enter・Escape・Tab・Backspace）」に広げ、WebKit の WEB-U-006b を足す。

### UXP-28 [medium] router と model をその依頼だけ変える UI が無い

- **場所**: `specs/loop.md` §3.4 の override（`JobReq.mode`：answer は常に、patch / agent は条件付き。model は `ModelId` なら何でも）、`specs/ux.md` §6.2.7（router チップは表示と hover の説明だけ）。
- **失敗シナリオ**: P2 は「この修正は agent で、Opus で」、P4 は「この質問は Haiku で十分」と判断するが、Composer から変えられない（設定画面の既定を変えるしかない）。
- **修正**: router チップを menu ボタンにする: mode（answer / patch / agent。使えないものは理由つきで無効）と model（完全 ID 3 種、見積りの $ の差を併記）。選んだ値は `JobReq.mode` / `model` で送り、その thread だけに保持する。

### UXP-29 [medium] ⌘K の群の固定順で、記号名を打っても用語・節が先に来る

- **場所**: `specs/ux.md` §4.10「照合」3（群の順 = 用語 → 節 → 部屋 → シンボル → スレッド → 操作、群内は点数順、各 3 件）、`PALETTE_GROUP_ORDER`。
- **失敗シナリオ**: P4 が `Login` と打つと、完全一致の symbol `Login` より先に用語「ログイン」と節「§3.2 認証フロー」が並ぶ。移動のたびに ↓ を数回押す。
- **修正**: 先頭に「トップ」の 1 行を置く（全群で最も点数が高い項目。点数 ≥ 120 = ラベルの先頭一致以上のときだけ）。接頭辞で群を絞る: `@` symbol、`#` 節、`>` 操作、`:` パス（VS Code と同じ）。AC: `Login` で先頭行が symbol `Login`。

### UXP-30 [medium] 生成カードの主行に誤差幅が無い。［生成 ⏎］の ⏎ が誤解を招く

- **場所**: `specs/ux.md` §4.2.4-3（主行は 1 点の値）、`specs/generation.md` §9.7（`confidencePct` は n < 5 で 25）、AC-J47（「［生成］の 1 クリックか ⏎ で始まり」）。
- **失敗シナリオ**: 未較正の初回に「$1.3 · 約6分」と 1 点で出し、実績が −30% や +40% になると、P2 / P4 は見積り全体を信用しなくなる。主行の「⏎」の表記を見た P1 は、地図の上で Enter（部屋の選択にも使う）を押すと生成が始まると思う。
- **修正**: `calibrationN < 5` のあいだ、主行を範囲で出す: `約0.3〜0.5M tok · 約5〜8分 · API換算$1.0〜1.6（未較正）`（範囲 = ±`confidencePct`）。較正後は 1 点にし、精度は tooltip。Enter で始まるのはボタンにフォーカスがあるときだけ（ネイティブの button の動作）と明記し、主行の ⏎ の glyph を外す。

### UXP-31 [medium] 推測の「確認済にする」が誰でも 1 クリックで、根拠も記録されない

- **場所**: `specs/ux.md` §4.3.5（推測 → 3 択の 1 番目が［確認済にする］→ `human-verified` のロック、再生成しても保持）、`specs/generation.md` §7.3（「確認済 by @name」）。
- **失敗シナリオ**: P1 が「推測」の帯を消したくて［確認済にする］を押す。コードを見ていなくても ✓✓ になり、`.mitori/` を commit しているチームでは全員にとって「人が確認した事実」になる。@name が何から来るのか（git の user.name か）も決まっていない。
- **修正**: 初めて・標準レベルでは［確認済にする］を、その claim の出典の peek を一度開くまで無効にする（「コードを見てから確認してください」）。記録する人は git の `user.name <user.email>` とし、hover に「{name}が{日付}に確認」を出す。S8（生成と鮮度）に human-verified の一覧を置き、block の履歴から外せるようにする。

### UXP-32 [medium] PostToolUse の `mitori touch` が未登録の repo で何をするか未定義

- **場所**: `specs/loop.md` §10.6（path の toplevel から workspace を決めて `POST /ws/:ws/touch`。未登録の場合の規定が無い）、§10 冒頭（他のコマンドは `POST /workspaces {target}` で開く）、§11.1（plugin は user scope = 全 repo の Claude Code で hook が動く）。
- **失敗シナリオ**: P4 が mitori の daemon を動かしたまま、mitori で開いていない別の repo を Claude Code で編集する。touch が workspace を開く実装になると、編集のたびにその repo の scan（CPU とメモリ）が走る。
- **修正**: touch は `srv_workspaces` に登録済みの toplevel のときだけ送る（daemon は未登録なら 204 を即答し、workspace を開かず scan もしない）と明記する。AC: 未登録の repo の編集 100 回で scan 0 回、touch 1 回 ≤ 20 ms。

### UXP-33 [medium] Pull の bundle 既定 4,000 token × thread 数が対話セッションの context に積まれる

- **場所**: `specs/loop.md` §10.2（`budget` 既定 4,000、最大 12,000）、§11.1 SKILL.md 手順 4（thread ごとに `mitori bundle <id>`）、§4.4（push は tier XS 0.4〜0.7k / S ≈1.1k / M / L）。
- **失敗シナリオ**: 10 thread の round で、agent が thread ごとに `mitori bundle` を呼ぶと、最大 40k token が P4 の対話の context に入る（メモや質問の thread には過大）。round を重ねるほど積み上がる。
- **修正**: pull の bundle の既定 budget を push と同じ tier の規則（質問・メモは XS、小さな変更は S）にし、上限だけを 4,000 にする。`mitori.review/1` の見出し行に ` bundle≈{k}` を足す（agent とユーザーが重さを見られる。≈ +3 token/thread）。SKILL に「thread の本文で足りるなら bundle を読まない。4 件以上は module ごとにサブエージェントへ」を足す（≤ 1.5KB の範囲で）。

---

## 4. 指摘（low）

| ID | 場所 | 失敗シナリオ | 修正 |
|---|---|---|---|
| UXP-34 | ux §8.4 `read.chapter`（`1`〜`9` = §1〜§9）、§7.2 PM パス（§0・1・3・11・13） | P3 が §0（ひとことで）と §11・§13 にキーで行けない（`0` は読者レベル） | `1`〜`9` を「目次の上から n 番目のページ」（§0 = 1）にし、目次の行に数字のヒントを出す。§10 以降は `g` + 2 桁（`g 1 1`）か ⌘K |
| UXP-35 | ux §8.1 手順 5（`when` が偽なら黙って通す）、`targetOrSelection` | 何も選ばずに `e` を押した P1 には何も起きず、壊れていると思う | 1 セッションに 1 回だけヒントのトースト「文を選ぶか、<kbd>j</kbd>/<kbd>k</kbd>でブロックを選んでから<kbd>e</kbd>」 |
| UXP-36 | ux §4.7.4 `E_GIT_MERGE_CONFLICT` の［やり直しを依頼（revise）］、loop §7.8-4（≈ $0.02・7 s） | LLM を呼ぶ操作なのに費用が出ない（原則 3 に反する） | ボタンに見積りチップ（`≈{k} tok · ${usd} · 約{s}秒`）を付ける |
| UXP-37 | ui.ts `selectionMinChars: 2` | 1 字の用語（鍵・型・表）を選べずコメントできない | 選択が CJK 1 字なら 1 文字でもツールバーを出す |
| UXP-38 | ux §4.4（採用で 1 つ前のモードへ）、§11.2 | 採用後のフォーカスの戻り先が未定義（body に落ちる）。読み上げに取り消しの方法が無い | フォーカスは更新した block へ戻す。読み上げは「採用しました。10秒以内なら⌘Zで取り消せます」 |
| UXP-39 | ux §8.5（再割当ては IME guard を通した次の keydown を chord にする） | IME オンで押すと 229 で捨てられ、何も起きない | 捕捉中に 229 が来たら「英数入力に切り替えてから押してください」を出す |

---

## 5. 契約・spec への変更依頼のまとめ（宛先別）

| 宛先 | 変更 | 指摘 |
|---|---|---|
| `contracts/api.ts` | SSE `review.waiting`（+ `SSE_EVENT_META`）、header `x-mitori-waiter`、`/d/:docId/b/:block`、`privacy.dataPolicyAck` の `shownAt`、session cookie の鍵の分離（コメントの修正） | 01, 04, 07, 13 |
| `contracts/core.ts` | `Claim.checks.l1` を 3 値、verdict `cited`、`UiSettings.defaultExecPath`、`WINDOW_PRIORS`、`E_WS_NOT_PROJECT` | 06, 10, 08, 23 |
| `contracts/ui.ts` | `ROMAJI_RULES` の適用範囲、`GateVerdict`、`JobChipProps.waiting`、`PullBar`、`composerDensity`、`read.claimNext/Prev`、viewer の `compose: "local"`、`cites.showAll` の非 mac 既定 | 12, 05, 01, 14, 17, 18, 26 |
| `specs/loop.md` | note の dispatch と router（R0b）、SKILL の手順 4 の分割、§7.8 手順 2b（H′ で gate）、§10.1 のタブ再利用、§10.6 の未登録 repo、§10.2 の tier 既定、AGENTS ブロックの例外 | 02, 05, 01, 32, 33, 11 |
| `specs/generation.md` | L1 vacuous と `cited`、session の見積り式、`/mitori:gen` skill、§9.4 の事前分布と run 増分の譲り合い、原稿の和欧間の空白 | 06, 11, 08, 24 |
| `specs/ux.md` | §2.2 の review ルート、§3.1 / §4.4 の幅の規則、§4.2.4 の送信確認と billing の文言と範囲表示、engine の状態、§5.3 の Finish 既定、§6.2 の密度と空の質問、§8.3 の review scope、§3.5 の文面、§9.6 の語彙 | 01, 03, 04, 09, 15, 10, 14, 16, 25 |
| ADR | ADR-0009 にブラウザ session 鍵の分離と idle 4 時間を追記。ADR-0003 の「直接編集は CM6」を ux §5.5 に反映 | 07, 20 |

---

## 付録 A. 検証の記録

すべて `scratchpad/design-tmp/ux-personas/`（= `/private/tmp/claude-501/-Users-satoki252595-work-20261002-aiAgentTool/99463a6e-6928-41bd-851e-ed1a1028dc52/scratchpad/design-tmp/ux-personas/`）にある。

1. **レイアウトのはみ出し**（UXP-03）: `grid.html` に `design-tokens.css` と同じ値（rail 248 / 228、ctx-margin 368 / 332、review 640、prose-min 672、code の clamp）で grid を組み、`probe.cjs`（Playwright + 手元の Chrome 154.0.8037.95）で 9 幅 × 4 モードの `scrollWidth − clientWidth` を測った。結果は UXP-03 の表。macOS の overlay スクロールバー（幅 0）での値なので、Windows の 17px は含まない。
2. **`text-autospace` の初期値**（UXP-24）: 同じ `probe.cjs` で、スタイルを指定しない `<p>` の computed `textAutospace` = `no-autospace`（Chrome 154）。
3. **ローマ字正規化**（UXP-12）: `romaji.mjs` が `ui.ts ROMAJI_RULES` を仕様どおりに順に適用し、16 の query × 12 のラベルで部分一致を 2 通りの解釈（query だけ / 両方）で調べた。
4. **トースト文面の lint**（UXP-25）: `toast-lint.mjs` が ux §3.5 の表の文面に §9.2 の規則（placeholder を `1` に置換、和字 + 半角空白 + 英数字、英数字 + 半角空白 + 和字）を当てた。10 文面・23 箇所（重なりを別に数えると 27 箇所）。
5. **契約の型検査**: `nix develop --command bunx tsc@6.0.3 -p docs/design/contracts/tsconfig.json --noEmit` はエラー 0（本レビューの変更依頼はまだ反映していない）。
6. 計算による確認: UXP-03 の必要幅（228 + 672 + 332 = 1,232、0 + 672 + 640 = 1,312、review 中の `b` で 248 + 672 + 640 = 1,560）、UXP-08 の費用（gen §9.6 の 100k LOC 標準 $2.92・1M LOC 完全の session C=1 426 分）。

## 付録 B. 確かめられなかったこと（実機が要る）

- Windows / Linux の Firefox・Chrome・Edge で、単独の Alt の keyup を `preventDefault` したときにメニューが出ないか（UXP-26）。IME 実機マトリクス（ux §17 U24）の回に含める。
- Safari で、変換を Escape で取り消したときの keydown の `keyCode`（229 か 27 か）（UXP-27）。
- Claude Code のサブエージェント 1 本の固定 token と、Read の行番号の前置の比率（UXP-11）。P0 の O2 に含める。
- plan ごとの κ（API 換算 $1 あたりの 5h 利用率の増分）の範囲（UXP-08）。Critic addendum C3 の計測で埋める。
