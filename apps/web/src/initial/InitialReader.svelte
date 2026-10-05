<!-- Server-only presentation of the existing pending proposal component; decisions still use ProposalLayer. -->
<script lang="ts">
import type { BlockView, DocProposalView } from "@mitori/core";
import ProposalBlock from "../proposals/ProposalBlock.svelte";
import ReaderPage from "../reader/ReaderPage.svelte";
import { t } from "../shell/index.ts";
import { useStores } from "../stores/app.svelte.ts";

const s = useStores();
function proposals(block: BlockView): readonly DocProposalView[] {
  return [...s.doc.proposals(block.id), ...s.doc.pendingInserts().filter((p) => p.after === block.id)];
}
function producer(p: DocProposalView): string {
  const job = p.source.kind === "job" ? s.review.jobs.get(p.source.id as `j_${string}`) : undefined;
  const thread = job?.threads[0] ? s.review.threads.get(job.threads[0]) : undefined;
  const kind = t(`proposals.kind.${p.op === "insert" ? "insert" : "body"}`);
  return job ? t("proposals.producer", { model: job.route.model, n: thread?.round ?? 1, kind }) : t(`proposals.source.${p.source.kind}`, { kind });
}
</script>

<ReaderPage native>
  {#snippet nativeProposals(block: BlockView)}
    {#each proposals(block) as proposal (proposal.id)}
      <div class="native-proposal" data-mx="prop" data-proposal={proposal.id} data-replace={proposal.op !== "insert" || undefined}>
        <ProposalBlock {proposal} producer={producer(proposal)} ondecide={() => {}} />
      </div>
    {/each}
  {/snippet}
</ReaderPage>
