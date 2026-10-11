# 9. 非機能 <!-- b_ym7rwsm3 -->

## ホットパス <!-- b_tazqak7d -->

- `Agent` がブラウザ層とモデル層を呼び出す実行経路では、通信の往復と待機が時間を使うため、往復回数の削減を高速化の軸としている（[agent.py:7-9](../../jev_ultrafast/agent.py#L7-L9)、[design.md:5](../../docs/design.md#L5)）。
- ブラウザ層の `observe` には読取り専用の待機と可視性確認があり、観測の所要時間にはページの準備を待つ時間も含まれる（[browser.py:44-63](../../jev_ultrafast/browser.py#L44-L63)）。
- モデル層の通信は HTTP/2 対応の共通 `CLIENT` を使用する（[model.py:12](../../jev_ultrafast/model.py#L12)、[model.py:18](../../jev_ultrafast/model.py#L18)）。 <!-- b_qqg7ma4c -->

## キャッシュ <!-- b_062fpafr -->

モデルで生成した入力文面をエージェント側の `pending_text` に保持し、生成用コンテキストが一致するときはモデルへの再リクエストを省く（[agent.py:109-115](../../jev_ultrafast/agent.py#L109-L115)）。再利用の境界は入力全体が同一の停滞再試行であり、成功した変更操作を越えて文面を持ち越さない（[design.md:9](../../docs/design.md#L9)）。 <!-- b_rfcf3htd -->

## 上限値 <!-- b_e2rpv7w2 -->

- デモから `Agent` に渡す `goal` は、`reset` 時に前後の空白を除いた後で 1～2000 文字に制限される（[demo.py:44-61](../../jev_ultrafast/demo.py#L44-L61)）。
- HTTP 入力の上限は実行予算とは別であり、`do_POST` が受け付ける本文は 1 リクエストにつき 0 バイト超、8192 バイト未満である（[demo.py:114-116](../../jev_ultrafast/demo.py#L114-L116)）。
- POST のコマンド実行はサーバー全体の `LOCK` で直列化され、競合するリクエストには待機させず HTTP 409 を返す（[demo.py:111-118](../../jev_ultrafast/demo.py#L111-L118)、[demo.py:124-125](../../jev_ultrafast/demo.py#L124-L125)）。
- エージェントの操作予算は 1 実行につき 60 操作であり、`history` が上限に達した後に次の操作を進めようとすると、`status` を `blocked` にして例外を送出する（[agent.py:100-104](../../jev_ultrafast/agent.py#L100-L104)、[questions.py:26](../../jev_ultrafast/questions.py#L26)）。
- 決定要求の予算は操作予算と別に数え、1 実行につき 120 回（`MAX_STEPS` の 2 倍）に達した後の `predict` は例外となる（[agent.py:65-76](../../jev_ultrafast/agent.py#L65-L76)、[questions.py:26](../../jev_ultrafast/questions.py#L26)）。
- ブラウザの `observe` 内での取得し直しは、1 呼出しにつき最大 10 回、間隔 0.02 秒に制限される（[browser.py:77-85](../../jev_ultrafast/browser.py#L77-L85)）。
- DOM 観測の `text` は 1 観測につき 6000 文字までであり、`actions` は通常候補を 250 件まで残してから、必要なスクロール候補と `wait` を追加するため、250 件は最終候補数の上限ではない（[snapshot.js:82-92](../../jev_ultrafast/snapshot.js#L82-L92)、[snapshot.js:99-104](../../jev_ultrafast/snapshot.js#L99-L104)）。 <!-- b_yxhdrj1m -->

## セキュリティ境界 <!-- b_s6jjct8r -->

- デモサーバーの既定の待受け境界は loopback であり、`main` は `127.0.0.1` にバインドする（[demo.py:131-134](../../jev_ultrafast/demo.py#L131-L134)）。
- ブラウザ操作を受け付ける `do_POST` では、`Host` と `X-Demo-Token` の一致が必須であり、`Origin` は欠落時には通過し、存在する場合だけ `ORIGIN` との一致を要求する（[demo.py:104-110](../../jev_ultrafast/demo.py#L104-L110)）。
- 読取り側の `do_GET` は `Host` を検査するがトークン認証は行わず、静的ファイルの `__TOKEN__` を `TOKEN` に置換して返す（[demo.py:81-102](../../jev_ultrafast/demo.py#L81-L102)）。
- デモからモデル通信へ渡る認証情報はサーバー側に置かれ、モデル層は `TYPESAFE_API_KEY` と `TEXT_MODEL_API_KEY` を環境変数から取得する（[design.md:31](../../docs/design.md#L31)、[model.py:119](../../jev_ultrafast/model.py#L119)、[model.py:161](../../jev_ultrafast/model.py#L161)）。
- 起動時の `load_environment` はカレントディレクトリの `.env` を読み、`os.environ.setdefault` によって既存の環境変数を上書きせず値を補う（[demo.py:23-29](../../jev_ultrafast/demo.py#L23-L29)）。 <!-- b_54ymq7g7 -->

## 信頼性 <!-- b_7c331kbw -->

- ブラウザ変更の失敗を再送で処理しないのは、中断時点で変更イベントが既に発火している可能性があるためであり、実行完了の記録も次の観測より先に行う（[design.md:19](../../docs/design.md#L19)）。
- ブラウザ層からの `StalePage` はエージェントの `tick` で回復対象となり、`decision` を破棄して `status` を `ready` に戻し、ページを再観測した状態を返す（[agent.py:52-64](../../jev_ultrafast/agent.py#L52-L64)）。
- デモの HTTP 境界では、`do_POST` が `ValueError`、`RuntimeError`、`TimeoutError` を HTTP 400 に変換し、それ以外の例外は HTTP 500 として、自動再試行せずリセットで回復する旨を返す（[demo.py:120-125](../../jev_ultrafast/demo.py#L120-L125)）。
- `Agent` の初回観測で例外が起きた場合は、作成済みの `Browser` を閉じてから例外を再送出する（[agent.py:12-26](../../jev_ultrafast/agent.py#L12-L26)）。 <!-- b_wckfphrd -->

## 可観測性 <!-- b_0mf0h7yy -->

- エージェントからデモへ公開する状態は `snapshot` を経由し、内部の `browser` を除外して操作候補の `elements` を加えた後、`response_state` が `text_model` と `max_steps` を追加する（[agent.py:46-50](../../jev_ultrafast/agent.py#L46-L50)、[demo.py:32-34](../../jev_ultrafast/demo.py#L32-L34)）。
- デモの `reset` はスクリーンショットを有効にして `Agent` を作り、`record` が真なら記録先の `record_dir` をカレントディレクトリ配下の `artifacts/frames` に指定する（[demo.py:44-61](../../jev_ultrafast/demo.py#L44-L61)）。
- 古いページからの回復時には、`elapsed_ms` を開始時刻からの経過ミリ秒として更新し、`snapshot` で返す（[agent.py:59-64](../../jev_ultrafast/agent.py#L59-L64)）。
- デモサーバーは起動時に `ORIGIN` を標準出力へ表示する（[demo.py:135](../../jev_ultrafast/demo.py#L135)）。 <!-- b_pzvvjk4d -->
