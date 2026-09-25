import { Router } from 'express';
import { z } from 'zod';
import { authLimiter } from '../../lib/rateLimits.js';
import { email, parseBody } from '../../lib/validate.js';
import { currentUser, requireAuth } from '../../middleware/auth.js';
import * as auth from './service.js';

const password = z
  .string()
  .min(8, 'must be at least 8 characters')
  .refine((p) => Buffer.byteLength(p) <= 72, 'must be 72 characters or fewer');

export const authRouter = Router();

authRouter.post('/login', authLimiter, async (req, res) => {
  const body = parseBody(req, z.object({ email, password: z.string().min(1).max(200) }));
  res.json(await auth.login(body.email, body.password));
});

authRouter.post('/register', authLimiter, async (req, res) => {
  const body = parseBody(req, z.object({
    name: z.string().trim().min(1, 'is required').max(120),
    email,
    password,
    inviteToken: z.string().max(200).optional(),
  }));
  res.status(201).json(await auth.register(body));
});

authRouter.get('/me', requireAuth, async (req, res) => {
  res.json(await auth.me(currentUser(req).id));
});

authRouter.post('/password', requireAuth, authLimiter, async (req, res) => {
  const body = parseBody(req, z.object({ currentPassword: z.string().min(1), newPassword: password }));
  await auth.changePassword(currentUser(req).id, body.currentPassword, body.newPassword);
  res.status(204).end();
});
