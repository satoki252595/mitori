/** Runtime configuration of the tsundoku service. */
export interface Config {
  port: number;
  databaseUrl: string | undefined;
}

/** Read the configuration from the environment. */
export function loadConfig(): Config {
  return {
    port: Number(process.env.PORT ?? "8787"),
    databaseUrl: process.env["DATABASE_URL"],
  };
}
