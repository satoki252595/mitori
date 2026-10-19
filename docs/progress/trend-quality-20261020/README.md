# トレンドOSS 3件での実生成と WP29〜34 の記録（2026-10-20）

利用者の依頼「（残作業を）進めてください。直近のgithubのOSSでトレンド入りしているツールで試してみて」の記録。見つかった問題はその場で直し、直せなかったものは観察に書いた。

## 対象と条件

2026-10-20 の GitHub Trending から、言語が分かれる3件を選んだ。前回（2026-10-12）は TS/JS/Python、今回は Rust を初めて含む。

| リポジトリ | 位置づけ | 主言語 | 固定 SHA | ファイル |
|---|---|---|---|---|
| [akitaonrails/ai-memory](https://github.com/akitaonrails/ai-memory) | daily 3位 | Rust | `116076eba390` | 1,204 |
| [MadsLorentzen/ai-job-search](https://github.com/MadsLorentzen/ai-job-search) | daily 1位 | Python | `84808eebc13f` | 277 |
| [mksglu/context-mode](https://github.com/mksglu/context-mode) | weekly 7位 | TypeScript | `3bcbec813a48` | 599 |

- エンジン: Muse（muse-spark-1.3-contributor・high・lean 起動）。設定は利用者の実設定のコピー。保存済みの実行ファイル（1.4.6）は消えていた。起動時に PR #25 の自動追従で 1.4.10 に切り替わった（ログ `agent.generic.auto_follow`、1.4.6-R6000.1 から 1.4.10-R6427.1 へ）。途中で Muse 本体が 1.4.11 に更新された。
- 実行: `bench/measure/gen-real.ts`、範囲 standard、並列 2、上限 API換算 $3/件。費用は Muse がトークン数を返さないため UTF-8 バイト換算の推計（実請求ではない）。
- 対象 repo の依存・スクリプトは実行していない。clone は `~/.cache/mitori-trend-20261020`（非公開）。

## 1回目の結果（main `021f9fb`）

| | ai-memory | ai-job-search | context-mode |
|---|---|---|---|
| 完了 / 失敗 | 61 / 0 | 10 / 0 | 16 / 0 |
| 実時間 | 1,952 秒 | 275 秒 | 419 秒 |
| 最初のAI本文まで | 58.6 秒 | 66.3 秒 | 21.5 秒 |
| API換算（推計） | $0.666 | $0.043 | $0.138 |
| 主張数 | 1,809 | 156 | 350 |
| 出典の存在・行範囲（L0） | 100 % | 100 % | 100 % |
| 主張と出典の一致（L1、vacuous除く） | 89.0 % | 94.5 % | 95.8 % |
| 1回目で妥当だった行 | 96.2 % | 100 % | 97.2 % |
| 行の再試行率 | 14.8 % | 0 % | 6.3 % |

## 見つけて直した問題

| # | 問題（利用者から見えたこと） | 直したこと | PR |
|---|---|---|---|
| 1 | ai-job-search の本体（`.agents/skills/**` 124件・`.claude/{skills,commands,agents}/**` 28件）が既定の deny で丸ごと除外された（除外155件中152件）。§0〜§3 が補助スクリプト（給与検索）しか説明しない | AI 用ディレクトリ（.claude/.codex/.agents/.cursor）のテキスト文書と `skills/` 配下の同梱コードを「信頼しない内容」として読む。書き込み禁止は不変。hook・settings・MCP 設定・*.toml は読まない。利用者・repo の deny と他の既定 deny（.envrc 等）は常に優先 | #27（WP30）・#28（WP32c/d） |
| 2 | §0 が Elastic-2.0 を「ライセンス: 不明」とした（地図は正しい。判定が2か所で表が違った） | 判定を1つにした。ELv2・BUSL・SSPL、Cargo.toml・pyproject.toml、LICENSE 1行目を見る | #27 |
| 3 | 生成後も付録が「commit: なし・使用量 0・未生成」と表示される | 生成の記録時に描き直す。バイト換算は推計と表示する | #27 |
| 4 | 間取り図に `index.ts` が3つ並ぶ。出典チップが `README.md:7` と出る（実は `.cursor-plugin/README.md`） | 区別できる最短の親ディレクトリを表示する | #26（WP31、CI 待ち） |
| 5 | ai-memory の流れの候補8件中7件が補助バイナリ・評価用 CLI で、本体の MCP サーバー・`/hook` が無い。§3 が取り込み系だけになる | Rust（axum・actix）のルートと MCP ツール登録（TS/JS・Python・Rust）を検出する。evals/bench を外す。CLI はプログラムごと1件にする | #28（WP32） |
| 6 | 親モジュールのページの出典一致が 70.3 %（関数名を挙げる文がファイル冒頭の `//!` を出典にした） | 子の公開関数の定義範囲を渡す（gen.parent@5） | #28 |
| 7 | コマンドが流れの候補になっても §3 に出ない（コマンド本文が入力に1行も届かず、コードの本体が予算を使い切っていた） | 文書 seed の本文を先に公平な取り分で渡す。コマンド・スキルの手順は文書の行を出典にする（gen.flows@8）。同梱コードの入口はスキルの一部として扱う。README の言及順・同名コピーは1件にする | #28（WP32b〜f） |

## 修正後の確認（実生成）

| | ai-memory（#28 の WP32 時点） | ai-job-search（#28 全部） | context-mode（#28 全部、コードだけの repo の退行確認） |
|---|---|---|---|
| 主張と出典の一致（L1） | 89.0 → 95.6 % | 99.1 % | 93.5 %（1回目 95.8 %） |
| API換算（推計） | $0.566 | $0.073 | $0.165 |
| その他 | gen.parent 70.3 → 100 %（pass 84 / fail 0）、gen.module 89.9 → 95.1 % | 読んだファイル 102 → 252、除外 175 → 25 | 再試行 25 %（1回目 6.3 %） |

- ai-memory: §3 に「フック取り込み」「ページ読み出し」が加わった。
- ai-job-search: §0 が `/scrape`→`/apply`→`/interview` を README から説明する。§3 は「プロフィール初期設定（/setup）」「求人トリアージ実行（/rank）」「給与指標照会」で、手順はコマンド文書の行を出典にする。付録は commit・使用量（バイト換算の推計）・standard を表示する。
- context-mode: §3 は「大出力の省コンテキスト処理」「ファイル索引登録」「索引検索」「知識ベース削除」（MCP の主機能）。ライセンスは Elastic-2.0。
- 観察（未対応）: context-mode の §0・§1 の主な出典はなお `.cursor-plugin/README.md`（10 回、ルート README 3 回）。ルート README の冒頭はバッジの列で、モデルが要約文のある下位 README を選ぶ。内容は同じ製品の説明で誤りではない。
- 実生成の合計は API換算の推計で約 $1.9。

## 性能（WP29、React 規模のメモリ）

別スレッドからの RSS 標本で、react（2,847 ファイル）の cold scan を測った。

- 開始前 100 MB → S0（Worker 8本起動）430 MB → S1 783 MB → S2〜S4 ほぼ横ばい。ピークは S1 で決まる。S1 後の main thread の JS heap は 65 MB（S4 後 123 MB）しかない。
- 素の Bun Worker は1本約 3 MB だが、解析 Worker は起動だけで約 30〜37 MB 使う。最初の構文解析で tree-sitter の WASM メモリが1本あたり +32〜48 MB 広がり戻らない（8本で約 320 MB）。Worker を縮めても RSS はほぼ下がらない。
- Worker 数と速さの関係（同じ負荷下、各2回）。Go 7k（上限 1,500 ms、現在 1,449）を悪化させずに 700 MB に届く手は無い。

| Worker 数 | ピーク RSS | S0–S4 時間 |
|---|---|---|
| 8 | 764〜797 MB | 1,156〜1,200 ms |
| 6 | 692〜700 MB | 1,279〜1,348 ms |
| 4 | 641〜701 MB | 1,622〜1,773 ms |

- 試して採らなかったもの: Worker 初期化時の grammar バイト列の解放（−4 MB、ぶれ ±20〜35 の範囲）、`batchMaxBytes` 1 MiB → 256 KiB（ABBA 各8回の中央値 788 → 780 MB、差は誤差）。

## 運用で見つけて直したこと

- Mac の再起動後に self-hosted runner が起動に失敗した（launchd `78: EX_CONFIG`。/nix のマウント前に起動しようとして再試行されない）。PR の browsers ジョブが何日も待ちになった。LaunchAgent を `/bin/sh` 経由で /nix を最大 10 分待ってから起動する方式に変えた（#29）。runner がバックグラウンド優先度に落ちる件は 2026-10-20 にも1回再発し、登録し直しで戻した（原因は未特定）。
- `WEB-U-025 detectUiLang` がテストの実行順で落ちる（SSE のテストが表示言語の設定を残す）。両側で後始末する方式に直した（#30）。
- browsers ジョブの chromium の速さのテスト4件（地図の部屋カード ≤100 ms、本文の段階切替 ≤50 ms、節の移動 ≤100 ms、streaming の位置 ≤4 px）が、Mac の負荷 5〜12 の下で main でも同じく落ちる（web に触れない #29・#30 でも発生）。負荷が下がった時の再実行で判断する。
- Muse の作業 worktree を `/private/tmp` に置いていたため、再起動で未コミットの作業が消えた。`~/.cache` に移すと biome の対象ファイルが変わり check が落ちたため、`~/Library/Caches/mitori-muse-wt` に置く。
