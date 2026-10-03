/** Settings of the billing service; secrets come from the environment, never from the repository. */
export interface Config {
  databaseUrl: string;
  stripeApiKey: string;
}

export function loadConfig(): Config {
  const databaseUrl = process.env.DATABASE_URL;
  const stripeApiKey = process.env.STRIPE_API_KEY;
  if (!databaseUrl || !stripeApiKey) throw new Error("DATABASE_URL and STRIPE_API_KEY must be set");
  return { databaseUrl, stripeApiKey };
}
