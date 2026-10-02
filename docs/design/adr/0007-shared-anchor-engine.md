# ADR-0007: 共通 anchor engine（claim と comment を同じ仕組みで追従させる）

- 状態: 採用（2026-10-03） / 関連: synthesis §4.4、07 §3.5、01 §1.6、04 §6.2

## Context
設計書の claim はコード範囲を引用し、コメントは block・コード範囲・図ノードに付く。コードが変わると両方を付け直す必要がある。crit の Hirschberg O(N·M) は 10k 行で 258 ms と遅く、付け直しに失敗したコメントが黙って消える製品も多い。

## Decision
- **anchor の同一性**: コードは `(path, start, end, blob, symbol, snippet hash)` + TextQuote（前後 32 文字）、設計書は `(block id, claim?, TextQuote, offset, block hash)`、図は `(diagram, node|edge)`。`Cite` と `CodeAnchor` は同じ組。
- **再アンカーの順序**（安い順、成功したら止める）: identity（blob 同一）→ symbol（新 index で symbol path を引き snippet hash で照合）→ **Myers O(ND) の行写像** → TextQuote の fuzzy 探索（近い位置から）→ **outdated**（元のスナップショットを保持、「新しい位置を指定」で人が直す）。**削除しない**。
- **1 つのパッケージ `@mitori/anchor`**（core にだけ依存）。claims（gen/doc）と threads（loop）は server が 1 回の `reanchor` 呼び出しにまとめて渡す。
- **stale 判定**: diff の hunk と引用範囲が重なる claim だけ stale。accept で重なった他の thread は `stale` フラグ（状態ではない）。
- `AnchorHealth`（ok / moved / fuzzy / outdated）は thread の状態とは独立のフィールド。

## Consequences
- SLO: コメント消失 0、再アンカー成功率 ≥ 95%（対象が残っている場合）、10k 行の再写像 ≤ 50 ms。回帰テストに rename・大移動・同一行の編集を含める。
- 設計書側の anchor は block ID が安定なので、ほとんどが identity で済む。

## Alternatives
- 行番号 + 行テキストだけ（crit）: symbol 単位の意味的 anchor がなく、多対多の対応を持てない。
- claim と comment で別々の実装: 精度と回帰の二重管理になる。
