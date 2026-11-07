# ADR-0017: LLM ごとのモデル設定と呼び出しごとの選択

- 状態: 採用（2026-11-07、WP41）。関連: ADR-0015、ADR-0016。

## Context

`engines.<id>` は engine ごとに並んで残るのに、`models` と `reasoning` は全体で 1 組しかなく、
`mitori setup` のたびに `defaultEngine`・`defaultGenEngine`・`models.*`・`reasoning.*` が上書きされる。
「最後に setup したものが既定」になり、前の LLM のモデル選択は消える。
利用者は「全部の LLM を最初に設定しておいて、呼び出すときに切り替えたい」。
`setup grok --api` が Muse の `engines.generic` を黙って置き換える問題もある。

## Decision

1. `GlobalSettings.engineProfiles: Partial<Record<EngineId, EngineProfile>>` を足す。
   `EngineProfile = { models: Partial<ModelDefaults>; reasoning: Partial<Record<ExecMode | "gen" | "genOverview", ReasoningEffort>> }`、
   scope と trust・exec の扱いは `models` と同じ（global のみ、exec ではない）。既定値 `{}`。
   古い設定ファイル（キーが無い）はそのまま読める（schemaVersion は上げない）。
2. 解決は `packages/core` の純関数 `profileFor(global, engine)` に集める。役割ごとに次の順で決める。
   1. `engineProfiles[engine]` にあればそれ。
   2. 無ければ、全体の `models[role]` がその engine の名前空間（Claude の素 id は claude-cli・anthropic-api、
      `codex:`・`grok:`・`antigravity:`・`generic:` は各 engine）ならそれ。
   3. それも無ければ `MODEL_CATALOG` のその engine の既定モデル（generic で一覧に無い独自モデルは、そのまま残っている全体値を使う）。
   4. `genLeaf`（anthropic-api Batch 専用）と `session` engine は全体の値をそのまま使う。
   5. reasoning も同じ順。そのモデルが受け付けない effort は、そのモデルの既定 effort にする
     （effort を無視する `claude-haiku-4-5` は受け取った値を保つ）。
3. `mitori setup <provider>` は毎回 `engines.<id>` と `engineProfiles.<id>` を保存し、既定
   （`defaultEngine`・`defaultGenEngine` と全体の `models.*`・`reasoning.*`）を変えるのは
   `--default` 付き・同じ engine の再設定・TTY の切り替え確認で「はい」と答えたときだけにする。
   今の既定 engine が未登録（claude-cli なら `pins.claude` が無い、など）なら、確認せずに新しい engine を既定にする
   （工場出荷の既定 claude-cli が、使わない人の既定に残らないように。WP41b）。
   `--keep-default` で確認なしに登録だけ残す。両方の同時指定は usage エラー。
   `generic` 枠に別の中身がすでにあるときは、保存の確認のあとで置き換えを警告する。
4. 呼び出すたびに選ぶ。生成の見積もりカードは、登録済みで有効なすべての生成 engine を
   `profileFor` のモデル・価格・effort で見積もる（今の 3 つの並びと表示は変えない）。
   回答・修正は Composer の送信欄の近くの「使うLLM」で選び、`JobReq.engine` で送り、
   model は `profileFor` に任せる（web から決め打ちしない）。
   その job の mode に対応しない engine（単発テキストのみ、送信に使えない session）は理由付きで選べない。
5. web の設定画面「モデルと推論の強さ」は、既定の LLM の切り替え（全体を `profileFor` の値に揃える）と
   LLM ごとのモデル・effort の編集（`engineProfiles.<id>` に保存、既定の LLM なら全体も揃える）に分ける。
   `saveProvider` の `defaultGenEngine` だけを変える不整合も同じ揃え方で直す。
6. `mitori gen --llm <provider>`（setup と同じプロバイダ名）で生成 engine を選べる。

## Verification and limits

- `profileFor` の解決順・effort 補正・古い設定（キー無し）の core テスト。
- engine 指定の見積もり・job がその engine のモデルと effort を使うこと、名前空間の合わない
  `JobReq.model` が日本語の案内付き `E_INVALID_INPUT` で拒否されることの gen・loop テスト。
- 2 つ目の setup で既定が変わらないこと（`--keep-default`・TTY の「いいえ」）、`--default` で変わること、
  同時指定の usage エラー、generic の置き換え警告の CLI テスト。
- プロファイル保存の検証、既定の切り替えで全体が揃うこと、exec が web から変わらないことの server テスト。
- 生成の engine 候補、Composer の LLM select の候補と無効理由、送信する `JobReq.engine` の web 単体テスト。
  e2e（`e2e/web/*.pw.ts`）は書いたが実行していない。ホストで実行する。
- `JobReq.model` の明示指定は今まで通り優先する。`session` engine の送信（pull 以外）は従来通り実行時に失敗する。
- 一覧に無いカスタムの generic モデル（`generic:qwen3:8b` など）の初回保存は、`checkModelSwitch` の
  `model-unknown` 判定で拒否される（今回の変更前からの挙動。実サービスでの二段階保存で確認し、
  素のツリーでも同じ結果）。`engineProfiles` の保存も同じ判定に従う。
