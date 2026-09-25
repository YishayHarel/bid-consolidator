// Request validation with zod. Every route declares the exact shape of its
// params/query/body; anything else is rejected with a 400 listing the fields.
// Parsed (and coerced) values replace the raw ones, so handlers get real types:
// a real 0 stays 0, "" becomes null where the schema says so, ids are numbers.
import type { Request } from 'express';
import { z } from 'zod';
import { badRequest } from './errors.js';

function fail(where: string, error: z.ZodError): never {
  const fields = error.issues.map((i) => ({ field: [where, ...i.path].join('.'), message: i.message }));
  throw badRequest(fields[0] ? `Invalid ${fields[0].field}: ${fields[0].message}` : 'Invalid request', { fields });
}

export function parseBody<S extends z.ZodType>(req: Request, schema: S): z.infer<S> {
  const r = schema.safeParse(req.body ?? {});
  if (!r.success) fail('body', r.error);
  return r.data;
}
export function parseQuery<S extends z.ZodType>(req: Request, schema: S): z.infer<S> {
  const r = schema.safeParse(req.query ?? {});
  if (!r.success) fail('query', r.error);
  return r.data;
}
export function parseParams<S extends z.ZodType>(req: Request, schema: S): z.infer<S> {
  const r = schema.safeParse(req.params ?? {});
  if (!r.success) fail('params', r.error);
  return r.data;
}

// ---- Reusable field schemas -------------------------------------------------

/** Positive integer id from a path/query string. */
export const id = z.coerce.number().int().positive();

/** Optional money/number: '' or null → null; numeric strings coerced; 0 kept. */
export const nullableNumber = z
  .union([z.number(), z.string(), z.null()])
  .transform((v, ctx) => {
    if (v === null || (typeof v === 'string' && v.trim() === '')) return null;
    const n = typeof v === 'number' ? v : Number(v.replace(/[$,\s]/g, ''));
    if (!Number.isFinite(n)) {
      ctx.addIssue({ code: 'custom', message: 'must be a number' });
      return z.NEVER;
    }
    return n;
  });

/** Optional non-negative integer (MOQ, pack counts). */
export const nullableInt = nullableNumber.refine((n) => n === null || (Number.isInteger(n) && n >= 0), {
  message: 'must be a whole number ≥ 0',
});

/** Trimmed optional text: '' → null. */
export const nullableText = (max = 2000) =>
  z
    .union([z.string(), z.null()])
    .transform((v) => (v === null ? null : v.trim() === '' ? null : v.trim()))
    .refine((v) => v === null || v.length <= max, { message: `must be at most ${max} characters` });

export const email = z.string().trim().toLowerCase().pipe(z.email('must be a valid email address')).pipe(z.string().max(254));

/** List of emails from an array or a comma/semicolon/newline separated string. */
export const emailList = z
  .union([z.array(z.string()), z.string(), z.null()])
  .transform((v) => {
    const arr = v === null ? [] : Array.isArray(v) ? v : v.split(/[,;\n]/);
    return [...new Set(arr.map((e) => e.trim().toLowerCase()).filter(Boolean))];
  })
  .pipe(z.array(z.email('contains an invalid email address')).max(20));

/** List of short labels (divisions) from an array or delimited string. */
export const labelList = z
  .union([z.array(z.string()), z.string(), z.null()])
  .transform((v) => {
    const arr = v === null ? [] : Array.isArray(v) ? v : v.split(/[,;\n]/);
    return [...new Set(arr.map((e) => e.trim()).filter(Boolean))];
  })
  .pipe(z.array(z.string().max(80)).max(30));

export const pagination = z.object({
  limit: z.coerce.number().int().min(1).max(200).default(50),
  offset: z.coerce.number().int().min(0).default(0),
});
