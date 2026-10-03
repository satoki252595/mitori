/**
 * The loop UI extension (contract `UiExtension`, CR m1-95) — ONE `ui.ts` for the whole review loop, because the shell
 * loads every extension module at boot (shell/ext.ts): the margin column, the S5 Review panel and the S4 Inbox are thin
 * wrappers whose real chunks are fetched when shown; `install` starts the loop controller (SSE hooks, keys, workspace
 * lifecycle) and mounts the overlays root (selection toolbar, PullBar, sheet Composer, proposals, dialogs) once.
 */
import { mount } from "svelte";
import type { AppStores, UiExtension } from "../contract.ts";
import InboxLazy from "../inbox/InboxLazy.svelte";
import ReviewLazy from "../review/ReviewLazy.svelte";
import type { Stores } from "../stores/app.svelte.ts";
import LoopRoot from "./LoopRoot.svelte";
import { loopOf } from "./loop.svelte.ts";
import MarginLazy from "./MarginLazy.svelte";

let mounted = false;

const ext: UiExtension = {
  margin: MarginLazy,
  reviewPanel: ReviewLazy,
  views: { inbox: InboxLazy },
  install(stores: AppStores): void {
    // the shell passes its full store root (shell/ext.ts); the overlays use the shell-only parts (prefs, ui, layers.open)
    const s = stores as Stores;
    loopOf(s).install();
    if (mounted || typeof document === "undefined") return;
    mounted = true;
    const host = document.createElement("div");
    host.id = "mitori-loop";
    document.body.append(host);
    mount(LoopRoot, { target: host, props: { stores: s } });
  },
};

export default ext;
