// In-memory store for user states.
// Key: userId, Value: state object
const userState = new Map();

/**
 * A user state object.
 * {
 * type: 'video' | 'photo',
 * stage: 'awaiting_target' | 'awaiting_source',
 * authToken: 'random-uuid-for-api',
 * targetPath: '/path/to/temp/file.mp4',
 * sourcePath: '/path/to/temp/file.png',
 * processingMessageId: 12345
 * }
 */

const setState = (userId, state) => {
  return userState.set(userId, state);
};

const getState = (userId) => {
  return userState.get(userId);
};

const clearState = (userId) => {
  return userState.delete(userId);
};

module.exports = { setState, getState, clearState };