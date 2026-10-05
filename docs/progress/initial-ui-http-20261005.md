# 初期UIのHTTP境界（2026-10-05）

60KiBの初期JS目標のため、信頼済みSvelte rendererをserverで実行し、既存のredacted GET DTOから初期HTMLとsnapshotを作る経路を追加した。rendererとnative controllerの統合・実served JS計測はUIトラックで確認中。この資料はHTTP境界の確認であり、JS予算や画面互換性の達成を主張しない。

`GET /api/v1/ws/:ws/ui` は既存pipelineを通り、Host / bearerまたはsession / CSRF / workspace存在を先に検証する。APIのCSP・no-store・request ID・CORS無しを保持する。rendererが無いdaemonは501。渡せる画面URLは同じworkspaceのMap/Docだけ。

request-scoped GET providerは、固定のsettings / daemon / usage summary / enginesと同じworkspaceのstatus / outline / section / map / threads / jobs / inboxだけを許す。別workspace、任意file、POST、SSE、再帰UI、外部URLを拒否する。認証を偽造せず元requestの資格情報で既存route adapterを呼び、sectionのsecret redactionを再利用する。内部JSON読取ではgzip/br・conditional/rangeヘッダーを外す。inline script、ブラウザーからの任意HTML、evalは追加していない。

未生成Mapの既存見積りカードを維持するため、第3引数として同じworkspaceの `POST /gen/estimate {effort,engine}` だけを呼べるdry専用callbackを加えた。GET providerをPOSTへ広げず、scope / concurrency / confirm / startは受け取らない。元requestの資格情報・POSTのCSRFとJSON body検査を通し、既存estimate adapterへ渡す。外側GETのidempotency key、圧縮、conditional、body lengthヘッダーは内部POSTへ引き継がない。元UIと同様、見積りだけでLLMを起動しない。

```sh
scripts/nd bun test packages/server/src/http/initial-ui.int.test.ts packages/server/src/http/app.int.test.ts packages/server/src/routes/match.test.ts
```

初回は既存HTTP / route testsと新規1件が23pass、新規の大URL試験はBunのtransportが先に431を返して期待413と不一致になった。試験をappの実fetch guardへ直接渡す形に直し、新規2件を限定再実行して **2pass / 29assertions**。大URLを通すために制限を緩めた変更ではない。既存HTTP / routeの成功も含め24件を対象に確認した。対象Biome成功。最終全体checkと実画面の検証は統合後に別記する。

dry callback追加後は既存2件がpass、新規1件のCSRF期待値を500から実pipelineの403へ直し、その失敗単位だけ再実行して **1pass / 7assertions**。same-site GETが許可されても内部POSTは拒否され、estimate adapterの呼出しは増えない。認証無しではcallback未実行、成功時も固定route/bodyと元web clientだけ、gen/start未呼出しを確認した。

初期UIのJSONも、既存の大きなsectionと同じ8KiB閾値・`negotiate`・async zlib（br quality4 / gzip）で圧縮する。`q=0`はidentityを維持し、no-store / auth / request IDを変更しない。全4件を限定実行して **4pass / 48assertions**。br、gzip、両方q=0の実HTTP応答を復号し、canonical DTOとの一致を確認した。初期転送量の最終計測はshipping binaryで別記する。

最終real UXでcold Readerのpending proposal表示が欠けることを確認した。既存のredacted `GET /ws/:ws/doc/proposals` を固定allowlistへ追加し、採用/拒否POSTは追加していない。同wsの読取成功、元web資格情報、別wsと採用routeの読取拒否、拒否時のadapter未呼出しを既存境界testへ追加した。対象全4件 **4pass / 54assertions**。SSR表示/操作引渡しの検証はUI報告に別記する。
