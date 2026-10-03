import { readFileSync, writeFileSync } from "node:fs";
import { execSync } from "node:child_process";
const R = process.env.CRIT_DIR; if (!R) throw new Error("set CRIT_DIR to a crit checkout at 406875d");
// id, path, peekFrom, peekTo, hiStart, hiEnd, symbol
const defs = [
  ["readme","README.md",6,23,8,8,null],
  ["bind","internal/server/daemon_cli.go",88,96,92,92,"parseDaemonFlags"],
  ["skey","internal/daemon/daemon.go",174,194,178,193,"SessionKey"],
  ["ready","internal/server/server.go",359,368,361,368,"(*Server).withReady"],
  ["poll","internal/daemon/client.go",124,154,130,152,"waitForDaemonReady"],
  ["timeout","internal/daemon/client.go",22,40,26,38,"RunReviewClient"],
  ["cycle","internal/server/server.go",2656,2680,2660,2677,"(*Server).handleReviewCycle"],
  ["order","internal/server/server.go",2664,2680,2668,2677,"(*Server).handleReviewCycle"],
  ["shutdown","internal/server/server.go",2708,2731,2714,2725,"(*Server).handleReviewCycle"],
  ["cfgagent","cmd/crit/cli_handlers_story.go",569,580,575,578,"runStoryLLM"],
  ["prep","cmd/crit/cli_handlers_story.go",585,601,587,600,"runStoryLLM"],
  ["nobudget","internal/story/prep.go",44,53,46,50,"BuildPrep"],
  ["gen","cmd/crit/cli_handlers_story.go",629,659,633,659,"generateStory"],
  ["fivemin","cmd/crit/cli_handlers_story.go",680,692,690,690,"execAgentCmd"],
  ["floor","internal/story/ingest.go",22,30,25,28,"placedFloor"],
  ["run","internal/story/ingest.go",112,170,115,169,"story.Run"],
  ["stamp","cmd/crit/cli_handlers_story.go",537,553,544,549,"runStorySkipLLM"],
  ["diff","internal/diff/diff.go",31,42,34,41,"ComputeLineDiff"],
  ["map","internal/diff/diff.go",188,205,192,199,"MapOldLineToNew"],
  ["remap","internal/session/watch.go",1096,1120,1098,1120,"remapLines"],
  ["verify","internal/session/watch.go",967,996,970,996,"verifyAndCorrectPosition"],
  ["similar","internal/session/watch.go",998,1029,1001,1029,"anchorSimilar"],
  ["global","internal/config/config.go",356,374,359,372,"mergeConfigs"],
  ["debounce","internal/session/session_write.go",11,30,13,19,"(*Session).scheduleWrite"],
  ["atomic","internal/session/atomic_write.go",9,40,19,40,"AtomicWriteFile"],
  ["ime","web/crit-comment-form.js",56,68,62,62,null],
  ["cfgstruct","internal/config/config.go",40,50,45,45,"Config"],
  ["cfgnotify","internal/config/config.go",132,143,136,141,"(Config).NotifyOnRoundReadyEnabled"],
  ["genloop","cmd/crit/cli_handlers_story.go",604,612,607,608,"runStoryLLM"],
  ["install","cmd/crit/cli_dispatch.go",44,49,46,46,"commands"],
  ["storymd","docs/story-mode.md",11,18,15,16,null],
  ["serve","cmd/crit/cli_dispatch.go",205,214,211,213,"commands"],
  ["events","internal/server/server.go",170,197,188,188,"(*Server).routes"],
  ["routes","internal/server/server.go",134,160,136,160,"(*Server).routes"],
  ["make","Makefile",1,35,6,33,null],
];
const out = {};
for (const [id, path, from, to, hs, he, sym] of defs) {
  const src = readFileSync(`${R}/${path}`, "utf8").split("\n");
  const blob = execSync(`git -C ${R} ls-files -s -- ${path}`).toString().split(/\s+/)[1].slice(0, 7);
  out[id] = { path, from, to, hs, he, sym, blob, lines: src.slice(from - 1, to) };
}
writeFileSync(process.argv[2] || "cites.json", JSON.stringify(out));
console.log(Object.keys(out).length, "cites", JSON.stringify(out).length, "bytes");
