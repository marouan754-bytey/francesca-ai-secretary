import { promises as fs } from 'fs';
import path from 'path';
import { vectorIndexer } from './memory.mjs';
import { logEvent } from './logger.mjs';

const CLOUD_BASE = path.join(process.cwd(), 'src/cloud');

/**
 * Salva i file in modo organizzato: /Azienda/Nome/Mensilità/file.pdf
 * E istruisce la memoria vettoriale sul contenuto.
 */
export async function saveOrganizedFile(buffer, info, mimetype, parereFrancesca = '') {
  try {
    // Pulizia nomi per evitare errori di sistema operativo (caratteri vietati)
    const az = (info.azienda || 'Sconosciuto').replace(/[/\\?%*:|"<>]/g, '-').trim();
    const nom = (info.nome || 'Sconosciuto').replace(/[/\\?%*:|"<>]/g, '-').trim();
    const mens = (info.mensilita || 'Senza-Data').replace(/[/\\?%*:|"<>]/g, '-').trim();

    // Creazione percorso gerarchico
    const dir = path.join(CLOUD_BASE, az, nom, mens);

    // Controllo e creazione cartelle asincrona
    await fs.mkdir(dir, { recursive: true });

    const ext = mimetype.includes('pdf') ? 'pdf' : 'jpg';
    const fileName = `${Date.now()}_doc.${ext}`;
    const filePath = path.join(dir, fileName);

    // 1. Salvataggio fisico sul disco
    await fs.writeFile(filePath, buffer);
    logEvent('INDEX', `File archiviato: ${az}/${nom}`, 'SUCCESS');

    // 2. Generazione stringa di memoria per il Database Vettoriale
    const memoriaDaSalvare = `[ARCHIVIO CLOUD] Documento di ${nom} per l'azienda ${az}. 
        Periodo: ${mens}. 
        Percorso locale: ${filePath}. 
        Contesto/Analisi: ${parereFrancesca}`;

    // 3. Indicizzazione neurale
    try {
      const userJid = info.jid || 'The Boss';
      await vectorIndexer(userJid, memoriaDaSalvare);
      logEvent('VECTOR', `Indicizzato: ${nom} (${az})`, 'INFO');
    } catch (err) {
      logEvent('SYSTEM', `Errore indicizzazione: ${err.message}`, 'ERROR');
    }

    return { az, nom, mens, filePath, fileName };
  } catch (error) {
    logEvent('SYSTEM', `Errore Storage: ${error.message}`, 'ERROR');
    throw error;
  }
}
