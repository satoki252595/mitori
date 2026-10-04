<!--
  Toast stack (BottomStack, ux.md §3.5): above the status bar, newest at the bottom, ≤ 3. Lifetimes pause while
  the pointer or focus is inside (WCAG 2.2.1). Text comes from the catalog (`toast.*`, `notice.*`).
  EX-11: a toast never covers the context column (the Composer's 送信, the Review panel's 採用 / 却下 footer, the
  map's card column): the stack sits at the right edge of the page's main area (tokens: width.ts toastRight).
-->
<script lang="ts">
import { currentLayout, layoutView, useStores } from "../stores/app.svelte.ts";
import { t } from "./index.ts";
import Rich from "./Rich.svelte";
import { toastRight } from "./width.ts";

const s = useStores();
const bottom = $derived(s.bottom.bottomOf("toasts"));
const right = $derived(toastRight(currentLayout(s), layoutView(s.router.route)));
let el: HTMLDivElement | undefined = $state();

// the lifetime stops while the pointer OR the focus is inside, and runs again only when both have left (WCAG 2.2.1)
const holders = new Map<string, Set<"pointer" | "focus">>();
function hold(id: string, by: "pointer" | "focus", on: boolean) {
  const set = holders.get(id) ?? new Set();
  holders.set(id, set);
  if (on) {
    if (set.size === 0) s.bottom.pause(id);
    set.add(by);
  } else if (set.delete(by) && set.size === 0) s.bottom.resume(id);
}

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

<div class="toasts" bind:this={el} style:bottom="{bottom}px" style:right="{right}px" data-chrome>
  {#each s.bottom.toasts as tt (tt.id)}
    <div
      class="toast"
      role={tt.live === "assertive" ? "alert" : "status"}
      onpointerenter={() => hold(tt.id, "pointer", true)}
      onpointerleave={() => hold(tt.id, "pointer", false)}
      onfocusin={() => hold(tt.id, "focus", true)}
      onfocusout={(e) => !(e.currentTarget as HTMLElement).contains(e.relatedTarget as Node | null) && hold(tt.id, "focus", false)}
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
