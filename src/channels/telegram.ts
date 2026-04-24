import fs from 'fs';
import path from 'path';
import { Bot, InputFile } from 'grammy';

// Prepend RLM (U+200F) to lines whose dominant script is RTL (Farsi/Arabic).
// This tells Telegram to render that line right-to-left regardless of where
// the first LTR character appears — preventing misaligned mixed-language output.
const RTL_CHARS = /[؀-ۿݐ-ݿࢠ-ࣿﭐ-﷿ﹰ-﻿]/g;
const LTR_CHARS = /[a-zA-Z]/g;
const RLM = '‏';

function fixBidi(text: string): string {
  return text
    .split('\n')
    .map((line) => {
      if (!line.trim()) return line;
      const rtl = (line.match(RTL_CHARS) || []).length;
      const ltr = (line.match(LTR_CHARS) || []).length;
      return rtl > 0 && rtl >= ltr ? RLM + line : line;
    })
    .join('\n');
}

import {
  ASSISTANT_NAME,
  GROUPS_DIR,
  TRIGGER_PATTERN,
  TELEGRAM_BOT_TOKEN,
} from '../config.js';
import { logger } from '../logger.js';
import { textToAudio, cleanupTtsFile } from '../tts.js';
import { transcribeAudio } from '../transcription.js';
import {
  Channel,
  OnInboundMessage,
  OnChatMetadata,
  RegisteredGroup,
} from '../types.js';
import { registerChannel, ChannelOpts } from './registry.js';

export interface TelegramChannelOpts {
  onMessage: OnInboundMessage;
  onChatMetadata: OnChatMetadata;
  registeredGroups: () => Record<string, RegisteredGroup>;
}

// Valid Telegram reaction emojis — rotated randomly to feel more alive
const REACTIONS = ['👀', '🔥', '⚡', '💯', '👌', '🫡', '🤓', '😎', '🎉', '🏆'] as const;
type ReactionEmoji = (typeof REACTIONS)[number];
function randomReaction(): ReactionEmoji {
  return REACTIONS[Math.floor(Math.random() * REACTIONS.length)];
}

export class TelegramChannel implements Channel {
  name = 'telegram';
  prefixAssistantName = false;

  private bot: Bot | null = null;
  private opts: TelegramChannelOpts;
  private botToken: string;

  constructor(botToken: string, opts: TelegramChannelOpts) {
    this.botToken = botToken;
    this.opts = opts;
  }

  async connect(): Promise<void> {
    this.bot = new Bot(this.botToken);

    this.bot.command('chatid', (ctx) => {
      const chatId = ctx.chat.id;
      const chatType = ctx.chat.type;
      const chatName =
        chatType === 'private'
          ? ctx.from?.first_name || 'Private'
          : (ctx.chat as any).title || 'Unknown';

      ctx.reply(
        `Chat ID: \`tg:${chatId}\`\nName: ${chatName}\nType: ${chatType}`,
        { parse_mode: 'Markdown' },
      );
    });

    this.bot.command('ping', (ctx) => {
      ctx.reply(`${ASSISTANT_NAME} is online.`);
    });

    this.bot.on('message:text', async (ctx) => {
      if (ctx.message.text.startsWith('/')) return;

      const chatJid = `tg:${ctx.chat.id}`;
      let content = ctx.message.text;
      const timestamp = new Date(ctx.message.date * 1000).toISOString();
      const senderName =
        ctx.from?.first_name ||
        ctx.from?.username ||
        ctx.from?.id.toString() ||
        'Unknown';
      const sender = ctx.from?.id.toString() || '';
      const msgId = ctx.message.message_id.toString();

      const chatName =
        ctx.chat.type === 'private'
          ? senderName
          : (ctx.chat as any).title || chatJid;

      // Translate Telegram @bot_username mentions into TRIGGER_PATTERN format
      const botUsername = ctx.me?.username?.toLowerCase();
      if (botUsername) {
        const entities = ctx.message.entities || [];
        const isBotMentioned = entities.some((entity) => {
          if (entity.type === 'mention') {
            const mentionText = content
              .substring(entity.offset, entity.offset + entity.length)
              .toLowerCase();
            return mentionText === `@${botUsername}`;
          }
          return false;
        });
        if (isBotMentioned && !TRIGGER_PATTERN.test(content)) {
          content = `@${ASSISTANT_NAME} ${content}`;
        }
      }

      this.opts.onChatMetadata(chatJid, timestamp, chatName);

      const group = this.opts.registeredGroups()[chatJid];
      if (!group) {
        logger.debug(
          { chatJid, chatName },
          'Message from unregistered Telegram chat',
        );
        return;
      }

      this.opts.onMessage(chatJid, {
        id: msgId,
        chat_jid: chatJid,
        sender,
        sender_name: senderName,
        content,
        timestamp,
        is_from_me: false,
      });

      // React with 👀 to acknowledge receipt
      ctx.api
        .setMessageReaction(ctx.chat.id, ctx.message.message_id, [
          { type: 'emoji', emoji: randomReaction() },
        ])
        .catch(() => { });

      logger.info(
        { chatJid, chatName, sender: senderName },
        'Telegram message stored',
      );
    });

    // Handle non-text messages with placeholders
    const storeNonText = (ctx: any, placeholder: string) => {
      const chatJid = `tg:${ctx.chat.id}`;
      const group = this.opts.registeredGroups()[chatJid];
      if (!group) return;

      const timestamp = new Date(ctx.message.date * 1000).toISOString();
      const senderName =
        ctx.from?.first_name ||
        ctx.from?.username ||
        ctx.from?.id?.toString() ||
        'Unknown';
      const caption = ctx.message.caption ? ` ${ctx.message.caption}` : '';

      this.opts.onChatMetadata(chatJid, timestamp);
      this.opts.onMessage(chatJid, {
        id: ctx.message.message_id.toString(),
        chat_jid: chatJid,
        sender: ctx.from?.id?.toString() || '',
        sender_name: senderName,
        content: `${placeholder}${caption}`,
        timestamp,
        is_from_me: false,
      });
    };

    this.bot.on('message:photo', async (ctx) => {
      const chatJid = `tg:${ctx.chat.id}`;
      const group = this.opts.registeredGroups()[chatJid];
      if (!group) return;

      const timestamp = new Date(ctx.message.date * 1000).toISOString();
      const senderName =
        ctx.from?.first_name ||
        ctx.from?.username ||
        ctx.from?.id?.toString() ||
        'Unknown';
      const caption = ctx.message.caption
        ? `\nCaption: ${ctx.message.caption}`
        : '';

      try {
        // Pick the largest available photo size
        const photos = ctx.message.photo;
        const largest = photos[photos.length - 1];
        const file = await ctx.api.getFile(largest.file_id);
        const url = `https://api.telegram.org/file/bot${this.botToken}/${file.file_path}`;
        const response = await fetch(url);
        const arrayBuffer = await response.arrayBuffer();
        const buffer = Buffer.from(arrayBuffer);

        const uploadsDir = path.join(GROUPS_DIR, group.folder, 'uploads');
        fs.mkdirSync(uploadsDir, { recursive: true });
        const filename = `photo-${Date.now()}.jpg`;
        const savePath = path.join(uploadsDir, filename);
        fs.writeFileSync(savePath, buffer);

        const containerPath = `/workspace/group/uploads/${filename}`;
        const content = `[Photo]${caption}\nSaved to: ${containerPath}\nUse the Read tool on this path to view the image.`;

        this.opts.onChatMetadata(chatJid, timestamp);
        this.opts.onMessage(chatJid, {
          id: ctx.message.message_id.toString(),
          chat_jid: chatJid,
          sender: ctx.from?.id?.toString() || '',
          sender_name: senderName,
          content,
          timestamp,
          is_from_me: false,
        });

        ctx.api
          .setMessageReaction(ctx.chat.id, ctx.message.message_id, [
            { type: 'emoji', emoji: randomReaction() },
          ])
          .catch(() => { });

        logger.info({ chatJid, filename }, 'Photo saved to workspace');
      } catch (err) {
        logger.error({ err }, 'Photo download error');
        storeNonText(ctx, '[Photo — failed to save]');
      }
    });
    this.bot.on('message:video', (ctx) => storeNonText(ctx, '[Video]'));
    this.bot.on('message:voice', async (ctx) => {
      const chatJid = `tg:${ctx.chat.id}`;
      const group = this.opts.registeredGroups()[chatJid];
      if (!group) return;

      const timestamp = new Date(ctx.message.date * 1000).toISOString();
      const senderName =
        ctx.from?.first_name ||
        ctx.from?.username ||
        ctx.from?.id?.toString() ||
        'Unknown';

      try {
        const file = await ctx.getFile();
        const url = `https://api.telegram.org/file/bot${this.botToken}/${file.file_path}`;
        const response = await fetch(url);
        const arrayBuffer = await response.arrayBuffer();
        const buffer = Buffer.from(arrayBuffer);

        const transcript = await transcribeAudio(buffer);
        const content = transcript
          ? `[Voice: ${transcript}]`
          : '[Voice message - transcription unavailable]';

        this.opts.onChatMetadata(chatJid, timestamp);
        this.opts.onMessage(chatJid, {
          id: ctx.message.message_id.toString(),
          chat_jid: chatJid,
          sender: ctx.from?.id?.toString() || '',
          sender_name: senderName,
          content,
          timestamp,
          is_from_me: false,
        });

        if (transcript) {
          logger.info(
            { chatJid, length: transcript.length },
            'Voice message transcribed',
          );
        }
      } catch (err) {
        logger.error({ err }, 'Voice transcription error');
        storeNonText(ctx, '[Voice message - transcription failed]');
      }
    });
    this.bot.on('message:audio', async (ctx) => {
      const chatJid = `tg:${ctx.chat.id}`;
      const group = this.opts.registeredGroups()[chatJid];
      if (!group) return;

      const timestamp = new Date(ctx.message.date * 1000).toISOString();
      const senderName =
        ctx.from?.first_name ||
        ctx.from?.username ||
        ctx.from?.id?.toString() ||
        'Unknown';
      const title =
        ctx.message.audio?.title || ctx.message.audio?.file_name || 'audio';
      const caption = ctx.message.caption ? ` ${ctx.message.caption}` : '';

      try {
        const file = await ctx.getFile();
        const fileSize = ctx.message.audio?.file_size || 0;

        // Telegram bot API limit is ~20MB for file downloads
        if (fileSize > 20 * 1024 * 1024) {
          logger.warn(
            { fileSize, title },
            'Audio file too large for transcription',
          );
          storeNonText(ctx, `[Audio: ${title} - too large to transcribe]`);
          return;
        }

        const url = `https://api.telegram.org/file/bot${this.botToken}/${file.file_path}`;
        const response = await fetch(url);
        const arrayBuffer = await response.arrayBuffer();
        const buffer = Buffer.from(arrayBuffer);

        const transcript = await transcribeAudio(buffer);
        const content = transcript
          ? `[Audio: ${title}${caption}]\n\nTranscript:\n${transcript}`
          : `[Audio: ${title}${caption} - transcription unavailable]`;

        this.opts.onChatMetadata(chatJid, timestamp);
        this.opts.onMessage(chatJid, {
          id: ctx.message.message_id.toString(),
          chat_jid: chatJid,
          sender: ctx.from?.id?.toString() || '',
          sender_name: senderName,
          content,
          timestamp,
          is_from_me: false,
        });

        if (transcript) {
          logger.info(
            { chatJid, title, length: transcript.length },
            'Audio file transcribed',
          );
        }
      } catch (err) {
        logger.error({ err, title }, 'Audio transcription error');
        storeNonText(ctx, `[Audio: ${title}${caption} - transcription failed]`);
      }
    });
    this.bot.on('message:document', async (ctx) => {
      const chatJid = `tg:${ctx.chat.id}`;
      const group = this.opts.registeredGroups()[chatJid];
      if (!group) return;

      const name = ctx.message.document?.file_name || 'file';
      const fileSize = ctx.message.document?.file_size || 0;
      const caption = ctx.message.caption
        ? `\nCaption: ${ctx.message.caption}`
        : '';
      const timestamp = new Date(ctx.message.date * 1000).toISOString();
      const senderName =
        ctx.from?.first_name ||
        ctx.from?.username ||
        ctx.from?.id?.toString() ||
        'Unknown';

      // Telegram bot API limit is ~20MB for file downloads
      if (fileSize > 20 * 1024 * 1024) {
        storeNonText(
          ctx,
          `[Document: ${name} — too large to save (${Math.round(fileSize / 1024 / 1024)}MB)]`,
        );
        return;
      }

      try {
        const file = await ctx.getFile();
        const url = `https://api.telegram.org/file/bot${this.botToken}/${file.file_path}`;
        const response = await fetch(url);
        const arrayBuffer = await response.arrayBuffer();
        const buffer = Buffer.from(arrayBuffer);

        // Save to group's uploads directory (visible as /workspace/group/uploads/ in container)
        const uploadsDir = path.join(GROUPS_DIR, group.folder, 'uploads');
        fs.mkdirSync(uploadsDir, { recursive: true });
        const savePath = path.join(uploadsDir, name);
        fs.writeFileSync(savePath, buffer);

        const containerPath = `/workspace/group/uploads/${name}`;
        const content = `[Document: ${name}]${caption}\nSaved to: ${containerPath}`;

        this.opts.onChatMetadata(chatJid, timestamp);
        this.opts.onMessage(chatJid, {
          id: ctx.message.message_id.toString(),
          chat_jid: chatJid,
          sender: ctx.from?.id?.toString() || '',
          sender_name: senderName,
          content,
          timestamp,
          is_from_me: false,
        });

        logger.info(
          { chatJid, name, size: fileSize },
          'Document saved to workspace',
        );
      } catch (err) {
        logger.error({ err, name }, 'Document download error');
        storeNonText(ctx, `[Document: ${name} — failed to save]`);
      }
    });
    this.bot.on('message:sticker', (ctx) => {
      const emoji = ctx.message.sticker?.emoji || '';
      storeNonText(ctx, `[Sticker ${emoji}]`);
    });
    this.bot.on('message:location', (ctx) => storeNonText(ctx, '[Location]'));
    this.bot.on('message:contact', (ctx) => storeNonText(ctx, '[Contact]'));

    this.bot.catch((err) => {
      logger.error({ err: err.message }, 'Telegram bot error');
    });

    return new Promise<void>((resolve) => {
      this.bot!.start({
        onStart: (botInfo) => {
          logger.info(
            { username: botInfo.username, id: botInfo.id },
            'Telegram bot connected',
          );
          console.log(`\n  Telegram bot: @${botInfo.username}`);
          console.log(
            `  Send /chatid to the bot to get a chat's registration ID\n`,
          );
          resolve();
        },
      });
    });
  }

  async sendMessage(jid: string, text: string): Promise<void> {
    if (!this.bot) {
      logger.warn('Telegram bot not initialized');
      return;
    }

    try {
      const numericId = jid.replace(/^tg:/, '');

      // Detect [voice] or [speak] tag — send as audio
      const voiceMatch = text.match(/\[(?:voice|speak)\]/i);
      if (voiceMatch) {
        const cleanText = text.replace(/\[(?:voice|speak)\]/gi, '').trim();
        if (cleanText) {
          const audioFile = await textToAudio(cleanText);
          if (audioFile) {
            await this.bot.api.sendVoice(numericId, new InputFile(audioFile));
            cleanupTtsFile(audioFile);
            logger.info(
              { jid, chars: cleanText.length },
              'Telegram voice message sent',
            );
            // Also send as text so it's readable
            await this.bot.api.sendMessage(numericId, cleanText);
            return;
          }
          // TTS failed, fall through to text without [voice] tag
          logger.warn('TTS failed, falling back to text');
          text = cleanText;
        }
      }

      // Detect file paths in the message and send as documents
      const fileMatch = text.match(
        /(?:^|\s)(\/workspace\/\S+\.(?:pdf|html|csv|json|txt|md|png|jpg))/i,
      );
      if (fileMatch) {
        const containerPath = fileMatch[1];
        // Map /workspace/group/ to the actual host path
        const hostPath = containerPath.replace(
          /^\/workspace\/group\//,
          path.join(process.cwd(), 'groups', 'main') + '/',
        );

        if (fs.existsSync(hostPath)) {
          const fileName = path.basename(hostPath);
          const caption = text.replace(containerPath, '').trim();
          await this.bot.api.sendDocument(
            numericId,
            new InputFile(hostPath, fileName),
            {
              caption: caption.slice(0, 1024) || undefined,
            },
          );
          logger.info({ jid, file: fileName }, 'Telegram document sent');
          return;
        }
      }

      // Regular text message
      text = fixBidi(text);
      const MAX_LENGTH = 4096;
      const sendWithMarkdown = async (
        chatId: string | number,
        chunk: string,
      ) => {
        try {
          await this.bot!.api.sendMessage(chatId, chunk, {
            parse_mode: 'Markdown',
          });
        } catch {
          // Fallback to plain text if Markdown parsing fails
          await this.bot!.api.sendMessage(chatId, chunk);
        }
      };
      if (text.length <= MAX_LENGTH) {
        await sendWithMarkdown(numericId, text);
      } else {
        for (let i = 0; i < text.length; i += MAX_LENGTH) {
          await sendWithMarkdown(numericId, text.slice(i, i + MAX_LENGTH));
        }
      }
      logger.info({ jid, length: text.length }, 'Telegram message sent');
    } catch (err) {
      logger.error({ jid, err }, 'Failed to send Telegram message');
    }
  }

  isConnected(): boolean {
    return this.bot !== null;
  }

  ownsJid(jid: string): boolean {
    return jid.startsWith('tg:');
  }

  async disconnect(): Promise<void> {
    if (this.bot) {
      this.bot.stop();
      this.bot = null;
      logger.info('Telegram bot stopped');
    }
  }

  async setTyping(jid: string, isTyping: boolean): Promise<void> {
    if (!this.bot || !isTyping) return;
    try {
      const numericId = jid.replace(/^tg:/, '');
      await this.bot.api.sendChatAction(numericId, 'typing');
    } catch (err) {
      logger.debug({ jid, err }, 'Failed to send Telegram typing indicator');
    }
  }
}

registerChannel('telegram', (opts: ChannelOpts) => {
  if (!TELEGRAM_BOT_TOKEN) return null;
  return new TelegramChannel(TELEGRAM_BOT_TOKEN, opts);
});
