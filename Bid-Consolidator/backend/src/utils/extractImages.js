const fs = require('fs');
const path = require('path');
const AdmZip = require('adm-zip');

function extractImagesFromExcel(filePath, outputDir) {
  const images = {};

  try {
    // Create output directory if it doesn't exist
    if (!fs.existsSync(outputDir)) {
      fs.mkdirSync(outputDir, { recursive: true });
    }

    // Open Excel file as a zip
    const zip = new AdmZip(filePath);
    const zipEntries = zip.getEntries();

    // Look for media files (images in xl/media/)
    zipEntries.forEach(entry => {
      if (entry.entryName.startsWith('xl/media/') && /\.(png|jpg|jpeg|gif|bmp)$/i.test(entry.entryName)) {
        const imageName = path.basename(entry.entryName);
        const outputPath = path.join(outputDir, imageName);

        // Extract to file
        fs.writeFileSync(outputPath, entry.getData());
        images[imageName] = outputPath;
      }
    });

    return images;
  } catch (err) {
    console.error('Error extracting images:', err);
    return {};
  }
}

module.exports = { extractImagesFromExcel };
