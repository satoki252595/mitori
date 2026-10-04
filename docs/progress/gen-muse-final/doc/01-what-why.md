# 1. これは何か・誰のためか・なぜあるか <!-- b_wng133et -->

## 解決する課題 <!-- b_zwaegpcy -->

Agent にとって plan も code も text であるが、人間にとって生成 plan の review と web application の review は別種の作業である（[README.md:14](../../README.md#L14)）。出力種別ごとに適した interface がないと、誤りの箇所を正確に指し示して agent に修正を依頼できない（[README.md:16](../../README.md#L16)）。 <!-- b_z7p8wtvv -->

## 利用者 <!-- b_3ajq5zbn -->

- AI coding tool と協働する developer が、生成された plan を人間向け UI で review するために使う（[README.md:3](../../integrations/README.md#L3)）。
- git 変更の diff を syntax-highlighted 表示で local review する developer が使う（[README.md:19](../../README.md#L19)）。
- 起動中 web app や static HTML 成果物を proxy 表示で review し、frontend 要素へ指摘する developer が使う（[README.md:20-21](../../README.md#L20-L21)）。
- 試す際は `brew install crit` で導入し、`crit plan.md` を実行して開いた画面で指摘操作を試す（[README.md:28-31](../../README.md#L28-L31)、[README.md:18](../../README.md#L18)）。 <!-- b_xftzyyp5 -->

## 範囲 <!-- b_8jkvsskv -->

- markdown 形式の plan を整形表示し、指摘用の review UI を添える（[README.md:18](../../README.md#L18)）。
- git 変更を auto-detect して syntax-highlighted diff で local review する（[README.md:19](../../README.md#L19)）。
- 起動中 app の proxy 表示と static HTML の rendering で frontend 成果物を review する（[README.md:20-21](../../README.md#L20-L21)）。
- `crit pull` と `crit push` で forge 上の変更要求と review 状態を往復する（[README.md:3](../../test/roundtrip/README.md#L3)）。
- 認証機構を持たず、HTTP server を loopback のみに bind して公開範囲を絞る（[README.md:9](../../integrations/docker/README.md#L9)）。 <!-- b_sbhjf4cm -->

## 制約 <!-- b_6nt3r8v5 -->

- Brew と Go と Nix と Windows 経由で導入し、local の単一 binary として動作する（[README.md:28-40](../../README.md#L28-L40)、[README.md:23](../../README.md#L23)）。
- HTTP 受け口は認証なしで `127.0.0.1` のみに bind し、外部公開時は loopback 公開に絞る（[README.md:9-11](../../integrations/docker/README.md#L9-L11)、[README.md:13-16](../../integrations/docker/README.md#L13-L16)）。
- 変更要求の往復は GitHub と GitLab を対象とし、`gh` と `glab` を介した roundtrip harness で検証する（[README.md:5-8](../../test/roundtrip/README.md#L5-L8)）。
- review UI は browser で開く構成であり、CLI と server が同一 host 上で連携する（[README.md:5](../../integrations/docker/README.md#L5)、[README.md:23](../../integrations/docker/README.md#L23)）。 <!-- b_yj6y94fy -->
