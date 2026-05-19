import { exec } from 'child_process';
import os from 'os';
import { logEvent } from './logger.mjs';
import { handleIncomingMessage } from '../../index.mjs';

// Map of separate queues per user
const userQueues = new Map();
// Set to keep track of which users are currently processing
const processingUsers = new Set();
const MAX_QUEUE_SIZE_PER_USER = 20;

// --- 🚀 2. AUTONOMOUS TASK MANAGER (Background Real-Time) ---
export const processTask = async (taskName, jid, sock, params = {}) => {
  const taskId = `ID_${Math.floor(Math.random() * 1000)}`;

  // Start message: DRY AND SHORT
  await sock.sendMessage(jid, {
    text: `⏳ *Task started:* ${taskName}\nID: ${taskId}\n_I will notify you when I am done._`,
  });

  // Execution outside the main flow (Background)
  new Promise((resolve, reject) => {
    let command = params.args?.command || params.query || '';
    if (taskName === 'compila_zip') {
      command =
        os.platform() === 'win32'
          ? `powershell -Command "Compress-Archive -Path . -DestinationPath ../backup_${taskId}.zip -Force"`
          : `tar -czf ../backup_${taskId}.tar.gz .`;
    }

    if (!command) return reject('Empty command.');

    exec(command, { cwd: './' }, (error, stdout) => {
      if (error) reject(error);
      else resolve(stdout);
    });
  })
    .then(async (stdout) => {
      // END NOTIFICATION: ONLY THE FACTS
      await sock.sendMessage(jid, {
        text: `✅ *Finished:* ${taskName}\n\n${museruola(stdout, 300)}`,
      });
    })
    .catch(async (err) => {
      await sock.sendMessage(jid, {
        text: `❌ *Failed:* ${taskName}\nError: ${museruola(err.message, 50)}`,
      });
    });

  // NO await here: the function ends immediately and frees the chat!
};

// --- 📥 3. MULTI-USER MESSAGE QUEUE MANAGER (Parallel Multi-Tasking) ---
export async function addToQueue(m, sock) {
  const jid = m.key.remoteJid;

  if (!userQueues.has(jid)) {
    userQueues.set(jid, []);
  }

  const queue = userQueues.get(jid);

  if (queue.length >= MAX_QUEUE_SIZE_PER_USER) {
    return await sock.sendMessage(jid, {
      text: '⚠️ Too many requests in queue. Please wait for previous answers.',
    });
  }

  queue.push({ m, sock });

  // If this user is not processing, start their loop
  if (!processingUsers.has(jid)) {
    processNextForUser(jid);
  }
}

async function processNextForUser(jid) {
  const queue = userQueues.get(jid);

  if (!queue || queue.length === 0) {
    processingUsers.delete(jid);
    return;
  }

  processingUsers.add(jid);
  const { m, sock } = queue.shift();

  try {
    logEvent('QUEUE', `▶️ Processing for [${jid}]. Remaining queue: ${queue.length}`, 'INFO');
    await handleIncomingMessage(m, sock);
  } catch (err) {
    logEvent('CRITICAL', `Error for [${jid}]: ${err.message}`, 'ERROR');
  }

  // Move to the next message OF THIS USER after a small pause
  setTimeout(() => processNextForUser(jid), 700);
}

/**
 * Truncates text for WhatsApp notifications
 */
function museruola(text, max = 300) {
  if (!text) return '';
  return text.length > max ? text.substring(0, max) + '...' : text;
}
