import { promises as fs } from 'fs';
import path from 'path';
import { logEvent } from './logger.mjs'; // <--- Dashboard connection

/**
 * CLEANER MODULE V5.0 - "System Hygiene"
 * Deterministically removes temporary files (.ogg, .txt, .json, .srt).
 */
export async function puliziaFile(filePath) {
  try {
    // 1. Safety wait: ensures file descriptors are closed
    await new Promise((resolve) => setTimeout(resolve, 500));

    const extensions = ['.ogg', '.txt', '.json', '.srt', '.vtt', '.tsv'];
    const baseName = filePath.replace(path.extname(filePath), '');

    logEvent('SYSTEM', `File cleanup: ${path.basename(baseName)}`, 'INFO');

    for (const ext of extensions) {
      const fileToRemove = baseName + ext;
      try {
        await fs.access(fileToRemove);
        await fs.unlink(fileToRemove);
        console.log(`🗑️ Removed temp resource: ${ext}`);
      } catch (err) {
        if (err.code !== 'ENOENT') {
          logEvent('SYSTEM', `Error removing ${ext}`, 'ERROR');
        }
      }
    }
  } catch (globalErr) {
    logEvent('SYSTEM', 'Critical cleaner error', 'ERROR');
    console.error('🚨 [CLEANER CRITICAL]:', globalErr.message);
  }
}

/**
 * Function to periodically empty the downloads folder
 */
export async function flushDownloads() {
  const downloadsDir = path.join(process.cwd(), 'downloads');
  try {
    const files = await fs.readdir(downloadsDir);
    if (files.length <= 1) return; // Do not log if empty (except .gitkeep)

    logEvent('SYSTEM', 'Emptying downloads folder...', 'QUEUE');

    for (const file of files) {
      if (file !== '.gitkeep') {
        await fs.unlink(path.join(downloadsDir, file));
      }
    }

    logEvent('SYSTEM', 'System hygiene completed', 'SUCCESS');
    console.log('🧼 [CLEANER] Downloads folder emptied.');
  } catch (err) {
    console.error('🚨 [CLEANER FLUSH ERROR]:', err.message);
  }
}
