import { MsEdgeTTS, OUTPUT_FORMAT } from 'msedge-tts';
import fs from 'fs';
import path from 'path';
import { logEvent } from './logger.mjs';

/**
 * VOICE MODULE V2.1 - "Elsa's Clarity"
 * High-quality Microsoft Edge TTS integration.
 */
export async function generateMicrosoftVoice(text) {
  try {
    const tts = new MsEdgeTTS();

    // Configure Elsa (Italian Voice)
    // The format should be set using the exported constant for safety
    await tts.setMetadata('it-IT-ElsaNeural', OUTPUT_FORMAT.AUDIO_24KHZ_48KBITRATE_MONO_MP3);

    const tempDir = path.join(process.cwd(), 'temp');
    if (!fs.existsSync(tempDir)) fs.mkdirSync(tempDir, { recursive: true });

    const randomSuffix = Math.random().toString(36).substring(2, 8);
    const fileName = `voice_out_${Date.now()}_${randomSuffix}.mp3`;
    const filePath = path.join(tempDir, fileName);

    logEvent('VOICE', `Generating audio for: "${text.substring(0, 30)}..."`, 'QUEUE');

    // msedge-tts v2 uses toStream(text) which returns a readable stream
    // Some versions might require awaiting or handling as a Promise
    const readable = await tts.toStream(text);

    if (!readable || typeof readable.pipe !== 'function') {
      throw new Error('TTS toStream did not return a valid pipeable stream.');
    }

    const writable = fs.createWriteStream(filePath);

    return new Promise((resolve, reject) => {
      readable.pipe(writable);

      writable.on('finish', () => {
        logEvent('VOICE', `Audio generated: ${fileName}`, 'SUCCESS');
        resolve(filePath);
      });

      writable.on('error', (err) => {
        logEvent('VOICE', `TTS Writable error: ${err.message}`, 'ERROR');
        reject(err);
      });

      readable.on('error', (err) => {
        logEvent('VOICE', `TTS Readable error: ${err.message}`, 'ERROR');
        reject(err);
      });
    });
  } catch (err) {
    logEvent('VOICE', `Critical TTS Error: ${err.message}`, 'ERROR');
    throw err;
  }
}
