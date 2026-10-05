# 文書操作・GitHub PR・Codex の続行結果

統合時追記: 後続の製品 helper による実 GitHub push / draft PR #3 の検証・close・remote branch削除まで完了した。[実送信証跡](pr-native-probe-20261005.md)。以下の「実公開の成功は未確認」は、その前の単位検証時点の記録。

確認日: 2026-10-05。変更は未コミット。新しい依存や有料 Codex 呼び出しは追加していない。

## 文書操作

- `docpatch/1` は tool-free runner から既存の pending proposal に接続した。既存 block id は DOC アンカー内のみ、操作数・本文長・Markdown・挿入順序を全件検証してから保存する。`new:n` は応答内の参照であり、同じ block の後に続く挿入は Markdown の一つの提案へまとめる。文書本文やコードを自動適用しない。
- expand / simplify は費用確認後に scoped generation を開始し、提案を人が採用する。block / section translate は secondary cache に保存して原文を保つ。revert は履歴の `{rev,baseHash}` を確認して新しい human revision として保存し、競合は409にする。
- backend は dry preparation が返した実 engine の `privacy.dataPolicyAck` を確認し、同じ保存済み estimate を開始する。cached proposal / zero-token translation の参照は新しい provider 呼び出しをしない。compose の追加は `domainHandlers` の `dataPolicyAcked` callback 一つ。
- Reader の費用確認、言語切替、proposal review、revert 人確認は UI 担当が接続した。secondary 本文に原文の model tag を流用しない。

## GitHub PR

既存の WEB ONLY route と SEC04 を維持し、agent bearer は403にする。passed gates と人の採用済み hunk を必要とし、side.git だけに tree / commit / branch を作る。remote default branch の preimage と reviewed delta が一致しない場合は push 前に拒否する。権限が無い場合は clone / remote 追加をしない fork 経路を使う。

origin は GitHub の HTTPS / SSH のみ。公開本文・新 blob の秘密候補、通常ファイル以外を拒否する。push は hook と継承 credential helper / global config を無効化し、既存 SAFE_PATH で解決済みの gh だけに認証を任せる。PR 本文は安全な一時ファイルを使う。

実 GitHub push / PR 作成は行っていない。recording gh / push fixture と real git で、reviewed delta のみ・正しい remote parent・dirty preimage 拒否・user repo の refs / objects / index / config / stash / worktree metadata 不変を確認した。remote base がローカルの読み取り可能 object に無い場合は、利用者が repo を更新して再レビューする必要がある。daemon は user repo を fetch しない。

後続の [pr-local-probe.ts](./pr-local-probe.ts) はこの `satoki252595/mitori` の real repo / temporary side repo を使った。gh auth / current GitHub base の API は読み取りだけ、push / PR create は recording spawner に置き換えた。`origin/main` と実 remote base が一致し、README 一つだけの差分が送信境界へ到達、user Git metadata の hash は一致した（1.38秒）。[証拠](./pr-local-probe-20261005.json)。これは GitSafety 層の局所到達検証であり、製品 job の人の採用や passing gates を作ったものではない。実公開の成功は未確認。

## Codex agent mode

検証済み `codex-cli 0.160.0` の pinned native realpath を直接実行する。symlink launcher 経由では macOS helper の再実行が EPERM になったため、実体と hash を毎回照合する。native 実体への read 許可だけを追加し、実行環境全体への write / network 許可は増やしていない。

private HOME / CODEX_HOME へ subscription auth のみを安全に複写する。API-key auth を拒否し、user / repo config・hook・MCP・shell・delegation・外部 network を継承しない。agent では native apply_patch 一つ、text mode では tools 無し。供給された文脈だけを読み、exact WRITE と明示 newFiles 以外は OS profile と JSONL 検証で拒否する。escaping symlink は書き込み root にできない。cold turn のみで session resume は使わない。

料金は `engines.codex-cli.pricing` に明示する。`maxEstimatedSpendUsd` は推計費用への明示同意であり、料金不明・同意なしは native call 前に拒否する。保守的な UTF-8 入力と構成した出力予算・patch steps を preflight で価格に換算し、実行中も観測可能な本文量、JSONL 量、壁時計を制限する。terminal usage は cached input を分離し、失敗時の未取得 usage は推計として残す。

**hard USD / token cap は保証しない。** native CLI は thinking の途中使用量と失敗した apply_patch 試行を JSONL に出さない。`maxPatchSteps` は観測可能な file_change の上限（既定2、1–8）であり、全 tool 試行数ではない。native billing は unknown と表示する。subscription の実費を API 換算から断定しない。別バージョンは拒否する。Linux / Windows の precise profile は未検証で、対応完了とは扱わない（Windows native path は現在の POSIX profile の前提を満たさず拒否される）。

native の macOS 正負確認は [codex-profile-probe.ts](./codex-profile-probe.ts) を実行した。local Responses provider だけを使い、7 HTTP request、tool inventory は apply_patch のみ、scoped update / add / delete 成功、別ファイル・repo 外・escaping symlink の3試行拒否、repo の malicious MCP/config 非実行を確認した。実 user auth を使わない。証拠は [codex-native-profile-20261005.json](./codex-native-profile-20261005.json)。

```sh
scripts/nd bun docs/progress/codex-profile-probe.ts
```

このプローブにはローカルの検証済み Codex 0.160.0 binary が必要。fake provider 用の上書きはプローブ内に限定し、本番 engine の argv / profile を使う。

## 対象検証

```sh
scripts/nd bun test packages/agent/src/adapters/codex-engine.test.ts packages/agent/src/adapters/adapters.test.ts packages/agent/src/testing.test.ts packages/server/src/settings/settings.test.ts packages/agent/src/claude/spawn.test.ts packages/loop/src/jobs/engine.test.ts packages/loop/src/contracts/docpatch.test.ts packages/loop/src/contracts/parse.test.ts packages/loop/src/git/pull-request.int.test.ts test/int/doc-operations.test.ts test/int/codex-agent.test.ts
scripts/nd bunx tsc -p packages/agent --noEmit
scripts/nd bunx tsc -p packages/loop --noEmit
scripts/nd bunx tsc -p packages/server --noEmit
scripts/nd bunx tsc -p test --noEmit
```

116 pass / 0 fail、1085 assertions、11 files、2.46秒。4対象の型検査成功。Codex の real daemon integration は side worktree の候補を user repo に自動適用せず、gate が無い README は `unverified`、全採用は412、人の個別採用と Undo は成功、user Git metadata 不変を確認した。gates の無いものを passed と扱う修正はしていない。

その後 detect / status も pricing / spend-consent を native call 前へ移し、pinned binary の hash も version probe と credential copy より前に検証するよう揃えた。この変更は該当 Codex unit＋integration のみ再実行し、9 pass / 0 fail / 61 assertions、agent tsc 成功。全体の116件はこの追加変更より前の記録。

対象 Biome は import 順2件を修正して error 0。既存方針の non-null assertion warnings は残る。全体 check / build / Windows 実機確認はこの単位で反復せず統合担当に渡した。

修復 prompt は標準ライブラリ・既存 helper を優先し、WRITE 内の必要な import を含む最小変更を指示した。単に import を避けるための wrapper / 手動変換への置き換えを避ける。gen の品質 prompt と文脈選択は別担当が調整した。

## 調査の出典

統合担当の追加確認: 実 GitHub 通信も、利用者の公開承認範囲内で own private repo に一時 draft [PR #3](https://github.com/satoki252595/mitori/pull/3) を作って検証した。製品 helper の side repo→push→PR が成功し、公開差分1 file / 3 additions、user Git metadata不変、coauthorを確認後、close / remote branch削除まで完了した。[追加証跡](pr-native-probe-20261005.md)。これはweb上の人の採用操作を再実行した証拠とは分けている。

Codex 設定・CLI と native tool inventory はローカル `codex exec --help` / `codex --version` と、[公式 config reference](https://learn.chatgpt.com/docs/config-file/config-reference)、[openai/codex の config.schema と tool / seatbelt source](https://github.com/openai/codex) を確認した（2026-10-05）。native の hard token / USD 設定や失敗ツールを数える JSONL event は確認できなかったため、推計同意と可視 step 数の設定として設計した。
