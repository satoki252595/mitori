<!--
  Toast stack (BottomStack, ux.md §3.5): above the status bar, newest at the bottom, ≤ 3. Lifetimes pause while
  the pointer or focus is inside (WCAG 2.2.1). Text comes from the catalog (`toast.*`, `notice.*`).
-->
<script lang="ts">
import { useStores } from "../stores/app.svelte.ts";
import { t } from "./index.ts";
import Rich from "./Rich.svelte";

const s = useStores();
const bottom = $derived(s.bottom.bottomOf("toasts"));
let el: HTMLDivElement | undefined = $state();

$effect(() => {
  if (!el) return;
  const ro = new ResizeObserver(() => s.bottom.set("toasts", "toast", el?.offsetHeight ?? 0));
  ro.observe(el);
  return () => {
    ro.disconnect();
    s.bottom.remove("toasts");
  };
});
</script>

<div class="toasts" bind:this={el} style:bottom="{bottom}px" data-chrome>
  {#each s.bottom.toasts as tt (tt.id)}
    <div
      class="toast"
      role={tt.live === "assertive" ? "alert" : "status"}
      onpointerenter={() => s.bottom.pause(tt.id)}
      onpointerleave={() => s.bottom.resume(tt.id)}
      onfocusin={() => s.bottom.pause(tt.id)}
      onfocusout={() => s.bottom.resume(tt.id)}
    >
      <span class="msg"><Rich text={t(tt.key, tt.params)} /></span>
      {#if tt.action}
        <button type="button" onclick={() => tt.action?.run()}>{t(tt.action.key)}{#if tt.action.kbd}<kbd>{s.keys.label(tt.action.kbd)}</kbd>{/if}</button>
      {/if}
      {#if tt.kind === "error" || tt.kind === "warn"}
        <button type="button" aria-label={t("toast.close")} onclick={() => s.bottom.dismiss(tt.id)}>&times;</button>
      {/if}
      {#if tt.kind === "undo"}<span class="cd" aria-hidden="true"></span>{/if}
    </div>
  {/each}
</div>
