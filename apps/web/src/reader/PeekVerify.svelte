<!--
  The cite peek's human check (EX-10), app only: having read the code, 「✓✓ 確かめた」 marks the cited paragraph's
  claims human-verified (again: withdraws it). Rendered in the peek's footer through its `extra` snippet, so the
  export viewer's script (60 KB gz) does not carry it.
-->
<script lang="ts">
import { t } from "../shell/index.ts";

let { verified, n, busy, onverify }: { verified: boolean; n: number; busy: boolean; onverify: (next: boolean) => void } = $props();
</script>

<button type="button" class="ver" class:on={verified} disabled={busy} title={t(verified ? "cite.unverifyHint" : "cite.verifyHint", { n })} onclick={() => onverify(!verified)}
  >&#x2713;&#x2713; {t(verified ? "cite.verified" : "cite.verify")}</button
>

<style>
  .ver {
    display: inline-flex;
    gap: 4px;
    align-items: center;
    min-height: 24px;
    color: var(--ink);
    font-size: var(--fs-meta);
    font-weight: var(--fw-strong);
  }
  .ver.on {
    color: var(--v-human);
  }
</style>
