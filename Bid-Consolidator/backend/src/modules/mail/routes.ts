// Connecting a buyer's own Outlook mailbox (see lib/outlook.ts).
//
//   GET    /api/mail/status               → is Outlook available / connected, and as whom
//   POST   /api/mail/microsoft/connect    → Microsoft sign-in URL for the browser to open
//   DELETE /api/mail/microsoft            → disconnect
//   GET    /api/mail/microsoft/callback   → PUBLIC: Microsoft redirects here after sign-in
import { Router } from 'express';
import { config } from '../../config.js';
import { AppError } from '../../lib/errors.js';
import { logger } from '../../lib/logger.js';
import { authorizeUrl, completeConnect, disconnect, mailStatus } from '../../lib/outlook.js';
import { authLimiter } from '../../lib/rateLimits.js';
import { currentUser, requireAuth } from '../../middleware/auth.js';

export const mailRouter = Router();
mailRouter.use(requireAuth);

mailRouter.get('/status', async (req, res) => {
  res.json(await mailStatus(currentUser(req).id));
});

mailRouter.post('/microsoft/connect', async (req, res) => {
  const u = currentUser(req);
  res.json({ url: authorizeUrl(u.id, u.email) });
});

mailRouter.delete('/microsoft', async (req, res) => {
  await disconnect(currentUser(req).id);
  res.status(204).end();
});

// Public: the signed `state` identifies the user. Always ends with a redirect
// back to the app's Settings page carrying only a short outcome code.
export const mailCallbackRouter = Router();
mailCallbackRouter.get('/microsoft/callback', authLimiter, async (req, res) => {
  const back = (outcome: string) => res.redirect(303, `${config.appUrl}/app/settings?outlook=${outcome}`);
  const { code, state, error } = req.query as Record<string, string | undefined>;
  if (error) return back(error === 'access_denied' ? 'cancelled' : 'error');
  if (!code || !state) return back('error');
  try {
    await completeConnect(code, state);
    return back('connected');
  } catch (err) {
    if (err instanceof AppError && err.code === 'mail_mismatch') return back('mismatch');
    if (err instanceof AppError && err.status === 400) return back('expired');
    logger.warn({ err }, 'outlook connect failed');
    return back('error');
  }
});
