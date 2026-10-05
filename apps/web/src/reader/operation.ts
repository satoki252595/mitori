import type { BlockOpRes, Estimate } from "@mitori/core";

/** Estimate first; paid work only follows the user's explicit confirmation. Cache hits need no new call. */
export async function confirmDocOperation(
  call: (confirm: boolean) => Promise<BlockOpRes>,
  confirm: (estimate: Estimate) => boolean,
): Promise<BlockOpRes | null> {
  const first = await call(false);
  if (first.cached || first.run || first.proposal) return first;
  if (!first.estimate || !confirm(first.estimate)) return null;
  return call(true);
}
