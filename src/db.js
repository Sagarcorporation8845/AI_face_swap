const { Pool } = require('pg');
const fs = require('fs');
const path = require('path');
require('dotenv').config();

const sslConfig = {
  rejectUnauthorized: true,
  ca: fs.readFileSync(path.join(__dirname, 'ca.pem')).toString(),
};

const pool = new Pool({
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  host: process.env.DB_HOST,
  port: process.env.DB_PORT,
  database: process.env.DB_DATABASE,
  ssl: sslConfig,
});

const initDb = async () => {
  const queryText = `
    CREATE TABLE IF NOT EXISTS users (
      id BIGINT PRIMARY KEY,
      first_name VARCHAR(255) NOT NULL,
      last_name VARCHAR(255),
      username VARCHAR(255),
      is_premium BOOLEAN DEFAULT FALSE,
      created_at TIMESTAMPTZ DEFAULT NOW(),
      last_seen TIMESTAMPTZ DEFAULT NOW(),
      photo_swaps_used INT DEFAULT 0,
      video_swaps_used INT DEFAULT 0,
      image_enhances_used INT DEFAULT 0,
      premium_start_date TIMESTAMPTZ,
      premium_end_date TIMESTAMPTZ,
      daily_photo_swaps INT DEFAULT 0,
      daily_video_swaps INT DEFAULT 0,
      daily_image_enhances INT DEFAULT 0,
      last_active_date TIMESTAMPTZ
    );
  `;

  const alterTableQueries = [
    'ALTER TABLE users ADD COLUMN IF NOT EXISTS daily_photo_swaps INT DEFAULT 0;',
    'ALTER TABLE users ADD COLUMN IF NOT EXISTS daily_video_swaps INT DEFAULT 0;',
    'ALTER TABLE users ADD COLUMN IF NOT EXISTS daily_image_enhances INT DEFAULT 0;',
    'ALTER TABLE users ADD COLUMN IF NOT EXISTS last_active_date TIMESTAMPTZ;',
  ];

  try {
    await pool.query(queryText);
    for (const query of alterTableQueries) {
      await pool.query(query);
    }
    console.log('Database initialized and "users" table is ready.');
  } catch (err) {
    console.error('Error initializing database table:', err);
    process.exit(1);
  }
};

const upsertUser = async (user) => {
  const queryText = `
    INSERT INTO users (id, first_name, last_name, username)
    VALUES ($1, $2, $3, $4)
    ON CONFLICT (id)
    DO UPDATE SET
      first_name = EXCLUDED.first_name,
      last_name = EXCLUDED.last_name,
      username = EXCLUDED.username,
      last_seen = NOW();
  `;
  const values = [user.id, user.first_name, user.last_name, user.username];
  try {
    await pool.query(queryText, values);
  } catch (err) {
    console.error(`[DB] Error upserting user ${user.id}:`, err);
  }
};

const incrementUsage = async (userId, type) => {
    let columnToIncrement, dailyColumnToIncrement;
    if (type === 'video') {
        columnToIncrement = 'video_swaps_used';
        dailyColumnToIncrement = 'daily_video_swaps';
    } else if (type === 'photo') {
        columnToIncrement = 'photo_swaps_used';
        dailyColumnToIncrement = 'daily_photo_swaps';
    } else if (type === 'image_enhance') {
        columnToIncrement = 'image_enhances_used';
        dailyColumnToIncrement = 'daily_image_enhances';
    } else {
        return;
    }
    const queryText = `UPDATE users SET ${columnToIncrement} = ${columnToIncrement} + 1, ${dailyColumnToIncrement} = ${dailyColumnToIncrement} + 1 WHERE id = $1;`;
    try {
        await pool.query(queryText, [userId]);
    } catch (err) {
        console.error(`[DB] Error incrementing usage for user ${userId}:`, err);
    }
};

const getAdminStats = async () => {
    let client;
    try {
        client = await pool.connect();
        const todayStart = new Date();
        todayStart.setHours(0, 0, 0, 0);
        const [totalUsersRes, photoSwapsRes, videoSwapsRes, imageEnhancesRes, newUsersRes, activeUsersRes] = await Promise.all([
            client.query('SELECT COUNT(*) FROM users;'),
            client.query('SELECT SUM(photo_swaps_used) FROM users;'),
            client.query('SELECT SUM(video_swaps_used) FROM users;'),
            client.query('SELECT SUM(image_enhances_used) FROM users;'),
            client.query('SELECT COUNT(*) FROM users WHERE created_at >= $1;', [todayStart]),
            client.query('SELECT COUNT(*) FROM users WHERE last_seen >= $1;', [todayStart])
        ]);
        const activeToday = parseInt(activeUsersRes.rows[0].count, 10);
        const newToday = parseInt(newUsersRes.rows[0].count, 10);
        return {
            totalUsers: parseInt(totalUsersRes.rows[0].count, 10),
            totalPhotoSwaps: parseInt(photoSwapsRes.rows[0].sum, 10) || 0,
            totalVideoSwaps: parseInt(videoSwapsRes.rows[0].sum, 10) || 0,
            totalImageEnhances: parseInt(imageEnhancesRes.rows[0].sum, 10) || 0,
            newUsersToday: newToday,
            repeatedUsersToday: activeToday - newToday,
        };
    } catch (err) {
        console.error('[DB] Error fetching admin stats:', err);
        throw err;
    } finally {
        if (client) {
            client.release();
        }
    }
};

/**
 * Finds a user by their Telegram ID or username (case-insensitive).
 * @param {string | number} identifier - The user's Telegram ID or username.
 * @returns {Promise<object|null>} - The user object or null if not found.
 */
const findUserByIdOrUsername = async (identifier) => {
    let queryText;
    let values;
    const numericId = parseInt(identifier, 10);

    if (!isNaN(numericId)) {
        queryText = 'SELECT id, first_name, username FROM users WHERE id = $1;';
        values = [numericId];
    } else {
        const cleanedUsername = identifier.startsWith('@') ? identifier.substring(1) : identifier;
        queryText = 'SELECT id, first_name, username FROM users WHERE lower(username) = lower($1);';
        values = [cleanedUsername];
    }

    try {
        const res = await pool.query(queryText, values);
        return res.rows[0] || null;
    } catch (err) {
        console.error(`[DB] Error finding user by identifier ${identifier}:`, err);
        return null;
    }
};

const setPremiumStatus = async (userId, days) => {
  const startDate = new Date();
  const endDate = new Date();
  endDate.setDate(startDate.getDate() + days);
  endDate.setHours(23, 59, 59, 999);

  const queryText = `
    UPDATE users SET is_premium = TRUE, premium_start_date = $2, premium_end_date = $3 WHERE id = $1;
  `;
  try {
    await pool.query(queryText, [userId, startDate, endDate]);
    console.log(`[DB] Set premium for user ${userId} for ${days} days.`);
  } catch (err) {
    console.error(`[DB] Error setting premium status for user ${userId}:`, err);
  }
};

const getUser = async (userId) => {
  const queryText = 'SELECT * FROM users WHERE id = $1;';
  try {
    const res = await pool.query(queryText, [userId]);

    const user = res.rows[0];

    if (user && user.is_premium && user.premium_end_date && new Date(user.premium_end_date) < new Date()) {
      // Premium has expired, update the user in the DB
      const updateQuery = 'UPDATE users SET is_premium = FALSE WHERE id = $1;';
      await pool.query(updateQuery, [userId]);

      // Update the user object in memory before returning
      user.is_premium = false;
      console.log(`[DB] Deactivated expired premium for user ${userId}.`);
    }

    return user || null;
    
  } catch (err) {
    console.error(`[DB] Error fetching user ${userId}:`, err);
    return null;
  }
};

const resetDailyLimits = async (userId) => {
  const queryText = `
    UPDATE users SET
      daily_photo_swaps = 0,
      daily_video_swaps = 0,
      daily_image_enhances = 0,
      last_active_date = NOW()
    WHERE id = $1;
  `;
  try {
    await pool.query(queryText, [userId]);
  } catch (err)
 {
    console.error(`[DB] Error resetting daily limits for user ${userId}:`, err);
  }
};

module.exports = { pool, initDb, upsertUser, incrementUsage, getAdminStats, findUserByIdOrUsername, setPremiumStatus, getUser, resetDailyLimits };