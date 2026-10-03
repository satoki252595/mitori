<!--
  At most one banner below the header (ux.md §3.7): auth_expired > version_mismatch > retrying > billing_overage >
  yield_5h (stopped is the full overlay). It overlays the content (fixed) so it never shifts the layout.
-->
<script lang="ts">
import { useStores } from "../stores/app.svelte.ts";
import { copyText } from "./clipboard.ts";
import { fmtHm } from "./fmt.ts";
import { t } from "./index.ts";
import Rich from "./Rich.svelte";

const s = useStores();
const conn = $derived(s.session.connection);
const run = $derived(s.gen.run);
const billingOverage = $derived(s.session.window?.billing === "overage");

const which = $derived.by(() => {
  if (conn.kind === "auth_expired") return "auth" as const;
  if (conn.kind === "version_mismatch") return "version" as const;
  if (conn.kind === "retrying") return "retrying" as const;
  if (billingOverage) return "overage" as const;
  if (run?.state === "paused" && run.paused?.reason === "yield_5h") return "yield" as const;
  return null;
});
</script>

{#if which}
  <div class="banner" class:bad={which === "auth"} role={which === "retrying" || which === "auth" ? "alert" : "status"} data-chrome>
    {#if which === "auth"}
      <span><Rich text={t("banner.authExpired")} /></span>
      <button type="button" class="btn btn-sec" onclick={() => copyText("mitori", s, "copy.command")}>{t("banner.copyCommand")}</button>
    {:else if which === "version" && conn.kind === "version_mismatch"}
      <span>{t("banner.version", { web: conn.web, daemon: conn.daemon })}</span>
      <button type="button" class="btn btn-sec" onclick={() => location.reload()}>{t("banner.reload")}</button>
    {:else if which === "retrying" && conn.kind === "retrying"}
      <span>{t("banner.retrying", { s: Math.max(1, Math.round(conn.nextInMs / 1000)) })}</span>
    {:else if which === "overage"}
      <span>{t("banner.overage")}</span>
    {:else if which === "yield" && run}
      <span>{t("banner.yield", { at: run.paused?.until ? fmtHm(run.paused.until) : "–" })}</span>
      <button type="button" class="btn btn-sec" onclick={() => s.gen.control("resume")}>{t("banner.resume")}</button>
    {/if}
  </div>
{/if}
