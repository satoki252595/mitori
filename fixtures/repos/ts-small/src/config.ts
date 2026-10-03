/** Log levels the service understands, quietest last. */
export const LOG_LEVELS = ["debug", "info", "warn", "error"] as const;

export type LogLevel = (typeof LOG_LEVELS)[number];

/** Runtime configuration of the tsundoku service. */
export interface Config {
  port: number;
  databaseUrl: string | undefined;
  logLevel: LogLevel;
  apiToken: string | undefined;
}

/** True when `value` is one of {@link LOG_LEVELS}. */
export function isLogLevel(value: string): value is LogLevel {
  return (LOG_LEVELS as readonly string[]).includes(value);
}

/** Read the configuration from the environment; command-line flags are applied by the caller (see src/index.ts). */
export function loadConfig(): Config {
  const level = Bun.env.LOG_LEVEL || "info";
  return {
    port: Number(process.env.PORT ?? "8787"),
    databaseUrl: process.env["DATABASE_URL"],
    logLevel: isLogLevel(level) ? level : "info",
    apiToken: import.meta.env.TSUNDOKU_API_TOKEN,
  };
}
