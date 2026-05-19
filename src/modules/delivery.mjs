import fs from 'fs';
import path from 'path';
import { logEvent } from './logger.mjs';

/**
 * DELIVERY MODULE V1.0 - "The Courier"
 * Handles searching and sending files from the archive.
 */

const ARCHIVE_ROOT = path.join(process.cwd(), 'storage', 'archive');

export async function sendRequestedFile(sock, jid, msgText) {
  try {
    // Extract file name from message (e.g., "invia fattura Rossi")
    const searchTerms = msgText
      .replace(/invia|mandami|inviami/i, '')
      .trim()
      .toLowerCase();

    if (!searchTerms) {
      await sock.sendMessage(jid, { text: "Cosa vorresti che ti inviassi? Specifica il nome del file o dell'azienda." });
      return;
    }

    logEvent('DELIVERY', `Searching for: "${searchTerms}"`, 'INFO');

    const foundFiles = [];

    // Recursive search in the archive
    function searchRecursive(dir) {
      if (!fs.existsSync(dir)) return;
      const items = fs.readdirSync(dir);

      for (const item of items) {
        const fullPath = path.join(dir, item);
        const stat = fs.statSync(fullPath);

        if (stat.isDirectory()) {
          searchRecursive(fullPath);
        } else if (item.toLowerCase().includes(searchTerms)) {
          foundFiles.push({ name: item, path: fullPath });
        }
      }
    }

    searchRecursive(ARCHIVE_ROOT);

    if (foundFiles.length === 0) {
      await sock.sendMessage(jid, { text: `Mi dispiace, non ho trovato alcun file che corrisponda a "${searchTerms}" nei miei archivi.` });
      return;
    }

    // If multiple files found, send the most recent one (or all?)
    // For now, let's send the most recent one to avoid spamming
    const targetFile = foundFiles.sort((a, b) => fs.statSync(b.path).mtimeMs - fs.statSync(a.path).mtimeMs)[0];

    logEvent('DELIVERY', `Sending file: ${targetFile.name}`, 'SUCCESS');

    await sock.sendMessage(jid, {
      document: fs.readFileSync(targetFile.path),
      fileName: targetFile.name,
      mimetype: 'application/pdf', // Default, Baileys usually handles this well
    });

    if (foundFiles.length > 1) {
      await sock.sendMessage(jid, { text: `Ho trovato più file, ti ho inviato il più recente. Se ne cercavi un altro, sii più specifico!` });
    }

  } catch (error) {
    logEvent('DELIVERY', `Error delivering file: ${error.message}`, 'ERROR');
    await sock.sendMessage(jid, { text: "Ho avuto un problema tecnico nel recuperare il file. Riprova più tardi." });
  }
}
