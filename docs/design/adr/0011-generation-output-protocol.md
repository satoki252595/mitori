# ADR-0011: 生成の出力プロトコル — `gen.block/1` NDJSON の行検証 + 1 回再試行

- 状態: 採用（2026-10-03）。小さなタスクでの `--json-schema` 使用範囲は P0 の計測（D14）で確定 / 関連: D14、synthesis §3.5、04 §7.4、01 §3.4–3.8

## Context
初回生成は block 単位で流れ込む体験（最初の文章 ≤ 30 s）が必須。`--json-schema` は 1 turn 増え約 1.75k token かかり、streaming できない。crit の story は ID 参照出力とサーバ側の決定的検証で再生成ループを減らしたが、推奨経路で版・SHA・指紋が刻印されない欠陥があった。

## Decision
- 生成（module ページ・overview・flows・glossary など）の出力は **`gen.block/1` NDJSON**（`GenLine`: block / delete / keep / diagram / term / module_name / question / end）。
- サーバは text delta を行に組み立て、**到着した行ごとに検証**（JSON、型、許可された section・ID、~~claim の text が md の部分文字列であること~~（R1-1: marker `[[n]]`）、cite の L0、生 HTML や ID コメントの混入禁止、長さ）。正しい行は即座に block として確定し SSE で流す。
- 失敗行は最後に集めて **1 回だけ**、構造化エラー（≤ 20 件）を添えて同じセッションに再要求する（~~claude-cli は `--resume`~~ R1-4: continuation）。2 回目も失敗した行は捨て、該当箇所は placeholder のまま残し、task を `failed` にする（R1-4: 必須 aspect 欠落時だけ）。
- LLM は path + 行範囲だけを出し、**blob・symbol・snippet hash・model・prompt 版・index digest はサーバが刻印**する。session engine（prep/ingest）も同じ検証器を使い、サーバ発行の fingerprint を必須にする。
- 小さなタスク（図のラベル、L3 judge）は `--json-schema` / structured outputs を使ってよい。

## Consequences
- 途中で切れても確定済みの block は残る（部分的な成功が UI に現れる）。
- prompt は「1 行 1 JSON、前後に文章を書かない」を守らせる必要がある。守られない行は行検証で落ちるだけで全体は壊れない。
- 行の文法と検証規則は gen spec が byte 単位の例と golden テストで固定する。

## Alternatives
- `--json-schema` で全体を 1 つの JSON: streaming 不可、+1 turn。
- 自由形式 Markdown を後から解析: citation の構造化と検証ができない。

## 改訂 R1（2026-10-03、レビュー反映: gen §17.4 A1、CONS-15、SC-17、PT-03、PT-09） — 本節が上の Decision より優先

1. **claim は marker**: md 内の `[[n]]` と claims の対応で表す（上の「claim の text が md の部分文字列」は廃止）。claim の文は marker の範囲から server が導出する。
2. **line 型**: `block`（diagram は block 行の中）/ `keep` / `delete` / `module`（name + summary）/ `flow` / `term` / `question` / `verdict` / `end`。
3. **compact 形が既定（PT-03）**: LLM は `t, id, aspect, md, claims`（aspect が代替を許すときだけ `kind`、図は `diagram`、挿入位置は `after`）。kind・depth・audience は server が `ASPECT_DEFAULTS` から導出、section は task が決める。claims は `{"1":"behavior path:a-b,…"}`。full 形も受理し、M-1 で妥当行率を比較する（compact が 2pp 以上悪ければ full に戻す）。
4. **再試行**: 失敗行は最後に集め、構造化エラー（≤ 20 件）を添えて **parking 中の同じプロセスへの continuation** で 1 回だけ再要求する（`--resume` は `--no-session-persistence` の既定では使えない）。プロセスが無ければ cold 再実行。2 回目も失敗した行は捨てて placeholder のまま残し、task を `failed` にするのは**必須 aspect が欠けたときだけ**。
5. **出力上限（PT-09）**: claude-cli には `CLAUDE_CODE_MAX_OUTPUT_TOKENS` を注入。CLI 内部の continuation（追加の `message_start`）を検出したら LineAssembler を閉じ、その task に mitori 側の再試行を足さない。
6. **fence**: gen は `GEN_DATA_FENCE`（内容 + workspace salt から導出した nonce。repo pack を system prompt に置く唯一の cache 点を壊さないため、PT-06）。loop の bundle は乱数の `UNTRUSTED_FENCE`。
7. **AI 由来の md は全経路で検証（SEC-11）**: V13 を `AiMarkdownValidator` として抽出し、patch/agent の `docUpdates`・回答の昇格・doc.sync/simplify/translate にも適用（repo 相対リンクと cite だけ、画像不可）。
