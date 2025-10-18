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
    return new Promise((resolve, reject) => {
      response.data.pipe(writer);
      let error = null;
      writer.on('error', err => {
        error = err;
        writer.close();
        reject(err);
      });
      writer.on('close', () => {
        if (!error) {
          console.log(`[DEBUG] fileHelper: File downloaded successfully to ${localPath}`);
          resolve(localPath);
        }
      });
    });
  } catch (error) {
    console.error(`[DEBUG] fileHelper: Error getting file link: ${error.message}`);
    throw new Error('Failed to download file from Telegram.');
  }
};

/**
 * **NEW FUNCTION**
 * Downloads a file from a public URL to the local temp directory.
 * @param {string} url - The public URL of the file to download.
 * @param {string} userId - The user's Telegram ID for unique naming.
 * @returns {Promise<string>} - The local path to the downloaded file.
 */
const downloadFromUrl = async (url, userId) => {
  try {
    const extension = path.extname(url).split('?')[0].substring(1) || 'mp4';
    const uniqueName = `${userId}_result_${Date.now()}.${extension}`;
    const localPath = path.join(tempDir, uniqueName);
    const response = await axios({
      method: 'get',
      url: url,
      responseType: 'stream',
    });
    const writer = fs.createWriteStream(localPath);
    return new Promise((resolve, reject) => {
      response.data.pipe(writer);
      let error = null;
      writer.on('error', err => {
        error = err;
        writer.close();
        reject(err);
      });
      writer.on('close', () => {
        if (!error) {
          console.log(`[DEBUG] fileHelper: Final result downloaded successfully to ${localPath}`);
          resolve(localPath);
        }
      });
    });
  } catch (error) {
    console.error(`[DEBUG] fileHelper: Error downloading final result from URL: ${error.message}`);
    throw new Error('Failed to download final result file.');
  }
};


/**
 * Deletes temporary files from the server.
 * @param {string[]} filePaths - An array of local file paths to delete.
 */
const deleteFiles = (filePaths) => {
  if (!Array.isArray(filePaths)) return;

  filePaths.forEach((filePath) => {
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

module.exports = { downloadFile, downloadFromUrl, deleteFiles };