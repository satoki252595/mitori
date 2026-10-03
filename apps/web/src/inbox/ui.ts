/** Loop UI extension, part 3 (contract `UiExtension.views.inbox`, CR m1-95): the S4 Inbox route view. */
import type { UiExtension } from "../contract.ts";
import InboxPage from "./InboxPage.svelte";

const ext: UiExtension = { views: { inbox: InboxPage } };

export default ext;
