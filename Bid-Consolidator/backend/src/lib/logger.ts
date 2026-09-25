// Structured JSON logging (pino). Pretty-printed locally, JSON in production so
// Render's log search can filter by level, request id, user, etc. Secrets are
// redacted at the logger level so they can never leak into logs by accident.
import pino from 'pino';
import { config } from '../config.js';

export const logger = pino({
  level: config.isTest ? 'silent' : config.LOG_LEVEL,
  redact: {
    paths: [
      'req.headers.authorization',
      'req.headers.cookie',
      '*.password',
      '*.token',
      '*.JWT_SECRET',
      '*.SUPABASE_SERVICE_KEY',
      '*.SMTP_PASS',
    ],
    censor: '[redacted]',
  },
  ...(config.isProduction || config.isTest
    ? {}
    : { transport: { target: 'pino-pretty', options: { colorize: true, translateTime: 'HH:MM:ss' } } }),
});
