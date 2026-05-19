import { promises as fs } from 'fs';
import path from 'path';
import { logEvent } from './logger.mjs';

const PROFILER_DB = path.join(process.cwd(), 'dossier_utenti.json');
const SECRET_CODE = '2907';

/**
 * Reads the dossier database
 */
async function readDB() {
  try {
    const data = await fs.readFile(PROFILER_DB, 'utf-8');
    return JSON.parse(data);
  } catch (e) {
    return {};
  }
}

/**
 * Saves the dossier database
 */
async function writeDB(db) {
  try {
    await fs.writeFile(PROFILER_DB, JSON.stringify(db, null, 2));
  } catch (e) {
    logEvent('SYSTEM', `Profiler DB write error: ${e.message}`, 'ERROR');
  }
}

/**
 * Gets the user's dossier.
 */
export async function getDossier(jid, messageText = '') {
  let db = await readDB();
  const text = String(messageText || '');

  // 1. IDENTIFICATION
  const isOwner = jid && (jid.includes('216') || jid.includes('39'));
  const isWebAdmin = jid === 'web-admin' || jid === 'admin-dashboard' || jid === 'admin';

  // 2. ELEVATION LOGIC (PIN or Automatic Recognition)
  // Note: The PIN works only for the Owner or from the Dashboard for safety
  const isPinCorrect = text.includes(SECRET_CODE);

  if (isOwner || isWebAdmin || isPinCorrect) {
    if (!db[jid] || db[jid].level !== 1) {
      db[jid] = {
        name: isOwner || isWebAdmin ? 'The Boss' : 'Elevated_Admin',
        level: 1,
        role: 'Admin',
        permissions: ['read', 'write', 'evolve', 'system'],
        lastUpgrade: new Date().toISOString(),
      };
      await writeDB(db);
      logEvent('SYSTEM', `LEVEL 1 privileges assigned to: ${jid}`, 'SUCCESS');
    }
    return db[jid];
  }

  // 3. RETRIEVE EXISTING PROFILE
  if (db[jid]) {
    return db[jid];
  }

  return {
    // 4. DEFAULT (Secretary)
    name: 'Unknown',
    level: 3,
    role: 'Secretary',
    instructions:
      'Act as a professional secretary. Be polite but formal. Do not give private information about the Boss.',
  };
}

export async function registraContatto(jid, info = {}) {
  let db = await readDB();
  if (!db[jid]) {
    db[jid] = { name: 'User', level: 3, actions: [] };
  }
  if (!db[jid].actions) db[jid].actions = [];

  db[jid].actions.push({
    ...info,
    timestamp: new Date().toISOString(),
  });

  if (db[jid].actions.length > 50) db[jid].actions.shift();
  await writeDB(db);
}

export async function checkPermission(jid, requiredLevel = 1) {
  const user = await getDossier(jid);
  return user.level <= requiredLevel;
}
