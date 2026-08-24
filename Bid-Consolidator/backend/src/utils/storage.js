// File storage abstraction. Uses Supabase Storage when configured
// (SUPABASE_URL + SUPABASE_SERVICE_KEY), otherwise falls back to the local
// uploads/ folder. The database always stores a relative KEY like
// "Project/Factory/images/x.png" so both modes serve identically.
const fs = require('fs');
const path = require('path');

const uploadsRoot = path.join(__dirname, '../../uploads');
const BUCKET = process.env.SUPABASE_BUCKET || 'uploads';

let client = null;
if (process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_KEY) {
  const { createClient } = require('@supabase/supabase-js');
  client = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY, {
    auth: { persistSession: false },
  });
}

function usingSupabase() {
  return !!client;
}

// Save a buffer under `key`. Returns the key (what to store in the DB).
async function saveObject(key, buffer, contentType = 'application/octet-stream') {
  if (client) {
    const { error } = await client.storage.from(BUCKET).upload(key, buffer, { contentType, upsert: true });
    if (error) throw error;
  } else {
    const p = path.join(uploadsRoot, key);
    fs.mkdirSync(path.dirname(p), { recursive: true });
    fs.writeFileSync(p, buffer);
  }
  return key;
}

// Resolve a stored value to something serveable.
// → { redirectUrl } for Supabase, { filePath } for local disk, or null.
async function resolveObject(stored) {
  if (!stored) return null;
  if (client) {
    const { data, error } = await client.storage.from(BUCKET).createSignedUrl(stored, 3600);
    if (error || !data) return null;
    return { redirectUrl: data.signedUrl };
  }
  // Local: accept relative keys and legacy absolute paths from older rows.
  const p = path.isAbsolute(stored) ? stored : path.join(uploadsRoot, stored);
  if (!fs.existsSync(p)) return null;
  return { filePath: p };
}

// Delete all objects under a key prefix (best-effort; used on re-upload/cleanup).
async function removePrefix(prefix) {
  try {
    if (client) {
      const { data } = await client.storage.from(BUCKET).list(prefix, { limit: 1000 });
      if (data && data.length) {
        await client.storage.from(BUCKET).remove(data.map(f => `${prefix}/${f.name}`));
      }
    } else {
      const p = path.join(uploadsRoot, prefix);
      if (fs.existsSync(p)) fs.rmSync(p, { recursive: true, force: true });
    }
  } catch (err) {
    console.error('storage removePrefix failed (non-fatal):', err.message);
  }
}

// Content type from a file extension.
function contentTypeFor(ext) {
  const e = String(ext || '').toLowerCase().replace(/^\./, '');
  if (e === 'jpg' || e === 'jpeg') return 'image/jpeg';
  if (e === 'png') return 'image/png';
  if (e === 'gif') return 'image/gif';
  if (e === 'webp') return 'image/webp';
  if (e === 'pdf') return 'application/pdf';
  if (e === 'xlsx') return 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
  if (e === 'xls') return 'application/vnd.ms-excel';
  return 'application/octet-stream';
}

module.exports = { saveObject, resolveObject, removePrefix, usingSupabase, contentTypeFor };
