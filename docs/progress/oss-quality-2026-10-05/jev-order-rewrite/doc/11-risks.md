# 11. リスクと負債 <!-- b_4stk4j5t -->

## テストの穴 <!-- b_27ghvjqn -->

- `jev_ultrafast/static` 配下のデモ UI は供給された証跡に対応する試験が見当たらない（推測）。
- `scripts` 配下の検証用脚本は供給された証跡に対応する試験が見当たらない（推測）。 <!-- b_1prprdwt -->

## ホットスポット <!-- b_01vdybkx -->

- `READ_STATE` は導入時に `snapshot.js` を読むため、`snapshot.js` の変更が導入直後から影響する（[browser.py:13-14](../../jev_ultrafast/browser.py#L13-L14)）。
- `fresh` と `act` は `page` を共有し、`StalePage` で頁ずれを知らせるため、頁照合の変更が両方に波及する（[browser.py:16-17](../../jev_ultrafast/browser.py#L16-L17)、[browser.py:88](../../jev_ultrafast/browser.py#L88)、[browser.py:100](../../jev_ultrafast/browser.py#L100)）。
- `command` は未開始などの状態を `ValueError` で拒むため、検証条件の変更が操作可否に直結する（[demo.py:44-45](../../jev_ultrafast/demo.py#L44-L45)、[demo.py:48-52](../../jev_ultrafast/demo.py#L48-L52)、[demo.py:64-65](../../jev_ultrafast/demo.py#L64-L65)）。
- `art` と `travel` と `results` は見た目に直結するため、変更がデモ表示に波及する（[fixture.html:388](../../jev_ultrafast/static/fixture.html#L388)、[fixture.html:391](../../jev_ultrafast/static/fixture.html#L391)、[fixture.html:413](../../jev_ultrafast/static/fixture.html#L413)）。
- `detail` と `article` は引数が呼び出し元と整合するため、引数の変更が呼び出しずれを起こす（[fixture.html:440](../../jev_ultrafast/static/fixture.html#L440)、[fixture.html:487](../../jev_ultrafast/static/fixture.html#L487)）。 <!-- b_ntwna1v5 -->

## 壊れやすい箇所 <!-- b_rs83j138 -->

> [!WARNING]
> **落とし穴**
> - `READ_STATE` の読み込みに失敗すると導入時点で影響が出るため、`snapshot.js` との整合確認が必要になる（[browser.py:13-14](../../jev_ultrafast/browser.py#L13-L14)）。
> - `page` がずれたまま `act` を進めると誤操作になるため、`StalePage` を受けた `fresh` での再取得の扱いが重要になる（[browser.py:16-17](../../jev_ultrafast/browser.py#L16-L17)、[browser.py:88](../../jev_ultrafast/browser.py#L88)、[browser.py:100](../../jev_ultrafast/browser.py#L100)）。
> - `verify` による合否判定と完了報告が食い違う場合の扱いを誤ると結果判定がずれる（[flights.py:18-19](../../examples/flights.py#L18-L19)）。
> - `snapshot` の保存を外すと失敗時の証跡が残らず、`SystemExit` の扱いを誤ると不通過の検出がずれる（[flights.py:53-56](../../examples/flights.py#L53-L56)、[flights.py:62-64](../../examples/flights.py#L62-L64)）。 <!-- b_4ts3z4rk -->

- （検出されませんでした）
<!-- b_6b7a1g1e -->

| モジュール | パス | 行数 |
|---|---|---|
| ブラウザ操作エージェント | `jev_ultrafast` | 769 |
| デモ UI 静的資源 | `jev_ultrafast/static` | 1622 |
| 検証用脚本集 | `scripts` | 550 |
<!-- b_p2895kf3 -->
