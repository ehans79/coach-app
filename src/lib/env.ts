import { z } from "zod";

const envSchema = z.object({
  DATABASE_URL: z.string().min(1),
  STRAVA_CLIENT_ID: z.string().min(1),
  STRAVA_CLIENT_SECRET: z.string().min(1),
  STRAVA_VERIFY_TOKEN: z.string().min(1),
  ANTHROPIC_API_KEY: z.string().min(1),
  RESEND_API_KEY: z.string().min(1),
  NOTIFY_EMAIL: z.string().email(),
  APP_BASE_URL: z.string().url(),
  INTERNAL_API_TOKEN: z.string().min(16),
});

type Env = z.infer<typeof envSchema>;

let cached: Env | undefined;

/**
 * Lazily validated, memoized env access. Lazy so that `next build` (which
 * imports route modules without real runtime env vars present) doesn't fail
 * — validation only runs the first time a server codepath actually needs a var.
 */
export function getEnv(): Env {
  if (cached) return cached;
  const parsed = envSchema.safeParse(process.env);
  if (!parsed.success) {
    const missing = parsed.error.issues
      .map((issue) => issue.path.join("."))
      .join(", ");
    throw new Error(`Missing/invalid required environment variables: ${missing}`);
  }
  cached = parsed.data;
  return cached;
}
