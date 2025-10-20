const axios = require('axios');
const fs = require('fs');
const path = require('path');
const FormData = require('form-data');
const { randomUUID } = require('crypto');

// --- Configuration ---
const API_BASE_URL = 'https://api.arting.ai';
const POLLING_INTERVAL_MS = 5000; // Check every 5 seconds
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
  console.log(`[DEBUG] uploadFile: Attempting to read file from path: ${filePath}`);
  
  if (!filePath || typeof filePath !== 'string') {
    console.error(`[DEBUG] uploadFile: FATAL! Received invalid filePath: ${filePath}`);
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

async function submitVideoTask(videoGetUrl, imageGetUrl, authToken, duration) {
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
  // MODIFICATION: Increased maxAttempts from 60 to 120 for a 10-minute timeout
  const maxAttempts = 120; // 10 minutes (120 * 5s)

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
  // MODIFICATION: Increased maxAttempts from 60 to 120 for a 10-minute timeout
  const maxAttempts = 120; // 10 minutes

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

// --- Image Enhance Functions ---

async function submitImageEnhanceTask(imageUrl, authToken) {
  try {
    const payload = {
      image_url: imageUrl,
      scale: 4,
      version: 'v1.4',
    };
    const response = await axios.post(`${API_BASE_URL}/api/image/image-enhance/create-task`, payload, {
      headers: {
        'Content-Type': 'application/json',
        'authorization': authToken,
        'Origin': 'https://arting.ai',
        'Referer': 'https://arting.ai/',
      },
    });
    if (response.data?.code === 100000 && response.data.data?.task_id) {
      return response.data.data.task_id;
    } else {
      throw new Error(`Failed to submit image enhance task: ${response.data?.message || 'Unknown error'}`);
    }
  } catch (error) {
    console.error('Error submitting image enhance task:', error.response ? error.response.data : error.message);
    throw error;
  }
}

async function checkImageEnhanceStatus(taskId, authToken) {
  let attempts = 0;
  const maxAttempts = 120; // 10 minutes

  while (attempts < maxAttempts) {
    attempts++;
    try {
      const resultEndpoint = `/api/image/image-enhance/get-task-result?task_id=${taskId}`;
      const response = await axios.get(`${API_BASE_URL}${resultEndpoint}`, {
        headers: {
          'authorization': authToken,
          'Origin': 'https://arting.ai',
          'Referer': 'https://arting.ai/',
        },
      });

      if (response.data?.code === 100000) {
        const resultData = response.data.data;
        if (resultData.status === 1 && resultData.task_result?.file_oss_path) {
          return resultData.task_result.file_oss_path;
        } else if (resultData.status === -1) {
          throw new Error(`Task failed with status: ${resultData.status}`);
        }
      }
    } catch (error) {
      console.error(`Attempt ${attempts}: Error checking image enhance status:`, error.response ? error.response.data : error.message);
      if (attempts >= maxAttempts) throw error;
    }
    await new Promise(resolve => setTimeout(resolve, POLLING_INTERVAL_MS));
  }
  throw new Error('Polling timed out for image enhance task.');
}


// --- Main Public Function ---

/**
 * Processes a face swap request.
 * @param {'video' | 'photo'} type - The type of swap to perform.
 * @param {string} targetPath - Local path to the target video/photo.
 * @param {string} sourcePath - Local path to the source face photo.
 * @param {number} [duration] - The duration of the video to process (only for video type).
 * @returns {Promise<string>} - The URL of the final output file.
 */
const processSwap = async (type, targetPath, sourcePath, duration) => {
  const authToken = randomUUID();
  
  console.log(`[DEBUG] apiHandler.processSwap: Received targetPath: ${targetPath}`);
  console.log(`[DEBUG] apiHandler.processSwap: Received sourcePath: ${sourcePath}`);

  if (!targetPath || !sourcePath || typeof targetPath !== 'string' || typeof sourcePath !== 'string') {
    console.error("[DEBUG] FATAL: processSwap received an undefined or invalid path.");
    throw new Error("processSwap received an undefined path. Check bot.js logs.");
  }

  console.log(`[${authToken}] Starting ${type} swap task...`);

  const targetExt = type === 'video' ? 'mp4' : path.extname(targetPath).substring(1);
  const sourceExt = 'png';
  const targetContentType = type === 'video' ? 'video/mp4' : `image/${targetExt}`;
  
  const targetUrls = await getSignedUrl(targetExt);
  const sourceUrls = await getSignedUrl(sourceExt);

  // ADDED LOGS FOR UPLOADED FILE URLS
  console.log(`[${authToken}] Target File URL: ${targetUrls.get}`);
  console.log(`[${authToken}] Source File URL: ${sourceUrls.get}`);

  console.log(`[${authToken}] Uploading files...`);
  await Promise.all([
    uploadFile(targetUrls.put, targetPath, targetContentType),
    uploadFile(sourceUrls.put, sourcePath, 'image/png')
  ]);
  console.log(`[${authToken}] Uploads complete.`);

  let outputUrl;
  if (type === 'video') {
    console.log(`[${authToken}] Submitting video task...`);
    const taskId = await submitVideoTask(targetUrls.get, sourceUrls.get, authToken, duration);
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

const processImageEnhance = async (imagePath) => {
    const authToken = randomUUID();

    console.log(`[DEBUG] apiHandler.processImageEnhance: Received imagePath: ${imagePath}`);

    if (!imagePath || typeof imagePath !== 'string') {
        console.error("[DEBUG] FATAL: processImageEnhance received an undefined or invalid path.");
        throw new Error("processImageEnhance received an undefined path. Check bot.js logs.");
    }

    console.log(`[${authToken}] Starting image enhance task...`);

    const imageExt = path.extname(imagePath).substring(1);
    const imageContentType = `image/${imageExt}`;

    const imageUrls = await getSignedUrl(imageExt);

    // ADDED LOG FOR UPLOADED FILE URL
    console.log(`[${authToken}] Image File URL: ${imageUrls.get}`);

    console.log(`[${authToken}] Uploading file...`);
    await uploadFile(imageUrls.put, imagePath, imageContentType);
    console.log(`[${authToken}] Upload complete.`);

    console.log(`[${authToken}] Submitting image enhance task...`);
    const taskId = await submitImageEnhanceTask(imageUrls.get, authToken);
    console.log(`[${authToken}] Polling image enhance task: ${taskId}`);
    const outputUrl = await checkImageEnhanceStatus(taskId, authToken);

    console.log(`[${authToken}] Task complete. Output: ${outputUrl}`);
    return outputUrl;
};

module.exports = { processSwap, processImageEnhance };