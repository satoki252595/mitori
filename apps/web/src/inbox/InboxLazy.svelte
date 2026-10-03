<!-- `UiExtension.views.inbox`: the S4 chunk is fetched when the Inbox route renders. -->
<script lang="ts" module>
const load = () => import("./InboxPage.svelte");
</script>

<script lang="ts">
import Lazy from "../threads/Lazy.svelte";
</script>

<Lazy {load}>
  {#snippet fallback()}<main id="main" class="ib-skel" tabindex="-1" aria-busy="true"><div class="skel" style="width: 6em; height: 40px"></div></main>{/snippet}
</Lazy>

<style>
  .ib-skel {
    padding: 48px 56px;
  }
</style>
