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
  stateManager.clearState(ctx.from.id);

  const isMember = await checkMembership(ctx);
  if (!isMember) {
    await sendMembershipPrompt(ctx);
  } else {
    await ctx.reply(ui.messages.welcome, ui.keyboards.mainMenu);
  }
});

bot.command('cancel', (ctx) => {
  console.log(`[DEBUG] User ${ctx.from.id} executing /cancel`);
  const state = stateManager.getState(ctx.from.id);
  if (state) {
    fileHelper.deleteFiles([state.targetPath, state.sourcePath]);
    stateManager.clearState(ctx.from.id);
  }
  ctx.reply(ui.messages.cancel, Markup.removeKeyboard());
});

// === ACTIONS (Button Clicks) ===

bot.action('start_video_swap', async (ctx) => {
  console.log(`[DEBUG] User ${ctx.from.id} clicked 'start_video_swap'`);
  const isMember = await checkMembership(ctx); // Check at entry point
  if (!isMember) {
    return sendMembershipPrompt(ctx);
  }
  stateManager.setState(ctx.from.id, { type: 'video', stage: 'awaiting_target' });
  ctx.editMessageText(ui.messages.sendTargetVideo, { parse_mode: 'Markdown' });
});

bot.action('start_photo_swap', async (ctx) => {
  console.log(`[DEBUG] User ${ctx.from.id} clicked 'start_photo_swap'`);
  const isMember = await checkMembership(ctx); // Check at entry point
  if (!isMember) {
    return sendMembershipPrompt(ctx);
  }
  stateManager.setState(ctx.from.id, { type: 'photo', stage: 'awaiting_target' });
  ctx.editMessageText(ui.messages.sendTargetPhoto, { parse_mode: 'Markdown' });
});

bot.action('check_membership', async (ctx) => {
  console.log(`[DEBUG] User ${ctx.from.id} clicked 'check_membership'`);
  await ctx.answerCbQuery();
  const isMember = await checkMembership(ctx);
  if (isMember) {
    await ctx.editMessageText(ui.messages.membershipVerified, ui.keyboards.mainMenu);
    stateManager.clearState(ctx.from.id);
  } else {
    const chat = await ctx.telegram.getChat(CHANNEL_ID);
    const groupLink = chat.invite_link || `https://t.me/${chat.username}`;
    await ctx.reply(ui.messages.membershipFailed, ui.keyboards.joinGroup(groupLink));
  }
});


// === MEDIA HANDLERS ===

const handleMedia = async (ctx, mediaType, fileInfo) => {
  const userId = ctx.from.id;
  const state = stateManager.getState(userId); // Get state FIRST

  console.log(`[DEBUG] User ${userId}: handleMedia triggered for type: ${mediaType}`);

  if (state) {
    // User is already in a process. They've been verified.
    // No need to check membership again. Proceed.
    console.log(`[DEBUG] User ${userId}: State found. Skipping membership check.`);
  } else {
    // No state. This is a random file upload.
    // NOW we check membership.
    console.log(`[DEBUG] User ${userId}: No state found. Checking membership.`);
    const isMember = await checkMembership(ctx);
    if (!isMember) {
      return sendMembershipPrompt(ctx);
    }
    // They are a member, but have no state.
    return ctx.reply(ui.messages.invalidState);
  }

  // --- STAGE 1: Awaiting Target File ---
  if (state.stage === 'awaiting_target') {
    console.log(`[DEBUG] User ${userId}: In 'awaiting_target' stage.`);
    if (state.type === 'video' && mediaType !== 'video') {
        console.log(`[DEBUG] User ${userId}: Invalid file type for target. Expected video, got ${mediaType}.`);
        return ctx.reply(ui.messages.invalidFileType);
    }
    if (state.type === 'photo' && mediaType !== 'photo') {
        console.log(`[DEBUG] User ${userId}: Invalid file type for target. Expected photo, got ${mediaType}.`);
        return ctx.reply(ui.messages.invalidFileType);
    }
    
    let extension;
    if (mediaType === 'video') {
        extension = 'mp4';
    } else if (mediaType === 'photo') {
        extension = fileInfo.mime_type ? fileInfo.mime_type.split('/')[1] : 'png';
    } else {
        extension = 'bin'; // Fallback
    }

    console.log(`[DEBUG] User ${userId}: File extension set to: ${extension}`);

    try {
      const targetPath = await fileHelper.downloadFile(ctx, fileInfo.file_id, extension);
      
      console.log(`[DEBUG] User ${userId}: Stage 1 Downloaded target file to: ${targetPath}`);

      if (!targetPath || typeof targetPath !== 'string') {
        console.error(`[DEBUG] User ${userId}: FATAL! downloadFile returned undefined or invalid path for target.`);
        return ctx.reply('Error downloading file. Please try again.');
      }

      const newState = { ...state, stage: 'awaiting_source', targetPath };
      
      console.log(`[DEBUG] User ${userId}: Stage 1 Setting new state:`, JSON.stringify(newState, null, 2));

      stateManager.setState(userId, newState);
      await ctx.reply(ui.messages.sendSourceFace, { parse_mode: 'Markdown' });
    } catch (downloadError) {
      console.error(`[DEBUG] User ${userId}: Target Download Error:`, downloadError);
      await ctx.reply('Failed to download your file. Please try again.');
    }
    return;
  }

  // --- STAGE 2: Awaiting Source Face ---
  if (state.stage === 'awaiting_source') {
    console.log(`[DEBUG] User ${userId}: In 'awaiting_source' stage.`);
    if (mediaType !== 'photo') {
      console.log(`[DEBUG] User ${userId}: Invalid source file type. Expected 'photo' (compressed/uncompressed image), got ${mediaType}.`);
      return ctx.reply('Invalid file type. Please send a PNG or JPG image for the **source face**.', { parse_mode: 'Markdown' });
    }
    
    let extension = fileInfo.mime_type ? fileInfo.mime_type.split('/')[1] : 'png';
    console.log(`[DEBUG] User ${userId}: Source file extension set to: ${extension}`);

    let processingMessage;
    let sourcePath;
    try {
      sourcePath = await fileHelper.downloadFile(ctx, fileInfo.file_id, extension);
      
      console.log(`[DEBUG] User ${userId}: Stage 2 Downloaded source file to: ${sourcePath}`);

      if (!sourcePath || typeof sourcePath !== 'string') {
        console.error(`[DEBUG] User ${userId}: FATAL! downloadFile returned undefined or invalid path for source.`);
        return ctx.reply('Error downloading source file. Please try again.');
      }
      
      processingMessage = await ctx.reply(ui.messages.processing);
      
      stateManager.setState(userId, { ...state, sourcePath, processingMessageId: processingMessage.message_id });
      
      console.log(`[DEBUG] User ${userId}: Handing off to background processor.`);
      
      (async () => {
        try {
          const currentState = stateManager.getState(userId);
          if (!currentState) {
            console.log(`[DEBUG] User ${userId} (BG Task): Task was cancelled. Aborting.`);
            return;
          }
      
          console.log(`[DEBUG] User ${userId} (BG Task): Calling processSwap with:`);
          console.log(`  - Type: ${currentState.type}`);
          console.log(`  - Target Path: ${currentState.targetPath}`);
          console.log(`  - Source Path: ${currentState.sourcePath}`);

          const outputUrl = await apiHandler.processSwap(currentState.type, currentState.targetPath, currentState.sourcePath);
          
          await ctx.telegram.deleteMessage(ctx.chat.id, processingMessage.message_id);
          
          if (currentState.type === 'video') {
            await ctx.replyWithVideo(outputUrl, { 
              caption: ui.messages.success,
              ...ui.keyboards.mainMenu 
            });
          } else {
            await ctx.replyWithPhoto(outputUrl, { 
              caption: ui.messages.success,
              ...ui.keyboards.mainMenu 
            });
          }
        
        } catch (apiError) {
          console.error(`[DEBUG] User ${userId} (BG Task): CATCH BLOCK: ${apiError.message}`);
          await ctx.telegram.editMessageText(ctx.chat.id, processingMessage.message_id, undefined, ui.messages.error);
        
        } finally {
          console.log(`[DEBUG] User ${userId} (BG Task): Running 'finally' block. Cleaning up files.`);
          const finalState = stateManager.getState(userId) || state; 
          fileHelper.deleteFiles([finalState.targetPath, finalState.sourcePath]);
          stateManager.clearState(userId);
        }
      })();

      return; 
      
    } catch (downloadOrReplyError) {
      console.error(`[DEBUG] User ${userId}: CATCH BLOCK (pre-process): ${downloadOrReplyError.message}`);
      if (processingMessage) {
        await ctx.telegram.editMessageText(ctx.chat.id, processingMessage.message_id, undefined, ui.messages.error);
      } else {
        await ctx.reply(ui.messages.error);
      }
      fileHelper.deleteFiles([state.targetPath, sourcePath]);
      stateManager.clearState(userId);
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
      width: 1000, 
      height: 1000,
    };
    return handleMedia(ctx, 'photo', mockPhoto);
  } else {
    // If it's not an image document, treat as a generic message
    console.log(`[DEBUG] User ${ctx.from.id}: Received non-image document or unknown message type.`);
    
    // --- FIX IS HERE: Get state first ---
    const state = stateManager.getState(ctx.from.id);
    if (state) {
      return ctx.reply("Please send a valid file. Use /cancel to restart.");
    }
    
    // No state, NOW check membership
    const isMember = await checkMembership(ctx);
    if (!isMember) {
      return sendMembershipPrompt(ctx);
    }
    
    // Member, no state
    return ctx.reply(ui.messages.invalidState, ui.keyboards.mainMenu);
  }
});

bot.on('photo', (ctx) => handleMedia(ctx, 'photo', ctx.message.photo.pop()));

// Handle other message types
bot.on('message', async (ctx) => {
  if (ctx.message.text || (!ctx.message.video && !ctx.message.photo && !ctx.message.document)) {
    console.log(`[DEBUG] User ${ctx.from.id}: Received non-media message or unhandled media: ${ctx.message.text || JSON.stringify(ctx.message)}`);
    
    // --- FIX IS HERE: Get state first ---
    const state = stateManager.getState(ctx.from.id);
    if (state) {
      // User is in a process and typed text.
      return ctx.reply("Please send a valid file. Use /cancel to restart.");
    }

    // User is NOT in a process. NOW we check membership.
    const isMember = await checkMembership(ctx);
    if (!isMember) {
      return sendMembershipPrompt(ctx);
    }
    
    // Member, no state, sent text. Show menu.
    return ctx.reply(ui.messages.invalidState, ui.keyboards.mainMenu);
  }
});


bot.launch(() => {
  console.log('Bot is up and running...');
});

// Enable graceful stop
process.once('SIGINT', () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));