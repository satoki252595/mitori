<!--
  Puts pending doc proposals IN the prose (ux.md §6.5): for every block of the page with a pending proposal, a
  `[data-mx]` host is added inside the block's server body `.mb` (HTML_CONTRACT: client chrome inside `.mb` carries
  `data-mx`, which ANCHOR_TEXT_RULES skip) and the original text is hidden by CSS while the suggestion shows.
  A block re-render drops the host; a MutationObserver puts it back. Job proposals feed the Review decisions (one
  accept call for the whole job); the others are accepted / rejected directly. An INSERT (a promoted answer, an
  agent's new paragraph) shows right after the block it follows, without hiding anything.
  CR-PENDING(WP-10b): a `UiExtension.block` slot rendered by BlockHost would replace this injection
  (docs/design/cr-requests/WP-10b.md "block decoration slot").
-->
<script lang="ts">
import type { BlockId, DocProposalView, JobSummary, ProposalId } from "@mitori/core";
import { MitoriError } from "@mitori/core";
import { mount, onMount, unmount } from "svelte";
import { errorText, t } from "../shell/index.ts";
import { useStores } from "../stores/app.svelte.ts";
import { loopOf } from "../threads/loop.svelte.ts";
import ProposalBlock from "./ProposalBlock.svelte";

const s = useStores();
const loop = loopOf(s);
let tick = $state(0);

interface Live {
  host: HTMLElement;
  inst: Record<string, unknown>;
  props: { proposal: DocProposalView; producer: string; decided: "accept" | "reject" | null; ondecide: (d: "accept" | "reject") => void };
}
const live = new Map<ProposalId, Live>();

function jobOf(p: DocProposalView): JobSummary | null {
  return p.source.kind === "job" ? (s.review.jobs.get(p.source.id as `j_${string}`) ?? null) : null;
}

function producer(p: DocProposalView): string {
  const j = jobOf(p);
  const th = j?.threads[0] ? s.review.threads.get(j.threads[0]) : undefined;
  const kind = t(`proposals.kind.${p.op === "insert" ? "insert" : "body"}`);
  if (j) return t("proposals.producer", { model: j.route.model, n: th?.round ?? 1, kind });
  return t(`proposals.source.${p.source.kind}`, { kind });
}

async function decide(p: DocProposalView, d: "accept" | "reject") {
  const j = jobOf(p);
  if (j && (j.state === "ready" || j.state === "partially_accepted")) {
    const dec = s.review.decisions(j.id);
    if (dec.proposals.get(p.id) === d) dec.proposals.delete(p.id);
    else dec.proposals.set(p.id, d);
    loop.decisionTick++;
    return;
  }
  const ws = s.workspace.key;
  if (!ws) return;
  try {
    if (d === "accept") {
      const b = await s.api.call("POST /ws/:ws/doc/proposals/:pp/accept", { params: { ws, pp: p.id }, body: {} });
      s.doc.upsertBlock(b);
      loop.flash([b.id]);
    } else await s.api.call("POST /ws/:ws/doc/proposals/:pp/reject", { params: { ws, pp: p.id } });
    s.doc.removeProposal(p.id);
  } catch (err) {
    s.bottom.toast({ id: "loop.proposal", kind: "error", key: "review.toast.failed", params: { error: errorText(MitoriError.from(err).toData()) } });
  }
}

/** Pending proposals of the blocks on screen: updates / deletes on their block, inserts after the block they follow. */
const wanted = $derived.by(() => {
  void tick;
  const out = new Map<ProposalId, { p: DocProposalView; block: BlockId }>();
  if (typeof document === "undefined") return out;
  const onScreen = new Set<BlockId>();
  for (const el of document.querySelectorAll<HTMLElement>(".reader-root .blk[data-b]")) {
    const id = el.dataset.b as BlockId;
    onScreen.add(id);
    for (const p of s.doc.proposals(id)) if (p.op !== "insert") out.set(p.id, { p, block: id });
  }
  for (const p of s.doc.pendingInserts()) if (p.after && onScreen.has(p.after)) out.set(p.id, { p, block: p.after });
  return out;
});

$effect(() => {
  const want = wanted;
  void loop.decisionTick;
  for (const [id, l] of live) {
    if (!want.has(id) || !l.host.isConnected) {
      void unmount(l.inst);
      l.host.closest(".mb")?.classList.remove("has-prop");
      l.host.remove();
      live.delete(id);
    }
  }
  for (const [id, { p, block }] of want) {
    const j = jobOf(p);
    const decided = j ? (s.review.decisions(j.id).proposals.get(id) ?? null) : null;
    const cur = live.get(id);
    if (cur) {
      cur.props.proposal = p;
      cur.props.decided = decided;
      cur.props.producer = producer(p);
      continue;
    }
    const mb = document.querySelector<HTMLElement>(`.reader-root .blk[data-b="${CSS.escape(block)}"] .mb`);
    if (!mb) continue;
    const host = document.createElement("div");
    host.dataset.mx = "prop";
    host.className = "mx-prop";
    if (p.op === "insert") mb.append(host);
    else {
      mb.prepend(host);
      mb.classList.add("has-prop");
    }
    const props = $state({ proposal: p, producer: producer(p), decided, ondecide: (d: "accept" | "reject") => void decide(p, d) });
    const inst = mount(ProposalBlock, { target: host, props });
    live.set(id, { host, inst, props });
  }
});

onMount(() => {
  const root = document.querySelector(".reader-root")?.parentElement ?? document.body;
  let raf = 0;
  const mo = new MutationObserver(() => {
    cancelAnimationFrame(raf);
    raf = requestAnimationFrame(() => tick++);
  });
  mo.observe(root, { childList: true, subtree: true });
  return () => {
    mo.disconnect();
    cancelAnimationFrame(raf);
    for (const l of live.values()) {
      void unmount(l.inst);
      l.host.remove();
    }
    live.clear();
  };
});
</script>

<style>
  :global(.mb.has-prop > :not([data-mx])) {
    display: none;
  }
</style>
