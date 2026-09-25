// Multipart upload handling. Files stream to the OS temp dir (never held fully
// in memory across a batch), with per-route size/count/type limits. Temp files
// are always removed.
//
// Disallowed file types are SKIPPED during parsing (the body is still fully
// read) and rejected with a clean 400 afterwards. Aborting mid-stream from the
// file filter is timing-sensitive: the client can see a connection reset (or
// hang) instead of the error message. Size limits still abort early — the
// server must not read an unbounded body.
import fs from 'node:fs';
import os from 'node:os';
import type { NextFunction, Request, RequestHandler, Response } from 'express';
import multer from 'multer';
import { AppError, badRequest, tooLarge } from './errors.js';

const TMP = fs.mkdtempSync(`${os.tmpdir()}/bid-uploads-`);

export const CAD_EXTENSIONS = /\.(png|jpe?g|gif|webp|bmp|tiff?|heic|heif|svg|pdf|ai|eps|psd)$/i;
export const EXCEL_EXTENSIONS = /\.(xlsx|xls)$/i;

const REJECTED = Symbol('rejectedUploads');
type WithRejected = Request & { [REJECTED]?: string[] };

function make(opts: { maxBytes: number; maxFiles: number; accept: RegExp }) {
  return multer({
    dest: TMP,
    limits: { fileSize: opts.maxBytes, files: opts.maxFiles, fields: 20, fieldSize: 64 * 1024 },
    fileFilter: (req, file, cb) => {
      if (opts.accept.test(file.originalname)) return cb(null, true);
      ((req as WithRejected)[REJECTED] ??= []).push(file.originalname);
      cb(null, false); // skip this file; keep reading the request normally
    },
  });
}

const cad = make({ maxBytes: 50 * 1024 * 1024, maxFiles: 50, accept: CAD_EXTENSIONS });
const excel = make({ maxBytes: 15 * 1024 * 1024, maxFiles: 1, accept: EXCEL_EXTENSIONS });

function wrap(mw: RequestHandler, label: string, kind: string): RequestHandler {
  return (req: Request, res: Response, next: NextFunction) => {
    mw(req, res, (err?: unknown) => {
      if (err) {
        cleanupUploads(req);
        if (err instanceof AppError) return next(err);
        const m = err as multer.MulterError;
        if (m.code === 'LIMIT_FILE_SIZE') return next(tooLarge(`A ${label} file is over the size limit.`));
        if (m.code === 'LIMIT_FILE_COUNT') return next(badRequest('Too many files in one upload.'));
        if (m.code === 'LIMIT_UNEXPECTED_FILE') return next(badRequest(`Unexpected upload field "${m.field}".`));
        return next(err);
      }
      const rejected = (req as WithRejected)[REJECTED];
      if (rejected?.length) {
        cleanupUploads(req);
        return next(badRequest(`${rejected.map((n) => `"${n}"`).join(', ')} ${rejected.length === 1 ? "isn't a" : "aren't"} supported ${kind} file${rejected.length === 1 ? '' : 's'}.`));
      }
      next();
    });
  };
}

export const uploadCads = wrap(cad.array('files', 50), 'design', 'design');
export const uploadExcel = wrap(excel.single('file'), 'Excel', 'Excel (.xlsx/.xls)');

/** Remove multer temp files for this request (call in finally). */
export function cleanupUploads(req: Request) {
  const files = [...(Array.isArray(req.files) ? req.files : []), ...(req.file ? [req.file] : [])];
  for (const f of files) fs.rm(f.path, { force: true }, () => {});
}
