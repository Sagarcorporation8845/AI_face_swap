const { Markup } = require('telegraf');

const keyboards = {
  mainMenu: Markup.inlineKeyboard([
    Markup.button.callback('🎬 Video Face Swap', 'start_video_swap'),
    Markup.button.callback('🖼️ Photo Face Swap', 'start_photo_swap'),
  ]),
  joinGroup: (groupLink) => Markup.inlineKeyboard([
    Markup.button.url('🚀 Join Our Community', groupLink),
    Markup.button.callback('✅ I have Joined', 'check_membership')
  ]),
  
  adminPanel: Markup.inlineKeyboard([
    [Markup.button.callback('📊 Refresh Stats', 'admin_refresh')],
    [Markup.button.callback('👑 Grant Premium', 'admin_grant_premium')],
  ]),

  premiumDuration: Markup.inlineKeyboard([
    [
        Markup.button.callback('☀️ 1 Day', 'premium_days_1'),
        Markup.button.callback('📅 7 Days', 'premium_days_7'),
    ],
    [
        Markup.button.callback('🗓️ 30 Days', 'premium_days_30'),
        Markup.button.callback('⚙️ Custom Days', 'premium_days_custom'),
    ],
    [Markup.button.callback('❌ Cancel', 'admin_cancel_grant')]
  ]),

  cancelGrant: Markup.inlineKeyboard([
    Markup.button.callback('❌ Cancel', 'admin_cancel_grant')
  ]),
};

const messages = {
  welcome: "Welcome to the AI Face Swapper! ✨\n\nPlease choose an operation:",
  sendTargetVideo: "Great! Please send me the **target video** you want to add a face to.\n\n(MP4 format only)",
  sendTargetPhoto: "Great! Please send me the **base photo** you want to add a face to.\n\n(PNG or JPG format only)",
  sendSourceFace: "✅ Got it! Now, please send me the **source face image**.\n\n(PNG format only)",
  processing: "⏳ Thank you! I have everything I need.\n\nYour request is processing. This may take a minute or two, please wait...",
  error: "❌ An error occurred.\n\nSomething went wrong while processing your request. Please try again later.",
  cancel: "✅ Operation cancelled. Send /start to begin a new task.",
  success: "✅ Success! Here is your swapped file.\n\nReady for another task?",
  invalidFileType: "⚠️ **Invalid File Type!**\n\nPlease send a file in the correct format.",
  invalidState: "Please send /start to begin.",
  membershipRequired: "To use this bot, you must first join our main Telegram group.",
  membershipVerified: "Thank you for joining! You can now use the bot. Please choose an operation:",
  membershipFailed: "It looks like you haven't joined yet, or Telegram's cache is slow. Please make sure you've joined, then click '✅ I have Joined' again.",

  adminHeader: `
╭─ BOTS ADMIN PANEL ─╮
`,
  // CORRECTED SECTION: Using <b> tags for HTML parsing
  adminStats: (stats) => `
📊 <b>Bot Analytics</b>

▫️ <b>Total Users:</b> ${stats.totalUsers}
▫️ <b>Photo Swaps:</b> ${stats.totalPhotoSwaps}
▫️ <b>Video Swaps:</b> ${stats.totalVideoSwaps}

📈 <b>Today's Activity</b>
▫️ <b>New Users:</b> ${stats.newUsersToday}
▫️ <b>Returning Users:</b> ${stats.repeatedUsersToday}
`,
  adminFooter: `
╰─ ${new Date().toLocaleString('en-US', { timeZone: 'Asia/Kolkata' })} ─╯
`,

  adminGrantAskUserId: "👑 **Grant Premium Access**\n\nPlease enter the user's Telegram ID (e.g., `123456789`) or their username (e.g., `@username`).",
  adminGrantUserNotFound: (identifier) => `❌ **User Not Found**\n\nI couldn't find a user with the ID or username \`${identifier}\` in the database. Please make sure they have started the bot at least once.`,
  adminGrantAskDuration: (userInfo) => `✅ **User Found:** \`${userInfo.first_name} (@${userInfo.username || 'N/A'})\`\n\nHow long do you want to grant premium access for?`,
  adminGrantAskCustomDays: "⚙️ **Custom Duration**\n\nPlease enter the number of days for the premium subscription (e.g., 45).",
  adminGrantInvalidDays: "⚠️ **Invalid Number**\n\nPlease enter a valid number of days.",
  adminGrantSuccess: (userInfo, days) => `✅ **Success!**\n\nUser \`${userInfo.first_name}\` (ID: \`${userInfo.id}\`) has been granted premium access for <b>${days} day(s)</b>.`,
  adminGrantCancelled: "❌ **Cancelled**\n\nThe premium grant operation has been cancelled."
};

module.exports = { keyboards, messages };