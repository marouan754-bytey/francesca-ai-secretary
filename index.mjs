import makeWASocket, {
  useMultiFileAuthState,
  DisconnectReason,
  Browsers,
  fetchLatestBaileysVersion,
} from '@whiskeysockets/baileys';
import pino from 'pino';
import qrcode from 'qrcode-terminal';
import express from 'express';
import http from 'http';
import { Server } from 'socket.io';
import cors from 'cors';
import fs from 'fs';

// Custom Modules
import { askFrancesca } from './src/modules/brain.mjs';
import { processVoice } from './src/modules/ear.mjs';
import { handleDocumentMedia, handleMedia } from './src/modules/documents.mjs';
import { sendRequestedFile } from './src/modules/delivery.mjs';
import { logEvent, setSocket } from './src/modules/logger.mjs';
import { flushDownloads, puliziaFile } from './src/modules/cleaner.mjs';
import { HumanModule } from './src/modules/human.mjs';
import { addToQueue } from './src/modules/queue.mjs';
import { ManagerModule } from './src/modules/manager.mjs';

import { config } from './src/config.mjs';

let sock;
const app = express();
const server = http.createServer(app);
export const io = new Server(server);

app.use(cors());
app.use(express.json());
app.use(express.static('public'));
app.use(express.static('total/dist'));

setSocket(io);

// --- API DASHBOARD ---
app.post('/api/chat', async (req, res) => {
  const { message, jid } = req.body;
  try {
    const response = await askFrancesca(jid || 'web-admin', message, null);
    res.json({ success: true, text: response });
  } catch (error) {
    res.status(500).json({ error: 'Neural error.' });
  }
});

// Robust Helper Function for Audio
async function sendVoiceResponse(jid, text, sock) {
  try {
    const { generateMicrosoftVoice } = await import('./src/modules/voice.mjs');
    const audioPath = await generateMicrosoftVoice(text);

    if (audioPath && fs.existsSync(audioPath)) {
      // Read the buffer to avoid file not found errors during sending
      const audioBuffer = fs.readFileSync(audioPath);

      await sock.sendMessage(jid, {
        audio: audioBuffer,
        mimetype: 'audio/mpeg',
        ptt: true,
      });

      // Cleanup the temporary file after sending
      setTimeout(() => {
        if (fs.existsSync(audioPath)) fs.unlinkSync(audioPath);
      }, 20000);
    }
  } catch (e) {
    logEvent('SYSTEM', `Voice send error: ${e.message}`, 'ERROR');
    await sock.sendMessage(jid, { text: text });
  }
}
/**
 * WHATSAPP CORE LOGIC
 */
export async function handleIncomingMessage(m, sock) {
  const jid = m.key.remoteJid;
  const msgText =
    m.message?.conversation ||
    m.message?.extendedTextMessage?.text ||
    m.message?.imageMessage?.caption ||
    '';

  try {
    // 0. MANAGER LOGIC: Check if this is a Boss reply to an escalation
    const isHandledByBoss = await ManagerModule.handleBossReply(sock, m);
    if (isHandledByBoss) return;

    // 1. WhatsApp UX: 'Seen' blue ticks immediately
    await HumanModule.markAsRead(sock, m);

    if (msgText.toLowerCase().startsWith('invia')) {
      await sendRequestedFile(sock, jid, msgText);
      return;
    }

    if (m.message?.documentMessage || m.message?.documentWithCaptionMessage) {
      // 2. WhatsApp UX: 'Typing...' while AI processes document
      await HumanModule.startPresence(sock, jid);
      const docResult = await handleDocumentMedia(m, jid, sock);
      if (docResult?.analysis) await sock.sendMessage(jid, { text: docResult.analysis });
      await HumanModule.stopPresence(sock, jid);
      return;
    }

    const isMedia = m.message?.imageMessage || m.message?.audioMessage;
    if (isMedia) {
      // 2. WhatsApp UX: 'Recording...' or 'Typing...' based on media
      const presenceMode = m.message?.audioMessage ? 'recording' : 'composing';
      await HumanModule.startPresence(sock, jid, presenceMode);

      const res = await handleMedia(m, jid);
      if (!res?.buffer) {
        await HumanModule.stopPresence(sock, jid);
        return;
      }

      if (res.type === 'audio') {
        const transcribedText = await processVoice(jid, res.buffer, sock);
        if (transcribedText) {
          const response = await askFrancesca(jid, transcribedText, sock);
          if (response) {
            // VOCAL MIRRORING: Audio -> Audio
            await sendVoiceResponse(jid, response, sock);
          }
        }
      } else {
        const response = await askFrancesca(
          jid,
          {
            text: res.caption || 'Analyze image',
            inlineData: { data: res.buffer.toString('base64'), mimeType: 'image/jpeg' },
          },
          sock
        );
        await sock.sendMessage(jid, { text: response });
      }
      if (res.path) await puliziaFile(res.path);
      await HumanModule.stopPresence(sock, jid);
      return;
    }

    if (msgText.trim().length > 0) {
      // 2. WhatsApp UX: 'Typing...' while AI thinks
      await HumanModule.startPresence(sock, jid);

      const response = await askFrancesca(jid, msgText, sock);
      if (!response) {
        await HumanModule.stopPresence(sock, jid);
        return;
      }

      const needsVoice = /parla|voce|audio|dimmi|ascolta|fammi un audio|spiegati/i.test(msgText);
      if (needsVoice) {
        await sendVoiceResponse(jid, response, sock);
      } else {
        await sock.sendMessage(jid, { text: response });
      }

      await HumanModule.stopPresence(sock, jid);
    }
  } catch (error) {
    logEvent('SYSTEM', `Error: ${error.message}`, 'ERROR');
    await HumanModule.stopPresence(sock, jid);
  }
} // <--- Closes handleIncomingMessage

/**
 * START WHATSAPP
 */
async function startBot() {
  const { state, saveCreds } = await useMultiFileAuthState('.auth_info');
  const { version } = await fetchLatestBaileysVersion();

  sock = makeWASocket({
    auth: state,
    logger: pino({ level: 'silent' }),
    version: version,
    browser: Browsers.ubuntu('Chrome'),
    syncFullHistory: false,
    connectTimeoutMs: 60000,
    keepAliveIntervalMs: 10000,
  });

  sock.ev.on('creds.update', saveCreds);

  sock.ev.on('connection.update', async (update) => {
    const { connection, lastDisconnect, qr } = update;
    if (qr) {
      process.stdout.write('\x1Bc');
      console.log('\n\x1b[42m\x1b[30m %s \x1b[0m', ' FRANCESCA CORE: QR GENERATED ');
      qrcode.generate(qr, { small: true });
      console.log('\n\x1b[33m%s\x1b[0m', '--- EMERGENCY LINK ---');
      console.log(
        `https://api.qrserver.com/v1/create-qr-code/?data=${encodeURIComponent(qr)}&size=300x300`
      );
      console.log('\x1b[33m%s\x1b[0m', '--------------------------\n');
    }

    if (connection === 'open') {
      process.stdout.write('\x1Bc');
      logEvent('SYSTEM', 'Francesca ONLINE on WhatsApp.', 'SUCCESS');
      flushDownloads();
    }

    if (connection === 'close') {
      const statusCode = lastDisconnect?.error?.output?.statusCode;
      const shouldReconnect = statusCode !== DisconnectReason.loggedOut;
      if (shouldReconnect) setTimeout(() => startBot(), 5000);
    }
  });

  sock.ev.on('messages.upsert', async ({ messages }) => {
    const m = messages[0];
    if (!m.message || m.key.fromMe) return;
    await addToQueue(m, sock);
  });
}

const PORT = config.port;
server.listen(PORT, '0.0.0.0', () => {
  logEvent('SYSTEM', `Server active on port ${PORT}`, 'SUCCESS');
});

startBot();
