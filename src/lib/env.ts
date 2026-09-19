import { z } from "zod";

const envSchema = z.object({
  GOOGLE_GENERATIVE_AI_API_KEY: z.string().min(1),
  AUTH_SECRET: z.string().min(1),
  AUTH_GITHUB_ID: z.string().min(1),
  AUTH_GITHUB_SECRET: z.string().min(1),
  DATABASE_URL: z.string().startsWith("postgres"),
  DATABASE_URL_UNPOOLED: z.string().startsWith("postgres"),
  UPSTASH_REDIS_REST_URL: z.string().startsWith("https://"),
  UPSTASH_REDIS_REST_TOKEN: z.string().min(1),
  // Unused locally: the Inngest dev server runs unauthenticated.
  INNGEST_EVENT_KEY: z.string().optional(),
  INNGEST_SIGNING_KEY: z.string().optional(),
});

export type Env = z.infer<typeof envSchema>;

let cached: Env | undefined;

/**
 * Validated environment. Resolved lazily so that importing a module which
 * touches env does not break `next build`, which evaluates modules without a
 * full environment.
 */
export function env(): Env {
  if (cached) return cached;

  const parsed = envSchema.safeParse(process.env);
  if (!parsed.success) {
    const names = parsed.error.issues
      .map((issue) => issue.path.join("."))
      .join(", ");
    throw new Error(
      `Invalid or missing environment variables: ${names}. See .env.example.`,
    );
  }

  cached = parsed.data;
  return cached;
}
