const axios = require('axios');
const fs = require('fs');
const path = require('path');
const FormData = require('form-data');
const { randomUUID } = require('crypto');

// --- Configuration ---
const API_BASE_URL = 'https://api.arting.ai';
const POLLING_INTERVAL_MS = 5000;
const CLIENT_SIDE_DELAY_MS = 100;

// --- Private Helper Functions ---

async function getSignedUrl(fileSuffix) {
  try {
    const response = await axios.post(`${API_BASE_URL}/api/cg/get_oss_signed_urls`, {
      f_suffixs: [fileSuffix],
    }, {
      headers: {
        'Content-Type': 'application/json',
        'Origin': 'https://arting.ai',
        'Referer': 'https://arting.ai/',
      },
    });
    if (response.data?.code === 100000 && response.data.data?.oss_signed_urls?.length > 0) {
      return response.data.data.oss_signed_urls[0];
    } else {
      throw new Error(`Failed to get signed URL: ${response.data?.message || 'Unknown error'}`);
    }
  } catch (error) {
    console.error(`Error getting signed URL for ${fileSuffix}:`, error.response ? error.response.data : error.message);
    throw error;
  }
}

async function uploadFile(putUrl, filePath, contentType) {
  // --- DEBUG LOG 7 ---
  console.log(`[DEBUG] uploadFile: Attempting to read file from path: ${filePath}`);
  
  if (!filePath || typeof filePath !== 'string') {
    console.error(`[DEBUG] uploadFile: FATAL! Received invalid filePath: ${filePath}`);
    // This is the error you were seeing.
    throw new Error(`The "path" argument must be of type string. Received ${typeof filePath}`);
  }
  
  try {
    const fileStream = fs.createReadStream(filePath);
    const stats = fs.statSync(filePath);
    const fileSizeInBytes = stats.size;

    await axios.put(putUrl, fileStream, {
      headers: {
        'Content-Type': contentType,
        'Content-Length': fileSizeInBytes,
      },
      maxBodyLength: Infinity,
      maxContentLength: Infinity,
    });
  } catch (error) {
    console.error(`Error uploading ${path.basename(filePath)}:`, error.response ? error.response.statusText : error.message);
    throw error;
  }
}

// --- Video-Specific Functions ---

async function submitVideoTask(videoGetUrl, imageGetUrl, authToken, duration = 7) {
  await new Promise(resolve => setTimeout(resolve, CLIENT_SIDE_DELAY_MS));
  try {
    const payload = {
      task_type: 2,
      file_type: "video",
      target_medio_url: videoGetUrl,
      target_source_face_url: imageGetUrl,
      duration: duration,
      start_clip_sec: 0,
      end_clip_sec: duration,
      face_enhance: true,
    };
    const response = await axios.post(`${API_BASE_URL}/api/fs/gifvideo/mutilface`, payload, {
      headers: {
        'Content-Type': 'application/json',
        'authorization': authToken,
        'Origin': 'https://arting.ai',
        'Referer': 'https://arting.ai/',
      },
    });
    if (response.data?.code === 100000 && response.data.data?.prediction_id) {
      return response.data.data.prediction_id;
    } else {
      throw new Error(`Failed to submit video task: ${response.data?.message || 'Unknown error'}`);
    }
  } catch (error) {
    console.error('Error submitting video task:', error.response ? error.response.data : error.message);
    throw error;
  }
}

async function checkVideoStatus(predictionId, authToken) {
  let attempts = 0;
  const maxAttempts = 60; // 5 minutes

  while (attempts < maxAttempts) {
    attempts++;
    try {
      const formData = new FormData();
      formData.append('prediction_id', predictionId);
      formData.append('task_type', '2');
      formData.append('rank', '');

      const response = await axios.post(`${API_BASE_URL}/api/mfs/gifvideo/task/status`, formData, {
        headers: {
          ...formData.getHeaders(),
          'authorization': authToken,
          'Origin': 'https://arting.ai',
          'Referer': 'https://arting.ai/',
        },
      });

      if (response.data?.code === 100000) {
        const statusData = response.data.data;
        if (statusData.status === 'success' && statusData.output) {
          return statusData.output;
        } else if (statusData.status === 'failed' || statusData.status === 'error') {
          throw new Error(`Task failed with status: ${statusData.status}`);
        }
      }
    } catch (error) {
      console.error(`Attempt ${attempts}: Error checking video status:`, error.response ? error.response.data : error.message);
      if (attempts >= maxAttempts) throw error;
    }
    await new Promise(resolve => setTimeout(resolve, POLLING_INTERVAL_MS));
  }
  throw new Error('Polling timed out for video task.');
}

// --- Photo-Specific Functions ---

async function submitPhotoTask(baseImageUrl, faceImageUrl, authToken) {
  try {
    const payload = {
      target_image_file: baseImageUrl,
      target_face_file: faceImageUrl,
    };
    const response = await axios.post(`${API_BASE_URL}/api/fs/singleface`, payload, {
      headers: {
        'Content-Type': 'application/json',
        'authorization': authToken,
        'Origin': 'https://arting.ai',
        'Referer': 'https://arting.ai/',
      },
    });
    if (response.data?.code === 100000 && response.data.data?.request_id) {
      return response.data.data.request_id;
    } else {
      throw new Error(`Failed to submit photo task: ${response.data?.message || 'Unknown error'}`);
    }
  } catch (error) {
    console.error('Error submitting photo task:', error.response ? error.response.data : error.message);
    throw error;
  }
}

async function checkPhotoStatus(requestId, authToken) {
  await new Promise(resolve => setTimeout(resolve, POLLING_INTERVAL_MS));
  let attempts = 0;
  const maxAttempts = 60; // 5 minutes

  while (attempts < maxAttempts) {
    attempts++;
    try {
      const resultEndpoint = `/api/fs/result?request_id=${requestId}`;
      const response = await axios.get(`${API_BASE_URL}${resultEndpoint}`, {
        headers: {
          'authorization': authToken,
          'Origin': 'https://arting.ai',
          'Referer': 'https://arting.ai/',
        },
      });

      if (response.data?.code === 100000) {
        const resultData = response.data.data;
        if (resultData.status === 'success' && resultData.result_img_url) {
          return resultData.result_img_url;
        } else if (resultData.status === 'failed' || resultData.status === 'error') {
          throw new Error(`Task failed with status: ${resultData.status}`);
        }
      }
    } catch (error) {
      console.error(`Attempt ${attempts}: Error checking photo status:`, error.response ? error.response.data : error.message);
      if (attempts >= maxAttempts) throw error;
    }
    await new Promise(resolve => setTimeout(resolve, POLLING_INTERVAL_MS));
  }
  throw new Error('Polling timed out for photo task.');
}


// --- Main Public Function ---

/**
 * Processes a face swap request.
 * @param {'video' | 'photo'} type - The type of swap to perform.
 * @param {string} targetPath - Local path to the target video/photo.
 * @param {string} sourcePath - Local path to the source face photo.
 *TA
 * @returns {Promise<string>} - The URL of the final output file.
 */
const processSwap = async (type, targetPath, sourcePath) => {
  const authToken = randomUUID();
  
  // --- DEBUG LOG 5 ---
  console.log(`[DEBUG] apiHandler.processSwap: Received targetPath: ${targetPath}`);
  console.log(`[DEBUG] apiHandler.processSwap: Received sourcePath: ${sourcePath}`);

  // --- DEBUG CHECK ---
  if (!targetPath || !sourcePath || typeof targetPath !== 'string' || typeof sourcePath !== 'string') {
    console.error("[DEBUG] FATAL: processSwap received an undefined or invalid path.");
    throw new Error("processSwap received an undefined path. Check bot.js logs.");
  }

  console.log(`[${authToken}] Starting ${type} swap task...`);

  // 1. Get Signed URLs
  const targetExt = type === 'video' ? 'mp4' : path.extname(targetPath).substring(1);
  const sourceExt = 'png';
  const targetContentType = type === 'video' ? 'video/mp4' : `image/${targetExt}`;
  
  const targetUrls = await getSignedUrl(targetExt);
  const sourceUrls = await getSignedUrl(sourceExt);

  // 2. Upload Files in Parallel
  console.log(`[${authToken}] Uploading files...`);
  await Promise.all([
    uploadFile(targetUrls.put, targetPath, targetContentType),
    uploadFile(sourceUrls.put, sourcePath, 'image/png')
  ]);
  console.log(`[${authToken}] Uploads complete.`);

  // 3. Submit & Poll
  let outputUrl;
  if (type === 'video') {
    console.log(`[${authToken}] Submitting video task...`);
    const taskId = await submitVideoTask(targetUrls.get, sourceUrls.get, authToken);
    console.log(`[${authToken}] Polling video task: ${taskId}`);
    outputUrl = await checkVideoStatus(taskId, authToken);
  } else {
    console.log(`[${authToken}] Submitting photo task...`);
    const taskId = await submitPhotoTask(targetUrls.get, sourceUrls.get, authToken);
    console.log(`[${authToken}] Polling photo task: ${taskId}`);
    outputUrl = await checkPhotoStatus(taskId, authToken);
  }

  console.log(`[${authToken}] Task complete. Output: ${outputUrl}`);
  return outputUrl;
};

module.exports = { processSwap };