import fs from 'fs';
import path from 'path';
import { pipeline } from '@xenova/transformers';
import { logEvent } from './logger.mjs';
import dotenv from 'dotenv';

dotenv.config();

const DB_PATH = path.join(process.cwd(), 'database.json');
const VECTOR_DB_PATH = path.join(process.cwd(), 'vector_db.json');

// RAM memory for instant and multi-thread reads
let vectorDatabase = [];
let standardDatabase = {};
let embedder = null;

// Lock management for async and safe writes
let isWritingDB = false;
let pendingDBWrite = false;

let isWritingVector = false;
let pendingVectorWrite = false;

// 65% confidence threshold (more inclusive than 75%)
const SEMANTIC_THRESHOLD = 0.65;

function initBrain() {
  // Load Vector DB
  if (fs.existsSync(VECTOR_DB_PATH)) {
    try {
      const content = fs.readFileSync(VECTOR_DB_PATH, 'utf-8').trim();
      vectorDatabase = content ? JSON.parse(content) : [];
      logEvent('SYSTEM', `📡 Deep memory: ${vectorDatabase.length} fragments.`, 'SUCCESS');
    } catch (e) {
      logEvent('SYSTEM', '🚨 Corrupted Vector DB error. Resetting...', 'ERROR');
      vectorDatabase = [];
    }
  }

  // Load Standard DB
  if (fs.existsSync(DB_PATH)) {
    try {
      const content = fs.readFileSync(DB_PATH, 'utf-8').trim();
      standardDatabase = content ? JSON.parse(content) : {};
    } catch (e) {
      logEvent('SYSTEM', '🚨 Corrupted Standard DB error. Resetting...', 'ERROR');
      standardDatabase = {};
    }
  } else {
    standardDatabase = {};
    fs.writeFileSync(DB_PATH, JSON.stringify(standardDatabase), 'utf-8');
  }
}
initBrain();

function cosineSimilarity(vecA, vecB) {
  let dotProduct = 0,
    normA = 0,
    normB = 0;
  for (let i = 0; i < vecA.length; i++) {
    dotProduct += vecA[i] * vecB[i];
    normA += vecA[i] * vecA[i];
    normB += vecB[i] * vecB[i];
  }
  return dotProduct / (Math.sqrt(normA) * Math.sqrt(normB));
}

async function getEmbedder() {
  if (!embedder) {
    logEvent('SYSTEM', '📥 Loading BGE-Small (High Precision)...', 'QUEUE');
    try {
      embedder = await pipeline('feature-extraction', 'Xenova/bge-small-en-v1.5', {
        quantized: true,
      });
      logEvent('SYSTEM', '✅ BGE Model Ready.', 'SUCCESS');
    } catch (error) {
      logEvent('SYSTEM', `❌ Embedding loading error: ${error.message}`, 'ERROR');
      throw error;
    }
  }
  return embedder;
}

export async function getEmbedding(text) {
  const pipe = await getEmbedder();
  const output = await pipe(text, { pooling: 'mean', normalize: true });
  return Array.from(output.data);
}

// Safe Vector DB write
async function safeWriteVectorDB() {
  if (isWritingVector) {
    pendingVectorWrite = true;
    return;
  }
  isWritingVector = true;
  pendingVectorWrite = false;

  try {
    await fs.promises.writeFile(VECTOR_DB_PATH, JSON.stringify(vectorDatabase, null, 2));
  } catch (err) {
    logEvent('SYSTEM', `❌ VectorDB save error: ${err.message}`, 'ERROR');
  } finally {
    isWritingVector = false;
    if (pendingVectorWrite) safeWriteVectorDB();
  }
}

export async function vectorIndexer(jid, content, category = 'general') {
  try {
    // If content is an object (multimodal), extract text
    const textContent = typeof content === 'object' ? content.text || '[Media]' : String(content);

    const finalContent =
      category !== 'general' ? `[${category.toUpperCase()}]: ${textContent}` : textContent;
    const embedding = await getEmbedding(finalContent);
    if (!embedding) return;

    const newEntry = { jid, content: finalContent, embedding, timestamp: new Date().toISOString() };
    vectorDatabase.push(newEntry);

    safeWriteVectorDB();
  } catch (err) {
    logEvent('SYSTEM', `❌ [INDEXER ERROR]: ${err.message}`, 'ERROR');
  }
}

export async function searchMemories(jid, query, isAdmin = false) {
  try {
    if (vectorDatabase.length === 0) return '';
    const queryEmbedding = await getEmbedding(query);
    if (!queryEmbedding) return '';

    const matches = vectorDatabase
      .filter((doc) => isAdmin || doc.jid === jid)
      .map((doc) => ({
        content: doc.content,
        score: cosineSimilarity(queryEmbedding, doc.embedding),
        jid: doc.jid,
      }))
      .filter((m) => m.score >= SEMANTIC_THRESHOLD)
      .sort((a, b) => b.score - a.score);

    if (matches.length === 0) {
      logEvent('VECTOR', `🔍 No precise memories (Below ${SEMANTIC_THRESHOLD * 100}%)`, 'INFO');
      return '';
    }

    const results = matches.slice(0, 5).map((m) => {
      const source = isAdmin && m.jid !== jid ? ` [SOURCE: ${m.jid}]` : '';
      return `${m.content}${source}`;
    });
    logEvent(
      'VECTOR',
      `✅ Found ${results.length} accurate fragments (Global: ${isAdmin}).`,
      'SUCCESS'
    );

    return `[CERTIFIED MEMORIES]: \n${results.join('\n---\n')}`;
  } catch (e) {
    return '';
  }
}

// --- STANDARD DATABASE MANAGEMENT ---
export function loadDatabase() {
  // Now returns the RAM copy, instant and safe
  return standardDatabase;
}

// Safe DB write
async function safeWriteDB() {
  if (isWritingDB) {
    pendingDBWrite = true;
    return;
  }
  isWritingDB = true;
  pendingDBWrite = false;

  try {
    await fs.promises.writeFile(DB_PATH, JSON.stringify(standardDatabase, null, 2));
  } catch (err) {
    logEvent('SYSTEM', `❌ Standard DB save error: ${err.message}`, 'ERROR');
  } finally {
    isWritingDB = false;
    if (pendingDBWrite) safeWriteDB();
  }
}

export function saveDatabase(db) {
  // Update the memory reference
  standardDatabase = db;
  safeWriteDB();
}

export async function saveToDatabase(db, jid, role, content) {
  if (!db[jid]) db[jid] = [];

  let parts;
  if (typeof content === 'object') {
    if (content.parts) {
      parts = content.parts;
    } else if (content.text || content.inlineData) {
      // It's the new multimodal input format
      parts = [{ text: content.text || '[Media Analysis]' }];
    } else {
      parts = [{ text: JSON.stringify(content) }];
    }
  } else {
    parts = [{ text: String(content) }];
  }

  db[jid].push({ role, parts, timestamp: new Date().toISOString() });
  if (db[jid].length > 200) db[jid] = db[jid].slice(-50);
  saveDatabase(db);
}

export function cleanHistory(db, jid) {
  if (!db[jid]) return [];
  const validHistory = db[jid].filter(
    (msg) => msg.parts && msg.parts.length > 0 && (msg.parts[0].text || msg.parts[0].inlineData)
  );
  return validHistory.slice(-30);
}

export async function purgeMemories(queryName) {
  const initialLength = vectorDatabase.length;
  vectorDatabase = vectorDatabase.filter(
    (doc) => !doc.content.toLowerCase().includes(queryName.toLowerCase())
  );
  if (vectorDatabase.length !== initialLength) {
    safeWriteVectorDB();
    logEvent('VECTOR', `Removed ${initialLength - vectorDatabase.length} tracks.`, 'SUCCESS');
  }
}
