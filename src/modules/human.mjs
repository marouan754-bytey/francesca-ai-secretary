import { searchMemories } from './memory.mjs';
import { personality } from './personality.mjs';
import { logEvent } from './logger.mjs';

/**
 * HUMAN V2.0 - "Francesca's Conscious Rhythm"
 * Orchestrates WhatsApp presence updates to simulate human attention.
 */

const delay = (ms) => new Promise((res) => setTimeout(res, ms));

export const HumanModule = {
  /**
   * 1. Sends the 'Blue Tick' (Read Receipt)
   */
  async markAsRead(sock, m) {
    if (!sock || !m.key.remoteJid) return;
    try {
      // Small "visual" delay (human reaction time to seeing the notification)
      await delay(500 + Math.random() * 1000);
      await sock.readMessages([m.key]);
      logEvent('HUMAN', `💙 Message marked as read for ${m.key.remoteJid}`, 'INFO');
    } catch (e) {
      logEvent('SYSTEM', `MarkAsRead error: ${e.message}`, 'WARNING');
    }
  },

  /**
   * 2. Shows 'Typing...' or 'Recording...' status
   */
  async startPresence(sock, jid, mode = 'composing') {
    if (!sock || !jid) return;
    try {
      // mode can be 'composing' (typing) or 'recording' (audio)
      await sock.sendPresenceUpdate(mode, jid);
    } catch (e) {
      logEvent('SYSTEM', `Presence update error: ${e.message}`, 'WARNING');
    }
  },

  /**
   * 3. Stops presence updates (shows as Online or nothing)
   */
  async stopPresence(sock, jid) {
    if (!sock || !jid) return;
    try {
      await sock.sendPresenceUpdate('paused', jid);
    } catch (e) {
      logEvent('SYSTEM', `Stop presence error: ${e.message}`, 'WARNING');
    }
  },

  /**
   * Legacy method kept for backward compatibility (internal use only)
   */
  async simulateHumanPresence(sock, m) {
    const jid = m.key.remoteJid;
    await this.markAsRead(sock, m);
    await delay(1000);
    await this.startPresence(sock, jid);
    await delay(2000);
  },

  /**
   * Special dates management
   */
  checkSpecialDate() {
    const oggi = new Date();
    const d = oggi.getDate();
    const m = oggi.getMonth() + 1;

    // Admin's Birthday (The Boss)
    if (d === 29 && m === 7) {
      return "\n[SYSTEM NOTIFICATION: Today is the Boss's birthday! Be sweet, festive, and make them feel special.]";
    }
    return '';
  },

  /**
   * Generates the "Human Touch" for the final prompt
   */
  async getHumanTouch(jid, message, isAdmin = false) {
    const specialDate = this.checkSpecialDate();
    const memories = await searchMemories(jid, message, isAdmin);

    return {
      instruction: `${personality.getInstruction()}\n[CURRENT CONTEXT]: You are in Wolfsburg. If the Boss is tired or stressed, adapt your tone. ${specialDate}`,
      memories: memories,
    };
  },
};

/**
 * Specific reaction for voice messages
 */
export async function handleHumanAudioReaction(sock, m) {
  try {
    await HumanModule.markAsRead(sock, m);
    await delay(1000);

    await sock.sendMessage(m.key.remoteJid, {
      react: { text: '👂', key: m.key },
    });

    logEvent('HUMAN', "👂 'Listening' reaction sent for audio.", 'SUCCESS');
  } catch (e) {
    logEvent('SYSTEM', `Audio reaction error: ${e.message}`, 'ERROR');
  }
}
