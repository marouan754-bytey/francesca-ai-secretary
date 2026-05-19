import { exec } from 'child_process';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { askFrancesca } from '../modules/brain.mjs';

const homeDir = os.homedir();

export function getSystemReport() {
  return new Promise((resolve) => {
    const totalMem = (os.totalmem() / 1024 ** 3).toFixed(2);
    const freeMem = (os.freemem() / 1024 ** 3).toFixed(2);
    const uptime = (os.uptime() / 3600).toFixed(1);

    // Scansione periferiche: USB, Stampanti (lpstat) e Dischi
    exec('lpstat -p 2>/dev/null; lsusb; df -h / | tail -1', (err, stdout) => {
      const output = stdout || '';
      const hasPrinter =
        output.includes('printer') || output.includes('attesa') ? '✅ Rilevata' : '❌ Non trovata';
      const usbDevices = (output.match(/ID/g) || []).length;
      const disk = output.trim().split(/\s+/).slice(-3)[0] || 'N/D';

      const report =
        `📊 *REPORT HARDWARE*\n\n` +
        `🖥️ *Sistema:* ${os.type()} ${os.arch()}\n` +
        `🧠 *RAM:* ${freeMem}GB / ${totalMem}GB\n` +
        `💾 *Disco:* ${disk} liberi\n` +
        `🖨️ *Stampante:* ${hasPrinter}\n` +
        `🔌 *Periferiche USB:* ${usbDevices} attive\n` +
        `⏱️ *Uptime:* ${uptime} ore`;
      resolve(report);
    });
  });
}

export async function hardwareProcessAll(targetPath, jid) {
  try {
    const absolutePath = path.isAbsolute(targetPath) ? targetPath : path.join(homeDir, targetPath);
    if (!fs.existsSync(absolutePath)) throw new Error(`File inesistente: ${absolutePath}`);
    const fileBuffer = fs.readFileSync(absolutePath);

    const result = await askFrancesca(jid, {
      text: 'Analizza questo file per la gestione hardware/stampa.',
      fileBuffer: fileBuffer,
    });

    return result;
  } catch (error) {
    console.error('⚠️ [HARDWARE ERROR]:', error.message);
    throw error;
  }
}
