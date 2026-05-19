import { downloadMediaMessage } from '@whiskeysockets/baileys';
import fs from 'fs/promises';
import path from 'path';
import puppeteer from 'puppeteer';
import { askFrancesca } from './brain.mjs';
import { vectorIndexer } from './memory.mjs';
import { registraContatto } from './profiler.mjs';
import { logEvent } from './logger.mjs';

/**
 * 1. FUNCTION: handleMedia
 * Purpose: Downloads bytes from WhatsApp (Supports DOC, IMG, and AUDIO).
 */
export async function handleMedia(m) {
  try {
    const msg = m.message;

    // Identify media types
    const doc = msg?.documentMessage || msg?.documentWithCaptionMessage?.message?.documentMessage;
    const img = msg?.imageMessage;
    const audio = msg?.audioMessage;

    logEvent('MEDIA', `Downloading (${audio ? 'AUDIO' : doc ? 'DOC' : 'IMG'})...`, 'QUEUE');

    const buffer = await downloadMediaMessage(m, 'buffer', {});

    // Determine the type for index.mjs routing
    let type = 'unknown';
    if (doc) type = 'doc';
    else if (img) type = 'img';
    else if (audio) type = 'audio';

    return {
      buffer,
      type, // <--- CRITICAL for index.mjs
      mimetype: doc?.mimetype || img?.mimetype || audio?.mimetype,
      fileName: doc?.fileName || `media_${Date.now()}`,
      caption: img?.caption || '',
    };
  } catch (err) {
    logEvent('MEDIA', `Download error: ${err.message}`, 'ERROR');
    return null;
  }
}
/**
 * 2. FUNCTION: extractData
 * Purpose: OCR via Puppeteer.
 */
async function extractData(buffer, mimetype) {
  if (mimetype === 'application/pdf') {
    let browser;
    try {
      logEvent('SYSTEM', 'Starting Puppeteer for PDF extraction...', 'INFO');
      browser = await puppeteer.launch({ headless: 'new', args: ['--no-sandbox'] });
      const page = await browser.newPage();
      const dataUrl = `data:application/pdf;base64,${buffer.toString('base64')}`;
      await page.goto(dataUrl, { waitUntil: 'domcontentloaded' });
      const text = await page.evaluate(() => {
        /* global document */
        return document.body.innerText;
      });
      await browser.close();
      return text.replace(/\s+/g, ' ').trim();
    } catch (err) {
      if (browser) await browser.close();
      logEvent('SYSTEM', `Puppeteer error: ${err.message}`, 'WARNING');
      return '';
    }
  }
  return '';
}

/**
 * 3. FUNCTION: saveOrganizedFile
 */
async function saveOrganizedFile(persona, azienda, fileName, buffer) {
  const safePersona = (persona || 'Unknown')
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]/g, '_');
  const safeAzienda = (azienda || 'Private')
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]/g, '_');

  const targetDir = path.join(process.cwd(), 'storage', 'archive', safePersona, safeAzienda);
  await fs.mkdir(targetDir, { recursive: true });

  const finalPath = path.join(targetDir, `${Date.now()}_${fileName}`);
  await fs.writeFile(finalPath, buffer);
  return finalPath;
}

/**
 * 4. FUNCTION: handleDocumentMedia (THE DIRECTOR)
 */
export async function handleDocumentMedia(m, jid, sock) {
  try {
    // --- STEP 1: DOWNLOAD ---
    const media = await handleMedia(m);
    if (!media) throw new Error('Unrecoverable media.');

    // --- STEP 2: RESILIENT AI ANALYSIS ---
    logEvent('BRAIN', 'Francesca is reading the document...', 'INFO');
    const promptTecnico = `Analyze this document and return ONLY JSON:
        {
          "persona": "First Last Name",
          "azienda": "Company Name",
          "mese": "Reference Month",
          "sintesi": "What the file contains",
          "parere": "Your professional comment as an astute assistant"
        }`;

    const aiRawResult = await askFrancesca(
      jid,
      {
        text: promptTecnico,
        inlineData: { data: media.buffer.toString('base64'), mimeType: media.mimetype },
      },
      sock
    );

    const cleanJson = aiRawResult.replace(/```json|```/g, '').trim();
    const data = JSON.parse(cleanJson);

    // --- STEP 3: OCR ---
    const testoEstratto = await extractData(media.buffer, media.mimetype);

    // --- STEP 4: ARCHIVING ---
    const pathFinale = await saveOrganizedFile(
      data.persona,
      data.azienda,
      media.fileName,
      media.buffer
    );
    logEvent('INDEX', `Archived: ${data.persona}/${data.azienda}`, 'SUCCESS');

    // --- STEP 5: MEMORY ---
    const memoriaDoc = `DOC: ${data.persona} - ${data.azienda}. Summary: ${data.sintesi}. Text: ${testoEstratto.substring(0, 2000)}`;
    await vectorIndexer(jid, memoriaDoc);
    await registraContatto({ persona: data.persona, nota: `Archived ${data.sintesi}` });

    // --- STEP 6: FRANCESCA'S OPINION ---
    const istruzioneSistema = `[ARCHIVE_SYSTEM]
        Person: ${data.persona} | Company: ${data.azienda} | Summary: ${data.sintesi}
        Francesca, confirm the archiving to the Boss and comment with your proactive style.`;

    const rispostaFrancesca = await askFrancesca(jid, istruzioneSistema, sock);

    // 🔥 Send the message on WhatsApp
    if (rispostaFrancesca) {
      await sock.sendMessage(jid, { text: rispostaFrancesca });
    }

    return {
      analysis: rispostaFrancesca,
      stored: true,
      path: pathFinale,
    };
  } catch (err) {
    logEvent('SYSTEM', `🚨 Monolith Error: ${err.message}`, 'ERROR');
    return {
      analysis: 'Boss, I archived the file but I had a problem generating the final comment.',
      stored: false,
    };
  }
}
