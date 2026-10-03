<!--
  Trust dialog (contract `TrustDialogProps`, ux.md §4.12 R1): opened from the 「確認する」 toast, a job card's
  「内容を見て承認」 or Inbox — never by itself (a `trust.request` only adds the Inbox row and the toast). [拒否] [承認する];
  the decision is `POST /ws/:ws/trust/:tr` (web-only route).
-->
<script lang="ts">
import { onMount } from "svelte";
import type { TrustDialogProps } from "../contract.ts";
import { t } from "../shell/index.ts";
import { useStores } from "../stores/app.svelte.ts";
import TrustBody from "./TrustBody.svelte";

let { request, ondecide, onclose }: TrustDialogProps & { onclose: () => void } = $props();
const s = useStores();
let dlg: HTMLDialogElement | undefined = $state();
let busy = $state(false);

onMount(() => {
  dlg?.showModal();
  s.layers.open("dialog", "trust", onclose);
  return () => s.layers.drop("trust");
});

function decide(d: "trusted" | "denied") {
  if (busy) return;
  busy = true;
  ondecide(d);
}
</script>

<dialog bind:this={dlg} class="tr" aria-labelledby="tr-t" onclose={() => s.layers.drop("trust")} data-chrome>
  <h2 id="tr-t">{t("trust.title")}</h2>
  <TrustBody {request} focusPreview />
  <footer>
    <button type="button" class="btn btn-sec" disabled={busy} onclick={() => decide("denied")}>{t("trust.deny")}</button>
    <button type="button" class="btn btn-pri" disabled={busy} onclick={() => decide("trusted")}>{t("trust.approve")}</button>
  </footer>
</dialog>

<style>
  .tr {
    width: min(560px, calc(100% - 32px));
    padding: 20px 22px 18px;
    border: 1px solid var(--rule);
    border-radius: var(--r-dialog);
    background: var(--sheet);
    color: var(--text);
    box-shadow: var(--shadow-pop);
  }
  .tr::backdrop {
    background: var(--scrim);
  }
  h2 {
    margin: 0 0 12px;
    font-family: var(--font-serif);
    font-size: var(--fs-title);
    font-weight: var(--fw-strong);
    color: var(--ink);
  }
  footer {
    display: flex;
    justify-content: flex-end;
    gap: 8px;
    margin-top: 18px;
  }
</style>
