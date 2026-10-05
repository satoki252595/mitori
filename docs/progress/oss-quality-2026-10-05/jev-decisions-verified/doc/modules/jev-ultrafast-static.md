# デモ UI 静的資源（jev_ultrafast/static） <!-- b_r6hbfmd8 -->

- ファイル 4 · 1622 行 · 重要度 0.32
<!-- b_phz2tgry -->

**変更の手引き**
- テスト: 見つかりませんでした
- 入口から: `jev_ultrafast/static/app.js`（`jev_ultrafast/static/index.html:142`）
- 一緒に変わりやすいファイル（直近 3 commit）: なし
- 注意: テストが無い
<!-- b_7vsczhpt -->

> [!NOTE]
> **この章で分かること**
> - デモ UI が担う役割と静的ファイルの構成要素
> - 主要な関数と状態取得の仕組み
> - フィクスチャ画面が果たす役割 <!-- b_42de2qwd -->

## 責務 <!-- b_vj2ctmnq -->

デモ画面の表示と操作を担い、静的ファイルとして配信される（[index.html:142](../../../jev_ultrafast/static/index.html#L142)）。`/api/state` から状態を取って画面に反映する（[app.js:56](../../../jev_ultrafast/static/app.js#L56)、[app.js:236](../../../jev_ultrafast/static/app.js#L236)）。目標の選択やブラウザ操作の判断は含まず、サーバ側の処理に任せる（推測）。 <!-- b_7ghmb0cn -->

## 公開インターフェース <!-- b_nd3kc9nj -->

- `$` は ID から DOM 要素を返す（[app.js:1](../../../jev_ultrafast/static/app.js#L1)）。
- `token` はデモ用トークンを `meta` から読む（[app.js:2](../../../jev_ultrafast/static/app.js#L2)）。
- `goals` は既定の目標一覧を保持する（[app.js:6](../../../jev_ultrafast/static/app.js#L6)）。
- `escape` は値を表示用に整える（[app.js:12](../../../jev_ultrafast/static/app.js#L12)）。
- `percent` は数値をパーセント文字列に整える（[app.js:20](../../../jev_ultrafast/static/app.js#L20)）。
- `call` は名前と本体で API 呼び出しを行う（[app.js:21](../../../jev_ultrafast/static/app.js#L21)、[app.js:22](../../../jev_ultrafast/static/app.js#L22)）。
- `perform` は受け取った処理を実行する（[app.js:45](../../../jev_ultrafast/static/app.js#L45)）。
- `render` は画面表示を更新する（[app.js:69](../../../jev_ultrafast/static/app.js#L69)）。 <!-- b_n1x85jn6 -->

## 依存関係 <!-- b_7a50tt4r -->

`jev_ultrafast` のデモサーバを利用する（推測）。Python パッケージへの依存はない（推測）。 <!-- b_0nyees8v -->

## 落とし穴 <!-- b_8812bktt -->

> [!WARNING]
> **落とし穴**
> - `art` と `travel` と `results` を変えるとデモの見た目が変わる（[fixture.html:388](../../../jev_ultrafast/static/fixture.html#L388)、[fixture.html:391](../../../jev_ultrafast/static/fixture.html#L391)、[fixture.html:413](../../../jev_ultrafast/static/fixture.html#L413)）。
> - `detail` と `article` の引数を変えると呼び出し元とずれる（[fixture.html:440](../../../jev_ultrafast/static/fixture.html#L440)、[fixture.html:487](../../../jev_ultrafast/static/fixture.html#L487)）。
> - `style.css` の変更は全画面に及ぶ（推測）。 <!-- b_bztr3r9x -->

## 深掘り <!-- b_7xw9fecs -->

> [!NOTE]
> **深掘り**
> `controls` が作る操作要素の一覧と配置 <!-- b_t1469mgx -->

> [!NOTE]
> **深掘り**
> `research` が担う画面の役割と遷移先 <!-- b_5tk7kj15 -->

> [!TIP]
> **まとめ**
> デモ画面とフィクスチャをまとめた静的資源である。サーバの状態を映す表示層に徹する。 <!-- b_ff5zchy3 -->
