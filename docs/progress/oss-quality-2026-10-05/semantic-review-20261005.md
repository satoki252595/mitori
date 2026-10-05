# S10 semantic review（公開資料のみ、追加 LLM なし）

確認日: 2026-10-05。対象は `m3e-decisions-final/doc/10-decisions.md` と `jev-questions-final/doc/10-decisions.md`、対応する pinned clone の公開 Markdown / source。private config と raw recording は読んでいない。生成結果は修正していない。

- m3e: `039ec311acc33dd0c76a54cbc16af4fc8ab9b491`
- jev: `1231850a0bf1a0c0341fe408ef1668dbbfdfac46`

| 対象 | 生成文 | 判定と引用元 |
|---|---|---|
| m3e / `b_pcsg2cmr` | 鍵がブラウザ外に出ない前提 | **意味が逆。** 保存先が browser であることと送信しないことを混同。README:50 は provider へ direct request。`lib/ai.ts:89-92` は `x-api-key`、105-107 は Bearer key を送る。正しくは「中継 server に保存しない、選択 provider へ送信する」。root の既存指摘を source で確認 |
| jev / `b_xqtmsw1d` | Host / Origin / local token により局所での盗聴を抑える（推測） | **根拠不足。** `demo.py:82,104-110` は request admission、design:31 は loopback / serialized inspector / checks の記述。通信の暗号化やローカル盗聴への防御は示さない。推測ラベルがあっても別種の security property を追加している。root の既存指摘を確認 |
| jev / `b_k8w3tdyt` | 1実行を60操作・120決定要求・250候補に収める | **上限の単位を混同。** 60 / 120 は run 全体（`agent.py:75-76,102-104`）、250 は各観測の DOM action table の切り捨て（`snapshot.js:99-101`）。その後 scroll / wait controls を追加する（102-104）。正しくは「run に60 actions / 120 decision requests、各 observation の DOM candidates は250まで」 |
| m3e / `b_q1q9n1nt` | Node22系で実行する | **不要に狭い要件。** CONTRIBUTING:25 は Node22.12以降を許し、CI の版が22。生成文の「22系」は後の major を禁止する読み方になる。正しくは「Node22.12以上、CIはNode22」 |

他の6件ずつは、今回の引用元の範囲で確定的な意味の逆転を見つけなかった。ただし source の事実から purpose / future constraints を補った推測も含まれ、引用の存在だけで entailment を合格とすることはできない。jev の120は text generation helper の calls を含む hard cost limit とも読ませない（`agent.py:106-115` は text calls を別に記録する）。

参照は上記 pinned clone の `CONTRIBUTING.md` / `README.md` / `lib/ai.ts`、`docs/design.md` / `AGENTS.md` / `jev_ultrafast/{agent.py,snapshot.js,demo.py}`。外部資料取得、依存 install、モデル実行、repo code 実行は追加していない。
