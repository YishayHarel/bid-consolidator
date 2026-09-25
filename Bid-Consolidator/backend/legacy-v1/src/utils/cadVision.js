// CAD vision: render PDF/image pages, ask Gemini to find each distinct product
// (name/style # + bounding box), and crop each product out for its item image.
const { GoogleGenAI } = require('@google/genai');
const { pdfToPng } = require('pdf-to-png-converter');
const sharp = require('sharp');

function aiEnabled() {
  return !!process.env.GEMINI_API_KEY;
}

function client() {
  if (!process.env.GEMINI_API_KEY) throw new Error('GEMINI_API_KEY not set');
  return new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
}

// Render a PDF buffer to an array of page PNG buffers.
async function renderPdfToPages(buffer) {
  const pages = await pdfToPng(buffer, { viewportScale: 2.0 });
  return pages.map(p => p.content);
}

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

// Ask Gemini for the products on one page image (PNG buffer). Retries a few
// times on transient overload (429/503) with backoff.
async function detectProducts(pngBuffer) {
  const ai = client();
  const req = {
    model: process.env.GEMINI_MODEL || 'gemini-3.6-flash',
    contents: [{
      role: 'user',
      parts: [
        { inlineData: { mimeType: 'image/png', data: pngBuffer.toString('base64') } },
        { text: PROMPT },
      ],
    }],
    config: { responseMimeType: 'application/json', temperature: 0 },
  };
  let resp, lastErr;
  for (let attempt = 0; attempt < 4; attempt++) {
    try { resp = await ai.models.generateContent(req); break; }
    catch (e) {
      lastErr = e;
      const msg = String(e && e.message || '');
      const transient = /429|503|overloaded|UNAVAILABLE|high demand|rate/i.test(msg);
      if (!transient || attempt === 3) throw e;
      await new Promise(r => setTimeout(r, 1500 * (attempt + 1)));
    }
  }
  if (!resp) throw lastErr;
  let parsed;
  try { parsed = JSON.parse(resp.text); } catch { return []; }
  const products = Array.isArray(parsed?.products) ? parsed.products : [];
  return products
    .map(p => ({
      // Strip a leading "STYLE #:" / "STYLE#" style label for a clean name.
      name: String(p.name || '').replace(/^\s*style\s*#?\s*:?\s*/i, '').trim(),
      specs: String(p.specs || '').trim(),
      box: p.box,
    }))
    .filter(p => Array.isArray(p.box) && p.box.length === 4 && p.box.every(n => typeof n === 'number'));
}

// Crop a normalized [ymin,xmin,ymax,xmax] (0-1000) box out of a page PNG buffer.
async function cropBox(pngBuffer, box) {
  const meta = await sharp(pngBuffer).metadata();
  const W = meta.width, H = meta.height;
  let [ymin, xmin, ymax, xmax] = box;
  // small padding, then convert to pixels + clamp
  let left = Math.round((xmin / 1000) * W);
  let top = Math.round((ymin / 1000) * H);
  let right = Math.round((xmax / 1000) * W);
  let bottom = Math.round((ymax / 1000) * H);
  left = Math.max(0, Math.min(left, W - 2));
  top = Math.max(0, Math.min(top, H - 2));
  right = Math.max(left + 1, Math.min(right, W));
  bottom = Math.max(top + 1, Math.min(bottom, H));
  return sharp(pngBuffer).extract({ left, top, width: right - left, height: bottom - top }).png().toBuffer();
}

// Normalize any raster image buffer to PNG (for non-PDF CADs).
async function imageToPng(buffer) {
  return sharp(buffer).png().toBuffer();
}

module.exports = { aiEnabled, renderPdfToPages, detectProducts, cropBox, imageToPng };
