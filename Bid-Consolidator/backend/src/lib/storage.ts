// File storage: Supabase Storage in production, a local folder in development.
//
// Every object is tracked in `stored_objects` so a project's files can be found
// and deleted with it. The write protocol (UploadBatch) is: upload the bytes
// first, then record the keys in the SAME transaction as the rows that
// reference them; if anything fails, the uploaded objects are deleted. Keys are
// `orgs/<org>/projects/<project>/<kind>/<uuid>.<ext>` — never derived from a
// (non-unique) project name — and objects are never overwritten.
import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { config } from '../config.js';
import type { Db } from '../db/pool.js';
import { logger } from './logger.js';

const LOCAL_ROOT = path.resolve(config.LOCAL_STORAGE_DIR ?? path.join(path.dirname(fileURLToPath(import.meta.url)), '../../uploads'));

let supabase: SupabaseClient | null = null;
if (config.storageMode === 'supabase') {
  supabase = createClient(config.SUPABASE_URL!, config.SUPABASE_SERVICE_KEY!, { auth: { persistSession: false } });
}
const bucket = () => supabase!.storage.from(config.SUPABASE_BUCKET);

/** Resolve a key to a path inside LOCAL_ROOT, refusing any traversal. Legacy
 *  rows may hold absolute paths written by old local-dev code; allow those only
 *  if they point inside LOCAL_ROOT. */
function localPath(key: string): string {
  const p = path.isAbsolute(key) ? path.resolve(key) : path.resolve(LOCAL_ROOT, key);
  if (p !== LOCAL_ROOT && !p.startsWith(LOCAL_ROOT + path.sep)) throw new Error('invalid storage key');
  return p;
}

const EXT_TYPES: Record<string, string> = {
  png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp',
  bmp: 'image/bmp', tif: 'image/tiff', tiff: 'image/tiff', svg: 'image/svg+xml', heic: 'image/heic', heif: 'image/heif',
  pdf: 'application/pdf', ai: 'application/postscript', eps: 'application/postscript', psd: 'image/vnd.adobe.photoshop',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', xls: 'application/vnd.ms-excel',
};
export function contentTypeFor(ext: string): string {
  return EXT_TYPES[ext.toLowerCase().replace(/^\./, '')] ?? 'application/octet-stream';
}
export function extOf(filename: string, fallback = 'bin'): string {
  const e = path.extname(filename).toLowerCase().replace(/^\./, '');
  return /^[a-z0-9]{1,5}$/.test(e) ? e : fallback;
}

export const storage = {
  async put(key: string, data: Buffer, contentType: string): Promise<void> {
    if (supabase) {
      const { error } = await bucket().upload(key, data, { contentType, upsert: false });
      if (error) throw new Error(`storage upload failed: ${error.message}`);
    } else {
      const p = localPath(key);
      fs.mkdirSync(path.dirname(p), { recursive: true });
      fs.writeFileSync(p, data, { flag: 'wx' }); // wx: fail rather than overwrite
    }
  },

  async get(key: string): Promise<Buffer> {
    if (supabase) {
      const { data, error } = await bucket().download(key);
      if (error || !data) throw new Error(`storage download failed: ${error?.message ?? 'no data'}`);
      return Buffer.from(await data.arrayBuffer());
    }
    return fs.promises.readFile(localPath(key));
  },

  /** A short-lived URL/path the client can be redirected to, or null if missing. */
  async resolve(key: string, downloadName?: string): Promise<{ redirectUrl: string } | { filePath: string } | null> {
    if (supabase) {
      const { data, error } = await bucket().createSignedUrl(key, 3600, downloadName ? { download: downloadName } : undefined);
      if (error || !data) return null;
      return { redirectUrl: data.signedUrl };
    }
    let p: string;
    try { p = localPath(key); } catch { return null; }
    return fs.existsSync(p) ? { filePath: p } : null;
  },

  async remove(keys: string[]): Promise<void> {
    if (!keys.length) return;
    if (supabase) {
      for (let i = 0; i < keys.length; i += 500) {
        const { error } = await bucket().remove(keys.slice(i, i + 500));
        if (error) throw new Error(`storage remove failed: ${error.message}`);
      }
    } else {
      for (const k of keys) {
        try { fs.rmSync(localPath(k), { force: true }); } catch { /* already gone */ }
      }
    }
  },
};

export type ObjectKind = 'cads' | 'crops' | 'item-images' | 'quote-images' | 'sources';

/**
 * Collects uploads for one operation. Call `put` for each file, then `record`
 * inside the transaction that writes the referencing rows. On failure call
 * `rollback()` to delete whatever was uploaded.
 */
export class UploadBatch {
  private readonly items: { key: string; contentType: string; size: number }[] = [];
  constructor(private readonly orgId: number, private readonly projectId: number) {}

  async put(kind: ObjectKind, data: Buffer, ext: string, contentType = contentTypeFor(ext)): Promise<string> {
    const key = `orgs/${this.orgId}/projects/${this.projectId}/${kind}/${randomUUID()}.${ext}`;
    await storage.put(key, data, contentType);
    this.items.push({ key, contentType, size: data.length });
    return key;
  }

  get keys() { return this.items.map((i) => i.key); }

  async record(db: Db): Promise<void> {
    for (const it of this.items) {
      await db.query(
        `INSERT INTO stored_objects (key, org_id, project_id, content_type, size_bytes)
         VALUES ($1, $2, $3, $4, $5) ON CONFLICT (key) DO NOTHING`,
        [it.key, this.orgId, this.projectId, it.contentType, it.size],
      );
    }
  }

  async rollback(): Promise<void> {
    try { await storage.remove(this.keys); }
    catch (err) { logger.error({ err, keys: this.keys }, 'upload rollback failed — objects left for the orphan sweep'); }
  }
}

/** Mark objects for deletion; the purge job removes them from storage. */
export async function requestObjectDeletion(db: Db, keys: string[]): Promise<void> {
  if (!keys.length) return;
  await db.query(
    `UPDATE stored_objects SET delete_requested_at = now()
      WHERE key = ANY($1) AND delete_requested_at IS NULL`,
    [keys],
  );
}
