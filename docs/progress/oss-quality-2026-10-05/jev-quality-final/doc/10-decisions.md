# 10. 設計判断 <!-- b_7sdagdaz -->

> [!IMPORTANT]
> **入力は 1 件の自然言語ゴールとし、観測ごとに索引付き要素表から操作と対象を選ぶ**（[design.md:3](../../docs/design.md#L3)）。5 件の手作り手順と引用文字列の複写は有限選択の実行しか示さないとして捨てた（[design.md:25](../../docs/design.md#L25)）。本来のゴールを最後まで通して使い、サイト固有の計画や固定値を方針に足さないことで汎用性を保つためである（[design.md:25](../../docs/design.md#L25)）。サイト固有の手順や固定値を足す変更は貢献方針の前提に反するため、汎用方針の見直しが必要になる（[AGENTS.md:5](../../AGENTS.md#L5)）。 <!-- b_25ays10g -->

> [!IMPORTANT]
> **操作と操作別の対象候補を 1 回の `TypeSafe` 要求で問い、選択操作に対応する対象だけを実行する**（[design.md:5](../../docs/design.md#L5)）。直列の操作決定後対象決定呼び出しと旧来の `flat-choice/lookahead/Noul` 配置は採らない（[design.md:5](../../docs/design.md#L5)、[design.md:25](../../docs/design.md#L25)）。直列呼び出しの待ち時間を避け、操作と互換性のない対象の誤実行を抑えるためである（[design.md:5](../../docs/design.md#L5)）。新たな操作を足す場合は専用の対象 head と前提文の追加が必要になり、選択外の head を使う変更は独立性の前提を見直す必要がある（[design.md:5](../../docs/design.md#L5)、[design.md:7](../../docs/design.md#L7)）。 <!-- b_gq9z24jp -->

> [!IMPORTANT]
> **対象は観測した要素と対応操作の組み合わせに限り、モデルにセレクターや実行コードを出させない**（[AGENTS.md:7](../../AGENTS.md#L7)、[README.md:31](../../README.md#L31)）。観測外の指定や切り捨てた候補の選択は採らず、実行識別子に `CDP` の backend node ID を使わない（[design.md:13](../../docs/design.md#L13)、[design.md:31](../../docs/design.md#L31)）。互換性のない対象や観測外指定による誤操作を抑えるためである（[design.md:5](../../docs/design.md#L5)）。セレクター出力を許す変更はノードひも付けの識別子管理と実行対応の見直しが必要になる（[design.md:13](../../docs/design.md#L13)）。 <!-- b_8xcqzdfp -->

> [!IMPORTANT]
> **`TYPE_TEXT` のときだけ小さな LLM に文面生成を任せ、厳密な `JSON` 契約で縛る**（[design.md:9](../../docs/design.md#L9)）。引用文字列の複写や引用リテラルの抽出は採らない（[design.md:9](../../docs/design.md#L9)、[design.md:25](../../docs/design.md#L25)）。有限選択の実行だけでなく任務分解と文面生成を示すためである（[design.md:25](../../docs/design.md#L25)）。文面の再利用は入力全体が同一の停滞再試行に限り、成功変異後は破棄するため、緩和は停滞安全性の見直しが必要になる（[design.md:9](../../docs/design.md#L9)）。 <!-- b_0ps1g9k4 -->

> [!IMPORTANT]
> **ブラウザー変更は再試行せず、実行完了を次回観測より先に記録する**（[design.md:19](../../docs/design.md#L19)）。通信回復による再試行や中断した選択肢評価の継続は採らない（[design.md:19](../../docs/design.md#L19)）。中断時点で変更イベントが発火済みの場合があるためである（[design.md:19](../../docs/design.md#L19)）。記録順序を変える変更は遷移を伴う観測時の記録前提を見直す必要がある（[design.md:19](../../docs/design.md#L19)）。 <!-- b_9gfq7wem -->

> [!IMPORTANT]
> **検査器は loopback 専用で直列化し、`Host` と `Origin` と局所トークンで検査する**（[design.md:31](../../docs/design.md#L31)）。認証情報はサーバー側に残し、`.env` は無視する（[design.md:31](../../docs/design.md#L31)）。局所外からの操作受付を狭めるためである（推測）。loopback 外への公開は検査と直列化と認証情報の扱いの見直しが必要になる（[design.md:31](../../docs/design.md#L31)）。 <!-- b_xqtmsw1d -->

> [!IMPORTANT]
> **1 実行はブラウザー操作 60 と決定要求 120 に収め、候補は 250 件まで残す**（[design.md:31](../../docs/design.md#L31)）。切り捨てた候補は選択できない（[design.md:31](../../docs/design.md#L31)）。暴走と費用の上限を抑えるためである（推測）。上限を緩める変更は費用と待ち時間と記録量の見直しが必要になる（推測）。 <!-- b_k8w3tdyt -->

> [!IMPORTANT]
> **モデルは可視テキストを見て、スクリーンショットは既定で止め、鮮度は意味状態で比べる**（[design.md:15](../../docs/design.md#L15)、[design.md:17](../../docs/design.md#L17)）。`screenshots=True` か `record_dir=...` で有効化し、検査器は明示的に有効化する（[design.md:15](../../docs/design.md#L15)）。`DOM` 変異の計数による鮮度判定とスクリーンショットのモデル入力は採らない（[design.md:17](../../docs/design.md#L17)）。鮮度判定を変える変更は操作前検査と比較対象範囲の見直しが必要になる（[design.md:17](../../docs/design.md#L17)）。 <!-- b_a7hb857q -->

- スレッドから記録した決定はまだありません。スレッドの結論を「決定として残す」と、ここに並びます。
<!-- b_5zj5x7xv -->
