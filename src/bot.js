require('dotenv').config();
const { Telegraf, Markup } = require('telegraf');
const stateManager = require('./stateManager');
const apiHandler = require('./apiHandler');
const fileHelper = require('./fileHelper');
const ui =require('./ui');
const db = require('./db');

// Correctly configure the Telegraf bot with an increased API timeout
const bot = new Telegraf(process.env.BOT_TOKEN, {
  telegram: {
    apiTimeout: 600000, // 10 minutes
  },
});

const CHANNEL_ID = process.env.CHANNEL_ID;
const ADMIN_ID = process.env.ADMIN_ID ? parseInt(process.env.ADMIN_ID, 10) : null;

// This function contains the long-running logic for processing media.
const processMedia = async (ctx, mediaType, fileInfo) => {
    const userId = ctx.from.id;
    const state = await stateManager.getState(userId);

    if (!state) {
        if (!await checkMembership(ctx)) return sendMembershipPrompt(ctx);
        return ctx.reply(ui.messages.invalidState);
    }

    if (state.stage === 'awaiting_target') {
        if ((state.type === 'video' && mediaType !== 'video') || (state.type === 'photo' && mediaType !== 'photo')) {
            return ctx.reply(ui.messages.invalidFileType);
        }
        const downloadMessage = await ctx.reply("✅ File received. Processing...");
        try {
            const extension = mediaType === 'video' ? 'mp4' : (fileInfo.mime_type?.split('/')[1] || 'png');
            const targetPath = await fileHelper.downloadFile(ctx, fileInfo.file_id, extension);
            const newState = { ...state, stage: 'awaiting_source', targetPath };
            if (state.type === 'video') {
                newState.duration = Math.min(fileInfo.duration, 60);
            }
            await stateManager.setState(userId, newState);
            await ctx.telegram.deleteMessage(ctx.chat.id, downloadMessage.message_id);
            await ctx.reply(ui.messages.sendSourceFace, { parse_mode: 'Markdown' });
        } catch (downloadError) {
            console.error(`[DEBUG] Target Download Error:`, downloadError);
            await ctx.telegram.editMessageText(ctx.chat.id, downloadMessage.message_id, undefined, '❌ Error downloading file.').catch(() => {});
            await stateManager.clearState(userId);
        }
    } else if (state.stage === 'awaiting_source') {
        if (mediaType !== 'photo') {
            return ctx.reply('Invalid file type for source face.', { parse_mode: 'Markdown' });
        }
        let processingMessage;
        try {
            const extension = fileInfo.mime_type?.split('/')[1] || 'png';
            const sourcePath = await fileHelper.downloadFile(ctx, fileInfo.file_id, extension);
            processingMessage = await ctx.reply(ui.messages.processing);
            await stateManager.setState(userId, { ...state, sourcePath });

            let localResultPath;
            let swapSuccess = false;
            try {
                const currentState = await stateManager.getState(userId);
                if (!currentState) return;
                const outputUrl = await apiHandler.processSwap(currentState.type, currentState.targetPath, currentState.sourcePath, currentState.duration);
                localResultPath = await fileHelper.downloadFromUrl(outputUrl, userId);
                const replyOptions = { caption: ui.messages.success, ...ui.keyboards.mainMenu };

                if (currentState.type === 'video') {
                    await ctx.replyWithVideo({ source: localResultPath }, replyOptions);
                } else {
                    await ctx.replyWithPhoto({ source: localResultPath }, replyOptions);
                }
                swapSuccess = true;
                await ctx.telegram.deleteMessage(ctx.chat.id, processingMessage.message_id);
            } catch (apiError) {
                console.error(`[DEBUG] CATCH BLOCK: ${apiError.message}`);
                await ctx.telegram.editMessageText(ctx.chat.id, processingMessage.message_id, undefined, ui.messages.error).catch(() => {});
            } finally {
                const finalState = await stateManager.getState(userId) || state;
                if (swapSuccess) {
                    await db.incrementUsage(userId, finalState.type);
                }
                fileHelper.deleteFiles([finalState.targetPath, finalState.sourcePath, localResultPath]);
                await stateManager.clearState(userId);
            }
        } catch (error) {
            console.error(`[DEBUG] CATCH BLOCK (pre-process): ${error.message}`);
            if (processingMessage) {
                await ctx.telegram.editMessageText(ctx.chat.id, processingMessage.message_id, undefined, ui.messages.error).catch(() => {});
            } else {
                await ctx.reply('❌ An error occurred.');
            }
            await stateManager.clearState(userId);
        }
    } else if (state.stage === 'awaiting_image') {
        if (mediaType !== 'photo') {
            return ctx.reply(ui.messages.invalidFileType);
        }
        let processingMessage;
        try {
            const extension = fileInfo.mime_type?.split('/')[1] || 'png';
            const imagePath = await fileHelper.downloadFile(ctx, fileInfo.file_id, extension);
            processingMessage = await ctx.reply(ui.messages.processing);
            await stateManager.setState(userId, { ...state, imagePath });

            let localResultPath;
            let enhanceSuccess = false;
            try {
                const currentState = await stateManager.getState(userId);
                if (!currentState) return;
                const outputUrl = await apiHandler.processImageEnhance(currentState.imagePath);
                localResultPath = await fileHelper.downloadFromUrl(outputUrl, userId);
                const replyOptions = { caption: ui.messages.enhanceSuccess, ...ui.keyboards.mainMenu };

                await ctx.replyWithPhoto({ source: localResultPath }, replyOptions);
                enhanceSuccess = true;
                await ctx.telegram.deleteMessage(ctx.chat.id, processingMessage.message_id);
            } catch (apiError) {
                console.error(`[DEBUG] CATCH BLOCK: ${apiError.message}`);
                await ctx.telegram.editMessageText(ctx.chat.id, processingMessage.message_id, undefined, ui.messages.error).catch(() => {});
            } finally {
                const finalState = await stateManager.getState(userId) || state;
                if (enhanceSuccess) {
                    await db.incrementUsage(userId, finalState.type);
                }
                fileHelper.deleteFiles([finalState.imagePath, localResultPath]);
                await stateManager.clearState(userId);
            }
        } catch (error) {
            console.error(`[DEBUG] CATCH BLOCK (pre-process): ${error.message}`);
            if (processingMessage) {
                await ctx.telegram.editMessageText(ctx.chat.id, processingMessage.message_id, undefined, ui.messages.error).catch(() => {});
            } else {
                await ctx.reply('❌ An error occurred.');
            }
            await stateManager.clearState(userId);
        }
    }
};

const checkMembership = async (ctx) => {
    if (!CHANNEL_ID) return true;
    try {
        const member = await ctx.telegram.getChatMember(CHANNEL_ID, ctx.from.id);
        return ['creator', 'administrator', 'member'].includes(member.status);
    } catch (error) {
        console.error(`[ERROR] Membership check failed for ${ctx.from.id}:`, error.message);
        return false;
    }
};

const sendMembershipPrompt = async (ctx) => {
    try {
        const chat = await ctx.telegram.getChat(CHANNEL_ID);
        const groupLink = chat.invite_link || `https://t.me/${chat.username}`;
        await ctx.reply(ui.messages.membershipRequired, ui.keyboards.joinGroup(groupLink));
    } catch (error) {
        console.error(`[ERROR] Failed to get chat link for ${CHANNEL_ID}:`, error.message);
        await ctx.reply("Could not get the group link. Please try again later.", ui.keyboards.mainMenu);
    }
};

const sendAdminPanel = async (ctx) => {
    if (!ADMIN_ID || ctx.from.id !== ADMIN_ID) {
        return ctx.reply('⛔ You are not authorized to use this command.');
    }
    try {
        const stats = await db.getAdminStats();
        const message = ui.messages.adminHeader + ui.messages.adminStats(stats) + ui.messages.adminFooter;
        await ctx.reply(message, { ...ui.keyboards.adminPanel, parse_mode: 'HTML' });
    } catch (error) {
        console.error("Error sending admin panel:", error);
        await ctx.reply("❌ Error fetching admin stats.");
    }
};

bot.start(async (ctx) => {
    await db.upsertUser(ctx.from);
    await stateManager.clearState(ctx.from.id);
    if (!await checkMembership(ctx)) {
        await sendMembershipPrompt(ctx);
    } else {
        await ctx.reply(ui.messages.welcome, ui.keyboards.mainMenu);
    }
});

bot.command('cancel', async (ctx) => {
    const state = await stateManager.getState(ctx.from.id);
    if (state) {
        fileHelper.deleteFiles([state.targetPath, state.sourcePath, state.imagePath]);
        await stateManager.clearState(ctx.from.id);
    }
    ctx.reply(ui.messages.cancel, Markup.removeKeyboard());
});

bot.command('admin', sendAdminPanel);

bot.action('start_video_swap', async (ctx) => {
    if (!await checkMembership(ctx)) {
        await ctx.answerCbQuery();
        return sendMembershipPrompt(ctx);
    }
    await stateManager.setState(ctx.from.id, { type: 'video', stage: 'awaiting_target' });
    await ctx.reply(ui.messages.sendTargetVideo, { parse_mode: 'Markdown' });
    await ctx.answerCbQuery();
});

bot.action('start_photo_swap', async (ctx) => {
    if (!await checkMembership(ctx)) {
        await ctx.answerCbQuery();
        return sendMembershipPrompt(ctx);
    }
    await stateManager.setState(ctx.from.id, { type: 'photo', stage: 'awaiting_target' });
    await ctx.reply(ui.messages.sendTargetPhoto, { parse_mode: 'Markdown' });
    await ctx.answerCbQuery();
});

bot.action('start_image_enhance', async (ctx) => {
    if (!await checkMembership(ctx)) {
        await ctx.answerCbQuery();
        return sendMembershipPrompt(ctx);
    }
    await stateManager.setState(ctx.from.id, { type: 'image_enhance', stage: 'awaiting_image' });
    await ctx.reply(ui.messages.sendEnhanceImage, { parse_mode: 'Markdown' });
    await ctx.answerCbQuery();
});


bot.action('check_membership', async (ctx) => {
    if (await checkMembership(ctx)) {
        await ctx.editMessageText(ui.messages.membershipVerified, ui.keyboards.mainMenu).catch(() => {});
    } else {
        await ctx.answerCbQuery("It seems you haven't joined yet. Please join the group and try again.", { show_alert: true });
    }
});

bot.action('admin_refresh', async (ctx) => {
    if (ctx.from.id !== ADMIN_ID) return ctx.answerCbQuery('⛔ Unauthorized');
    try {
        const stats = await db.getAdminStats();
        const message = ui.messages.adminHeader + ui.messages.adminStats(stats) + ui.messages.adminFooter;
        await ctx.editMessageText(message, { ...ui.keyboards.adminPanel, parse_mode: 'HTML' });
    } catch (error) {
        await ctx.answerCbQuery('❌ Error refreshing stats', { show_alert: true });
    }
});

bot.action('admin_grant_premium', async (ctx) => {
    if (ctx.from.id !== ADMIN_ID) return ctx.answerCbQuery('⛔ Unauthorized');
    await stateManager.setState(ADMIN_ID, { admin_task: 'grant_premium', stage: 'awaiting_user_id' });
    await ctx.editMessageText(ui.messages.adminGrantAskUserId, { ...ui.keyboards.cancelGrant, parse_mode: 'Markdown' });
});

bot.action('admin_cancel_grant', async (ctx) => {
    if (ctx.from.id !== ADMIN_ID) return ctx.answerCbQuery('⛔ Unauthorized');
    await stateManager.clearState(ADMIN_ID);
    await ctx.editMessageText(ui.messages.adminGrantCancelled);
    const stats = await db.getAdminStats();
    const message = ui.messages.adminHeader + ui.messages.adminStats(stats) + ui.messages.adminFooter;
    await ctx.reply(message, { ...ui.keyboards.adminPanel, parse_mode: 'HTML' });
});

const grantPremiumForDays = async (ctx, days) => {
    if (ctx.from.id !== ADMIN_ID) return ctx.answerCbQuery('⛔ Unauthorized');
    const state = await stateManager.getState(ADMIN_ID);
    if (!state || state.admin_task !== 'grant_premium' || !state.target_user_id) return;
    
    await db.setPremiumStatus(state.target_user_id, days);
    const message = ui.messages.adminGrantSuccess(state.target_user_info, days);
    
    if (ctx.updateType === 'callback_query') {
        await ctx.editMessageText(message, { parse_mode: 'Markdown' });
    } else {
        await ctx.reply(message, { parse_mode: 'Markdown' });
    }
    await stateManager.clearState(ADMIN_ID);
};

bot.action(/premium_days_(\d+)/, (ctx) => grantPremiumForDays(ctx, parseInt(ctx.match[1], 10)));

bot.action('premium_days_custom', async (ctx) => {
    if (ctx.from.id !== ADMIN_ID) return ctx.answerCbQuery('⛔ Unauthorized');
    await stateManager.setState(ADMIN_ID, { ...(await stateManager.getState(ADMIN_ID)), stage: 'awaiting_custom_days' });
    await ctx.editMessageText(ui.messages.adminGrantAskCustomDays, ui.keyboards.cancelGrant);
});

bot.on('text', async (ctx) => {
    if (ctx.from.id === ADMIN_ID) {
        const adminState = await stateManager.getState(ADMIN_ID);
        if (adminState?.admin_task === 'grant_premium') {
            if (adminState.stage === 'awaiting_user_id') {
                const identifier = ctx.message.text;
                
                const userInfo = await db.findUserByIdOrUsername(identifier);
                if (!userInfo) {
                    return ctx.reply(ui.messages.adminGrantUserNotFound(identifier), { parse_mode: 'Markdown' });
                }
                
                await stateManager.setState(ADMIN_ID, { ...adminState, stage: 'awaiting_duration', target_user_id: userInfo.id, target_user_info: userInfo });
                return ctx.reply(ui.messages.adminGrantAskDuration(userInfo), { ...ui.keyboards.premiumDuration, parse_mode: 'Markdown' });
            }
            if (adminState.stage === 'awaiting_custom_days') {
                const days = parseInt(ctx.message.text, 10);
                if (isNaN(days) || days <= 0) {
                    return ctx.reply(ui.messages.adminGrantInvalidDays);
                }
                return grantPremiumForDays(ctx, days);
            }
        }
    }
    
    const userState = await stateManager.getState(ctx.from.id);
    if (userState) {
        return ctx.reply("Please send a valid file. Use /cancel to restart.");
    }
    if (!await checkMembership(ctx)) return sendMembershipPrompt(ctx);
});

// This is the main handler that calls the long-running processMedia function without awaiting it.
const handleMedia = (ctx, mediaType, fileInfo) => {
    processMedia(ctx, mediaType, fileInfo).catch(err => {
        console.error("Unhandled error in processMedia:", err);
        ctx.reply(ui.messages.error).catch(() => {});
    });
};

bot.on('video', (ctx) => handleMedia(ctx, 'video', ctx.message.video));
bot.on('photo', (ctx) => handleMedia(ctx, 'photo', ctx.message.photo.pop()));
bot.on('document', async (ctx) => {
    if (ctx.message.document?.mime_type?.startsWith('image/')) {
        const mockPhoto = { file_id: ctx.message.document.file_id, mime_type: ctx.message.document.mime_type };
        return handleMedia(ctx, 'photo', mockPhoto);
    }
});

db.initDb().then(() => {
    bot.launch(() => {
        console.log(`Bot is up and running... Admin ID: ${ADMIN_ID || 'Not set'}`);
    });
});

process.once('SIGINT', () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));