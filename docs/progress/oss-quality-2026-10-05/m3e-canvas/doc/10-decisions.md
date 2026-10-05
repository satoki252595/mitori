# 10. 設計判断 <!-- b_b0svs594 -->

> [!IMPORTANT]
> **サーバを持たず単一ページを静的出力し、保存はブラウザに置く**（[CONTRIBUTING.md:25](../../CONTRIBUTING.md#L25)）。`npm run build` は `out/` への静的出力を担う（[CONTRIBUTING.md:22](../../CONTRIBUTING.md#L22)）。運用負荷を避けて配布と利用を単純にするためである（推測）。変更者はサーバ側の永続化や API を追加せず、ブラウザ保存が前提の実装を保つ必要がある（推測）。 <!-- b_fv6dbq2g -->

> [!IMPORTANT]
> **AI 支援は利用者の鍵をブラウザに置き、直接業者へ要求する**（[README.md:50](../../README.md#L50)）。サーバ中継を挟まない構成である（[README.md:50](../../README.md#L50)）。鍵を手元に置いて漏えい範囲を狭めるためである（推測）。変更者は鍵の送信先や保存場所を増やさず、直接接続を保つ必要がある（推測）。 <!-- b_pcsg2cmr -->

> [!IMPORTANT]
> **部品描画はパレットトークンのみから行い、編集画面の装飾と分離する**（[CONTRIBUTING.md:57-58](../../CONTRIBUTING.md#L57-L58)）。ダークモードと全配色で正しく保つためである（[CONTRIBUTING.md:57-58](../../CONTRIBUTING.md#L57-L58)）。変更者は部品側に固定色を持ち込まず、トークン経由で色を参照する必要がある（推測）。 <!-- b_vrwq208w -->

> [!IMPORTANT]
> **UI 文言とプロンプト文は 4 言語すべてにそろえて追加する**（[CONTRIBUTING.md:53-54](../../CONTRIBUTING.md#L53-L54)）。1 言語だけの追加は認めず、日本語、英語、中国語、韓国語を対象にする（[CONTRIBUTING.md:53-54](../../CONTRIBUTING.md#L53-L54)、[README.md:48](../../README.md#L48)）。変更者は文言追加時に全言語分を用意し、プロンプト出力を 4 言語で保つ必要がある（推測）。 <!-- b_fgd2xddw -->

> [!IMPORTANT]
> **寸法や角丸やトークンは Material 3 Expressive の標準値を用い、Material の名称で呼ぶ**（[CONTRIBUTING.md:55-56](../../CONTRIBUTING.md#L55-L56)）。独自の数値や命名は避け、迷う場合は Material の頁へ参照する（[CONTRIBUTING.md:55-56](../../CONTRIBUTING.md#L55-L56)）。変更者は新規の寸法や名称を追加する前に標準値との対応を確認する必要がある（推測）。 <!-- b_j8794cbe -->

> [!IMPORTANT]
> **新しい部品種別は定められた複数箇所を同時に触って追加する**（[CONTRIBUTING.md:43-44](../../CONTRIBUTING.md#L43-L44)）。`Kind` と `KIND_SPEC` と `KIND_ORDER` の定義から描画や文言や編集器まで既存種別を参照してそろえる（[CONTRIBUTING.md:45-49](../../CONTRIBUTING.md#L45-L49)）。変更者は単一ファイルの追加で済ませず、部品追加の手順に沿って横断的に更新する必要がある（推測）。 <!-- b_ytddw4g5 -->

> [!IMPORTANT]
> **プロンプト文言を含む大きめの変更は実装前に Issue で合意する**（[CONTRIBUTING.md:9-12](../../CONTRIBUTING.md#L9-L12)）。プロンプトは注意深く調整されており、Material 3 Expressive の語彙に合わせるためである（[CONTRIBUTING.md:9-12](../../CONTRIBUTING.md#L9-L12)）。変更者は小さな修正を直接送り、部品やパネルや文言の追加は先に相談する必要がある（[CONTRIBUTING.md:8-10](../../CONTRIBUTING.md#L8-L10)）。 <!-- b_11ex40ep -->

> [!IMPORTANT]
> **検証は型検査と単体試験と構築の 3 点を通し、Node 22 系で実行する**（[CONTRIBUTING.md:25](../../CONTRIBUTING.md#L25)、[CONTRIBUTING.md:65](../../CONTRIBUTING.md#L65)）。`npm run typecheck` と `npm test` と `npm run build` を PR 前と CI で同じく実行する（[CONTRIBUTING.md:65](../../CONTRIBUTING.md#L65)）。試験群が Node 22.12 以上を要求し、CI が同じ 3 点で回帰を防ぐためである（[CONTRIBUTING.md:25](../../CONTRIBUTING.md#L25)、[CONTRIBUTING.md:65](../../CONTRIBUTING.md#L65)）。変更者は Node 22.12 以上を用意し、英語の伝言で焦点の絞った要求を送る必要がある（[CONTRIBUTING.md:25](../../CONTRIBUTING.md#L25)、[CONTRIBUTING.md:59-60](../../CONTRIBUTING.md#L59-L60)）。 <!-- b_q1q9n1nt -->

- スレッドから記録した決定はまだありません。スレッドの結論を「決定として残す」と、ここに並びます。
<!-- b_fhy5ch0f -->
