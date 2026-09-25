// Rate limits. Tight on credential endpoints (brute force), moderate on the
// public factory portal (token guessing/abuse), generous on the authenticated
// API (runaway clients). Keyed by client IP (the app trusts Render's proxy hop).
import { rateLimit } from 'express-rate-limit';
import { config } from '../config.js';

const common = {
  standardHeaders: 'draft-7' as const,
  legacyHeaders: false,
  skip: () => config.isTest,
};

export const authLimiter = rateLimit({
  ...common,
  windowMs: 15 * 60 * 1000,
  limit: 20,
  message: { error: 'Too many attempts. Please wait a few minutes and try again.', code: 'rate_limited' },
});

export const portalLimiter = rateLimit({
  ...common,
  windowMs: 60 * 1000,
  limit: 120,
  message: { error: 'Too many requests. Please slow down.', code: 'rate_limited' },
});

export const apiLimiter = rateLimit({
  ...common,
  windowMs: 60 * 1000,
  limit: 600,
  message: { error: 'Too many requests. Please slow down.', code: 'rate_limited' },
});
