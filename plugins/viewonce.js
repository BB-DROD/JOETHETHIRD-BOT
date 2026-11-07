/**
 * ViewOnce Command - Reveal view-once messages
 */

import { downloadContentFromMessage, jidNormalizedUser } from '@whiskeysockets/baileys';
import config from '../config.js';

export default {
  command: 'viewonce',
  aliases: ['readvo', 'vv', 'readviewonce'],
  category: 'general',
  description: 'Reveal view-once messages and forward them to owner DM',
  usage: '.viewonce (reply to view-once message)',

  async handler(sock, msg, _args, context) {
    try {
      const chatId = context.chatId || msg.key.remoteJid;

      // Try to get contextInfo from different message types (reply can be from text, image, video, etc.)
      const ctx = msg.message?.extendedTextMessage?.contextInfo
        || msg.message?.imageMessage?.contextInfo
        || msg.message?.videoMessage?.contextInfo
        || msg.message?.buttonsResponseMessage?.contextInfo
        || msg.message?.listResponseMessage?.contextInfo;

      if (!ctx?.quotedMessage || !ctx?.stanzaId) {
        return await sock.sendMessage(
          chatId,
          { text: '🗑️ Reply to a *view-once* message to reveal it.' },
          { quoted: msg }
        );
      }

      const quotedMsg = ctx.quotedMessage;

      // Check various patterns used for view-once messages
      const hasViewOnce =
        !!quotedMsg.viewOnceMessageV2 ||
        !!quotedMsg.viewOnceMessageV2Extension ||
        !!quotedMsg.viewOnceMessage ||
        !!quotedMsg.viewOnce ||
        !!quotedMsg?.imageMessage?.viewOnce ||
        !!quotedMsg?.videoMessage?.viewOnce ||
        !!quotedMsg?.audioMessage?.viewOnce;

      if (!hasViewOnce) {
        return await sock.sendMessage(
          chatId,
          { text: '❌ This is not a view-once message!' },
          { quoted: msg }
        );
      }

      let actualMsg = null;
      let mtype = null;

      // Newer Baileys: viewOnceMessageV2Extension
      if (quotedMsg.viewOnceMessageV2Extension?.message) {
        actualMsg = quotedMsg.viewOnceMessageV2Extension.message;
        mtype = Object.keys(actualMsg)[0];

      // Classic Baileys: viewOnceMessageV2
      } else if (quotedMsg.viewOnceMessageV2?.message) {
        actualMsg = quotedMsg.viewOnceMessageV2.message;
        mtype = Object.keys(actualMsg)[0];

      // Older: viewOnceMessage
      } else if (quotedMsg.viewOnceMessage?.message) {
        actualMsg = quotedMsg.viewOnceMessage.message;
        mtype = Object.keys(actualMsg)[0];

      // Direct message with viewOnce flag on media
      } else if (quotedMsg.imageMessage?.viewOnce) {
        actualMsg = { imageMessage: quotedMsg.imageMessage };
        mtype = 'imageMessage';
      } else if (quotedMsg.videoMessage?.viewOnce) {
        actualMsg = { videoMessage: quotedMsg.videoMessage };
        mtype = 'videoMessage';
      } else if (quotedMsg.audioMessage?.viewOnce) {
        actualMsg = { audioMessage: quotedMsg.audioMessage };
        mtype = 'audioMessage';
      }

      if (!actualMsg || !mtype) {
        return await sock.sendMessage(
          chatId,
          { text: '❌ Unsupported view-once message type.' },
          { quoted: msg }
        );
      }

      const downloadType =
        mtype === 'imageMessage'
          ? 'image'
          : mtype === 'videoMessage'
          ? 'video'
          : mtype === 'audioMessage'
          ? 'audio'
          : 'document';

      const mediaStream = await downloadContentFromMessage(
        actualMsg[mtype],
        downloadType
      );

      let buffer = Buffer.from([]);
      for await (const chunk of mediaStream) {
        buffer = Buffer.concat([buffer, chunk]);
      }

      const caption = actualMsg[mtype]?.caption || '';
      const ownerNumber = Array.isArray(config.ownerNumber)
        ? config.ownerNumber[0]
        : config.ownerNumber;
      const ownerJid = ownerNumber
        ? jidNormalizedUser(ownerNumber.includes('@')
          ? ownerNumber
          : `${ownerNumber.replace(/\D/g, '')}@s.whatsapp.net`)
        : null;

      if (!ownerJid) {
        return await sock.sendMessage(
          chatId,
          { text: '❌ No owner number configured to forward view-once content.' },
          { quoted: msg }
        );
      }

      const sourceText = `📩 Revealed view-once from ${chatId}`;
      await sock.sendMessage(ownerJid, { text: sourceText });

      if (/video/.test(mtype)) {
        await sock.sendMessage(ownerJid, {
          video: buffer,
          caption,
          mimetype: 'video/mp4'
        });
      } else if (/image/.test(mtype)) {
        await sock.sendMessage(ownerJid, {
          image: buffer,
          caption,
          mimetype: 'image/jpeg'
        });
      } else if (/audio/.test(mtype)) {
        await sock.sendMessage(ownerJid, {
          audio: buffer,
          ptt: true,
          mimetype: 'audio/ogg; codecs=opus'
        });
      } else if (mtype === 'documentMessage') {
        await sock.sendMessage(ownerJid, {
          document: buffer,
          fileName: actualMsg.documentMessage?.fileName || 'document',
          caption,
          mimetype: actualMsg.documentMessage?.mimetype || 'application/octet-stream'
        });
      }

      await sock.sendMessage(chatId, { react: { text: '✅', key: msg.key } });

      // Remove the trigger command message after successful delivery to owner
      try {
        await sock.sendMessage(chatId, { delete: msg.key });
      } catch (delErr) {
        console.error('[viewonce] failed to delete trigger:', delErr.message);
      }
    } catch (error) {
      console.error('Error in viewonce command:', error);
      await sock.sendMessage(
        msg.key.remoteJid,
        {
          text: `❌ Error processing view-once message: ${error.message || 'Unknown error'}`
        },
        { quoted: msg }
      );
    }
  }
};
