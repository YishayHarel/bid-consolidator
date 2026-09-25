// Validated runtime configuration. Every environment variable the app reads is
// declared here once, parsed with zod, and exported as a typed object. Missing
// or malformed critical settings abort startup with a clear message instead of
// failing later (e.g. uploads silently landing on an ephemeral disk).
import 'dotenv/config';
import { z } from 'zod';

const flag = (fallback: boolean) =>
  z
    .string()
    .optional()
    .transform((v) => (v === undefined || v === '' ? fallback : ['1', 'true', 'yes'].includes(v.toLowerCase())));

const optionalString = z
  .string()
  .optional()
  .transform((v) => (v === undefined || v.trim() === '' ? undefined : v));

const schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  RENDER: optionalString, // set automatically by Render
  PORT: z.coerce.number().int().positive().default(4000),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),

  // Database: DATABASE_URL (Supabase) or discrete DB_* vars for local dev.
  DATABASE_URL: optionalString,
  DB_HOST: z.string().default('localhost'),
  DB_PORT: z.coerce.number().int().default(5432),
  DB_NAME: z.string().default('bid_consolidator'),
  DB_USER: optionalString,
  DB_PASSWORD: optionalString,
  DB_CA_CERT: optionalString,
  DB_POOL_MAX: z.coerce.number().int().positive().default(10),
  MIGRATE_ON_START: flag(true),

  // Auth
  JWT_SECRET: z.string().min(32, 'JWT_SECRET must be at least 32 random characters'),
  JWT_EXPIRES_IN: z.string().default('8h'),
  FILE_URL_SECRET: optionalString, // derived from JWT_SECRET when unset
  ALLOWED_SIGNUP_DOMAINS: optionalString, // extra bootstrap domains for the default org

  // Web
  FRONTEND_URL: z.string().default('http://localhost:5173'), // comma-separated allowed origins
  PUBLIC_APP_URL: optionalString, // base for links in emails; defaults to first FRONTEND_URL

  // Storage (Supabase). Required in production.
  SUPABASE_URL: optionalString,
  SUPABASE_SERVICE_KEY: optionalString,
  SUPABASE_BUCKET: z.string().default('uploads'),
  LOCAL_STORAGE_DIR: optionalString, // dev/test only; defaults to backend/uploads

  // Email
  SMTP_HOST: optionalString,
  SMTP_PORT: z.coerce.number().int().default(587),
  SMTP_USER: optionalString,
  SMTP_PASS: optionalString,
  SMTP_SECURE: flag(false),
  SMTP_FROM: optionalString,

  // AI CAD reading
  GEMINI_API_KEY: optionalString,
  GEMINI_MODEL: z.string().default('gemini-3.6-flash'),

  // Background jobs
  RUN_JOBS: flag(true),
  JOB_CONCURRENCY: z.coerce.number().int().positive().default(2),
});

function load() {
  const parsed = schema.safeParse(process.env);
  if (!parsed.success) {
    const lines = parsed.error.issues.map((i) => `  - ${i.path.join('.')}: ${i.message}`);
    throw new Error(`Invalid configuration:\n${lines.join('\n')}`);
  }
  const env = parsed.data;
  const isProduction = env.NODE_ENV === 'production' || !!env.RENDER;

  if (isProduction) {
    const missing = (['DATABASE_URL', 'SUPABASE_URL', 'SUPABASE_SERVICE_KEY'] as const).filter((k) => !env[k]);
    if (missing.length) {
      // Without Supabase, uploads would land on Render's ephemeral disk and be
      // lost on the next deploy; without DATABASE_URL we'd hit localhost.
      throw new Error(`Invalid configuration: missing required production settings: ${missing.join(', ')}`);
    }
  }

  const origins = env.FRONTEND_URL.split(',')
    .map((s) => s.trim().replace(/\/+$/, ''))
    .filter(Boolean);

  return {
    ...env,
    isProduction,
    isTest: env.NODE_ENV === 'test',
    corsOrigins: origins,
    appUrl: (env.PUBLIC_APP_URL ?? origins[0] ?? 'http://localhost:5173').replace(/\/+$/, ''),
    storageMode: env.SUPABASE_URL && env.SUPABASE_SERVICE_KEY ? ('supabase' as const) : ('local' as const),
    smtpEnabled: !!(env.SMTP_HOST && env.SMTP_USER && env.SMTP_PASS),
    aiEnabled: !!env.GEMINI_API_KEY,
    bootstrapSignupDomains: (env.ALLOWED_SIGNUP_DOMAINS ?? '')
      .split(',')
      .map((d) => d.trim().toLowerCase())
      .filter(Boolean),
  };
}

export type Config = ReturnType<typeof load>;
export const config: Config = load();
