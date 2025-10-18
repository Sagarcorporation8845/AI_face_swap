const { Markup } = require('telegraf');

const keyboards = {
  mainMenu: Markup.inlineKeyboard([
    Markup.button.callback('🎬 Video Face Swap', 'start_video_swap'),
    Markup.button.callback('🖼️ Photo Face Swap', 'start_photo_swap'),
  ]),
  // New keyboard for membership check
  joinGroup: (groupLink) => Markup.inlineKeyboard([
    Markup.button.url('🚀 Join Our Community', groupLink),
    Markup.button.callback('✅ I have Joined', 'check_membership')
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
  // New messages for membership
  membershipRequired: "To use this bot, you must first join our main Telegram group.",
  membershipVerified: "Thank you for joining! You can now use the bot. Please choose an operation:",
  membershipFailed: "It looks like you haven't joined yet, or Telegram's cache is slow. Please make sure you've joined, then click '✅ I have Joined' again."
};

module.exports = { keyboards, messages };