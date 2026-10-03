// Placeholder for a root script whose owning WP has not landed yet: prints the owner and exits 0, so
// `bun run ci:pr` stays green until the real runner exists. Usage: bun scripts/pending.ts <script> <WP>
const [script = "?", wp = "?"] = process.argv.slice(2);
console.log(`${script}: not implemented yet — owner ${wp} (docs/design/briefs/${wp}.md); skipping`);
