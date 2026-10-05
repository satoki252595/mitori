# 10. 設計判断 <!-- b_7sdagdaz -->

> [!IMPORTANT]
> **入力は 1 件の自然言語ゴールであり、観測ごとに索引付き要素表から操作と対象を選ぶ**（[design.md:3](../../docs/design.md#L3)）。5 件の手作り手順と引用文字列の複写は有限選択の実行しか示さず、任務分解と文面生成を示さないため捨てた（[design.md:25](../../docs/design.md#L25)）。本来のゴールを通して使うことで汎用方針を保つためである（[design.md:25](../../docs/design.md#L25)、[design.md:33](../../docs/design.md#L33)）。サイト固有の計画や固定値を方針に足す変更は、この汎用性の前提を見直す必要がある（[AGENTS.md:5](../../AGENTS.md#L5)）。 <!-- b_25ays10g -->

> [!IMPORTANT]
> **操作と操作別 target head を 1 回の TypeSafe 要求で問い、選択操作に対応する target だけを実行する**（[design.md:5](../../docs/design.md#L5)）。操作決定と対象決定の直列呼び出しは待ち時間を増やすため避ける（[design.md:5](../../docs/design.md#L5)）。互換性のない対象の誤実行を抑えるためである（[design.md:5](../../docs/design.md#L5)）。head を増やす変更は対象基準と実行側の対応付けを見直す必要がある（推測）。 <!-- b_gq9z24jp -->

> [!IMPORTANT]
> **対象は観測した要素と対応操作の組み合わせに限り、モデルにセレクターや実行コードを出させない**（[AGENTS.md:7](../../AGENTS.md#L7)）。実行は DOM ノードにひも付くコード所有の識別子で行い、CDP の backend node ID は使わない（[design.md:13](../../docs/design.md#L13)）。観測外の指定による誤操作を抑えるためである（[design.md:5](../../docs/design.md#L5)）。新しい操作種別を足す変更は対応表と実行器の検査を見直す必要がある（推測）。 <!-- b_8xcqzdfp -->

> [!IMPORTANT]
> **`TYPE_TEXT` のときだけ小さな LLM に文面生成を任せ、厳密な JSON 契約で縛る**（[design.md:9](../../docs/design.md#L9)）。引用文字列の抜き出しは行わず、JSON に `text` 値が 1 件だけあることを求める（[design.md:9](../../docs/design.md#L9)）。stale な決定の値は helper 入力全体が同一のときだけ再利用し、成功した変更の後は捨てる（[design.md:9](../../docs/design.md#L9)）。文面生成の入力や検証を変える変更は再利用条件と無効化を見直す必要がある（推測）。 <!-- b_0ps1g9k4 -->

> [!IMPORTANT]
> **ブラウザー変更は再試行せず、実行完了を次回観測より先に記録する**（[design.md:19](../../docs/design.md#L19)）。中断した native select 評価は change event が発火済みの場合があるため止める（[design.md:19](../../docs/design.md#L19)）。二重変更を避けるためである（推測）。実行と観測の順序や復旧処理を変える変更は重複実行の有無を確かめる必要がある（推測）。 <!-- b_9gfq7wem -->

> [!IMPORTANT]
> **検査器は loopback 専用で直列化し、`Host` と `Origin` と局所トークンで検査する**（[design.md:31](../../docs/design.md#L31)）。資格情報はサーバー側に置き、`.env` を無視する（[AGENTS.md:11](../../AGENTS.md#L11)）。局所での盗聴や外部からの操作を抑えるためである（推測）。公開範囲や認証を変える変更は資格情報の置き場所と検査を見直す必要がある（推測）。 <!-- b_xqtmsw1d -->

> [!IMPORTANT]
> **1 実行は 60 操作と 120 決定要求と 250 候補に収める**（[design.md:31](../../docs/design.md#L31)）。切り捨てた候補は選択できない（[design.md:31](../../docs/design.md#L31)）。暴走と課金を抑えるためである（推測）。上限を変える変更は事例と表示と証拠と呼び出し回数の整合を見直す必要がある（[AGENTS.md:13](../../AGENTS.md#L13)）。 <!-- b_k8w3tdyt -->

> [!IMPORTANT]
> **モデルは可視テキストを見て、スクリーンショットは既定で止め、鮮度は意味状態で比べる**（[design.md:15](../../docs/design.md#L15)、[design.md:17](../../docs/design.md#L17)）。スクリーンショットはモデルが消費せず、記録用に任意で有効化する（[AGENTS.md:10](../../AGENTS.md#L10)、[design.md:15](../../docs/design.md#L15)）。文書と URL と viewport と安全な form 値を比べ、DOM 変異の回数では比べない（[design.md:17](../../docs/design.md#L17)）。観測項目を変える変更は鮮度判定と待機条件を見直す必要がある（推測）。 <!-- b_a7hb857q -->

- スレッドから記録した決定はまだありません。スレッドの結論を「決定として残す」と、ここに並びます。
<!-- b_5zj5x7xv -->
