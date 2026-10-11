# LM Studioの実Explain（2026-10-11）

取得済みGGUF `qwen/qwen3.8-27b`（17.74GB）と既存ランタイムを使い、Nix Bun / 通常の既存Bun 1.4.2で各1回成功した。モデル・ソフトウェアの取得や有料API呼出は行っていない。[機械可読の証跡](lmstudio-explain.json)。

| 経路 | 実HTTP推論 | 所要時間 | reported input / output | 本文 / 有効引用 / 不正引用 |
|---|---:|---:|---:|---:|
| Nix | 1 | 11.244秒 | 766 / 213 | 98文字 / 1 / 0 |
| 通常Bun | 1 | 12.127秒 | 767 / 266 | 90文字 / 1 / 0 |

実製品daemonと `go-small` fixtureを使い、`NormalizeISBN` の40–42行をアンカーに短い日本語説明を要求した。両回答はハイフン・空白の削除と大文字への変換を正しく説明し、同じ関数の有効な出典を付けた。各jobはattempt1 / done、元sourceは不変。各検証daemon・fixture・一時homeの削除を確認した。

接続先は既定 `http://localhost:1234/v1`。APIキーなし、出力600tokens・90秒・同時1・repair0とし、harnessで非loopback HTTPと2回目の推論を拒否した。推論は計2回、追加費用は$0。モデル全体の文書生成・構造化patch・大きなcontextの品質は未確認。

再現にはLM Studioで取得済みモデルを読み込み、Developerでサーバーを起動し、表示されたモデルIDで `bun run start -- setup lmstudio --model MODEL_ID` を実行する。Nixなら先頭に `scripts/nd` を付ける。対象repoを開き、関数をアンカーに短い説明と出典を要求する。今回の検証専用識別子は後始末で解除済みなので、そのままコピーせず本人の表示IDを使う。

今回、既存 `lms load` に4096を指定したが、`lms ps` とローカル `GET /api/v1/models` のloaded instanceは262144を報告した。4096設定の成功とは扱わず、原因未確定で記録した。推論は小さい入力に限定し、thinkingの追加設定やサービス側変更は行っていない。

介入直前のserverは起動中・読込モデル0件だった。検証専用識別子だけを読み込み、終了後に同識別子だけをunloadし、起動中・0件へ復元した。既存serverの停止や他モデルの解除はしていない。より前の停止→起動の変化は誰が行ったか不明で、本人操作と断定しない。
