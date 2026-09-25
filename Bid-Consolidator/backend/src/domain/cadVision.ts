// CAD vision: render design files to page images, ask Gemini to find each
// distinct product on a page (name/style #, key specs, bounding box), and crop
// each product out as its item image. Runs inside a background job, never an
// HTTP request. Transient model overloads are retried with backoff.
import { GoogleGenAI } from '@google/genai';
import sharp from 'sharp';
import { config } from '../config.js';
import { unavailable } from '../lib/errors.js';

export interface DetectedProduct {
  name: string;
  specs: string;
  box: [number, number, number, number] | null; // [ymin, xmin, ymax, xmax], 0-1000
}

let ai: GoogleGenAI | null = null;
function client(): GoogleGenAI {
  if (!config.GEMINI_API_KEY) throw unavailable('AI CAD reading is not configured (GEMINI_API_KEY).');
  return (ai ??= new GoogleGenAI({ apiKey: config.GEMINI_API_KEY }));
}

/** Render a PDF to one PNG buffer per page (capped to keep jobs bounded). */
export async function renderPdfToPages(pdf: Buffer, maxPages = 60): Promise<Buffer[]> {
  const { pdfToPng } = await import('pdf-to-png-converter');
  const pages = await pdfToPng(pdf, { viewportScale: 2.0 });
  return pages.slice(0, maxPages).map((p) => p.content).filter((c): c is Buffer => !!c);
}

/** Normalize any raster image to PNG. */
export const imageToPng = (buf: Buffer) => sharp(buf).png().toBuffer();

const PROMPT = `You are reading a product line-sheet / CAD spec page for a consumer-goods importer.
Identify each DISTINCT physical product shown on this page (a page may show one product, or several products laid out in a grid).
For EACH product return:
- "name": its style number or label exactly as printed if visible (e.g. "FB974459A", "PY975364", "BAG A"); if there is no code, a short 2-4 word description.
- "specs": a concise one-line summary of that product's key specs shown on the sheet — include whatever is present: size/dimensions, material or GSM, pack/count, finish (e.g. powder-coated, foil, glitter), packaging. Keep under ~140 chars. Empty string if none are shown.
- "box": the bounding box around that product's artwork and its label, as [ymin, xmin, ymax, xmax], each an integer 0-1000 normalized to the image.
Rules:
- Treat each separately-labeled product as its own entry (e.g. "STYLE #: X" and "STYLE #: Y" are two products; "BAG A".."BAG F" are six).
- If the page clearly shows just ONE product, return exactly one entry whose box covers the main artwork.
- Ignore the company logo when drawing boxes; but DO read spec tables/call-outs to fill "specs".
Return ONLY JSON: {"products":[{"name":"...","specs":"...","box":[ymin,xmin,ymax,xmax]}]}`;

function isTransient(err: unknown): boolean {
  return /429|503|overloaded|UNAVAILABLE|high demand|rate|timeout|ECONNRESET/i.test(String((err as Error)?.message ?? err));
}

export async function detectProducts(png: Buffer): Promise<DetectedProduct[]> {
  const request = {
    model: config.GEMINI_MODEL,
    contents: [{ role: 'user', parts: [{ inlineData: { mimeType: 'image/png', data: png.toString('base64') } }, { text: PROMPT }] }],
    config: { responseMimeType: 'application/json', temperature: 0, abortSignal: AbortSignal.timeout(90_000) },
  };
  let text: string | undefined;
  for (let attempt = 0; ; attempt++) {
    try {
      const resp = await client().models.generateContent(request);
      text = resp.text;
      break;
    } catch (err) {
      if (!isTransient(err) || attempt >= 3) throw err;
      await new Promise((r) => setTimeout(r, 1500 * (attempt + 1)));
    }
  }
  let parsed: { products?: unknown };
  try { parsed = JSON.parse(text ?? '{}'); } catch { return []; }
  const list = Array.isArray(parsed.products) ? parsed.products : [];
  return list
    .map((p) => {
      const o = p as { name?: unknown; specs?: unknown; box?: unknown };
      const box = Array.isArray(o.box) && o.box.length === 4 && o.box.every((n) => typeof n === 'number')
        ? (o.box as [number, number, number, number]) : null;
      return {
        // Strip a leading "STYLE #:" label for a clean name.
        name: String(o.name ?? '').replace(/^\s*style\s*#?\s*:?\s*/i, '').trim().slice(0, 255),
        specs: String(o.specs ?? '').trim().slice(0, 500),
        box,
      };
    })
    .filter((p) => p.box !== null);
}

/** Crop a normalized [ymin, xmin, ymax, xmax] (0-1000) box out of a page image. */
export async function cropBox(png: Buffer, box: [number, number, number, number]): Promise<Buffer> {
  const { width: W = 0, height: H = 0 } = await sharp(png).metadata();
  const [ymin, xmin, ymax, xmax] = box;
  const left = Math.max(0, Math.min(Math.round((xmin / 1000) * W), W - 2));
  const top = Math.max(0, Math.min(Math.round((ymin / 1000) * H), H - 2));
  const right = Math.max(left + 1, Math.min(Math.round((xmax / 1000) * W), W));
  const bottom = Math.max(top + 1, Math.min(Math.round((ymax / 1000) * H), H));
  return sharp(png).extract({ left, top, width: right - left, height: bottom - top }).png().toBuffer();
}
