# eval レポート: quick（オフライン集計）

- 実行: 2026-10-05T11:27:00.110Z → 2026-10-05T11:27:00.111Z
- git: `815957fd01fb`（未コミットの変更あり）
- 予算: 上限 $0（API 換算）／使用 $0／課金: unknown
- 価格表: 2026-09-25

## SLO

| id | 値 | target | limit | 判定 | n | 備考 |
|---|---|---|---|---|---|---|
| gen.ratio.inputFiltered | 1.11 ratio | 0.5000 | 0.6000 | 未達 |  | 推計（分母を含む） m3e-token-pass1-final/report.json |

## スイート

### tokens — 失敗

- Offline report analysis: no engine detection or model call; every filtered denominator and ratio is estimated.
- m3e-token-pass1-final/report.json: SHA 039ec311acc33dd0c76a54cbc16af4fc8ab9b491, indexDigest 093c4511769c4384; numerator estimated (13 estimated calls), denominator FileEntry.tokensEst (claude-v5).

| check | 結果 | 詳細 |
|---|---|---|
| inputFiltered:m3e-token-pass1-final/report.json | **NG** | estimated 1.1142; target 0.5, limit 0.6; numerator estimated, denominator estimated |

report.0.pass1In = 692453／report.0.filteredTokens = 621491／report.0.inputFiltered = 1.11／report.0.estimatedCalls = 13
