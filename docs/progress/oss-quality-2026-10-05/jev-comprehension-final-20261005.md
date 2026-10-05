# Jev 生成資料の変更理解確認（2026-10-05）

## order-rewrite の最終確認

[jev-order-rewrite の §3](jev-order-rewrite/doc/03-key-flows.md) と [本体 module](jev-order-rewrite/doc/modules/jev-ultrafast.md) を同じ pinned source `1231850a0bf1a0c0341fe408ef1668dbbfdfac46` と照合した。§3.1 手順8と§3.3 手順6は「履歴へ追記してから observe」となり、[Agent:117–147](https://github.com/browser-use/jev-ultrafast/blob/1231850a0bf1a0c0341fe408ef1668dbbfdfac46/jev_ultrafast/agent.py#L117-L147) の実行 → 先行履歴 → 観測 → 履歴更新の順序へ訂正された。全 keep の失敗 run は下の履歴として残す。

| 確認点 | 結果・残る説明不足 |
|---|---|
| 観測失敗時の履歴保持 | 先行記録の順序は正しい。後観測が stale でも実行履歴を消さない理由は本文に明示せず、変更時は上記 source の確認が必要となる。 |
| choose の選択 head 検証 | §3.1 手順6は choose の呼出しまでで、一要求の operation / target と、選んだ head だけを検証する [model:95–133](https://github.com/browser-use/jev-ultrafast/blob/1231850a0bf1a0c0341fe408ef1668dbbfdfac46/jev_ultrafast/model.py#L95-L133) の内部手順は依然省略される。PRESS_KEY の関連変更地図も未解消である。 |
| GET / LOCK の訂正維持 | 冒頭と§3.2は POST command、GET state、静的 GET を分ける。module は LOCK 宣言と atexit の終了時 callback を混同せず、前回の二誤文は戻っていない。 |

[report.json](jev-order-rewrite/report.json) の run `gr_afdvbdrd`、scope `s3`、`gen.flows@7`、**1/1 task、4 blocks、171.4秒、API 相当推計 $0.006018**（`report.spentUsd`、1/1 call が `usageEstimated`、請求額 unknown、cap $0.012）。C1 child process は max 1 / 終了時0 / 5秒後0。first-pass valid 100%、L1 pass 24 / fail 0 / vacuous 0 は構文・引用の集計で、全文 semantic pass ではない。今回の source 照合で生成本文を手編集せず、追加 LLM・upstream 実行・production 修正はしていない。

## 旧 branches-verified の確認

[jev-branches-verified の §3](jev-branches-verified/doc/03-key-flows.md) と [本体 module](jev-branches-verified/doc/modules/jev-ultrafast.md) を、同じ pinned source `1231850a0bf1a0c0341fe408ef1668dbbfdfac46` と照合した。直前の snapshot に残った二件の誤説明は解消した。

| 確認対象 | 最新資料の説明 | source 照合 |
|---|---|---|
| GET 全てを command / response_state とする一般化 | §3 冒頭は POST の command と GET `/api/state` の直接 response_state を分ける。§3.2 はパス分岐・未知パス404・動画無し404を明記する。 | [GET:81–102](https://github.com/browser-use/jev-ultrafast/blob/1231850a0bf1a0c0341fe408ef1668dbbfdfac46/jev_ultrafast/demo.py#L81-L102) と [POST:104–125](https://github.com/browser-use/jev-ultrafast/blob/1231850a0bf1a0c0341fe408ef1668dbbfdfac46/jev_ultrafast/demo.py#L104-L125) に合う。静的 asset まで command / state 応答とする旧文は無い。 |
| LOCK と終了時 cleanup の混同 | module は `atexit.register(close_browser)` の後始末と `threading.Lock` の宣言を別文にする。§3 は POST の取得条件と GET state の LOCK を示す。 | [LOCK 宣言:19](https://github.com/browser-use/jev-ultrafast/blob/1231850a0bf1a0c0341fe408ef1668dbbfdfac46/jev_ultrafast/demo.py#L19) と [終了時登録:133](https://github.com/browser-use/jev-ultrafast/blob/1231850a0bf1a0c0341fe408ef1668dbbfdfac46/jev_ultrafast/demo.py#L133) の役割を混ぜていない。 |

**sampled residual:** §3.1 手順6・§3.3 手順5の「observe して履歴に記録する」は実装の順序と異なる。[Agent:117–147](https://github.com/browser-use/jev-ultrafast/blob/1231850a0bf1a0c0341fe408ef1668dbbfdfac46/jev_ultrafast/agent.py#L117-L147) は入力実行 → history.append → observe → history 更新である。再観測が stale でも実行履歴を失わない境界なので、再試行を変更する初見者は source 確認が必要となる。生成本文は手編集していない。

`choose` の operation と対象 head の一要求・選択 head だけの検証、`PRESS_KEY` を足す producer / validator / executor の関連変更手順は、下の同じ質問に対して依然不足する。無効選択の HTTP400 終端と tick の StalePage 回復の区別も、本文だけでは全て説明していない。これらを説明できたものとして数えない。

[report.json](jev-branches-verified/report.json) の run `gr_28kahmht`、scope `s3` / `s6/jev-ultrafast`、indexDigest `29bdbb49700e9fcf` に対応する。**2/2 tasks、14 blocks、432.1秒、API 相当推計 $0.009957**（`report.spentUsd`、2/2 calls が `usageEstimated`、請求額 unknown、cap $0.015）。C1 child process は max 1 / 終了時0 / 5秒後0。first-pass valid 100%、L1 pass 37 / fail 0 / vacuous 0 は構文・引用の集計で、全文 semantic pass ではない。以前の run は以下の履歴として残す。今回の追加 LLM・upstream 実行・source 修正は無い。

## 旧 verified-final の再確認

[jev-verified-final の §3](jev-verified-final/doc/03-key-flows.md) と [本体 module](jev-verified-final/doc/modules/jev-ultrafast.md) を同じ pinned source `1231850a0bf1a0c0341fe408ef1668dbbfdfac46` と再照合した。以下の旧 snapshot 評価で問題にした `validate_choice` 拒否後の自動再観測という文は、新 §3 から消えている。`tick` が `StalePage` を catch して再観測し `ready` に戻る手順・境界は明記された。

| 同じ変更場面 | verified-final から分かること | sampled residual / 不足 |
|---|---|---|
| goal から観測・選択・実行へ進む主経路 | §3.1 は HTTP 境界 → command → tick / predict / choose → freshness / budget → browser → snapshot を説明する。§3.3 は fill の文面生成と実行・history・再観測を示す。旧 UI↔Agent の担当名だけの説明より具体化した。 | operation と操作別 target head を一つの要求にし、選ばれた head だけ検証する `choose` の内部は概略に留まる。 |
| 無効選択と stale の拒否・回復 | `StalePage` の自動回復を `tick` の catch として説明し、無効選択も同じ回復をするという誤文を除いた。 | `validate_choice` → `ValueError` → HTTP400 の終端は本文に明示しない。直接 `act` の stale は HTTP400 となり、tick の自動再観測と同一ではない。最新の「再選択を促す」は自動再選択を保証する文ではない。 |
| `PRESS_KEY` を追加する関連箇所 | module は `action_space` / `choose` / `Browser.act` と head 分離テストへの入口を維持する。 | producer・operation 専用 head・validator・executor を一つの追加手順にした説明は依然無い。名称だけの追加で足りるとは判定できない。 |

拒否の実装は [model:30–44](https://github.com/browser-use/jev-ultrafast/blob/1231850a0bf1a0c0341fe408ef1668dbbfdfac46/jev_ultrafast/model.py#L30-L44)、StalePage 回復は [agent:55–64](https://github.com/browser-use/jev-ultrafast/blob/1231850a0bf1a0c0341fe408ef1668dbbfdfac46/jev_ultrafast/agent.py#L55-L64)、HTTP400 は [demo:120–125](https://github.com/browser-use/jev-ultrafast/blob/1231850a0bf1a0c0341fe408ef1668dbbfdfac46/jev_ultrafast/demo.py#L120-L125) を確認した。

残る明確な誤説明は二件。§3 冒頭は依然「どの流れも do_GET / do_POST が入口で command 結果を response_state で返す」と一般化するが、[GET:81–102](https://github.com/browser-use/jev-ultrafast/blob/1231850a0bf1a0c0341fe408ef1668dbbfdfac46/jev_ultrafast/demo.py#L81-L102) の state は command を実行せず、静的 asset は response_state を返さない。module の「LOCK と atexit と close_browser で終了時に後始末」も残る。LOCK は [POST:110–125](https://github.com/browser-use/jev-ultrafast/blob/1231850a0bf1a0c0341fe408ef1668dbbfdfac46/jev_ultrafast/demo.py#L110-L125) の要求直列化、終了時 cleanup は [demo:133](https://github.com/browser-use/jev-ultrafast/blob/1231850a0bf1a0c0341fe408ef1668dbbfdfac46/jev_ultrafast/demo.py#L133) の atexit 登録であり、役割を分ける必要がある。

この文書 snapshot は [jev-verified-final/report.json](jev-verified-final/report.json) の run `gr_63wpkzjk`、scope `s3` / `s6/jev-ultrafast`、indexDigest `29bdbb49700e9fcf` に対応する。**2/2 tasks、298.1秒、API 相当推計 $0.009774**。Muse `muse-spark-1.3-contributor` / `max`、2/2 calls が `usageEstimated`、請求額 unknown。以前の `jev-flow-module-final` と別 run の履歴として扱う。構文・引用の集計は first-pass valid 100%、L1 pass 30 / fail 0 / vacuous 2 だが、上の残存誤説明を含む全文 semantic pass を意味しない。今回の source 照合は限定した変更場面のサンプルであり、追加 LLM・upstream 実行・source 修正はしていない。

## 旧 flow-module-final の確認

[旧 §3](jev-flow-module-final/doc/03-key-flows.md) と [本体 module](jev-flow-module-final/doc/modules/jev-ultrafast.md) を、公開 clone `browser-use/jev-ultrafast` の pinned HEAD `1231850a0bf1a0c0341fe408ef1668dbbfdfac46` と照合した記録。以前の理解確認と同じ変更場面を使い、評価しやすい質問へ入れ替えていない。追加 LLM、upstream の起動・テスト、生成 Markdown の修正は行っていない。実際の新人による理解度テストではない。

**文面生成を伴う入力の経路は具体化したが、主要な `choose` の処理順序と新操作の追加手順はまだ不足する。**

| 変更する初見者への質問 | 最新資料から導ける答え | pinned source で確認した答え・残る不足 |
|---|---|---|
| ゴールから browser が一手進むまで、観測・operation / target 選択・文面生成・実行・再観測を誰が受け持つか。 | §3.3 は `act` の fill → `field_context` → `field_text` → `Browser.act` → history → observe を行番号付きで説明する。module は `Agent`、`Browser`、`choose`、`action_space` の担当を示す。 | [Agent:55–142](https://github.com/browser-use/jev-ultrafast/blob/1231850a0bf1a0c0341fe408ef1668dbbfdfac46/jev_ultrafast/agent.py#L55-L142) の tick → predict → choose → act が主経路。[choose:81–133](https://github.com/browser-use/jev-ultrafast/blob/1231850a0bf1a0c0341fe408ef1668dbbfdfac46/jev_ultrafast/model.py#L81-L133) は一要求に operation と操作別 target head を含め、選択された head だけを検証し観測済み action id へ戻す。§3.1 は依然 UI↔Agent の往復で、この具体的な選択経路を説明しない。 |
| 入力失敗時に再試行を足したい。どの状態を再利用でき、何を再観測・再選択しなければならないか。 | §3.3 は文面生成前の stale 拒否、実行直前の freshness、文面生成失敗時に未入力であることを説明する。 | [Agent:86–121](https://github.com/browser-use/jev-ultrafast/blob/1231850a0bf1a0c0341fe408ef1668dbbfdfac46/jev_ultrafast/agent.py#L86-L121) は副作用・モデル呼出し前に decision を一度だけ消費し、同一 `field_context` のときだけ pending text を再利用する。[Browser:88–107](https://github.com/browser-use/jev-ultrafast/blob/1231850a0bf1a0c0341fe408ef1668dbbfdfac46/jev_ultrafast/browser.py#L88-L107) は click / select に対象 scope の比較、他の操作に全体 marker 比較を使う。この消費・再利用・比較範囲の差が資料に無く、再試行を変更するには source 確認が必要。 |
| 観測済み textbox に Enter を押す `PRESS_KEY` を追加するとき、選択肢以外にどこを変えるか。 | module は `action_space` / `choose` / `Browser.act` と head 分離テストへの入口を示す。最新二文書には `PRESS_KEY` や追加手順自体は無い。 | [snapshot:55–104](https://github.com/browser-use/jev-ultrafast/blob/1231850a0bf1a0c0341fe408ef1668dbbfdfac46/jev_ultrafast/snapshot.js#L55-L104) の観測済み node / action、[model:48–106](https://github.com/browser-use/jev-ultrafast/blob/1231850a0bf1a0c0341fe408ef1668dbbfdfac46/jev_ultrafast/model.py#L48-L106) の kind→operation・説明・専用 target head、[executor:135–185](https://github.com/browser-use/jev-ultrafast/blob/1231850a0bf1a0c0341fe408ef1668dbbfdfac46/jev_ultrafast/browser.py#L135-L185) の実入力を一緒に検討する必要がある。未知 kind は現状 controls 扱いになり、executor の非 select 分岐は click / fill の入力用なので、operation 名だけ追加しても Enter 入力にならない。対象外 head 拒否、stale 拒否、decision の単発消費、候補250件上限を維持した回帰が必要。 |

## 誤説明と注意すべき省略

- **§3.1「選択肢に無い応答は validate_choice で退け、次の観測から選び直す」は誤り。** [validate_choice:30–44](https://github.com/browser-use/jev-ultrafast/blob/1231850a0bf1a0c0341fe408ef1668dbbfdfac46/jev_ultrafast/model.py#L30-L44) は `ValueError` を送出し、[HTTP handler:120–125](https://github.com/browser-use/jev-ultrafast/blob/1231850a0bf1a0c0341fe408ef1668dbbfdfac46/jev_ultrafast/demo.py#L120-L125) は HTTP 400 にする。tick が再観測するのは `StalePage` の場合だけであり、無効応答から自動再選択する保証は無い。§3.3 の stale 回復説明も tick と直接 act を区別していない。
- **§3 冒頭の「どの流れも do_POST と do_GET が入口となり command の結果を response_state で返す」は広すぎる。** [GET:81–102](https://github.com/browser-use/jev-ultrafast/blob/1231850a0bf1a0c0341fe408ef1668dbbfdfac46/jev_ultrafast/demo.py#L81-L102) の `/api/state` は command を実行せず、静的 asset の GET は response_state も返さない。
- module の「LOCK と atexit と close_browser で終了時に後始末」は役割を混同する。LOCK は共有 Agent の要求処理を直列化する。入力変更で重要なのは一般的な「頁ずれ」だけでなく、上表の scoped freshness と単発消費である。

引用と関数名から変更先を探す用途には使える。fill の処理順序は改善した一方、`choose` と `PRESS_KEY` の変更を安全に完了するための説明は source から補ったものであり、最新二文書だけで導けた答えとして数えない。

## 入力の欠落と共有修正

上の所見の後、無償で private ignored native recording `jev-flow-module-final-raw/002.json` の `--prompt-file` が指定した保存済み入力を調べた。本文・stdin・env は出力せず、関数と numbered source lines の有無だけ確認した。§3 の実入力には tick の `StalePage` catch / 再観測、HTTP handler の `ValueError` catch / 400 があった。しかし `validate_choice` は skeleton の名前のみで、本体30–45行が無く、`choose` の target head 検証127行も無かった。

`flowBodies` 単独は拒否 helper を含むが、同 file の helper が sibling `field_text` の後ろに並び、gather の総 budget で落ちていた。加えて単 file の boot / static branch は後順位に sort されても毎 round で予算を使っていた。共有修正は次の三点に限った。

- 下流の function が呼ぶ同 file helper を、その function の直後に渡す。呼出し元に選ばれた class / method の順序は維持する。
- 同じ helper を繰り返し呼ぶ function の callsite も、既存の最大6箇所・各前後3行内で示す。
- 下流 repo call がある branches の round-robin を先に終え、単 file の boot / static は残る予算で示す。source の無い call を追加せず、総 budget・folding・秘密除去は維持する。

同じ pinned clone を既存 parser / pipeline / gather で無償確認した結果は次の通り。これは修正後のモデル出力の成功を示す値ではない。

| 入力 | 修正前 | 修正後 |
|---|---|---|
| validate_choice 拒否本体 | 無し | 有り |
| selected target head 検証 | 無し | 有り |
| tick / StalePage、HTTP400 | 有り | 有り |
| Browser.fresh / act、field_text | 有り | 有り |
| source BODIES tokens（既存 estimateCode） | 11,966 | 11,971、元12,000上限内 |

再現用の小さい回帰を flow と renderer の既存 unit に一件ずつ追加した。対象二ファイル全体 **37 tests / 769 assertions**、gen / indexer の `tsc --noEmit`、所有6ファイルの Biome が成功し、source を freeze した。一般的な「実装済み catch 経路がある場合だけ retry / reobserve を書く」指示と prompt version / lock は root の担当。追加実モデル測定も root が行う。この確認で PRESS_KEY の具体的追加手順まで説明できたと扱わない。

## verified-final の残存2件: 入力確認と最小修正

private ignored recording `jev-verified-final-raw/001.json` / `002.json` から、保存済み prompt の source 範囲と EXISTING 要約の有無だけを確認した。argv・env・本文を出力していない。

| 残存誤説明 | 実入力の確認 | 根因・修正 |
|---|---|---|
| GET 全てが command の結果を response_state で返す | flows の BODIES に GET の state 分岐85–87行と static response101–102行が両方あった。 | intro の「共通点」を異なる entry 分岐へ一般化した。`gen.flows@5` は選択した全 flow で source が示す処理だけを共通とし、command / state read / static response を区別する。 |
| LOCK と atexit / close_browser が終了時 cleanup をする | module の BODIES に main131行と atexit 登録133行があった。LOCK acquire / release 本体は無く、SKELETON の宣言だけだった。EXISTING には concurrency block があったが、先頭1文だけの要約で誤った第2文が丸ごと落ちていた。 | `gen.module@7` は同期の guarded operation と lifecycle の registered callback を分け、近接した宣言から共有役割を推定しない。根拠に反する既存文は stale=no でも訂正する。共有 `summary()` は先頭1文限定を外し、先頭80字を渡す。 |

EXISTING の80字・1,500 token、flows BODIES の12,000 token、module BODIES の6,000 token は増やしていない。元 concurrency の全90字を渡す修正ではなく、LOCK / atexit / close_browser を含む第2文の頭が戻る。事実を消したり引用を外して誤説明を隠したりする変更ではない。human lock の keep / suggestion 契約、source の範囲、validator は変更していない。

新しい狭い証明は renderer の既存 test 内一件。二文の concurrency を actual gather で要約し第2文が80字以内に残ること、GET の別分岐・lock acquire / release・cleanup callback が citable DATA に残り、両 prompt が別の役割を求めることを確認した。**対象 proof + prompt lock 2 pass / 19 assertions、render lock 1 pass / 2 assertions、gen `tsc --noEmit`、所有6ファイル Biome、diff check が成功**。これは実モデルが誤文を訂正した証明ではない。

production source と locks を freeze。次の実検証は同じ pinned source / home で `s3` と `s6/jev-ultrafast` の2 tasks に限り root が実施する。前回の同 scope は事前 API 相当見積り $0.003446、実行後推計 $0.009774。今回の正確な再見積りと $0.015 cap 内の run は root の担当で、この調査・修正では追加 LLM を実行していない。m3e の条件付き checklist 省略は既知の限界として残し、全項目を常に必須へ変更していない。

## branches-verified の順序誤説明: 入力確認と最小修正

private ignored recording `jev-branches-verified-raw/002.json` が参照した保存済み入力を、本文・argv・env を出力せず有無だけ調べた。flows の BODIES には history.append → observe → history 更新と、stale な後観測でも実行履歴を消さない理由の source comment が全てある。入力不足ではなく、生成が番号付き要約で処理順序を平坦化した。`choose` の一要求と選択した target head の検証も、この flows 入力にはあった。

`gen.flows@6` だけを変更した。副作用・履歴や状態の書込み・後続観測は BODIES 通りの順序で説明し、後段の失敗で何が残るかも実装が示す範囲に限る。先行記録を後段へ移したり rollback を推定したりしない。既存 steps 指示には、重要な内部選択・検証・dispatch が入力にあるときは呼出し名だけに省略しない一文を足した。source 本文、gather、API、token cap、推測・引用の契約は変えていない。PRESS_KEY の producer 本体は module / flows の両入力に無く、この順序修正と別の既知限界として残す。

既存 renderer 単位に小さい proof を一件追加した。actual gather から選択・検証・実行・先行記録・観測・後続更新が番号付きの順序で残り、全範囲が citable で、新指示が描画されることを確認する。**proof + prompt lock 2 pass / 8 assertions、render lock 1 pass / 2 assertions、gen `tsc --noEmit`、所有5ファイル Biome、diff check が成功**。これはモデルの意味の正確さを判定するテストではない。source / locks は freeze 済み。追加実測は root が新見積りと cap を付けて `s3` 一 task を行う。この修正担当からの LLM 呼出しは無い。

## order-verified: 全 keep で訂正されなかった実測

root が `gen.flows@6` で行った [jev-order-verified/report.json](jev-order-verified/report.json) は run `gr_g1geegp7`、scope `s3`、1/1 task 完了、**39.7秒、0 blocks、API 相当推計 $0.005116**（事前推計 $0.003121、1/1 call が `usageEstimated`、請求額 unknown）。private raw の生成出力を内容非出力で確認すると keep 13 / flow 3 / end.blocks=0 だった。手順の誤順序は残り、今回の品質訂正は失敗した履歴として扱う。

保存済み prompt の EXISTING は13 idsを含む。steps の3 ids は全て lock=-、要約は各80字で、末尾の履歴・observe は一件も見えない。BODIES の先行履歴・後観測・更新・理由コメントは全て残り、@6 の順序指示も届いていた。モデルは短要約から既存 steps の正確さを判定できないまま全 keep を選んだ。summary / EXISTING 上限を増やすと別 id の accounting を落とし得るため、上限は維持する。未ロックの flows steps に限り BODIES から同 id へ再記述させる条件を共有 prompt に加える案を root へ送った。human lock の keep / suggestion 契約、同入力 cache replay は変更しない方針である。

root 承認後、`gen.flows@7` の条件ルールだけを追加した。再生成の listed aspect=steps / lock=- は同 id・同 flow/section へ、BODIES が支える手順を再記述する。短要約や stale=no だけを理由に keep しない。lock=human は keep、または data から誤りが分かる場合の suggestion という既存契約に従う。全 regeneration への拡張、summary / budget / API / cache 処理の変更は無い。

既存の狭い renderer proof を拡張し、actual gather の13 idsと各80字、誤った末尾の非表示、unlocked / human lock の区別、同 flow/section、再生成前後の cache key 一致を確認した。**proof + prompt lock 2 pass / 18 assertions、render lock 1 pass / 2 assertions、gen `tsc --noEmit`、所有5ファイル Biome、diff check が成功**。source / locks は freeze 済み。root が `s3` 一 task を再見積りし cap $0.012 で一回実測する。実モデルの訂正成功はまだ確認していない。この修正担当からの追加 LLM 呼出しは無い。
