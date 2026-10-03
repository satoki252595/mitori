/** Loop UI extension, part 2 (contract `UiExtension.reviewPanel`, CR m1-95): the S5 Review panel (ctx review mode). */
import type { UiExtension } from "../contract.ts";
import ReviewPanel from "./ReviewPanel.svelte";

const ext: UiExtension = { reviewPanel: ReviewPanel };

export default ext;
