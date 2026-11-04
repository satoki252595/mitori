/**
 * Browser-launch gate (WP40g). A single place every bun test and `test/int/shots` script checks before
 * starting a real browser: `MITORI_NO_BROWSERS=1` means the runner must not launch one (the sandbox
 * cannot register a GUI app, so a launch aborts and leaves a crash report on the host). Unset keeps
 * the old behavior (CI and the host still launch).
 */

/** False when the runner must not start a real browser (`MITORI_NO_BROWSERS=1`). */
export const browsersAllowed = (): boolean => process.env.MITORI_NO_BROWSERS !== "1";
