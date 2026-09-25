// Serves files by signed URL only. There is no way to request a file by id:
// the URL itself (issued by an authorized API response) is the credential, and
// it expires. Redirects to a short-lived Supabase URL in production.
import { Router } from 'express';
import { z } from 'zod';
import { notFound } from '../../lib/errors.js';
import { verifyFileToken } from '../../lib/fileUrls.js';
import { storage } from '../../lib/storage.js';
import { parseParams } from '../../lib/validate.js';

export const filesRouter = Router();

filesRouter.get('/:token', async (req, res) => {
  const { token } = parseParams(req, z.object({ token: z.string().max(4096) }));
  const signed = verifyFileToken(token);
  if (!signed) throw notFound('File');
  const target = await storage.resolve(signed.key, signed.downloadName);
  if (!target) throw notFound('File');
  res.setHeader('Cache-Control', 'private, max-age=3600');
  if ('redirectUrl' in target) return res.redirect(302, target.redirectUrl);
  if (signed.downloadName) res.attachment(signed.downloadName);
  res.sendFile(target.filePath);
});
