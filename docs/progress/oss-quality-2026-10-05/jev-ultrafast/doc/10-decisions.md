# 10. 設計判断 <!-- b_7sdagdaz -->

> [!IMPORTANT]
> **入力は 1 件の自然言語ゴールとし、観測ごとに作る索引付き要素表から操作と対象を選ぶ**（[design.md:3](../../docs/design.md#L3)）。5 件の手作り手順や引用文字列の複写、サイト固有のスクリプトや用意済みフィールド文字列は捨てた（[design.md:25](../../docs/design.md#L25)）。タスク分解とテキスト生成を実証し、汎用方針を保つためである（[design.md:25](../../docs/design.md#L25)、[design.md:33](../../docs/design.md#L33)）。変更時はサイト固有の計画や固定値を方針に足さず、ゴールと観測から導く形に寄せる（[AGENTS.md:5](../../AGENTS.md#L5)）。 <!-- b_25ays10g -->

> [!IMPORTANT]
> **操作と操作別対象 head を 1 回の TypeSafe 要求で問い、選択操作に対応する対象だけを実行する**（[design.md:5](../../docs/design.md#L5)）。操作決定後の逐次呼び出しや旧来の flat-choice 配置は採らない（[design.md:5](../../docs/design.md#L5)、[design.md:25](../../docs/design.md#L25)）。逐次呼び出しを避け、操作と不整合な対象を排除し、2 決定を 1 往復で済ませるためである（[design.md:5](../../docs/design.md#L5)）。変更時は対象 head を増やす場合も対応操作との互換性だけを入れ、実行側で他 head を読まない（[README.md:49](../../README.md#L49)、[AGENTS.md:6](../../AGENTS.md#L6)）。 <!-- b_gq9z24jp -->

> [!IMPORTANT]
> **対象は観測した要素と対応操作の組み合わせに限り、モデルにセレクターや実行コードを出させない**（[AGENTS.md:7](../../AGENTS.md#L7)）。実行は DOM ノードにひも付くコード所有の識別子で行い、CDP の backend node ID は使わない（[design.md:13](../../docs/design.md#L13)）。操作と不整合な対象を排除するためである（[design.md:5](../../docs/design.md#L5)）。変更時は候補を観測外から足さず、打ち切られた候補を選択可能にしない（[AGENTS.md:7](../../AGENTS.md#L7)、[design.md:31](../../docs/design.md#L31)）。 <!-- b_8xcqzdfp -->

> [!IMPORTANT]
> **`TYPE_TEXT` のときだけ小さな LLM に文面生成を任せ、厳密な JSON 契約と同一入力条件の再利用で縛る**（[design.md:9](../../docs/design.md#L9)）。引用符で囲んだ文字の抜き出しや手作り文面の複写はしない（[design.md:9](../../docs/design.md#L9)、[design.md:25](../../docs/design.md#L25)）。本来のゴール起点で実際のテキスト生成を実証するためである（[design.md:25](../../docs/design.md#L25)）。変更時は `text` 以外の取り出しを足さず、stale 決定の値を使い回す条件を緩めない（[design.md:9](../../docs/design.md#L9)）。 <!-- b_0ps1g9k4 -->

> [!IMPORTANT]
> **ブラウザー変更は再試行せず、実行完了を次回観測より先に記録する**（[design.md:19](../../docs/design.md#L19)）。中断した native-select 評価は change イベント発火済みの恐れがあるため止める（[design.md:19](../../docs/design.md#L19)）。二重適用や結果の取り違えを避けるためである（推測）。変更時は輸送回復で再試行せず、観測前に記録する順序を保つ（[design.md:19](../../docs/design.md#L19)）。 <!-- b_9gfq7wem -->

> [!IMPORTANT]
> **検査器は loopback 専用で直列化し、Host と Origin と局所トークンで検査し、資格情報はサーバー側に置く**（[design.md:31](../../docs/design.md#L31)）。テストは課金 API を呼ばず、`.env` は無視する（[AGENTS.md:11](../../AGENTS.md#L11)）。局所実行での資格情報漏えいと外部呼び出しを抑えるためである（推測）。変更時は検査を緩めず、資格情報を静的配信や検査器応答に載せない（[design.md:31](../../docs/design.md#L31)）。 <!-- b_xqtmsw1d -->

> [!IMPORTANT]
> **1 実行は 60 操作と 120 決定要求と 250 候補に収める**（[design.md:31](../../docs/design.md#L31)）。`DONE` の選択を成功証拠にせず、最終成果は独立に検証する（[AGENTS.md:12](../../AGENTS.md#L12)）。妥当な行動でも誤り得るし、2 サイトでは広い信頼性を示せないためである（[design.md:33](../../docs/design.md#L33)）。変更時は例と README 主張と生証拠と呼び出し回数の整合を保つ（[AGENTS.md:13](../../AGENTS.md#L13)）。 <!-- b_k8w3tdyt -->

> [!IMPORTANT]
> **モデルは可視テキストを見て、スクリーンショットは既定で止め、鮮度は意味状態で比べる**（[design.md:15](../../docs/design.md#L15)、[design.md:17](../../docs/design.md#L17)）。DOM 変異の計数や予測前の高額な待機はしない（[design.md:17](../../docs/design.md#L17)、[design.md:21](../../docs/design.md#L21)）。自動補完の到着前予測の課金を避けるためである（[design.md:21](../../docs/design.md#L21)）。変更時は可視性や有効状態や幾何の再検査を外さず、記録速度を上げない（[design.md:17](../../docs/design.md#L17)）。 <!-- b_a7hb857q -->

- スレッドから記録した決定はまだありません。スレッドの結論を「決定として残す」と、ここに並びます。
<!-- b_5zj5x7xv -->
