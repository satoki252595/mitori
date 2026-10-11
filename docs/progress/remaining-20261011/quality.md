# 生成品質の継続確認（2026-10-11）

## 修正と検証範囲

全 OSS の再生成ではなく、前回の source 照合で具体的に欠けていた 3 節を対象とする。

| OSS | 固定 source SHA | 対象 |
| --- | --- | --- |
| Jev | [`1231850a0bf1a0c0341fe408ef1668dbbfdfac46`](https://github.com/browser-use/jev-ultrafast/tree/1231850a0bf1a0c0341fe408ef1668dbbfdfac46) | `s6/jev-ultrafast`, `s9` |
| m3e | [`039ec311acc33dd0c76a54cbc16af4fc8ab9b491`](https://github.com/lnkiai/m3e-canvas/tree/039ec311acc33dd0c76a54cbc16af4fc8ab9b491) | `s6/lib-tokens` |

`gen.module@11` は既存の module core 28,000 tokens 枠を保ち、skeleton/tests/facts/neighbors の実残量から BODIES を最大 12,000 tokens まで使う。separator / omitted marker 用に 40 tokens を残す。小さな executable script の名前付き関数より後ろ（Jev の匿名 IIFE を含む）を共有入力に回収し、entry 境界を残して downstream の selection / validation / dispatch を broad caller より先に提示する。source slice が同一 callable の冒頭・末尾に分かれた場合は、全体の callable を既存枠内で再結合し、途中の副作用や順序を落とさない。短い hot helper は既存 L1 の context 幅である前後 2 行を含め、隣接する既定値 helper を broad hot body より前に保持する。全体の `DATA_BUDGETS` を一律に増やしていない。

`gen.quality@6` は既存 BODIES 6,000 tokens 枠の 1/3 までを名前付き上限・collection truncation とその周辺行に使い、残りを従来の entry/guard/hot source に使う。除外 source を読まず、元の行番号と blob を維持する。単なる数値比較より名前付き上限を優先する。

module の生成指示は CONTRIBUTING の必須変更と条件付き変更、個別 helper、検証手順を省略しない。再生成時は unlocked pitfalls を source から組み直し、human lock は既存 keep / suggestion の経路を維持する。

## 実呼び出し前の source 包含

Jev module の共有入力に snapshot producer（250 件制限の後の scroll/wait 追加）、`action_space`、`choose` の operation / selected target head、`validate_choice`、executor、POST と GET の両 handler が入る。`Agent.command` 52–161 行を保持し、history 記録 121 行 → `browser.observe` 142 行 → `page_changed` 更新 145 行の順序も入力にある。品質節には `MAX_STEPS = 60`、予測ループ `MAX_STEPS * 2`、history cap、DOM candidate cap、POST/GET の LOCK 範囲が入る。120 は prediction の判断要求上限で、別の text helper 呼び出しを含む全 LLM 要求の上限ではない。250 は scroll/wait 追加前の DOM candidate 上限。

m3e の DOCS には CONTRIBUTING の `Kind`, `KIND_SPEC`, `KIND_ORDER`, `sizeOf`, `baseRadii`, `iconSlotsOf`, `KIND_TEXT`, `M3Node`, `MEASURED`, `NO_BOX`, `itemJa/itemEn/itemZh/itemKo`, `STYLE_NOTES`, `Inspector`, 条件付き Preview tap と検証手順が入る。@10 以降の offline 入力は core 16,972 + BODIES 10,990 = 27,962 tokens。`frameSizeOf` の省略寸法補完と `isPhoneFrame` の判定がともに入る。Jev module は core 2,008 + BODIES 11,996 = 14,004 tokens で、history → observe の source を維持する。[入力包含と予算証跡](quality.inputs.audit.json)。品質 BODIES の items は既存 6,000 枠内で、joined text の見積りは separator / omitted marker を含み 6,007 tokens（既存 Budget が marker を別扱いするため）。

## Codex の正式生成経路と費用

利用者の指定に合わせ、実検証は Claude / Muse から Codex へ切り替える。`defaultGenEngine: codex-cli` と `gen-real --engine codex-cli` を正式に配線し、既存 native adapter を再利用する。native `0.160.0`、隔離 auth/config、`--ignore-user-config` / `--ignore-rules`、空 cwd、tool 無効、network 無効の profile を維持する。対象 OSS の hook / settings / tool を引き継がない。

Codex の推計は明示単価を要求し、Claude の cache / subscription window / session 代替の推定を流用しない。billing は unknown とする。native adapter・gen・loop が共有する `codexPreflight` は 1 byte = 1 token + 固定 2,048 を使い、cold retry の全 prompt と schema も含める。設定済みの `maxEstimatedSpendUsd` を超える生成は spawn 前に拒否する。native thinking に hard token cap はなく、これらは推計・停止 guard である。

モデルは `gpt-6.1-sol`、effort `high`。2026-10-11 確認の [OpenAI 公式モデル情報](https://developers.openai.com/api/docs/models/gpt-6.1-sol) に基づく standard 単価を input $2/M、cached input $0.10/M、output $10/M とする。今回の各 prompt は 272k threshold 以下。API-equivalent は請求額の実測ではない。

| 対象 | 3 節検証前 @9 の dry estimate（未校正 ±25%） | @9 native byte preflight | byte 入力上限 |
| --- | ---: | ---: | ---: |
| Jev 2 節 | $0.107469 | $0.317230 | 57,530 + 41,085 |
| m3e 1 節 | $0.139974 | $0.285640 | 106,820 |
| 合計 | $0.247443 | $0.602870 | 205,435 |

再試行は cold で、入力に前回の不正出力が加わる。初回の推計 $0.326548 を差し引き、修正後の実験 guard は各ターン consent $1、harness は各 OSS $0.8 とした。合算停止枠は $1.926548 で、総枠 $2 を維持する。root の費用告知・GO 後に実 LLM を呼んだ。

## 回帰検証

初回 targeted 6 files は 73 tests / 466 assertions pass。追加修正に関する adapter / renderer / render lock / execute の 4 files は 35 tests / 248 assertions pass、さらに reported token 超過を拒否する adapter 回帰を追加し、adapter 単位は 10 tests / 64 assertions pass。gen/server と依存 package の `tsc -b` pass。prompt / render lock は版更新に合わせて更新済み。追加回帰は、実残量からの module BODIES 枠、匿名 script tail、split callable の中間副作用と順序、上限定数と除外 source、条件付き checklist と human lock の同一性、Codex cold retry byte preflight / consent 拒否 / continuation なし / Claude cache を使わない生成を確認する。

## 初回実生成の停止を再現

費用告知・GO 後、Jev の 2 節を各ターン推計 consent $1、run guard $1、concurrency 1、run timeout 600 秒で実行した。native の各ターン timeout は既存 gen 式による 120 秒。追加の mitori retry は 0。

gen 表示は 2/2 tasks done、22 blocks、不正行 0 だったが、native は両 call とも `exit=1`、`turn.completed` なし、metrics `stop=budget`。module は 7,138 bytes、quality は 6,164 bytes の完成 `agent_message`（JSONL end 行あり）を返した直後、既存 adapter の `observedBytes >= budget.outTokens`（それぞれ 6,000 / 4,000）で SIGINT された。byte 数と token 予算の比較が日本語の完成出力を止めることを実証した。

usageEstimatedCalls=2、保守計上 $0.326548 API-equivalent。provider terminal usage / 請求額の実測は無い。native 完走としては未合格とし、m3e の実行と追加再試行は止めた。[protocol と allowlist 証跡](quality.jev-first.audit.json)、[module 出力](quality.jev-module-first.md)、[品質節の出力](quality.jev-quality-first.md) を保存した。raw prompt / argv / auth / env は保存対象に含めない。

出力の source 照合では、品質節に 60 操作、prediction decision 120 回、DOM candidate 250 件（scroll/wait 追加前）が具体化された。module の new-operation pitfalls は producer → action mapping → choice → executor 分岐まで具体化し、POST の非 blocking 409 と GET 状態読取りの同 LOCK を区別する。一方 module@8 processing は予測→選択→fill/鮮度で終わり、history 記録→観測を省略した。source slice の冒頭・末尾はあっても中間が選別落ちしていたため、module@9 で full callable を再結合し、上記順序の入力包含を offline で確認した。修正後の実出力は下記の Jev 完走記録で確認した。

## 停止原因の最小修正

Codex の tool-free `answer` / `generate` は完成 `agent_message` の byte 数を token 予算と比較せず、直後の terminal usage を受け取る。native の 1 MiB stdout guard、turn timeout、reported input/output/USD の上限、agent mode の保守的な step / byte meter は維持する。日本語 5,400 bytes・reported 1,200 tokens が outTokens 2,000 内で完走し、SIGINT されない回帰を追加した。生成の各ターン timeout は既存 native generate 定数 600,000 ms を再利用し、新しい設定値を増やしていない。

最初の Jev 2 calls の停止証跡を残し、修正後の完走と品質を別に検証する。

## 修正後 Jev の実生成

fresh daemon home で対象 2 節のみを再生成し、152.1 秒で 2/2 tasks done、20 blocks、不正行 0、追加 retry 0。native 2 calls とも exit 0 / `turn.completed` / stop=end。usageEstimatedCalls=0、reported token counts に基づく API-equivalent $0.128254 で guard $0.8 内だった。provider invoice は未取得。engine child は run 中最大 1、終了時 / 5 秒後とも 0。

実 module の処理手順には `predict` → `choose` → `act` → history 記録 → 再観測 → `page_changed` 反映が入り、入力で回復した中間手順を説明できた。操作追加時も snapshot producer / `action_space` / `choose` の回答検証 / `browser_operation` の dispatch が具体化された。並行性は POST の非 blocking LOCK と HTTP 409、状態読取り GET の同 LOCK を区別する。品質節は 60 操作 / 120 decision requests、通常候補 250 件の後の scroll / wait 追加を明記した。

L1 は module が 22 pass / 0 fail / 3 vacuous、quality が 22 pass / 1 fail / 2 vacuous。quality hotpaths の `Agent` は import 7–9 行を引用しており、識別子の照合が fail、metadata の verdict は inferred だった。Markdown export では cite があるためリンクを表示し、推測の警告は表示していない。対象の上限・共有 LOCK・手順の欠落は改善したが、全主張の引用が pass したとは扱わない。[allowlist 証跡](quality.jev-final.audit.json)、[module 出力](quality.jev-module-final.md)、[品質節の出力](quality.jev-quality-final.md)。

## m3e の contributor checklist と既定値

module@9 の 1 call は 110.4 秒、14 blocks、不正行 0、追加 retry 0、native exit 0 / terminal usage / stop=end。API-equivalent $0.114856、usageEstimatedCalls=0。CONTRIBUTING の全変更先と条件付き helper、4 言語 producer、専用編集 / タップ条件、typecheck / test / build の検証手順が本文に出た。`linkUrlOf` は HTTP と HTTPS の両方を許可し、scheme なしには HTTPS を補うと説明した。[証跡](quality.m3e-final.audit.json)、[本文](quality.m3e-module-final.md)。

ただし過去レビューの `isPhoneFrame` で、省略寸法を `frameSizeOf` が補う説明はまだ無かった。本体 2148–2151 行は入力にあったが、直前の既定値 helper 2147 行が slice の境界外だった。@10 で短い hot helper に前後 2 行を添え、上記 28k 枠内で source 包含を回帰検証した。

@10 の当該 1 節再生成は 94.2 秒、12 blocks、不正行 0、追加 retry 0、native exit 0 / terminal usage / stop=end、API-equivalent $0.112496、usageEstimatedCalls=0。source と引用には既定値が入ったが、本文は最終の幅・高さ比較だけを再び説明した。引用があるだけで説明の省略が解消したとは扱わない。[証跡](quality.m3e-defaults-final.audit.json)、[本文](quality.m3e-module-defaults.md)。

@11 は source 入力を保ち、既存 invariants の説明 1 行に、判定前の既定値補完・正規化と missing-input の場合も保つ一般規則だけを加えた。固有の関数名や答えを指示へ埋め込んでいない。renderer 22 tests / 183 assertions と render lock が pass。保守 preflight は input 107,477 / $0.286954。費用告知・GO 後、fresh home / concurrency 1 / timeout 600 秒 / run guard $0.8 / turn consent $1 で当該 1 節のみ再生成した。bench の `--max-native-calls 1` で repair を含む第 2 native spawn を禁止し、実呼び出しは 1 回だった。

@11 の実生成は 91.9 秒、1/1 tasks done、12 blocks、不正行 0、追加 retry 0、native exit 0 / `turn.completed` / stop=end。reported input 32,788 / output 4,476（うち reasoning 1,879）、usageEstimatedCalls=0、API-equivalent $0.110336。本文は「`isPhoneFrame` は未指定の幅・高さを `PHONE_W`・`PHONE_H` で補い、両方がその値と一致する場合だけ真を返す」と 2147–2150 行を引用し、対象の省略を解消した。この claim は L0 / L1 / L2 pass、verdict verified。条件付き contributor checklist と検証 3 コマンドも保持した。engine child は最大 1、終了時 / 5 秒後とも 0。[証跡](quality.m3e-defaults-rule-final.audit.json)、[本文](quality.m3e-module-defaults-rule.md)。

L1 は @11 module が 28 pass / 2 fail / 8 vacuous。2 fail は `getLang` / `KIND_TEXT` と `schemeFromSeed` の依存文で、意味は source の import と call に一致するが、別ファイル名を含む引用窓が弱い。全引用の pass は主張しない。品質検証の累計は初回停止の推計も含み $0.792490 API-equivalent（7 native calls、うち terminal usage 5 calls / 推計 2 calls）。総枠 $2 内で、追加 call は終了した。

m3e 依存文の `getLang` / `schemeFromSeed` の意味は `tokens.ts:2–3` の import と引用された call に一致するが、引用窓に別ファイル名が無いため L1 fail になった。Jev hotpaths と合わせた [source 照合](quality.citation-review.json) を保持し、検証器を緩めない。

human lock は入力上の同一性に加え、既存 apply の locked update→proposal と replay skip 2 tests / 7 assertions が pass。今回の Jev/m3e の保存済み OSS doc に human-locked blocks は 0 件だったため、実 OSS 出力で locked 本文の保持を確認済みとは記さない。

## 生成の予算拒否を成功扱いしない

Codex が authoritative usage で `E_BUDGET_EXCEEDED` / stop=budget を返した場合、coverage が完成していても task を failed にする。すでに検証して適用した本文と usage は保持し、repair と output cache を行わない。通常の他 engine の truncation 処理は既存経路を維持する。完全な 2 aspect と end 行を返した scripted Codex の回帰で、failed / 2 blocks 保持 / usage 保持 / 1 call / cache 0 を確認した。orchestrator / execute / bench call-cap の 3 files は 23 tests / 116 assertions pass。

さらに本番の Runner → fallback scheduler で、保守 native 額に対する run の並列予約が小さな旧 plan 推計のままになる問題を修正した。送信前に共有 preflight で native 予約・発生済み usage を合算し、初回不足は pending / resume、retry 不足は failed / partial 保持とする。実 LLM 追加 0、独立 trace と新規 6 tests / 49 assertions、既存 31 tests が pass。[run 予算の再現・修正・検証](codex-budget.md)、[機械可読証跡](codex-budget.json)。

## 引用入力と判定の追加修正（実再生成なし）

保存済み入力では m3e の skeleton header が `./i18n` / `./color` を示す一方、名前付き import の原文 `tokens.ts:2–3` が無かった。module の共有 BODIES に、index が持つ named import の元の番号付き source を追加した。aliases を合成せず、既存 `Indexer.read` の redaction / blob 経路を使う。index の import 行は statement 冒頭ではなく source specifier の行なので、最大 39 行前までを読み、TS/JS は見えている直前の `import` / `export` 行から specifier までに絞る。1 slice 最大 40 行、既存の core 28k / BODIES 最大 12k と除外規則を維持する。複数行 import と、先行 slice の境界をまたぐ次の import にも回帰を追加した。

固定済み source と保存 index のコピーを使い、ソケット・追加 parsing・LLM なしで実 `gatherInputs` → renderer →共有 preflight を確認した。m3e は core 16,972 + BODIES 10,942 = 27,914 tokens。import 2–3 行が実際に citable で、既存 anchor / verifier でも両候補の L0 / L1 / L2 が pass した。`frameSizeOf` の既定寸法補完と `isPhoneFrame` の比較、`makeItem`、`linkUrlOf` を保持し、CONTRIBUTING の DOCS は修正前と同一だった。Jev module も history 121 行 → `browser.observe` 142 行 → `page_changed` 145 行を保持する。途中の probe が `function frameSizeOf` を探して arrow 宣言を見落としたが、実原文 `export const frameSizeOf` を照合して誤検出を訂正した。

Jev quality の `Agent` 宣言 12 行は修正前から入力にある。7–9 行を選んだ引用窓はモデルの選択であり、今回の共通入力修正で直ったとはしない。保存済み本文を変更せず、最新出力の L1 fail 3 件をそのまま保持する。新しい原文候補をモデルが選ぶかは未再生成・未確認。renderer / verifier の対象 2 files は 40 tests / 287 assertions、gen 型検査と変更 4 files の Biome が pass。[入力・有効な引用候補・予算の証跡](quality.imports-static.json)。

doc store の重複した判定表も既存 CR m1-17 に従い core `computeVerdict` へ統一した。再 stamp、setVerified / unlock、setClaimChecks、load、apply、edit の caller を確認し、L1 fail → inferred、human lock → human-verified、unlock → inferred、vacuous + L3 S → verified の回帰を追加した。store / reload / gen verifier の 3 files は 61 tests / 449 assertions、doc 変更 2 files の Biome が pass。これは保存・再検証時の判定統一であり、引用窓の実生成改善とは別である。Markdown の本文・cite link と `doc.index.json` の verdict metadata を分ける既存 codec 契約を変更せず、golden と検証器も変更していない。

追加の任意検証を各 1 native call・repair なしで行う場合、現行 `gpt-6.1-sol` / high の byte preflight は m3e module input 107,278 / output 予約 7,200 / $0.286556、Jev quality input 41,144 / output 予約 4,800 / $0.130288、合計 $0.416844 API-equivalent。品質検証の既計 $0.792490 と合わせると $1.209334、品質の総枠 $2 からの残りは $0.790666（別の Explain 呼出は含まない）。これは請求実測ではなく、native thinking に厳密な token cap もない。追加実呼出は実施しておらず、既存 consent / run guard と利用者の確認を前提とする。

この Mac の追加費用なしの再現入口は `scripts/nd bun /private/tmp/mitori-quality-imports-offline-20261011.ts`（m3e）、`scripts/nd bun /private/tmp/mitori-quality-imports-jev-offline-20261011.ts`（Jev quality）、`scripts/nd bun /private/tmp/mitori-quality-imports-jev-module-offline-20261011.ts`（Jev module の保持確認）。既存の固定 source と保存 index が必要で、実入力は private temporary JSON へ保存し Git には入れない。対象回帰は上記の repo 内 test files で再実行できる。

承認後の実検証用には `/private/tmp/mitori-quality-citation-prepare-20261011.ts` で新規 home / out / raw を 0700、既存の隔離 Codex 設定だけを引き継ぐ config と plan を 0600 で準備済み。実行入口 `/private/tmp/mitori-quality-citation-rerun-20261011-Goiu63/plan.json` に既存 `bench/measure/gen-real.ts` の未実行コマンドを保存した。`--scope s6/lib-tokens` / `s9`、`--engine codex-cli`、concurrency 1、timeout 10 分、`--max-native-calls 1`、各 run guard $0.35 / $0.15（計 $0.50）、turn consent $1 とする。native 呼出は 0 のまま。call cap 用の `--record` は raw prompt / argv / env を含み得るため private temporary directory にのみ保持し、Git へ残すのは allowlist 化した検証結果だけにする。
