import fs from 'fs';
import path from 'path';
import OpenAI from 'openai';
import { logEvent } from './logger.mjs';
import { vectorIndexer } from './memory.mjs';
import dotenv from 'dotenv';
import ffmpeg from 'fluent-ffmpeg';
import ffmpegInstaller from '@ffmpeg-installer/ffmpeg';

ffmpeg.setFfmpegPath(ffmpegInstaller.path);

dotenv.config();

const groq = new OpenAI({
  apiKey: process.env.GROQ_API_KEY,
  baseURL: 'https://api.groq.com/openai/v1',
});

/**
 * Handles transcription and decides if the content is worthy of neural memory.
 */
export async function processVoice(jid, audioBuffer) {
  const timestamp = Date.now();
  const safeJid = jid.replace(/[^a-zA-Z0-9]/g, '_');
  const tempFileName = `voice_in_${safeJid}_${timestamp}.ogg`;
  const tempFilePath = path.join(process.cwd(), tempFileName);
  const convertedFileName = `voice_out_${safeJid}_${timestamp}.mp3`;
  const convertedFilePath = path.join(process.cwd(), convertedFileName);

  try {
    logEvent('EAR', `🎙️ Preparing audio for Groq...`, 'QUEUE');

    // Temporary physical write of the raw file from WhatsApp
    fs.writeFileSync(tempFilePath, audioBuffer);

    // Convert to MP3 via FFmpeg
    await new Promise((resolve, reject) => {
      ffmpeg(tempFilePath)
        .toFormat('mp3')
        .on('error', (err) => {
          logEvent('EAR', `❌ FFmpeg conversion error: ${err.message}`, 'ERROR');
          reject(err);
        })
        .on('end', () => {
          resolve();
        })
        .save(convertedFilePath);
    });

    logEvent('EAR', `🎙️ Ultra-fast transcription with Groq...`, 'QUEUE');

    // 1. TRANSCRIPTION (Most accurate model available)
    const transcription = await groq.audio.transcriptions.create({
      file: fs.createReadStream(convertedFilePath),
      model: 'whisper-large-v3',
      language: 'it',
      response_format: 'verbose_json', // Request more details to filter better
    });

    // Immediate cleanup of temporary files
    if (fs.existsSync(tempFilePath)) fs.unlinkSync(tempFilePath);
    if (fs.existsSync(convertedFilePath)) fs.unlinkSync(convertedFilePath);

    const text = transcription.text.trim();

    // --- FILTER 1: ANTI-HALLUCINATION ---
    // Whisper sometimes invents text on silent audio (e.g., "Subtitles by..")
    if (transcription.duration < 0.5 || text.length < 3) {
      logEvent('EAR', `⚠️ Audio too short or null. Ignored.`, 'INFO');
      return null;
    }

    // --- FILTER 2: RELEVANCE ANALYSIS (For Memory) ---
    // We don't want the neural memory filled with "Hello", "Hey Boss", "Ok"
    const paroleInutili = ['ciao', 'ehi', 'buongiorno', 'ok', 'va bene', 'grazie', 'fatto'];
    const isGeneric = paroleInutili.includes(
      text.toLowerCase().replace(/[.,/#!$%^&*;:{}=\-_`~()]/g, '')
    );

    logEvent('EAR', `✅ Transcribed: "${text}"`, 'SUCCESS');

    // --- FILTER 3: SELECTIVE INDEXING ---
    // We save to vector_db only if it's useful information (> 15 chars and not generic)
    if (!isGeneric && text.length > 15) {
      await vectorIndexer(jid, `[VOCAL]: ${text}`, 'vocal_note');
      logEvent('VECTOR', `🧠 Important vocal note saved in memory.`, 'SUCCESS');
    } else {
      logEvent('VECTOR', `🗑️ Transcription not saved in memory (too generic).`, 'INFO');
    }

    return text;
  } catch (error) {
    logEvent('SYSTEM', `🚨 Groq Audio Error: ${error.message}`, 'ERROR');
    if (fs.existsSync(tempFilePath)) fs.unlinkSync(tempFilePath);
    if (fs.existsSync(convertedFilePath)) fs.unlinkSync(convertedFilePath);
    return null;
  }
}
