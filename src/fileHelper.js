const fs = require('fs');
const path = require('path');
const axios = require('axios');

const tempDir = path.join(__dirname, '..', 'temp');

// Ensure the temp directory exists
if (!fs.existsSync(tempDir)) {
  fs.mkdirSync(tempDir, { recursive: true });
}

/**
 * Downloads a file from Telegram to the local temp directory.
 * @param {object} ctx - The Telegraf context.
 * @param {string} fileId - The Telegram file_id.
 * @param {string} extension - The file extension (e.g., 'mp4', 'png').
 * @returns {Promise<string>} - The local path to the downloaded file.
 */
const downloadFile = async (ctx, fileId, extension) => {
  try {
    const fileLink = await ctx.telegram.getFileLink(fileId);
    const uniqueName = `${ctx.from.id}_${Date.now()}.${extension}`;
    const localPath = path.join(tempDir, uniqueName);

    const response = await axios({
      method: 'get',
      url: fileLink.href,
      responseType: 'stream',
    });

    const writer = fs.createWriteStream(localPath);

    // --- THIS IS THE ROBUST PROMISE LOGIC ---
    return new Promise((resolve, reject) => {
      response.data.pipe(writer);

      response.data.on('error', err => { // Error on the download stream
        console.error(`[DEBUG] fileHelper: Download stream error: ${err.message}`);
        writer.close();
        fs.unlink(localPath, () => {}); // Clean up broken file
        reject(err);
      });
      
      writer.on('error', err => { // Error on the file-writing stream
        console.error(`[DEBUG] fileHelper: File write error: ${err.message}`);
        fs.unlink(localPath, () => {}); // Clean up broken file
        reject(err);
      });
      
      writer.on('finish', () => { // Success
        console.log(`[DEBUG] fileHelper: File downloaded successfully to ${localPath}`);
        resolve(localPath);
      });
    });

  } catch (error) {
    console.error(`[DEBUG] fileHelper: Error getting file link: ${error.message}`);
    throw new Error('Failed to download file from Telegram.');
  }
};

/**
 * Deletes temporary files from the server.
 * @param {string[]} filePaths - An array of local file paths to delete.
 */
const deleteFiles = (filePaths) => {
  if (!Array.isArray(filePaths)) return;

  filePaths.forEach((filePath) => {
    // --- THIS CHECK PREVENTS THE CRASH ---
    if (filePath && typeof filePath === 'string' && fs.existsSync(filePath)) {
      fs.unlink(filePath, (err) => {
        if (err) console.error(`Failed to delete temp file: ${filePath}`, err);
        else console.log(`[DEBUG] fileHelper: Deleted temp file: ${filePath}`);
      });
    } else {
      console.log(`[DEBUG] fileHelper: Skipped deleting invalid path: ${filePath}`);
    }
  });
};

module.exports = { downloadFile, deleteFiles };