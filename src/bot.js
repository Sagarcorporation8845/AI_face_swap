require('dotenv').config();
const { Telegraf, Markup } = require('telegraf');
const stateManager = require('./stateManager');
const apiHandler = require('./apiHandler');
const fileHelper = require('./fileHelper');
const ui = require('./ui');
const path = require('path');

const bot = new Telegraf(process.env.BOT_TOKEN);
const CHANNEL_ID = process.env.CHANNEL_ID; // Your Telegram Group/Channel ID

// --- Helper function to check channel membership ---
const checkMembership = async (ctx) => {
  if (!CHANNEL_ID) {
    console.warn('[WARNING] CHANNEL_ID is not set in .env. Skipping membership check.');
    return true;
  }

  try {
    const member = await ctx.telegram.getChatMember(CHANNEL_ID, ctx.from.id);
    const isMember = ['creator', 'administrator', 'member'].includes(member.status);
    console.log(`[DEBUG] User ${ctx.from.id} membership status in ${CHANNEL_ID}: ${member.status}. Is member: ${isMember}`);
    return isMember;
  } catch (error) {
    console.error(`[ERROR] Failed to check membership for user ${ctx.from.id} in channel ${CHANNEL_ID}:`, error.message);
    if (error.response && error.response.error_code === 400 && error.response.description.includes('chat not found')) {
      console.error('[ERROR] CHANNEL_ID might be incorrect or bot is not an admin in the channel.');
      await ctx.reply('Error: Could not verify channel. Please contact support.');
      return false;
    }
    return false;
  }
};

const sendMembershipPrompt = async (ctx) => {
  try {
    const chat = await ctx.telegram.getChat(CHANNEL_ID);
    const groupLink = chat.invite_link || `https://t.me/${chat.username}`;
    await ctx.reply(ui.messages.membershipRequired, ui.keyboards.joinGroup(groupLink));
  } catch (error) {
    console.error(`[ERROR] Failed to get chat link for CHANNEL_ID ${CHANNEL_ID}:`, error.message);
    await ctx.reply("I can't get the group link right now. Please try again later or contact support.", ui.keyboards.mainMenu);
  }
};


// === COMMANDS ===

bot.start(async (ctx) => {
  console.log(`[DEBUG] User ${ctx.from.id} executing /start`);
  await stateManager.clearState(ctx.from.id);

  const isMember = await checkMembership(ctx);
  if (!isMember) {
    await sendMembershipPrompt(ctx);
  } else {
    await ctx.reply(ui.messages.welcome, ui.keyboards.mainMenu);
  }
});

bot.command('cancel', async (ctx) => {
  console.log(`[DEBUG] User ${ctx.from.id} executing /cancel`);
  const state = await stateManager.getState(ctx.from.id);
  if (state) {
    fileHelper.deleteFiles([state.targetPath, state.sourcePath]);
    await stateManager.clearState(ctx.from.id);
  }
  ctx.reply(ui.messages.cancel, Markup.removeKeyboard());
});

// === ACTIONS (Button Clicks) ===

bot.action('start_video_swap', async (ctx) => {
  console.log(`[DEBUG] User ${ctx.from.id} clicked 'start_video_swap'`);
  const isMember = await checkMembership(ctx);
  if (!isMember) {
    await ctx.answerCbQuery();
    return sendMembershipPrompt(ctx);
  }
  await stateManager.setState(ctx.from.id, { type: 'video', stage: 'awaiting_target' });
  await ctx.reply(ui.messages.sendTargetVideo, { parse_mode: 'Markdown' });
  await ctx.answerCbQuery();
});

bot.action('start_photo_swap', async (ctx) => {
  console.log(`[DEBUG] User ${ctx.from.id} clicked 'start_photo_swap'`);
  const isMember = await checkMembership(ctx);
  if (!isMember) {
    await ctx.answerCbQuery();
    return sendMembershipPrompt(ctx);
  }
  await stateManager.setState(ctx.from.id, { type: 'photo', stage: 'awaiting_target' });
  await ctx.reply(ui.messages.sendTargetPhoto, { parse_mode: 'Markdown' });
  await ctx.answerCbQuery();
});

bot.action('check_membership', async (ctx) => {
  console.log(`[DEBUG] User ${ctx.from.id} clicked 'check_membership'`);
  await ctx.answerCbQuery();
  const isMember = await checkMembership(ctx);
  if (isMember) {
    try {
        await ctx.editMessageText(ui.messages.membershipVerified, ui.keyboards.mainMenu);
    } catch (error) {
        console.error(`[ERROR] Failed to edit message after membership verification: ${error.message}`);
        await ctx.reply(ui.messages.membershipVerified, ui.keyboards.mainMenu);
    }
    await stateManager.clearState(ctx.from.id);
  } else {
    const chat = await ctx.telegram.getChat(CHANNEL_ID);
    const groupLink = chat.invite_link || `https://t.me/${chat.username}`;
    await ctx.reply(ui.messages.membershipFailed, ui.keyboards.joinGroup(groupLink));
  }
});


// === MEDIA HANDLERS ===

const handleMedia = async (ctx, mediaType, fileInfo) => {
  const userId = ctx.from.id;
  const state = await stateManager.getState(userId);

  console.log(`[DEBUG] User ${userId}: handleMedia triggered for type: ${mediaType}`);

  if (!state) {
    console.log(`[DEBUG] User ${userId}: No state found. Checking membership.`);
    const isMember = await checkMembership(ctx);
    if (!isMember) {
      return sendMembershipPrompt(ctx);
    }
    return ctx.reply(ui.messages.invalidState);
  }

  // --- STAGE 1: Awaiting Target File ---
  if (state.stage === 'awaiting_target') {
    console.log(`[DEBUG] User ${userId}: In 'awaiting_target' stage.`);
    if ((state.type === 'video' && mediaType !== 'video') || (state.type === 'photo' && mediaType !== 'photo')) {
        console.log(`[DEBUG] User ${userId}: Invalid file type for target. Expected ${state.type}, got ${mediaType}.`);
        return ctx.reply(ui.messages.invalidFileType);
    }

    const downloadMessage = await ctx.reply("✅ File received. Processing...");

    (async () => {
        try {
            let extension = mediaType === 'video' ? 'mp4' : (fileInfo.mime_type ? fileInfo.mime_type.split('/')[1] : 'png');
            console.log(`[DEBUG] User ${userId}: File extension set to: ${extension}`);

            const targetPath = await fileHelper.downloadFile(ctx, fileInfo.file_id, extension);
            console.log(`[DEBUG] User ${userId}: Stage 1 Downloaded target file to: ${targetPath}`);

            if (!targetPath || typeof targetPath !== 'string') {
                throw new Error("File download resulted in an invalid path.");
            }

            const newState = { ...state, stage: 'awaiting_source', targetPath };
            if (state.type === 'video') {
                const videoDuration = fileInfo.duration; 
                newState.duration = Math.min(videoDuration, 60);
                console.log(`[DEBUG] User ${userId}: Original video duration: ${videoDuration}s. Capped duration: ${newState.duration}s.`);
            }

            console.log(`[DEBUG] User ${userId}: Stage 1 Setting new state:`, JSON.stringify(newState, null, 2));
            await stateManager.setState(userId, newState);

            await ctx.telegram.deleteMessage(ctx.chat.id, downloadMessage.message_id);
            await ctx.reply(ui.messages.sendSourceFace, { parse_mode: 'Markdown' });

        } catch (downloadError) {
            console.error(`[DEBUG] User ${userId} (BG Task): Target Download Error:`, downloadError);
            await ctx.telegram.editMessageText(ctx.chat.id, downloadMessage.message_id, undefined, '❌ Error downloading file. Please try again.');
            await stateManager.clearState(userId);
        }
    })();
    return;
  }

  // --- STAGE 2: Awaiting Source Face ---
  if (state.stage === 'awaiting_source') {
    console.log(`[DEBUG] User ${userId}: In 'awaiting_source' stage.`);
    if (mediaType !== 'photo') {
      console.log(`[DEBUG] User ${userId}: Invalid source file type. Expected 'photo', got ${mediaType}.`);
      return ctx.reply('Invalid file type. Please send a PNG or JPG image for the **source face**.', { parse_mode: 'Markdown' });
    }

    let extension = fileInfo.mime_type ? fileInfo.mime_type.split('/')[1] : 'png';
    console.log(`[DEBUG] User ${userId}: Source file extension set to: ${extension}`);

    let processingMessage;
    try {
      const sourcePath = await fileHelper.downloadFile(ctx, fileInfo.file_id, extension);
      console.log(`[DEBUG] User ${userId}: Stage 2 Downloaded source file to: ${sourcePath}`);

      if (!sourcePath || typeof sourcePath !== 'string') {
        throw new Error("Source file download resulted in an invalid path.");
      }

      processingMessage = await ctx.reply(ui.messages.processing);
      await stateManager.setState(userId, { ...state, sourcePath, processingMessageId: processingMessage.message_id });

      console.log(`[DEBUG] User ${userId}: Handing off to API processor.`);

      (async () => {
        try {
          const currentState = await stateManager.getState(userId);
          if (!currentState) {
            console.log(`[DEBUG] User ${userId} (BG Task): Task was cancelled. Aborting.`);
            return;
          }

          const outputUrl = await apiHandler.processSwap(
            currentState.type, 
            currentState.targetPath, 
            currentState.sourcePath,
            currentState.duration
          );

          const replyOptions = {
            caption: ui.messages.success,
            ...ui.keyboards.mainMenu
          };
          
          if (currentState.type === 'video') {
            await ctx.replyWithVideo(outputUrl, replyOptions);
          } else {
            await ctx.replyWithPhoto(outputUrl, replyOptions);
          }
        
          await ctx.telegram.deleteMessage(ctx.chat.id, processingMessage.message_id);

        } catch (apiError) {
          console.error(`[DEBUG] User ${userId} (BG Task): CATCH BLOCK: ${apiError.message}`);
          
          // --- ROBUST ERROR HANDLING FIX ---
          try {
            // First, try to edit the original message.
            await ctx.telegram.editMessageText(ctx.chat.id, processingMessage.message_id, undefined, ui.messages.error);
          } catch (editError) {
            // If editing fails (e.g., message not found), send a new message instead.
            console.error(`[DEBUG] User ${userId} (BG Task): Failed to edit message, sending new one. Reason: ${editError.message}`);
            await ctx.reply(ui.messages.error);
          }
        
        } finally {
          console.log(`[DEBUG] User ${userId} (BG Task): Running 'finally' block. Cleaning up files.`);
          const finalState = await stateManager.getState(userId) || state;
          fileHelper.deleteFiles([finalState.targetPath, finalState.sourcePath]);
          await stateManager.clearState(userId);
        }
      })();

    } catch (error) {
      console.error(`[DEBUG] User ${userId}: CATCH BLOCK (pre-process): ${error.message}`);
      await ctx.reply('❌ An error occurred. Please try again.');
      await stateManager.clearState(userId);
    }
  }
};

// Listen for video and photo uploads
bot.on('video', (ctx) => handleMedia(ctx, 'video', ctx.message.video));

bot.on('document', async (ctx) => {
  const document = ctx.message.document;
  if (document && document.mime_type && document.mime_type.startsWith('image/')) {
    console.log(`[DEBUG] User ${ctx.from.id}: Received document identified as image: ${document.mime_type}`);
    const mockPhoto = {
      file_id: document.file_id,
      file_size: document.file_size,
      mime_type: document.mime_type,
    };
    return handleMedia(ctx, 'photo', mockPhoto);
  } else {
    console.log(`[DEBUG] User ${ctx.from.id}: Received non-image document.`);
    const state = await stateManager.getState(ctx.from.id);
    if (state) {
      return ctx.reply("Please send a valid file. Use /cancel to restart.");
    }
    const isMember = await checkMembership(ctx);
    if (!isMember) {
      return sendMembershipPrompt(ctx);
    }
    return ctx.reply(ui.messages.invalidState, ui.keyboards.mainMenu);
  }
});

bot.on('photo', (ctx) => handleMedia(ctx, 'photo', ctx.message.photo.pop()));

// Handle other message types
bot.on('message', async (ctx) => {
  if (ctx.message.text) {
    console.log(`[DEBUG] User ${ctx.from.id}: Received text message.`);
    const state = await stateManager.getState(ctx.from.id);
    if (state) {
      return ctx.reply("Please send a valid file. Use /cancel to restart.");
    }
    const isMember = await checkMembership(ctx);
    if (!isMember) {
      return sendMembershipPrompt(ctx);
    }
    return ctx.reply(ui.messages.invalidState, ui.keyboards.mainMenu);
  }
});


bot.launch(() => {
  console.log('Bot is up and running...');
});

// Enable graceful stop
process.once('SIGINT', () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));