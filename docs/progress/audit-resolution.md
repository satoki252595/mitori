# 監査 49 件の解決（finisher、main、2026-10-04）

> 以下は2026-10-04の判定を保持した履歴。rem4ブランチの統合、その後の実Muse/残タスク対応は [HANDOFF §★](../HANDOFF.md) と [2026-10-05の一覧](backlog-2026-10-05.md) を参照する。「ログアウト」「見送り」を現在の状態へ読み替えない。

3 本の監査（`audit-newcomer.md`・`audit-expert.md`・`audit-nonfunc.md`）の指摘を、コンセプトの順に直した。
初見者に分かること、専門家が細部を詰められること、文書の一点に付けたコメントで AI がそこを直す・答えること、速さとトークン、UI の仕上げ。
直した指摘には、それぞれ回帰テストがある。

- critical / high は 17 件（NC-05 と F3 は同じ不具合なので、中身は 16 件）。13 件を修正し、4 件は一部修正（NC-04・EX-04・F1・F4）。一部修正の 4 件も、主な害は止めた。
- medium / low の一部も、小さく直せるものは直した。
- 残りは「見送り」として理由を書いた。
- この作業での実 LLM 消費は **$0**。`claude` CLI はログアウトのままで（`claude auth status` → `loggedIn: false`）、最終デモの実エンジン実行はできていない（`live.md` §最終デモ）。

判定の意味:

| 判定 | 意味 |
|---|---|
| 修正 | 監査の修正案どおりに直した（または同等の別解） |
| 一部 | 主な害は止めたが、修正案の一部が残っている |
| 見送り | 今回は直していない（理由を書いた） |
| 不同意 | 指摘に根拠付きで同意しない |

## critical / high

| id | lens | 重大度 | 判定 | 変更（主なファイル · 回帰テスト） |
|---|---|---|---|---|
| EX-01 | expert | critical | 修正 | **原因は監査の想定と違った**。id が変わったのは親モジュール（`internal`・`web`）の 2 つだけで、その節を消すときに **子モジュールの節まで連鎖して消していた**（14 枚がスタブになった）。対策は 3 つ。(1) 消すときに、生きているモジュールの節を巻き込まない。(2) 消えたモジュールの頁は、新しい id のモジュールに付け替える。葉はファイルの重なり、親は子 id の重なりで照合し、閾値は ≥ 0.6。静的ブロックの slot も付け替えるので、ブロック id とバイト列はそのまま残る。付け替え先が無い頁は `orphaned/<slug>.md` に残す。(3) `DocModuleEntry.members`（葉の全メンバー）を `doc.index.json` に載せ、seed から分割を完全に復元する。実 crit で確認した結果: 生成済み `.mitori/` を新しいパスと新しい home で開いてもスタブは 0（以前は 14）、2 回目の移動では 16/16 頁がバイト単位で同一。`doc/store/apply.ts`・`indexer/structure/{stage,incremental}.ts`・`repartition.test.ts`（7 件）・`structure.test.ts`・`test/int/repartition.test.ts` |
| EX-02 | expert | critical | 修正 | Composer / ⌘K の入力中は 2 打鍵の prefix を作らず、使いもしない。`stores/keys.svelte.ts`・`keys.test.ts`（修正前は失敗）。最終デモで、`config` を含む質問が bundle の ASK にそのまま届くことを確認 |
| NC-01 | newcomer | high | 修正 | `focusWhenShown`: slot が配置されて見えるようになるまで、毎フレーム focus し直す（最大 30 フレーム。ほかの入力欄にフォーカスがあれば奪わない）。`composer/focus.ts`・`focus.test.ts`。`live.ts` から `ta.click()` を外し、「クリックせずに打った文字がそのまま入る」を検査に足した |
| NC-02 | newcomer | high | 修正 | profile（README の最初の段落・toolchain・SPDX・remote・HEAD・行数タイル）を 0 tok で作り、`WorkspaceStatus.profile` に載せる。git の読み取りは並列（crit で 18〜20 ms）。§0 を生成したあとは、§0 の最初の段落をリードに出す。主ボタンは「5分コースで読む」、生成済みカードの題は「設計書（生成済み）」。0 件のタイルは出さず、所要時間のタイルは「詳しい」でだけ出す。`server/wiring/profile.ts`・`platform/git/reader.ts`（`remoteUrl`・`headMeta`）・`map/MapPage.svelte`・`profile.test.ts`・`map.test.ts`・`test/int/reader-diagrams.test.ts` |
| NC-03 | newcomer | high | 修正 | 節を返すときに、図ブロックへ配置済みの SVG（ELK レイアウトはキャッシュ）を差し込む。export と同じ `withDiagramSvg` を使う。ノードの一覧は代替テキストとして残す。図の CSS は app と viewer で共有し、小さい図は描いた大きさのまま（拡大しない）。`doc/export/inline.ts`・`server/wiring/views.ts`・`shell/styles/diagram.css`・`reader-diagrams.test.ts`。最終デモで §2 の `figure.mdiagram svg` を検査 |
| NC-04 | newcomer | high | 一部 | 地図と §2 の部屋名を、生成済みのモジュール名にした（ディレクトリは副題）。popover にはモジュールの一行の役割を出し、hover の tooltip とは同時に出さない。結び付きは重みの上位（約 1.5 × 部屋数）だけを描き、どの部屋も最も強い結び付きは残す。「区画0」は出さない。**残り**: 「文脈」ズームのラベル付け。`static-input.ts`（`strongEdges`）・`views.ts`・`static.ts`・`map-names.test.ts`・`map.test.ts`・`repartition.test.ts` |
| NC-05 / F3 | newcomer / nonfunc | high | 修正 | learn 囲みの `li` を block にし、番号は絶対配置にした。app と export の両方に効く。`prose.css`・`e2e/web/reader.pw.ts`（code の高さが 1 行以内。修正前は失敗）。mock の learn ブロックも実物の形にそろえた |
| NC-06 | newcomer | high | 修正 | §4 の先頭に 0 tok の手順を置いた（必要な toolchain → lockfile から決めた install → パッケージマネージャ付きの起動コマンド → README にある localhost URL）。表には見出しを付け、「状態 未実行」の列は消した。入口は Next.js App Router の `app/page.tsx` を先頭にする。Go は README と module 名から main を選ぶ。m3e の結果: `Node.js ^22.12.0 \|\| ^24.0.0 \|\| >=26.0.0` → `npm install` → `npm run dev`（中身は `next dev`）→ `http://localhost:3000`。**残り**: §1 から §4 へのリンク（生成文側の変更）。`server/wiring/guide.ts`・`doc/store/static.ts`・`guide.test.ts`・`reader-diagrams.test.ts` |
| NC-07 | newcomer | high | 修正 | §5 に「読む順番」を置いた（入口 → 基盤の型 → ハブ（fan-in × fan-out）→ 機能の芯）。m3e の結果: `app/page.tsx` → `lib/tokens.ts`（`Palette`・`Kind`・`KindSpec`・`Item`）→ `app/Editor.tsx:453-4841 Editor` → `components/Preview.tsx`。300 行を超えるファイルには、コード画面にシンボルの目次を出す（`FileContent.outline`）。**残り**: 横断的な「変更の手引き」。`guide.ts`・`views.ts`（`fileOutline`）・`CodeView.svelte`・`wiring.test.ts` |
| EX-03 | expert | high | 修正 | 選んだ文が触れている claim の出典だけを使い、出典の無い文はブロックのほかの文の出典を借りない。この場合 Fix には対象コードが無く、Composer が候補を出す。選んだ範囲の中でバッククォートされた名前は、定義（≤ 40 行）を読み取り専用の CODE として渡す。静的な表の行が指すコード（`config.go:36`）も同じく渡す。シンボル全体を送るのは 60 行まで（以前は 120 行）。`router/ranges.ts`（`touchingClaims`）・`bundle/named.ts`・`build.test.ts`（修正前は失敗） |
| EX-04 | expert | high | 一部 | 出典の無い事実文を数える `uncitedSentences` と、`bench/measure/doc-uncited.ts` を足した。crit では 45/276 文で、そのうち 28 文がコードを名指しする（監査の 17 % と一致）。「詳しい」か出典の表示中は、claim の外にあるコード名に点線を引く。**残り**: 生成側の claim span を広げる変更。実エンジンで再試行率への影響を測ってから入れる（CLI がログアウト中）。`gen/line/mdscan.ts`・`mdscan.test.ts`・`prose.css`・`BlockHost.svelte`（`data-origin`） |
| EX-05 | expert | high | 修正 | job が却下・cancel・失敗・Undo（reverted）になったら、その job の pending の提案を閉じる。閉じた job の提案を採用しようとすると 409 `E_STATE_TRANSITION` になり、UI に専用の toast を出す。`jobs/{core,review-ops,runner}.ts`・`server/wiring/proposals.ts`・`test/int/proposal-close.test.ts`（修正前は失敗） |
| EX-06 | expert | high | 修正 | 修正の対象を 3 択にした: コードを依頼に合わせる / **AI に設計書を直させる（コードが正しい）** / 設計書を自分で直す（0 tok）。AI の道は `docFix` 付きの Explain。bundle が「CODE が正しい」と言い、答えの最後の ```` ```mitori-doc ```` が、アンカーしたブロックの更新提案になる。コードは変えない。自分で直す欄には「ここは本文そのもの」と書いた。`api.ts`（`JobReq.docFix`）・`jobs/pipeline.ts`（`splitDocFix`）・`composer/session.svelte.ts`・`test/int/doc-fix.test.ts`・`session.test.ts` |
| F1 | nonfunc | high | 一部 | agent のターン（初回・修復）の間、追跡ファイルの秘密を番号付きのトークンに置き換え、ターンが終わってから head commit とゲートの前に元のバイト列へ戻す。書き込み範囲のファイルでは、編集で残ったトークンだけを元の値に戻す（消したトークンは、利用者が消したかった秘密）。同意文はモードごとに分けた。**残り**: 依存リンクをターンの後に作ること。ワークツリーの外を指す追跡済み symlink。`agent/secrets.ts`・`secrets.test.ts`・`int08.test.ts`（F1。修正前は失敗） |
| F2 | nonfunc | high | 修正 | `detectGateSandbox()`（macOS は sandbox-exec に自明なプロファイルを渡して確かめる。Linux は bwrap で user namespace を作れるか確かめる）を CLI daemon が使う。int harness の既定は今までどおり `"none"`。`platform/spawn/sandbox.ts`・`sandbox.test.ts` |
| F4 | nonfunc | high | 一部 | `measure` のファイルが無い budget は、`unmeasured: "<理由>"` を書かないと check で失敗する。逆に、ファイルがあるのに `unmeasured` を書いても失敗する。該当する 78 件に理由を書いた。**残り**: `ci:pr` に e2e/web を入れること。実バイナリで毎晩測る perf。`scripts/lib/budgets.ts`・`budgets.test.ts` |

## medium / low

| id | lens | 重大度 | 判定 | 変更・理由 |
|---|---|---|---|---|
| NC-08 | newcomer | medium | 一部 | §0 の網羅率と除外の内訳を L3 にした（「初めて」では隠れる）。除外理由は和名にした（バイナリ・テスト用データ…）。**残り**: 初回の既定を「初めて」と 5 分コースにすること、「やさしく」 |
| NC-09 | newcomer | medium | 見送り | 本文の全文検索と「AI に聞く」導線。クライアント側に索引が要り、仮想化された Reader の外で本文を持つ設計が要る |
| NC-10 | newcomer | medium | 見送り | §7 の主要な型、§8 の外向き通信。§5 の「読む順番」の基盤の型が一部を補う |
| NC-11 | newcomer | medium | 修正 | 「合計0.48M tok（出力27k）」。`hero.ts`（`generatedTokens`）・`map.test.ts` |
| NC-12 | newcomer | medium | 修正 | 製品は 見取り図、図と §2 は 間取り図。0 の数は出さない。gen.overview の「フロアプラン」は prompt lock を変えるので見送り |
| NC-13 | newcomer | medium | 一部 | エンジンが未ログインなら、送信ボタンの横にそう書く。**残り**: ヘルプの「この画面でできること」 |
| NC-14 | newcomer | low | 見送り | EN のヘッダーの重なり、翻訳の導線 |
| NC-15 | newcomer | low | 見送り | 読書パスの残り時間と完了の 1 行 |
| NC-16 | newcomer | low | 修正 | outline が届くまで、rail は「—」を出す（「未生成」とは言わない） |
| NC-17 | newcomer | low | 一部 | 地図では popover と tooltip を同時に出さない。全体の popover を 1 層にするのは残り |
| NC-18 | newcomer | low | 一部 | §0 に桁区切りと言語名（TSX 17,191 行）。統計タイルは語の途中で折らない。daemon の連携の案内は和文 1 行。ローマ字・内部語は残り |
| NC-19〜21 | newcomer | low | 見送り | 生成 prompt の変更（`prompts.lock.json` と実エンジンでの確認が要る） |
| EX-07 | expert | medium | 修正 | 逆リンクはブロックと範囲ごとに 1 行。要求された範囲を先に並べ、key の重複を無くした。`views.ts`（`fileBacklinks`）・`wiring.test.ts` |
| EX-08 | expert | medium | 見送り | Undo の後のコード列の再取得 |
| EX-09 | expert | medium | 一部 | 未承認の検査があるときの主ボタンは「承認して検査 → 採用」にした（⌘⏎ は承認ダイアログを開く）。「検査なしで採用」は副ボタン。左の本文をアンカーしたブロックへスクロールするのは残り |
| EX-10 | expert | medium | 見送り | 履歴の UI、すべての主張への ✓✓ |
| EX-11 | expert | medium | 一部 | スレッドの preview では `[[path:a-b]]` を `path:a-b` と表示する。learn の崩れは NC-05 で修正済み。trust toast の重なりと一時停止の表示は残り |
| F5〜F7 | nonfunc | medium | 見送り | 初期 JS の分割、大きな節の分割配信、メモリ |
| F8 | nonfunc | medium | 見送り | pull 経路の範囲チェックと Undo |
| F9 | nonfunc | medium | 見送り | formatter の信頼 hash に実体を含めること |
| F10 | nonfunc | medium | 修正（2026-10-11追補） | 既存固定分に加えexact profileのledger実測超過を反映。保守floorを維持、対象40pass。[確認](remaining-20261011/ledger-calibration.md) |
| F11・F12・F15 | nonfunc | low | 見送り | — |
| F13 | nonfunc | low | 修正 | `state.sqlite`・`-wal`・`-shm` を 0600 にした。`platform/sqlite/perm.test.ts` |
| F14 | nonfunc | low | 修正（2026-10-11追補） | 連携通知に加え既存全体helpを接続。export自身のdaemonだけをidle時に終了し、既存・後接続中は維持。[確認](remaining-20261011/cli-lifecycle.md) |
| F16 | nonfunc | low | 一部 | EX-01 の `members` により、2 回目以降の open では分割が完全に復元される。`.mitori/` が無い最初の open の揺れは残り |

## 監査の外で見つけて直したもの

| 症状 | 修正 |
|---|---|
| 最初の flush の途中で、利用者の `git status` に `?? .mitori/` が出る（最終デモの「scratch repo starts clean」が時々失敗した） | `.mitori/.gitignore` を最初に書く。`reload.test.ts` |
| 見出し付きの表（`**スクリプト**` + 表）は、sidecar が無いと別ブロックに割れる | 形から推定するとき、太字の見出し行と表 / リストを 1 つのブロックとして扱う。golden で確認 |
