# 専門家監査（expert lens）— crit の設計書を「うるさいテックリード」として読み、レビューを回す（2026-10-04）

crit を知っている専門家として、module 章の主張を 19 件コードと突き合わせ、気に入らない文を選んでコメント → Fix / 質問 → Review →
却下 / 採用 → Undo を本物の UI で回した。見たのは「主張は正確で、出典は精密か」「アンカーした文脈が最小のトークンで AI に届くか」
「差分はレビューできるか」「却下・取り消しできるか」「専門家に要るもの（コードへのジャンプ、逆リンク、履歴、人の確認印）があるか」。

- 対象: `dist/mitori-darwin-arm64`（09:23 ビルド。最後のコード統合 `90f75b9` 09:19 より後）
- 文書: `refs/crit`（`406875d`）を新しく `git clone`。新しい `MITORI_HOME` で開き、**記録済みの実エンジン出力を再生**して標準生成した。
  再生は `scratchpad/gen2/rec-crit-after/*.json`（`gen-real.ts --record` の 25 本）を TASK 行で突き合わせ、その stdout をそのまま流す
  偽の `claude` を `engines.claude-cli.binary` に指した（`--version`・`auth status`・`--help` も CLI と同じに返す）。module 章 16/16 と §3・§9〜§13 は
  `docs/progress/dogfood2/crit/doc/` と同じ文面になった（概要 5/8 で「上限の 80 %」により一時停止。台帳の $ は記録上の値で、実費ではない）
- ループ: 同じ偽 `claude` が、各 engine 呼び出しの **argv・system prompt・bundle をそのまま保存**し、patch/1 や回答は台本で返す。
  これで「AI に何が届いたか」を 1 文字単位で確かめた（例 `audit/expert/bundle-explain-disputed-sentence.txt`）
- 操作: Playwright + インストール済み Google Chrome（headless、1440×900、ダーク）。台本は scratchpad の `drive.ts`
- **この監査の実 LLM 消費は $0**（`claude` CLI はログアウト状態でもある）
- スクショ: `docs/progress/audit/expert/e*.png`（本文で番号を示す）

---

## 1. 結論

**部品の多くは専門家の期待に届いている。** 詳しいモードの横並びコード（行番号付き）、出典 peek と「エディタで開く」、hunk ごとの採用・却下、本文に
差分で出る設計書の提案、採用しても 1 ファイルが未コミットで変わるだけ、Undo でコードと設計書が一緒に戻る、が揃っている。bundle は
`DOC / SEL / CODE / REL / ASK / WRITE / BUDGET` の形で、データと指示を nonce の柵で分けている。

**ただし、実際の利用者がコンセプトで失敗する穴が 7 つある**（重い順。§2 に詳細）。

1. **「一度だけ読む」の成果物が消える**（EX-01）。生成済みの `.mitori/` ごと repo を別の場所へ移す（新しい作業ディレクトリ、チームメイトの clone、`~/.mitori` の作り直し）と、
   開いた瞬間に **module 章 16 のうち 14 がスタブ「未生成」に上書きされる**。`.mitori/` は既定で gitignore なので、作業ツリーからは戻せない。
2. **レビューコメントの「g」が消える**（EX-02）。Composer と ⌘K でフォーカスが入っていても、`g` / `G` が全部食われる。
   `gofmt config GET go test` → `ofmt confi ET o test`。壊れた依頼文がそのまま AI に届く。
3. **アンカーした文脈がずれる**（EX-03）。出典の無い文を選ぶと、ブロックにある**他の文の出典**が対象コードになる。争点の関数の本体は bundle に入らない。
   例: `checkSecFetchSite` について質問したのに、その本体（`server.go:323-333`）が入らず、関係の無い `NewServer` 102 行（≈2.1k tok、入力の約半分）が入った。
4. **出典の無い事実文が検証にも画面にも現れない**（EX-04）。本文の 17 %（45/271 文）に出典が無い。そのうち 27 文はコード識別子を含む。
   今回見つけた**誤り**（セキュリティの記述）は、この「出典なしの文」の中にあった。gen-quality の「支持されない claim 0」はこの文を数えていない。
5. **却下した変更の設計書提案が残る**（EX-05）。Fix を却下しても、その Fix の設計書提案は本文に「✓採用」付きで残る。採用すると、設計書が
   存在しないコードを語る。L1 の印は静かな ◦ のまま。
6. **「設計書が間違っている」に AI の道が無い**（EX-06）。「設計書を直す（コードが正しい）」は 0 tok で、ブロックの生 Markdown を人が書き換える
   エディタになるだけ。依頼文はそのまま設計書に保存されうる。
7. **専門家の道具が途中で壊れる**（EX-07〜EX-10）。逆リンクの列は `each_key_duplicate` の例外で空になる。Undo の後、コード列は消えた版を出し続け、
   出典が違う行を光らせる。ブロックの履歴・巻き戻しは route があるのに UI が無い。✓✓（人の確認）は「推測・裏付けなし・古い」の主張にしか付けられない。

文面の正確さ（§3）: 19 件の主張を検証した。**捏造は 0**。誤り 1（セキュリティ）、一部誤り 2、誤解を招く省略 2、「正しいが、出典範囲の中か隣にある『なぜ』や
不変条件を落とした」が 5、正確 9。§11 は module 章の主張 6 件をほぼ同文で繰り返し、横断的な発見（例: `SetSession` の順序と `loadCritJSON` の
ロック違反検出が組で守る不変条件）を書いていない。

---

## 2. 指摘（重大度順）

### EX-01 〔critical〕repo を移す・clone する・home を作り直すと、生成済み module 章がスタブで上書きされる

- **再現**: 生成が終わった `crit3`（`.mitori/` に doc・`doc.index.json`・`mitori.json` が揃い、module 章は 16/16 生成済み）を `cp -cR crit3 crit5` で複製し、
  新しい `MITORI_HOME` で `mitori crit5` を開いた。1.1 s 後、`.mitori/doc/modules/*.md` の **14/16 が「未生成」スタブ**になった。
  `internal-server.md` は「ファイル 38 · 5799 行」から「ファイル 36 · 5603 行」へ変わり、`internal.md` と `web.md` は消え、`internal-2.md` と `web-2.md` が増えた。
  `.mitori/` のどのファイルにも、生成文（例 `checkSecFetchSite`）は残っていない。一方 `mitori.json` は `modulesGenerated: 16` のままで、実態と合わない
- 同じ home・同じパスで開き直したときは、module 章は保たれた（warm start）。`scratchpad/gen2/repos/crit` は 08:43 の開き直しで、すでに 14/16 がスタブだった（`mitori.json` は `modulesGenerated: 2`）
- **原因**: CR gen #8（seed 付きの再 open で module の分割が変わる）が、module id ごとにページを持つ doc store と組み合わさっている。
  static refresh は、id の変わった module のページを、生成ブロックや人の編集ごとスタブで置き換える。既知の項目（HANDOFF §0.3-6）は「計測の揺れ」として
  扱われているが、利用者から見ると**データの消失**になる
- **失敗シナリオ**: チームで `.mitori/` を commit する（`docCommitted` は opt-in）。チームメイトが clone して開くと、作業ツリーの設計書が消える（巨大な削除差分）。
  個人の場合も、repo をリネーム・移動するか home を作り直すと、$1.65 の生成と、人の編集・確認印が失われる
- **修正案**:
  (1) スタブを書き込む前に、置き換える側を確かめる。対象ページに `origin: ai|human` のブロックがあり、新しい分割にその module id が無いなら、
  上書きしない。ファイル集合の重なり（Jaccard ≥ 0.6）で新しい module に付け替え「分割が変わった — 古い可能性」の印を付ける。付け替えられなければ、
  旧ページを `modules/_orphaned/<slug>.md` に残す。
  (2) CR #8 を直す。保存された分割から seed すると、同じ分割が再現される（冪等）ようにする。
  (3) 回帰テスト: 生成済みの `.mitori` を持つ repo を新しいパスと新しい home で開き、AI ブロックのある module ページのバイト列が保たれることを確かめる

### EX-02 〔critical〕Composer と ⌘K パレットで `g` / `G` を打っても入らない（フォーカスがあっても）

- **計測**: Fix の Composer の textarea にフォーカスがある状態で、`page.keyboard.type("gofmt config GET go test")` を打った。値は `"ofmt confi ET o test"` になった。
  ⌘K で `config` を打つと `"confi"` になった（`e05-fix-composer-estimate.png` の依頼文は `ET/HEAD`・`same-oriin`、`e09-palette-typed-config.png`）
- **原因**: `apps/web/src/stores/keys.svelte.ts:195`。編集中の要素（composer / palette）でも `g` の 2 打鍵 prefix の処理が先に走る。
  `chord === "g" && !this.#find("g", scopes)` → `pendingPrefix = "g"; e.preventDefault(); return`。`editable` を見ていない。
  NC-01（Composer にフォーカスが入らない）とは別の不具合で、フォーカスを直しても残る
- **失敗シナリオ**: 英語やコードの語を含むコメント（`logging`・`config`・`gofmt`・`GET`・`go test`）が、気付かれないまま壊れて AI に届く。
  IME の変換中は早く return するので日本語は無事。直接入力の識別子だけ欠ける
- **修正案**: `if (!editable && chord === "g" && …)`。編集中の要素には prefix chord を使わせない。回帰テスト: keys の単体テストで、composer scope の textarea への `keydown g` が
  `defaultPrevented === false` になること。`live-ui` に「`g` を含む ASK がそのまま bundle の `ASK` に入る」検査を足す

### EX-03 〔high〕アンカーした文脈が「選んだ文」ではなく「ブロックのほかの文の出典」になる。争点の関数は入らない

- **画面と計測**: §6.1.4「処理の流れ」の 2 番目の項目の 1 文目「次に `checkSecFetchSite` で別オリジンからのブラウザ要求を拒否する。」だけを選んだ（`e03`）。
  この文自身には claim が無い（EX-04）。
  - **修正の Composer**（`e04`）: 対象コードは `server.go:170-174 NewServer`（3 番目の項目の出典）と `server.go:278-291 ServeHTTP`。
    hint の「減らすには、その文だけを選び直す」はもう満たしている。`checkSecFetchSite` の本体 323-333 は、関連の chip `server.go:323 49`（シグネチャ）として出るだけ
  - **質問の bundle**（偽 claude で保存、`bundle-explain-disputed-sentence.txt`、8,098 字、見積り ≈4.1k in）:
    `CODE internal/server/server.go:127-228 sym=NewServer anchor=170-174`（102 行）と `CODE …:278-293 sym=Server.ServeHTTP`。**323-333 は無い**。
    AI が見るのは呼び出し側と、その上のコメント「Cross-site values mean the request came from another origin」だけになる。このコメントは
    設計書の誤った読みと同じなので、実際のモデルは**誤った文を肯定しやすい**
  - Fix（落とし穴の文、`e11a`）では、13 行のアンカーに対して `NewServer` 全体（127-228）と REL 2 件が送られた（bundle 7,534 字 + system 2,490 字、見積り ≈4.5k in）。
    動くが、最小とは言えない
- **失敗シナリオ**: 専門家は、記述が怪しい関数の名前を文中に挙げて「これは本当？」と聞く。AI はその関数を見られない。文脈の半分は関係の無いコードで、
  答えは推測か「本体が必要」になる
- **修正案**: `packages/loop/src/router`（anchorRanges）と `bundle/plan.ts`:
  (1) 選択範囲が claim span と重なればその claim の cite を使い、重ならなければ**同じブロックのほかの claim の cite は CODE に入れない**（REL のシグネチャ止まり）。
  (2) SEL の識別子を symbol 索引で解決し、定義の本体（≤ 40 行）を CODE に入れる（`checkSecFetchSite` → 323-333）。
  (3) CODE は「囲むシンボル全体」ではなく「アンカー ± 8 行 + シンボルの先頭行」にし、全体はシンボルが 60 行未満のときだけにする。
  回帰テスト: 出典の無い文 + 文中の識別子 → bundle にその定義があり、ほかの文の cite が無いこと

### EX-04 〔high〕出典の無い事実文が、検証にも画面にも現れない（本文の 17 %）

- **計測**（crit の module 章 16 枚、NOTE / TIP の囲みを除く）: 本文 271 文のうち **45 文（17 %）に出典が無い**。そのうち **27 文はコード識別子を含む**。例:
  「次に `checkSecFetchSite` で別オリジンからのブラウザ要求を拒否する。」（**誤り**、§3 #1）、「`host`…`open_cmd` などは project 設定からマージされない。」
  （設定章の核心の不変条件）、「編集の検出は `LastPushedBodyHash` と現在の本文のハッシュを比べて行う。」
- **原因**: 生成側は、2 文のあとの 1 つの marker を**最後の文だけ**の claim span にする。前の文は claim にならず、L1 も推測の印も付かない。
  画面では検証済みの文と同じ見た目になる（`html.show-cites` でも印なし。`e02-flow-claims-show-cites.png` の 2 番目の項目: 後半だけ ◦、前半は無印）
- **失敗シナリオ**: 専門家が「確かさ」の印を信じると、いちばん危ない文（印が無い文）を読み飛ばす。gen-quality §2 の「29 + 25 claim、支持されないもの 0」は
  claim だけを母数にしているため、こうした文を構造的に数えない
- **修正案**: `packages/gen/src/line`（W10 と mdscan の `deriveSpans`）。項目・段落の中で marker が 1 つしかなく、前の文に出典が無いとき、span を項目全体へ広げる。
  あるいは、識別子を含み出典の無い文を `inferred` の claim にする（〜推測 の印と L1 が付く）。詳しいモードでは「出典なし」の文に薄い下線を引く。
  品質の指標に「出典の無い事実文の率」を加え、抜き取り検査の母数に入れる

### EX-05 〔high〕Fix を却下しても、その Fix の設計書提案は残る。採用すると設計書が嘘になる

- **再現**: 落とし穴の文に Fix（「列挙をやめてループで登録して」）を送った。台本の patch/1 は、コードの edit と、それに合わせた `doc_updates` を返す。
  Review の ⌘⌫ / 「却下」で job は `rejected`、thread も `rejected` になった。ところが提案 `pp_hcr6bdny` は `pending` のまま、本文に「✓採用」付きで出ている（`e16`）。
  押すと、設計書は「live-mode スクリプトは `NewServer` 内のスライスからループで登録される」になる（`e17`）。コードは個別登録のままで、引用先 `server.go:157-164` も個別登録。
  claim の印は静かな ◦（cited）で、警告は出ない
- **原因**: `packages/loop/src/jobs/review-ops.ts:190` の `reject()` は、job の状態と thread しか変えない。`source: {kind:"job", id}` の提案に触れない。
  `POST /doc/proposals/:pp/accept` も、元の job の状態を見ない。一方 Undo（`undo()`）は提案も戻す（正しい）
- **修正案**: job の却下（と failed / cancelled / reverted）のとき、その job の pending な提案を `rejected`（理由「元の変更が却下された」）にする。
  accept の route は、元の job が `accepted` / `partially_accepted` でなければ 409 を返す。回帰テスト: patch と doc_updates を持つ job を却下 → 提案は pending ではない。
  accept → 409

### EX-06 〔high〕「設計書の文が間違っている（コードが正しい）」に AI の道が無い。依頼文が設計書に保存されうる

- **画面**: 修正の Composer の「設計書を直す（コードが正しい）」を選ぶと、textarea が**ブロック全体の生 Markdown**
  （`[server.go:278-282](../../../internal/server/server.go#L278-L282)` のような相対リンク付き）に置き換わる。表示は「0 tok · 設計書だけを直します / 設計書を保存」（`e08`）。
  台本では、切り替えてから依頼文を打った。その依頼文は 3 番目の項目の末尾に設計書の本文として保存された（`e07-docfix-comment-saved-into-doc.png`）。
  確認も差分の表示も無い。元に戻せたのは、同じエディタで元の Markdown を貼り直したとき（`e10`）だけ
- **失敗シナリオ**: うるさいテックリードは「この文は不正確。正しくは…」と指摘する。AI は文を直さない。選べるのは (a) 人が生 Markdown を書く、
  (b)「コードをこの依頼に合わせる」（AI が**コードを誤った文に合わせる**方向に倒れうる）、(c) 質問（答えるだけで設計書は変わらない）。
  コンセプトの「レビューに AI が答えて、その場所を直す」が設計書の誤りに対して成り立たない
- **修正案**: 3 つ目の道「AI に設計書を直させる（コード準拠）」を足す。job は `patch` と同じ bundle（DOC + SEL + 指摘 + 選んだ文の cite と識別子の定義、EX-03）
  で、`edits: []` に制約し、`doc_updates` は提案として出す。L1 を通ってから表示し、Review では提案だけを出す。「設計書を直す（自分で）」は名前を変え、
  依頼文の欄とは別の欄にする（依頼文を本文と取り違えない）

### EX-07 〔medium〕コード画面の逆リンク（「この範囲を説明している節」）が空。`each_key_duplicate` の例外

- **計測**: `/code/internal/server/server.go#L323-L333` を開くと pageerror `https://svelte.dev/e/each_key_duplicate` が出て、右の列は空になる
  （「なし」の文言も出ない）。表示も 323 行へスクロールせず 143 行から始まる（`e19`）
- **原因**: `packages/server/src/wiring/views.ts:334-341` は cite ごとに backlink を 1 件 push する。同じブロックが同じファイルを複数回引用すると
  （例: 公開 IF の項目が `server.go` の 127・425・449 を引用）、`apps/web/src/reader/CodeView.svelte:69` の `{#each … (b.block)}` の key が重なる
- **修正案**: key を `${b.block}:${b.start}-${b.end}` にする。server 側で block ごとにまとめ、要求された範囲と重なるものを先に並べる。
  回帰テスト: 1 ブロックが同じファイルを 2 回引用する fixture で、逆リンク 2 件が描画され、console に error が無いこと

### EX-08 〔medium〕Undo の後、コード列が消えた版を出し続け、出典が違う行を光らせる

- **再現**: Fix を採用（⌘⏎、`server.go` だけが未コミットで変わる）→ ⌘Z（作業ツリーは `b81ad1e` に戻り、`git status` は空）。詳しいモードのコード列は
  `b2e4a6c`（採用後の版）の `L278–282` を出し、`return` / `}` / コメントを出典の範囲として光らせた（`e15d`）。開き直すと正しい（`e18`）
- **修正案**: checkpoint の undo / accept の SSE で、ctx 列（コード）を開いている path を再取得する。cite の `data-blob` と、コード列の blob が違うときは
  「表示中の版は古い」の帯と再読み込みを出す

### EX-09 〔medium〕Review: 左の本文がページの先頭で開く。主ボタンは「検査なしで採用」

- **画面**（`e13a`）: 右には依頼・ゲート・費用・要約・hunk（hunk ごとの ✓✕）があり、よくできている。しかし左は §6.1.4 の先頭（崩れた「この章で分かること」）で開き、
  アンカーしたブロックとその提案（数画面下）は見えない。ゲートは gofmt・go test・go vet とも「未承認のため skip」。主ボタン（橙）は「検査なしで採用 ⌘⏎」で、
  「内容を見て承認」は小さなリンクになっている
- **修正案**: Review を開いたら、左はアンカーしたブロックへスクロールし、提案に focus する。未承認のゲートがあるときの主ボタンは「承認して検査 → 採用」にし、
  「検査なしで採用」は副ボタンにする（⌘⏎ は承認ダイアログを出す）

### EX-10 〔medium〕専門家の道具: 履歴・巻き戻しの UI が無い。✓✓ は一部の主張にしか付けられない。コード列とスレッドは同時に見られない

- `GET /doc/blocks/:block/history` と `POST /doc/blocks/:block/revert`（`clients: ["web"]`）はあるが、`apps/web` は呼ばない。履歴は残る
  （例: rev 1 generate → rev 2 human_edit）のに、画面からは見られず戻せない
- ✓✓（人の確認）は ClaimPopover からだけ付けられる。ClaimPopover が開くのは `inferred` / `unsupported` / `stale` の主張だけ
  （`apps/web/src/reader/BlockHost.svelte:301`）。専門家が `verified` / `cited` の主張を確かめても署名できず、出典の無い文（EX-04）には何も付けられない
- 詳しいモードで出典を開くと、右の列がコードになり、margin のスレッド（回答カード）が見えなくなる。Esc で戻すと見える（`e22` → `e23`）。
  「コードを見ながら回答を読む」ができない
- 修正案: ブロックのメニューに「履歴」を置き、rev の差分・作者・source を出す。rev を選んで巻き戻せるようにし、Undo の toast も出す。
  ClaimPopover は全ての主張で開き、「✓✓ 確かめた」を付けられるようにする。出典の無い文には「出典を付ける」（選んだ範囲を cite にする）。
  コード列の上か下に、そのブロックのスレッドを畳んで重ねる

### EX-11 〔medium〕その他、ループの UI

- trust の toast「このリポジトリの自動検査1件が承認待ちです」が、Composer の「送信」ボタンに重なる（`e05` 右下）。LIVE-05 では Review パネルの側だけを直した
- 回答カードの preview に、生の `[[internal/server/server.go:283-291]]` が出る（`e23`）。LIVE-06 の変換はメッセージ html にだけ効いている
- 生成が予算で一時停止すると、生成済みの各ページに「この設計書はまだ生成されていません / 見積りを見る」が出る（`e01`）。「再開」を押しても、見た目は何も変わらない
- 「この章で分かること」の箇条が縦書きになる崩れ（NC-05 / F3 で既出）: crit では module 章 15 枚のうち 8 枚、45 項目のうち 11 項目で起きる。
  各 module 章の最初のブロックで、HTML export も同じ（`e01`・`e20`）。原因は `apps/web/src/shell/styles/prose.css:530` の `li { display:grid; grid-template-columns:22px 1fr }`。
  インライン要素と文字列の連なりが、別々の grid item になる

---

## 3. 主張の検証（crit の module 章、19 件）

判定: S = 正確 / S− = 正しいが、出典範囲の中か隣にある「なぜ」や不変条件を落とした / P = 一部誤り / M = 誤解を招く / W = 誤り。行番号は `406875d`。

| # | 章・ブロック | 主張（要約） | 判定 | 根拠 |
|---|---|---|---|---|
| 1 | server / 処理の流れ `b_zpah7z1x` | `checkSecFetchSite` で別オリジンからのブラウザ要求を拒否する | **W** | `server.go:323-333`: GET / HEAD / OPTIONS は常に通す。拒否するのは、安全でないメソッドで `Sec-Fetch-Site` が `same-origin` 以外（`same-site`・`none` を含む）のときだけ。この文には claim が無い。出典 283-291 は呼び出し側と、誤解を招くコメントだけ |
| 2 | server / 公開 IF | `SetSession` はセッションを差し替え、開始時刻を記録する（425-430） | S− | 420-424「Ordering matters」: `MarkSessionStarted` を `Store` より**前**にしないと、`LoadCritJSON` のガードがすり抜ける。出典範囲が 5 行遅い |
| 3 | server / 並行性 | バックグラウンド処理は `bgWG` で待ち合わせる（108） | S− | 105-107: shutdown のとき review file を書く前に、タイムアウト付きで待つ。理由を落とした |
| 4 | server / 落とし穴 | `/api/health`・`/preview`・`/live` は `withReady` なし（135-148） | S | `/api/qr`・`/themes` も同じ。1 文目は claim になっていない（EX-04） |
| 5 | session / 並行性 | `mu` は状態、書き出しは別の `writeMu`（487-497） | S− | 492-496: `writeMu` は、debounce された古い書き込みが `ClearAllComments` 後に review file を蘇らせるのを防ぐ（`Timer.Stop` は実行中の callback を待たない）。出典範囲の中にある理由を落とした |
| 6 | session / 並行性 | `ChangeBaseBranch` はロックの外で VCS 処理をし、差し替え直前にコメントを取り直す（2458-2466） | S− | 取り直しの仕組みは `appendOrphanedFiles` → `applyOrphanedCritFile`（2742-2782、改名と墓標も扱う）が担い、引用されていない。`BaseRef` は VCS 処理の**前**に新しい merge-base へ切り替わる（2392-2396）。この間の old 側の `AddComment` は、新しい base から anchor を取り、表示は古い diff のまま。この窓は落とし穴なのに書かれていない |
| 7 | session / エラー処理 | 変更ファイルの検出に失敗すると、override・`BaseRef`・`BaseBranchName` を戻す（2386-2419） | S | 正確で、範囲も精密 |
| 8 | session / 落とし穴 | 墓標 `deletedCommentIDs` を新しいパスへ**移す**（2467-2480） | P | 実際は**複写**する（旧キーも残す）。`omitTombstonedComments` が旧パスと新パスの両方を見るため（2763-2766） |
| 9 | session / 設定・§9 | `CRIT_DEBUG` は `session.go` で参照される（2508-2512） | S− | 中身が無い。肝は「`SetSession` 後の `loadCritJSON` 呼び出し（ロック違反）を dev / CI では panic にする」（2504-2512）。§9 で同じ文を繰り返す |
| 10 | session / データ構造 | Lazy ファイルは `loadOnce` で一度だけ読む（231-233） | S− | 229-230: Content・FileHash・DiffHunks・Lazy は `Session.mu` の下で一緒に公開され、読み手はロックを持つ必要がある。閾値（25 ファイル超、35 行）も落とした |
| 11 | comment / 落とし穴 | `LoadCritJSON` は v3→v4 移行を起こし、ファイルが無いときは cwd を記録する。読み取りに副作用がある（328-356） | P | cwd は返り値の構造体に入るだけで、何も書かない（350-356）。ディスクへの副作用は移行（329）だけ |
| 12 | comment / エラー処理・§11 | 壊れた JSON は警告を出してスキップする（507-513） | M | これは `findReviewFileByBranch` だけの話。主要な読み込み口 `LoadCritJSON` は、壊れた JSON でエラーを返して止まる（335-337）。対比が無く、一般則のように読める |
| 13 | config / 不変条件 | `host`…`open_cmd` は project 設定からマージされない（330-334、359-373） | S（**重大な省略**） | 逆向きの規則を書いていない。`live_cookie*`・`live_cdp_url`（350-358、374-377）、prompts・**hooks**（385-386、444-454）は project からマージされる。project の hook は `sh -c` で実行され（`hooks/run.go:59-64`）、`internal/prompt/trust.go` の trust flow が関門になる。この関門は module 章 16 枚のどこにも出てこない。中核の文自体にも claim が無い |
| 14 | vcs / 並行性 | `DefaultBranch` は RWMutex と `sync.Once`。Sapling と JJ も**同様に**守る（104-115） | M | git の override と once はパッケージ変数（`git.go:101-106`）で、`GitVCS.SetDefaultBranchOverride` はそれを書く（`git_vcs.go:22`）。プロセス全体で共有される。Sapling と JJ はインスタンスごと（`sapling.go:13-18`）。「同様に」が非対称を隠す |
| 15 | vcs / エラー処理 | `FileDiffForCommit` は exit 128 なら空ツリーとの diff に切り替える（477-495） | S | 精密 |
| 16 | vcs / 落とし穴・§9・§11 | `ParseUnifiedDiff` は `suppressBlankEmpty` の空行を、範囲内に限って文脈行にする（1575-1587） | S | 精密。3 章で同文を繰り返す |
| 17 | §9 キャッシュ | `prMetadataCache` は競合時に既存のエントリを優先し、cap を超えると追い出す（58-87） | S− | 51-57 にある性能上の取引を落とした（singleflight が無いので、同時の miss で `gh` が二重に走る）。cap の値 64（16 行）も落とした |
| 18 | §11 TODO 表 | `TODO \| at main.go:1826). \| AGENTS.md:44` | W（ノイズ） | AGENTS.md の散文の参照を拾っている。`cmd/crit/main.go` は 32 行で、参照先は古い |
| 19 | §11 テストの穴 | `web/style.css` はテストを持たない（推測） | 低価値 | CSS をテストの穴として挙げても、専門家の役に立たない |

**横断の章**: §11 の「ホットスポット」「壊れやすい箇所」は、module 章の主張 6 件（`ChangeBaseBranch` ×3、`ParseUnifiedDiff`、`ConfigPresence`、`review_file.go:507`）を
ほぼ同文で繰り返す。§9 も 3 件を繰り返す。module 章をまたぐ不変条件（#2 と #9 は「plan v4 §Lock discipline」の両端）は、どこにも書かれていない。
gen.risks の「claim 文を写さない」は crit では効いていない。

---

## 4. レビューループの観察（良い点も）

| 段階 | 結果 |
|---|---|
| 選択 → ツールバー | コメント C・説明 E・修正 F・⤴ P・リンク Y（`e03`） |
| 修正の Composer（詳しい） | 対象コード chip、書き込み 1 ファイル、固定 1.4k cache、DOC 202・prev/next 102・context 2.5k・REL 8 件、見積り「≈5.2k in · ≈1.5k out · $0.023 · 約 11–17 秒 · patch · 19 行」（`e05`）。透明性は高い。ただし対象がずれる（EX-03） |
| bundle（patch/1） | `MBF/1 mode=patch`、`GATE fmt:gofmt test:go typecheck:go-vet (untrusted)`、`TASK`、`DOC … h=`、`SEL`、`CODE … base= sym= anchor=`、`REL`、`ASK`、`WRITE internal/server/server.go`、`BUDGET in=4000 out=1500 usd=0.08`、DENY の glob と ACCEPT。argv は lean（`--tools ""`・`--setting-sources ""`・`--no-session-persistence`・`--max-budget-usd 0.08`・`--json-schema`）、cwd は空のディレクトリ |
| 送信 → ready | running 155 ms → gating 1.37 s → ready 1.53 s（台本の engine） |
| 提案 | 本文に差分で出る（和文は文字単位）、✓採用 / ✕、TOC に ●（`e12a`） |
| Review | 依頼の見出し、ゲートの pill、費用と見積りの差、AI の要約、hunk ごとの ✓✕、「本文で見る」、決定 n/2（`e13a`・`e14b`） |
| 却下 | toast「却下しました — … 元に戻す ⌘Z」。確定は toast が消えたときか `pagehide`（タブを閉じても反映された）。作業ツリーは変わらない |
| 採用 → Undo | ⌘⏎ で ` M internal/server/server.go` のみ（未コミット）、提案も採用。⌘Z でバイト列・`git status`・設計書ブロックが戻る（`e14d`・`e15d`）。toast「元に戻しました（取り消し点から復元 · 設計書も戻しました）」 |
| コードへ | peek に「0 横に固定 · ⇧O エディタで開く」。詳しいモードは横並びの列に行番号（`e02`）。peek の行間は広く、行番号が無い（既知） |

---

## 5. 優先度つきの直し方（提案）

1. EX-01（消失を止める: スタブで上書きしない + 付け替え + 回帰テスト）と EX-02（`!editable` の 1 行 + テスト）。どちらも小さく、効果が大きい
2. EX-03 と EX-04 を一緒に直す（claim span の拡張 / 出典なし文の推測化と、SEL の識別子による CODE の選択）。専門家のレビューの「的」が正しくなる
3. EX-05（却下で提案を閉じる、accept の 409）と EX-06（AI による設計書修正の道）
4. EX-07〜EX-10（逆リンクの key、Undo 後のコード列、Review の焦点と主ボタン、履歴・✓✓・スレッドの同時表示）

## 6. 再現

- 文書の再生生成: `scratchpad/audit-expert/fake-claude.ts`（`replay-dir.txt` に録画のディレクトリ）。`home3/config.json` の `engines.claude-cli.binary` に、
  その wrapper（`bin/claude`）を指す。`refs/crit` を新しく clone して開き、「生成」を押す
- ループ: `scripts/nd bun scratchpad/audit-expert/drive.ts <read|fix|probe|codefix|review|rejectclose|acceptproposal|pane|ask|findcard> …`
  （`reply-patch.json` / `reply-answer.txt` が台本の返答。保存された bundle は `prompts/NNN.json`）
- EX-01: 生成済みの workspace を `cp -cR` で別パスへ移し、新しい `MITORI_HOME` で開き、`grep -l 未生成 .mitori/doc/modules/*.md | wc -l` を数える
- EX-02: Composer か ⌘K にフォーカスを入れて `gofmt config` を打ち、値を読む
