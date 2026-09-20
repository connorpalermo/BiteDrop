import { z } from 'zod';

const envSchema = z.object({
  DATABASE_URL: z.url().startsWith('postgresql://'),
});

export function loadDbConfig(env: NodeJS.ProcessEnv = process.env) {
  const parsed = envSchema.safeParse(env);
  if (!parsed.success) {
    throw new Error(
      `Invalid database configuration:\n${z.prettifyError(parsed.error)}\n` +
        `Copy .env.example to .env.local and set DATABASE_URL.`,
    );
  }
  return parsed.data;
}
