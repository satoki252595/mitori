# Security Policy

## 報告の宛先

脆弱性を見つけたら、公開の Issue には書かず、GitHub の非公開の脆弱性報告
（リポジトリの Security タブ → "Report a vulnerability"）で送る。
再現手順・影響の範囲・確認した版（`mitori --version` の `0.0.0+<build>`）を書く。

## 対応範囲

mitori は手元の clone を読むローカルツールである。報告は次の設計を前提に判断し、これを破る不具合は優先して直す。

- 対象リポジトリの中では、信頼できない文書・hook・ツールを実行しない設計である。
- AI の変更は人が確認して初めて適用される（未コミット・Undo 可）。自動で対象へは書かない。
- API キーは環境変数から読み、mitori の設定ファイルや Git には保存しない。各 AI ツールの認証は、そのツール自身の保管先を使う。

## 公開情報

ライセンスは MIT（ルートの [LICENSE](LICENSE)）。同梱する依存は
[THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md) を読む。
