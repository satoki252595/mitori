# Session の同 phase 依存と cache 再利用（2026-10-05）

whole unit の gen 失敗2単位を最新の凍結 source で再実行した。renderer の「entry branches and synchronization versus cleanup」は成功。whole run の既存 module cache が先頭1文だけの古い `summary()` を保持していたため、途中更新後の新しい proof と混在した失敗だった。期待は変更していない。

AC-45 の「every task is reused from the cache」は再現した。初回 prep は同じ phase3 の flow と questions を同時に render し、questions の CLAIMS に flow の claim が無かった。ingest 後の二回目は他の11 tasks を cache replay した時点で flow の claim が入り、questions の cache key だけが変わって新 packet を返していた。planner が既に持つ questions → flow 等の hard deps を session の phase 単位の準備が無視したのが根因であり、cache の無効化や key の変更では解消しない。

修正は session の2箇所。prep は hard deps が terminal になるまで render / replay / packet 作成を待つ。packet の全出力を ingest した後、同 phase に pending task があれば既存の `next` / `continueFrom` で次 packet へ進む。prompt・cache key・依存グラフ・予算・fingerprint / drift / symlink / human lock の契約は変えていない。Push 実行は変更していない。

既存 AC-45 回帰を最後の packet まで進め、初回 questions の CLAIMS に flow の claim が存在することを確認した。再実行は packet を返さず `E_PRECONDITION` となり、二回目の12 tasks は全て cached。固定 fake clock で2 runs の時刻が同じため、テスト末尾の ID 辞書順を実行順とみなす仮定も除き、初回 ID と異なる run を検査する。sleep や時計の操作、期待の弱化は追加していない。

検証は `scripts/nd` 経由で session 全体 **14 pass / 93 assertions**、renderer の対象 proof と両 lock **3 pass / 21 assertions**、gen `tsc --noEmit`、所有2 source files の Biome、diff check が成功。source と既存 locks を freeze した。追加 LLM・upstream 実行・全体検査・Linux cold は行っていない。
