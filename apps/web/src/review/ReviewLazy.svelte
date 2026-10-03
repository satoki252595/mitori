<!-- `UiExtension.reviewPanel`: the Review panel chunk is fetched when S5 opens (never at boot). -->
<script lang="ts" module>
const load = () => import("./ReviewPanel.svelte");
</script>

<script lang="ts">
import type { JobId } from "@mitori/core";
import Lazy from "../threads/Lazy.svelte";

let { job }: { job: JobId } = $props();
</script>

<Lazy {load} props={{ job }}>
  {#snippet fallback()}<div class="skel rv-skel" aria-busy="true"></div>{/snippet}
</Lazy>

<style>
  .rv-skel {
    height: 160px;
    margin: 24px 28px;
  }
</style>
