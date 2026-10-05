<script lang="ts">
import { useStores } from "../stores/app.svelte.ts";
import { copyText } from "./clipboard.ts";
import { t } from "./index.ts";
import Rich from "./Rich.svelte";

const s = useStores();
const conn = $derived(s.session.connection);
</script>

<div class="stopped" role="alertdialog" aria-modal="true" aria-labelledby="stopped-t" data-chrome>
  <div class="card">
    <h2 id="stopped-t">{t("app.stopped")}</h2>
    <p>{conn.kind === "stopped" ? conn.reason : ""}</p>
    <p><Rich text={t("app.stoppedHint")} /></p>
    <button type="button" class="btn btn-sec" onclick={() => copyText("mitori", s, "copy.command")}>{t("banner.copyCommand")}</button>
  </div>
</div>
