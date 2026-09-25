// Zip-bomb guard for untrusted .xlsx uploads (an .xlsx is a zip archive). Reads
// only the central directory — nothing is decompressed — and rejects archives
// whose declared uncompressed size, entry count, or compression ratio is abusive
// before any parser touches them.
import AdmZip from 'adm-zip';
import { badRequest } from '../../lib/errors.js';

const MAX_ENTRIES = 5000;
const MAX_UNCOMPRESSED = 250 * 1024 * 1024; // 250 MB total
const MAX_ENTRY = 100 * 1024 * 1024;        // 100 MB any single part
const MAX_RATIO = 200;                      // uncompressed : compressed, for large archives

export function assertSafeXlsx(buf: Buffer): void {
  if (buf.subarray(0, 2).toString('latin1') !== 'PK') return; // legacy binary .xls: not a zip, parser handles it
  let entries: AdmZip.IZipEntry[];
  try {
    entries = new AdmZip(buf).getEntries();
  } catch {
    throw badRequest("That file doesn't look like a valid Excel workbook.");
  }
  if (entries.length > MAX_ENTRIES) throw badRequest('Spreadsheet has too many parts to process safely.');
  let total = 0;
  let compressed = 0;
  for (const e of entries) {
    const size = e.header.size || 0;
    if (size > MAX_ENTRY) throw badRequest('Spreadsheet is too large to process safely.');
    total += size;
    compressed += e.header.compressedSize || 0;
  }
  if (total > MAX_UNCOMPRESSED || (compressed > 0 && total > 20 * 1024 * 1024 && total / compressed > MAX_RATIO)) {
    throw badRequest('Spreadsheet is too large to process safely.');
  }
}
