/**
 * Stub shell entry (WP-11a walking skeleton). Built by scripts/gen-assets.ts only while WP-10a's real shell
 * (`apps/web/index.html` + `vite.config.ts`) does not exist; delete this directory when it lands.
 */
import { mount } from "svelte";
import Shell from "./Shell.svelte";

const target = document.getElementById("app");
if (target) mount(Shell, { target });
