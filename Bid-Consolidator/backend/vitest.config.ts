import os from 'node:os';
import path from 'node:path';
import { defineConfig } from 'vitest/config';

// Integration tests run against a real PostgreSQL database that globalSetup
// recreates from scratch and migrates. Locally that's the Homebrew/Postgres.app
// socket; in CI it's the GitHub Actions postgres service (TEST_DB_* vars).
export const testEnv = {
  NODE_ENV: 'test',
  DATABASE_URL: '',
  DB_HOST: process.env.TEST_DB_HOST ?? '/tmp',
  DB_PORT: process.env.TEST_DB_PORT ?? '5432',
  DB_NAME: process.env.TEST_DB_NAME ?? 'bid_consolidator_vitest',
  DB_USER: process.env.TEST_DB_USER ?? '',
  DB_PASSWORD: process.env.TEST_DB_PASSWORD ?? '',
  JWT_SECRET: 'vitest-secret-vitest-secret-vitest-0123456789',
  SUPABASE_URL: '',
  SUPABASE_SERVICE_KEY: '',
  GEMINI_API_KEY: '',
  SMTP_HOST: '',
  ALLOWED_SIGNUP_DOMAINS: '',
  FRONTEND_URL: 'http://localhost:5173',
  LOCAL_STORAGE_DIR: path.join(os.tmpdir(), 'bid-consolidator-test-uploads'),
  RUN_JOBS: 'false',
  MIGRATE_ON_START: 'false',
  LOG_LEVEL: 'silent',
};

export default defineConfig({
  test: {
    environment: 'node',
    include: ['test/**/*.test.ts'],
    globalSetup: ['./test/globalSetup.ts'],
    fileParallelism: false, // integration files share one database
    testTimeout: 30_000,
    hookTimeout: 60_000,
    env: testEnv,
  },
});
