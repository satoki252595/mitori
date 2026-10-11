# 9. 非機能 <!-- b_ym7rwsm3 -->

## ホットパス <!-- b_tazqak7d -->

- ブラウザー層とモデル層を結ぶ実行経路では、往復通信と待機が時間を消費するため、往復回数の削減を高速化の中心に置く（[design.md:5](../../docs/design.md#L5)）。
- ブラウザー側の `observe` には、読取り専用の待機と可視性確認が含まれる（[browser.py:44-63](../../jev_ultrafast/browser.py#L44-L63)）。
- モデル側では、共通の `CLIENT` を HTTP/2 対応にして通信に使用する（[model.py:12](../../jev_ultrafast/model.py#L12)、[model.py:18](../../jev_ultrafast/model.py#L18)）。 <!-- b_qqg7ma4c -->

## キャッシュ <!-- b_062fpafr -->

モデル層で生成した入力文をエージェント層の `pending_text` に保持することで、生成用コンテキストが同じ場合の再生成を省く（[agent.py:109-115](../../jev_ultrafast/agent.py#L109-L115)）。この再利用は入力全体が一致する停滞再試行に限定され、成功した変更操作の後には保持した文面を破棄する（[design.md:9](../../docs/design.md#L9)）。 <!-- b_rfcf3htd -->

## 上限値 <!-- b_e2rpv7w2 -->

- デモの `reset` は、前後の空白を除いた `goal` を 1～2000 文字に制限し、`scenario` を `travel`、`research`、`flights` の 3 種に限定する（[demo.py:46-52](../../jev_ultrafast/demo.py#L46-L52)）。
- `do_POST` が受け付ける本文は、1 リクエストにつき 0 バイト超、8192 バイト未満である（[demo.py:114-116](../../jev_ultrafast/demo.py#L114-L116)）。
- POST のコマンド実行はサーバー全体の `LOCK` で直列化され、実行中のリクエストと競合すると待たずに HTTP 409 を返す（[demo.py:111-118](../../jev_ultrafast/demo.py#L111-L118)、[demo.py:124-125](../../jev_ultrafast/demo.py#L124-L125)）。
- エージェントの操作予算は 1 実行につき 60 操作であり、`history` が上限に達した状態で次の操作を進めようとすると、`status` を `blocked` にして例外を送出する（[agent.py:100-104](../../jev_ultrafast/agent.py#L100-L104)、[questions.py:26](../../jev_ultrafast/questions.py#L26)）。
- 決定要求は 1 実行につき `MAX_STEPS` の 2 倍、すなわち 120 回を上限とし、上限到達後の `predict` は例外となる（[agent.py:65-76](../../jev_ultrafast/agent.py#L65-L76)、[questions.py:26](../../jev_ultrafast/questions.py#L26)）。
- ブラウザーの `observe` は、1 呼出し内での取得し直しを最大 10 回、間隔を 0.02 秒に制限する（[browser.py:77-85](../../jev_ultrafast/browser.py#L77-L85)）。
- 観測結果の表示テキストは 6000 文字に切り詰められ、通常の操作候補は 250 件まで残した後にスクロール候補と `wait` を追加する（[snapshot.js:82-92](../../jev_ultrafast/snapshot.js#L82-L92)、[snapshot.js:99-104](../../jev_ultrafast/snapshot.js#L99-L104)）。 <!-- b_yxhdrj1m -->

## セキュリティ境界 <!-- b_s6jjct8r -->

- デモサーバーの既定の待受けアドレスは `127.0.0.1` である（[demo.py:134](../../jev_ultrafast/demo.py#L134)）。
- `do_POST` のトークン検査は任意ではなく、`Host` と `X-Demo-Token` の一致を必須とする一方、`Origin` は欠落時に検査を通過し、存在する場合だけ `ORIGIN` との一致を要求する（[demo.py:104-110](../../jev_ultrafast/demo.py#L104-L110)）。
- GET 側の境界は POST 側と異なり、`do_GET` は `Host` を検査するが、トークン検査は行わない（[demo.py:81-102](../../jev_ultrafast/demo.py#L81-L102)）。
- モデル通信の認証情報はサーバー側に置き、`TYPESAFE_API_KEY` と `TEXT_MODEL_API_KEY` を環境変数から読む（[design.md:31](../../docs/design.md#L31)、[model.py:119](../../jev_ultrafast/model.py#L119)、[model.py:161](../../jev_ultrafast/model.py#L161)）。
- デモ起動時の `load_environment` は作業ディレクトリの `.env` を読み込むが、`os.environ.setdefault` により既存の環境変数を上書きしない（[demo.py:23-29](../../jev_ultrafast/demo.py#L23-L29)）。 <!-- b_54ymq7g7 -->

## 信頼性 <!-- b_7c331kbw -->

- ブラウザー変更では、中断時点で変更イベントが発火済みの場合があるため、変更操作を再試行せず、実行完了を次の観測より先に記録する（[design.md:19](../../docs/design.md#L19)）。
- エージェントの `tick` は `StalePage` を受けると決定を破棄し、`status` を `ready` に戻してページを再観測することで、古い決定の実行から回復する（[agent.py:52-64](../../jev_ultrafast/agent.py#L52-L64)）。
- デモの `do_POST` は `ValueError`、`RuntimeError`、`TimeoutError` を HTTP 400 として返し、それ以外の例外では HTTP 500 とともに自動再試行をせずリセットで回復する旨を返す（[demo.py:120-125](../../jev_ultrafast/demo.py#L120-L125)）。
- 初回観測の失敗時にはブラウザーを閉じて例外を再送出し、デモの `close_browser` も既存の `AGENT` を閉じた後に参照を破棄する（[agent.py:22-26](../../jev_ultrafast/agent.py#L22-L26)、[demo.py:37-41](../../jev_ultrafast/demo.py#L37-L41)）。 <!-- b_wckfphrd -->

## 可観測性 <!-- b_0mf0h7yy -->

- エージェントの `snapshot` は内部状態から `browser` を除外し、観測した操作候補を `action_space` で整理した `elements` を公開する（[agent.py:46-50](../../jev_ultrafast/agent.py#L46-L50)）。
- デモの `response_state` はそのスナップショットに `text_model` と `max_steps` を加え、未開始時にはページなしの `idle` 状態を返す（[demo.py:32-34](../../jev_ultrafast/demo.py#L32-L34)）。
- `tick` が古いページから回復した経路では、開始時刻からの経過時間をミリ秒単位の `elapsed_ms` に更新する（[agent.py:57-62](../../jev_ultrafast/agent.py#L57-L62)）。
- デモの `reset` はスクリーンショットを有効にし、`record` が真の場合だけ、作業ディレクトリ配下の `artifacts` と `frames` を記録先の `record_dir` に指定する（[demo.py:44-62](../../jev_ultrafast/demo.py#L44-L62)）。
- 起動時の `main` は、接続先の `ORIGIN` を標準出力に表示する（[demo.py:131-135](../../jev_ultrafast/demo.py#L131-L135)）。 <!-- b_pzvvjk4d -->
