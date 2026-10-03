/** The one Vite build-time feature the app uses (the full `vite/client` types are not in the tsconfig). */
interface ImportMeta {
  glob<T>(pattern: string | string[], options: { eager: true; import?: string }): Record<string, T>;
  glob<T>(pattern: string | string[], options?: { eager?: false; import?: string }): Record<string, () => Promise<T>>;
}

declare module "*.css";
