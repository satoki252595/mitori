/**
 * Loop UI extension, part 1 (contract `UiExtension`, CR m1-95): the margin column content and the one-time install —
 * the loop controller (SSE hooks, keys, workspace lifecycle) and the overlays root (selection toolbar, sheet Composer,
 * proposals in the prose, PullBar, dialogs), mounted once next to the app.
 */
import { mount } from "svelte";
import type { AppStores, UiExtension } from "../contract.ts";
import type { Stores } from "../stores/app.svelte.ts";
import LoopRoot from "./LoopRoot.svelte";
import { loopOf } from "./loop.svelte.ts";
import Margin from "./Margin.svelte";

let mounted = false;

const ext: UiExtension = {
  margin: Margin,
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
