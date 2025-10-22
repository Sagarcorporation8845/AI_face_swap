const { createClient } = require('redis');
require('dotenv').config(); // Load environment variables

// --- Redis Client Setup ---
// Credentials are now loaded from your .env file
const client = createClient({
  username: process.env.REDIS_USERNAME || 'default', // Use 'default' if REDIS_USERNAME is not set
  password: process.env.REDIS_PASSWORD,
  socket: {
    host: process.env.REDIS_HOST,
    port: process.env.REDIS_PORT, // Ensure this is set in your .env
  },
});

client.on('error', (err) => console.error('Redis Client Error', err));

// Connect to Redis immediately when the module is loaded.
(async () => {
  // Check if credentials are provided before trying to connect
  if (!process.env.REDIS_PASSWORD || !process.env.REDIS_HOST || !process.env.REDIS_PORT) {
    console.error('Redis credentials (PASSWORD, HOST, PORT) not found in .env file. State manager will not work.');
    return;
  }
  
  try {
    await client.connect();
    console.log('Successfully connected to Redis!');
  } catch (err) {
    console.error('Failed to connect to Redis:', err);
  }
})();


/**
 * Sets the state for a given user. The state object is stringified for storage.
 * @param {number | string} userId - The user's Telegram ID.
 * @param {object} state - The state object to save.
 * @returns {Promise<void>}
 */
const setState = async (userId, state) => {
  try {
    // Redis keys are strings. We'll use a prefix for good practice.
    const key = `user:${userId}`;
    // Redis stores strings, so we must stringify our state object.
    const value = JSON.stringify(state);
    // Set the value with a Time-To-Live (TTL) of 1 hour (3600 seconds)
    // This automatically cleans up old states if a user abandons a task.
    await client.set(key, value, { EX: 3600 });
  } catch (err) {
    console.error(`[Redis] Error setting state for user ${userId}:`, err);
  }
};

/**
 * Retrieves the state for a given user. The stored string is parsed back into an object.
 * @param {number | string} userId - The user's Telegram ID.
 * @returns {Promise<object | null>} - The parsed state object, or null if not found or on error.
 */
const getState = async (userId) => {
  try {
    const key = `user:${userId}`;
    const result = await client.get(key);
    // If a state is found, parse it from JSON string to an object.
    return result ? JSON.parse(result) : null;
  } catch (err) {
    console.error(`[Redis] Error getting state for user ${userId}:`, err);
    return null; // Return null on error to prevent crashes.
  }
};

/**
 * Deletes the state for a given user.
 * @param {number | string} userId - The user's Telegram ID.
 * @returns {Promise<void>}
 */
const clearState = async (userId) => {
  try {
    const key = `user:${userId}`;
    await client.del(key);
  } catch (err) {
    console.error(`[Redis] Error deleting state for user ${userId}:`, err);
  }
};

module.exports = { setState, getState, clearState };