const fs = require('fs');
const path = require('path');

const UPLOADS_ROOT = path.join(__dirname, '../../uploads');

async function classifyWithAI(parsed, fileName) {
  try {
    const Anthropic = require('@anthropic-ai/sdk');
    const client = new Anthropic();

    const sampleProducts = parsed.products.slice(0, 15).map(p =>
      [p.style_num, p.description, p.category, p.color].filter(Boolean).join(' | ')
    ).join('\n');

    const prompt = `You are helping organize factory quote files into project folders for a wholesale sourcing company.

File name: ${fileName}
Factory: ${parsed.factoryName || 'Unknown'}
Auto-detected division: ${parsed.division || 'Unknown'}
Auto-detected project: ${parsed.detectedProject || 'None detected'}

Sample product lines from the file:
${sampleProducts || '(no products parsed)'}

Based on this information, determine the single best folder name for this file. The folder represents the retail buyer / project this quote is for.

Common buyers include: Ross, Burlington, Body Glove, TJ Maxx, Target, Walmart, Amazon, Five Below, Costco.
If the content relates to a specific division with no clear buyer, use the division name: Hydration, Pet Beauty, Hard Coolers, Soft Coolers, Kitchen.
If you cannot determine the folder with reasonable confidence, respond with exactly: Uncategorized

Respond with ONLY the folder name — no explanation, no punctuation, just the name.`;

    const message = await client.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 20,
      messages: [{ role: 'user', content: prompt }],
    });

    const folder = message.content[0].text.trim().replace(/[^a-zA-Z0-9 _-]/g, '').trim();
    return folder || 'Uncategorized';
  } catch (err) {
    console.error('AI classify error:', err.message);
    // Fall back to rule-based detection
    return parsed.detectedProject || parsed.division || 'Uncategorized';
  }
}

async function organizeFile(currentPath, parsed, originalName) {
  const folder = await classifyWithAI(parsed, originalName);

  const destDir = path.join(UPLOADS_ROOT, folder);
  if (!fs.existsSync(destDir)) fs.mkdirSync(destDir, { recursive: true });

  const ext = path.extname(originalName);
  const base = path.basename(originalName, ext);
  const timestamp = Date.now();
  const destName = `${timestamp}-${base}${ext}`;
  const destPath = path.join(destDir, destName);

  fs.renameSync(currentPath, destPath);

  return { folder, destPath, destName };
}

// Explicit folder: division/buyer (used when token carries that metadata)
async function organizeByDivisionBuyer(currentPath, originalName, division, buyer) {
  const destDir = path.join(UPLOADS_ROOT, division, buyer);
  if (!fs.existsSync(destDir)) fs.mkdirSync(destDir, { recursive: true });

  const ext = path.extname(originalName);
  const base = path.basename(originalName, ext);
  const destName = `${Date.now()}-${base}${ext}`;
  const destPath = path.join(destDir, destName);
  fs.renameSync(currentPath, destPath);
  return { folder: `${division}/${buyer}`, destPath, destName };
}

module.exports = { organizeFile, organizeByDivisionBuyer };
