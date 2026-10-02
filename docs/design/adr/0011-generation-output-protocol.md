# ADR-0011: 生成の出力プロトコル — `gen.block/1` NDJSON の行検証 + 1 回再試行

- 状態: 採用（2026-10-03）。小さなタスクでの `--json-schema` 使用範囲は P0 の計測（D14）で確定 / 関連: D14、synthesis §3.5、04 §7.4、01 §3.4–3.8

## Context
初回生成は block 単位で流れ込む体験（最初の文章 ≤ 30 s）が必須。`--json-schema` は 1 turn 増え約 1.75k token かかり、streaming できない。crit の story は ID 参照出力とサーバ側の決定的検証で再生成ループを減らしたが、推奨経路で版・SHA・指紋が刻印されない欠陥があった。

## Decision
- 生成（module ページ・overview・flows・glossary など）の出力は **`gen.block/1` NDJSON**（`GenLine`: block / delete / keep / diagram / term / module_name / question / end）。
- サーバは text delta を行に組み立て、**到着した行ごとに検証**（JSON、型、許可された section・ID、claim の text が md の部分文字列であること、cite の L0、生 HTML や ID コメントの混入禁止、長さ）。正しい行は即座に block として確定し SSE で流す。
- 失敗行は最後に集めて **1 回だけ**、構造化エラー（≤ 20 件）を添えて同じセッションに再要求する（claude-cli は `--resume`）。2 回目も失敗した行は捨て、該当箇所は placeholder のまま残し、task を `failed` にする。
- LLM は path + 行範囲だけを出し、**blob・symbol・snippet hash・model・prompt 版・index digest はサーバが刻印**する。session engine（prep/ingest）も同じ検証器を使い、サーバ発行の fingerprint を必須にする。
- 小さなタスク（図のラベル、L3 judge）は `--json-schema` / structured outputs を使ってよい。

## Consequences
- 途中で切れても確定済みの block は残る（部分的な成功が UI に現れる）。
- prompt は「1 行 1 JSON、前後に文章を書かない」を守らせる必要がある。守られない行は行検証で落ちるだけで全体は壊れない。
- 行の文法と検証規則は gen spec が byte 単位の例と golden テストで固定する。

## Alternatives
- `--json-schema` で全体を 1 つの JSON: streaming 不可、+1 turn。
- 自由形式 Markdown を後から解析: citation の構造化と検証ができない。
