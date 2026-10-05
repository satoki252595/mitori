import type { InitialUiSnapshot } from "@mitori/core";
import { defaultEffort, isRange } from "../gen/estimate.ts";
import { parseRoute } from "../shell/router.ts";
import type { Stores } from "../stores/app.svelte.ts";

/** Seed the same DTOs in server rendering and the enhanced UI. No request runs during the hand-off. */
export function seedInitial(s: Stores, snapshot: InitialUiSnapshot): void {
  const { ui } = snapshot;
  s.router.route = parseRoute(ui.url);
  s.router.focusMain = false;
  s.workspace.key = snapshot.status.info.key;
  s.workspace.status = snapshot.status;
  s.session.settings = snapshot.settings;
  s.session.daemon = snapshot.daemon;
  s.session.scheduler = snapshot.daemon?.scheduler ?? null;
  s.session.engines = snapshot.engines;
  s.session.today = snapshot.usage?.totals ?? null;
  s.session.window = snapshot.usage?.window ?? null;
  s.prefs.lang = ui.lang;
  s.prefs.level = ui.level;
  s.prefs.theme = ui.theme;
  s.prefs.railCollapsed = ui.railCollapsed;
  s.prefs.codeWidth = ui.codeWidth;
  s.prefs.singleKeys = snapshot.settings.settings.ui.singleKeyShortcuts;
  s.prefs.noteVersion(snapshot.settings.version);
  s.prefs.effort = ui.effort ?? null;
  s.keys.setOverrides(snapshot.settings.settings.ui.keymap);
  s.ui.width = ui.width;
  s.doc.seed(snapshot.outline, snapshot.sections);
  for (const proposal of snapshot.proposals ?? []) s.doc.upsertProposal(proposal);
  s.doc.level = ui.level;
  s.map.view = snapshot.map;
  const route = s.router.route;
  if (route.name === "map") {
    s.map.selected = route.room ?? null;
    s.map.flow = route.flow ?? null;
  }
  if (snapshot.status.gen) s.gen.applyRun(snapshot.status.gen);
  s.gen.engine = snapshot.status.genEngine ?? snapshot.settings.settings.defaultGenEngine;
  for (const [effort, estimate] of Object.entries(snapshot.estimates ?? {})) if (estimate) s.gen.estimates.set(s.gen.key(effort as never), estimate);
  s.gen.error = snapshot.estimateError ?? null;
  const std = snapshot.estimates?.standard;
  s.gen.setEffort(
    defaultEffort({
      cookie: ui.effort,
      workspace: snapshot.settings.settings.workspaces[snapshot.status.info.key]?.defaultEffort,
      global: snapshot.settings.settings.defaultEffort,
      uncalibratedPro: !!std && (!!std.windowDeltaRange || isRange(std)) && snapshot.engines.find((e) => e.engine === s.gen.engine)?.plan === "pro",
    }),
    false,
  );
  for (const thread of snapshot.threads) s.review.threads.set(thread.id, thread);
  for (const job of snapshot.jobs) s.review.jobs.set(job.id, job);
  s.inbox.items = snapshot.inbox;
  s.inbox.loaded = true;
}
